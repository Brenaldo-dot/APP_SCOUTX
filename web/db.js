const { Pool, Client } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// O backend Python do Mega Minerador precisa do próprio banco, separado das
// tabelas deste app. Em vez de pedir pra alguém criar isso manualmente no
// mesmo servidor Postgres, criamos aqui no boot (idempotente — não faz nada
// se já existir). MINERADOR_DB_NAME é só o nome lógico do banco; a URL final
// pros serviços Python é a mesma do Postgres trocando o nome do banco no fim.
const MINERADOR_DB_NAME = "minerador_intel";

async function ensureMineradorDatabase() {
  if (!process.env.DATABASE_URL) return;
  const exists = await pool.query("SELECT 1 FROM pg_database WHERE datname = $1", [MINERADOR_DB_NAME]);
  if (exists.rows.length > 0) return;

  // CREATE DATABASE não pode rodar dentro de uma transação nem via pool
  // (o driver às vezes agrupa em transação implícita) — usamos um Client
  // solto, direto.
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(`CREATE DATABASE ${MINERADOR_DB_NAME}`);
    console.log(`Banco "${MINERADOR_DB_NAME}" criado para o Mega Minerador.`);
  } catch (err) {
    if (err.code !== "42P04") throw err; // 42P04 = database already exists (corrida com outro boot)
  } finally {
    await client.end();
  }
}

async function migrate() {
  // A tabela anterior guardava usuários pelo login OAuth do pm-board (schema
  // diferente, sem email/senha). Trocamos pra login próprio — como ainda não
  // tinha nenhum usuário real usando aquele fluxo, recriamos do zero.
  const hasOldSchema = await pool.query(`
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'app_users' AND column_name = 'pmboard_user_id'
  `);
  if (hasOldSchema.rows.length > 0) {
    await pool.query("DROP TABLE IF EXISTS search_logs");
    await pool.query("DROP TABLE IF EXISTS app_users");
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'collaborator',
      can_view_history BOOLEAN NOT NULL DEFAULT false,
      can_access_minerador BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS can_access_minerador BOOLEAN NOT NULL DEFAULT false;`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS search_logs (
      id SERIAL PRIMARY KEY,
      app_user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      tool TEXT NOT NULL,
      domain TEXT NOT NULL,
      url TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_search_logs_user ON search_logs(app_user_id);`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS login_events (
      id SERIAL PRIMARY KEY,
      app_user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      ip TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_login_events_user ON login_events(app_user_id);`);
}

async function countUsers() {
  const res = await pool.query("SELECT COUNT(*)::int AS n FROM app_users");
  return res.rows[0].n;
}

async function createUser({ name, email, passwordHash, role }) {
  const res = await pool.query(
    "INSERT INTO app_users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING *",
    [name, email.toLowerCase().trim(), passwordHash, role || "collaborator"]
  );
  return res.rows[0];
}

async function findUserByEmail(email) {
  const res = await pool.query("SELECT * FROM app_users WHERE email = $1", [email.toLowerCase().trim()]);
  return res.rows[0] || null;
}

async function getAppUserById(id) {
  const res = await pool.query("SELECT * FROM app_users WHERE id = $1", [id]);
  return res.rows[0] || null;
}

async function listUsersWithCounts() {
  const res = await pool.query(`
    SELECT u.id, u.name, u.email, u.role, u.can_view_history, u.can_access_minerador, u.created_at,
           COUNT(DISTINCT s.id)::int AS search_count,
           COUNT(DISTINCT l.ip)::int AS ip_count,
           (
             SELECT le.ip FROM login_events le
             WHERE le.app_user_id = u.id
             ORDER BY le.created_at DESC
             LIMIT 1
           ) AS last_ip
    FROM app_users u
    LEFT JOIN search_logs s ON s.app_user_id = u.id
    LEFT JOIN login_events l ON l.app_user_id = u.id
    GROUP BY u.id
    ORDER BY u.created_at ASC
  `);
  return res.rows;
}

async function logLogin(appUserId, ip) {
  await pool.query("INSERT INTO login_events (app_user_id, ip) VALUES ($1, $2)", [appUserId, ip || "desconhecido"]);
}

async function ipSummaryForUser(appUserId) {
  const res = await pool.query(
    `SELECT ip, COUNT(*)::int AS count, MIN(created_at) AS first_at, MAX(created_at) AS last_at
     FROM login_events
     WHERE app_user_id = $1
     GROUP BY ip
     ORDER BY last_at DESC`,
    [appUserId]
  );
  return res.rows;
}

async function updateUserPermissions(id, { role, canViewHistory, canAccessMinerador }) {
  const fields = [];
  const values = [];
  let i = 1;
  if (role !== undefined) {
    fields.push(`role = $${i++}`);
    values.push(role);
  }
  if (canViewHistory !== undefined) {
    fields.push(`can_view_history = $${i++}`);
    values.push(canViewHistory);
  }
  if (canAccessMinerador !== undefined) {
    fields.push(`can_access_minerador = $${i++}`);
    values.push(canAccessMinerador);
  }
  if (fields.length === 0) return;
  values.push(id);
  await pool.query(`UPDATE app_users SET ${fields.join(", ")} WHERE id = $${i}`, values);
}

async function deleteUser(id) {
  await pool.query("DELETE FROM app_users WHERE id = $1", [id]);
}

async function logSearch(appUserId, tool, domain, url) {
  await pool.query("INSERT INTO search_logs (app_user_id, tool, domain, url) VALUES ($1, $2, $3, $4)", [
    appUserId,
    tool,
    domain,
    url,
  ]);
}

async function historySummaryForUser(appUserId) {
  const res = await pool.query(
    `SELECT domain, tool, COUNT(*)::int AS count, MAX(created_at) AS last_at
     FROM search_logs
     WHERE app_user_id = $1
     GROUP BY domain, tool
     ORDER BY count DESC, last_at DESC`,
    [appUserId]
  );
  return res.rows;
}

module.exports = {
  pool,
  migrate,
  ensureMineradorDatabase,
  countUsers,
  createUser,
  findUserByEmail,
  getAppUserById,
  listUsersWithCounts,
  updateUserPermissions,
  deleteUser,
  logSearch,
  historySummaryForUser,
  logLogin,
  ipSummaryForUser,
};

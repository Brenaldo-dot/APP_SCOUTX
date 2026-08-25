const { Pool, Client } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Planos de venda do ScoutX — 3 planos fixos, não precisa ser configurável
// pelo admin. maxOperations/maxCompetitors em Infinity = sem limite
// (Enterprise). Se um dia mudar preço/limite, é troca de constante aqui, não
// de schema. As CHAVES (solo/pro/agencia) são só o identificador interno,
// gravado em organizations.plan — não mudam com o rebrand dos nomes de
// venda (Solo → Standard, Pro → Pro, Agência → Enterprise), só o "label"
// exibido pra pessoa muda.
//
// maxUsers é sempre 1 nos três planos — decisão de negócio: cada conta é de
// UMA equipe (1 login), não de N colaboradores dividindo uma assinatura;
// o que muda de plano pra plano é só o número de países/concorrentes.
// Fixo em 1 (não uma constante à parte) de propósito, pra não sobrar
// nenhuma trilha de "plano X permite N usuários" pra reintroduzir sem querer.
const PLAN_LIMITS = {
  solo: { label: "Standard", maxUsers: 1, maxOperations: 1, maxCompetitors: 50 },
  pro: { label: "Pro", maxUsers: 1, maxOperations: 3, maxCompetitors: 250 },
  agencia: { label: "Enterprise", maxUsers: 1, maxOperations: Infinity, maxCompetitors: Infinity },
};
const BILLING_CYCLE_DAYS = { mensal: 30, trimestral: 90, anual: 365 };

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
  // Bloqueio de login escalonado (revisão de segurança) — ver
  // failedLoginAttempt/checkLoginLock em server.js.
  await pool.query(`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;`);
  // Revisão de segurança: sessão hoje é só um cookie assinado com validade
  // de 30 dias, sem nenhuma lista de revogação — trocar a senha não
  // invalidava sessões já abertas em outro lugar (nem uma sessão roubada).
  // token_version vai dentro do cookie no login (auth.js/setSessionCookie);
  // toda troca de senha incrementa esse número (updateUserPassword, abaixo)
  // — qualquer cookie assinado com o número antigo passa a ser rejeitado
  // (requireAuth), mesmo com assinatura válida e prazo não vencido.
  await pool.query(`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;`);
  // Suspensão reversível — diferente de excluir: bloqueia login na hora
  // (checado em /login) sem apagar histórico/permissões, útil pra investigar
  // algo suspeito sem perder o usuário. role_changed_by_id/at é auditoria de
  // quem promoveu/rebaixou quem admin — dar admin é a ação mais sensível da
  // tela e antes disso não ficava registrado em lugar nenhum.
  await pool.query(`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS suspended BOOLEAN NOT NULL DEFAULT false;`);
  // Foto de perfil (Minha Conta) — guardada como data URI já redimensionada
  // no navegador (~256px, JPEG) antes de subir, então cabe tranquilo num
  // TEXT do Postgres sem precisar de storage de arquivo (S3 etc.) só pra
  // isso. TEXT sem limite de tamanho fixo — o teto de verdade é aplicado no
  // PATCH /api/me/avatar (server.js), não aqui.
  await pool.query(`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS avatar_url TEXT;`);
  await pool.query(`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS role_changed_by_id INTEGER;`);
  await pool.query(`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS role_changed_at TIMESTAMPTZ;`);
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

  // Log de auditoria administrativa — pedido do usuário pra rastrear quem
  // fez o quê entre vários admins (promoveu, suspendeu, resetou senha,
  // excluiu). actor/target_name são um SNAPSHOT do nome no momento da ação
  // (não FK) de propósito: um usuário excluído não pode deixar o log
  // ilegível ("Usuário #47 excluiu Usuário #52") só porque uma das duas
  // pontas sumiu depois.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_audit_log (
      id SERIAL PRIMARY KEY,
      actor_id INTEGER,
      actor_name TEXT NOT NULL,
      target_id INTEGER,
      target_name TEXT NOT NULL,
      action TEXT NOT NULL,
      details TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created ON admin_audit_log(created_at DESC);`);

  // Planos de venda — cada organização agrupa N logins (app_users) sob um
  // plano/ciclo/validade só. expires_at vencido bloqueia login de TODO
  // mundo da organização (checado em requireAuth/login, ver server.js).
  // notes é texto livre do admin (valor pago, canal de venda) — sem campo
  // estruturado de preço nessa fase (ativação ainda é manual).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS organizations (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      plan TEXT NOT NULL,
      billing_cycle TEXT NOT NULL,
      started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ NOT NULL,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
  await pool.query(`ALTER TABLE app_users ADD COLUMN IF NOT EXISTS organization_id INTEGER REFERENCES organizations(id);`);

  // País/operação que a conta escolheu na primeira vez que abriu o app —
  // até aqui isso só vivia no localStorage do NAVEGADOR (ver
  // OperationContext.jsx no React), então trocar de dispositivo/navegador,
  // ou até só limpar os dados do site, fazia perguntar de novo pra sempre.
  // NULL = essa organização ainda nunca escolheu (mostra o seletor
  // inicial); depois de escolhida uma vez, fica valendo pra sempre, mesmo
  // trocando de plano — não é a mesma coisa que "qual país está sendo
  // visto agora" (isso continua livre, ver seletor no menu lateral).
  await pool.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS default_operation TEXT;`);

  // Automação Cakto: cakto_purchase_id/cakto_customer_email identificam qual
  // organização veio de qual compra, pra um evento de cancelamento/reembolso
  // futuro (que só traz o ID da compra ou o email do comprador) achar a
  // organização certa pra suspender. NULL pras organizações criadas
  // manualmente pelo admin (a maioria hoje).
  await pool.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS cakto_purchase_id TEXT;`);
  await pool.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS cakto_customer_email TEXT;`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_organizations_cakto_purchase ON organizations(cakto_purchase_id) WHERE cakto_purchase_id IS NOT NULL;`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_organizations_cakto_email ON organizations(cakto_customer_email) WHERE cakto_customer_email IS NOT NULL;`);

  // Idempotência do webhook: a Cakto pode reenviar o mesmo evento (timeout,
  // retry automático dela) — sem isso, um reenvio de "purchase_approved"
  // criaria uma segunda organização/usuário pra mesma compra. Chave composta
  // (id da compra + evento) porque a MESMA compra gera vários eventos ao
  // longo do tempo (aprovada, depois talvez reembolsada).
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cakto_events (
      purchase_id TEXT NOT NULL,
      event TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'received',
      detail TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (purchase_id, event)
    );
  `);

  // Ponte entre o webhook (servidor a servidor) e a página /bem-vindo (que o
  // navegador do comprador abre depois do redirect da Cakto): a senha gerada
  // fica aqui em texto puro só até a página buscar UMA vez (consumeCaktoCredential
  // zera password_plain depois de entregar) ou expirar. Nunca deve acumular
  // linha permanente com senha em texto puro.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cakto_pending_credentials (
      ref_id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      password_plain TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      expires_at TIMESTAMPTZ NOT NULL,
      retrieved_at TIMESTAMPTZ
    );
  `);

  // Backfill: todo usuário collaborator que já existia antes dessa revisão
  // (e qualquer um sem organização por algum motivo) recebe uma organização
  // própria de "Legado", plano Enterprise (sem limite) e validade 10 anos no
  // futuro — ninguém trava no dia desse deploy. O admin reorganiza quem
  // realmente compartilha uma assinatura só depois, pela tela de
  // Organizações. Contas admin (role='admin') nunca recebem organização —
  // seguem sem limite, é o modelo delas hoje.
  const orphaned = await pool.query(
    "SELECT id, name FROM app_users WHERE organization_id IS NULL AND role != 'admin'"
  );
  for (const user of orphaned.rows) {
    const org = await pool.query(
      `INSERT INTO organizations (name, plan, billing_cycle, expires_at, notes)
       VALUES ($1, 'agencia', 'anual', now() + interval '10 years', 'Criada automaticamente na migração de planos — reorganizar se necessário')
       RETURNING id`,
      [`Legado — ${user.name}`]
    );
    await pool.query("UPDATE app_users SET organization_id = $1 WHERE id = $2", [org.rows[0].id, user.id]);
  }
}

// Só grava se ainda não tinha nada (NULL) — a primeira escolha da conta
// vale pra sempre, tentar chamar de novo depois não sobrescreve (evita uma
// chamada maliciosa/acidental de outro dispositivo "resetando" o país já
// decidido). Devolve a organização atualizada, com o valor que realmente
// ficou valendo (pode não ser o `value` passado, se já tinha outro antes).
async function setOrgDefaultOperationIfUnset(organizationId, value) {
  const res = await pool.query(
    `UPDATE organizations SET default_operation = $1 WHERE id = $2 AND default_operation IS NULL RETURNING *`,
    [value, organizationId]
  );
  if (res.rows[0]) return res.rows[0];
  return await getOrganizationById(organizationId);
}

async function countUsers() {
  const res = await pool.query("SELECT COUNT(*)::int AS n FROM app_users");
  return res.rows[0].n;
}

// Admin suspenso não conta — senão "o último admin ATIVO" ficaria escondido
// atrás de um admin que já nem consegue logar, e a trava deixaria de
// proteger contra o cenário real (ninguém com acesso de fato).
async function countActiveAdmins() {
  const res = await pool.query("SELECT COUNT(*)::int AS n FROM app_users WHERE role = 'admin' AND suspended = false");
  return res.rows[0].n;
}

async function createUser({ name, email, passwordHash, role, createdById, organizationId }) {
  const isAdmin = role === "admin";
  // Colaborador preso a uma organização é cliente pagante — ScoutX é o
  // PRÓPRIO produto vendido, não faz sentido nascer sem acesso a ele e
  // depender do admin lembrar de destravar depois manualmente (bug real:
  // usuário do plano Standard criado sem conseguir nem ver o app até alguém
  // notar e mexer no toggle). Admin continua sem esse campo fazer sentido
  // (já tem acesso total por ser admin).
  const canAccessMinerador = !isAdmin && !!organizationId;
  const res = await pool.query(
    `INSERT INTO app_users (name, email, password_hash, role, role_changed_by_id, role_changed_at, organization_id, can_access_minerador)
     VALUES ($1, $2, $3, $4, $5, ${isAdmin ? "now()" : "NULL"}, $6, $7) RETURNING *`,
    [
      name,
      email.toLowerCase().trim(),
      passwordHash,
      role || "collaborator",
      isAdmin ? createdById || null : null,
      isAdmin ? null : organizationId || null,
      canAccessMinerador,
    ]
  );
  return res.rows[0];
}

// org_plan/org_expires_at vêm junto (LEFT JOIN) porque requireAuth e /login
// checam o vencimento do plano a cada request — sem isso seria uma query a
// mais em todo request autenticado só pra saber se o plano venceu.
const USER_WITH_ORG_SELECT = `
  SELECT u.*, o.plan AS org_plan, o.expires_at AS org_expires_at, o.name AS org_name,
         o.default_operation AS org_default_operation
  FROM app_users u
  LEFT JOIN organizations o ON o.id = u.organization_id
`;

async function findUserByEmail(email) {
  const res = await pool.query(`${USER_WITH_ORG_SELECT} WHERE u.email = $1`, [email.toLowerCase().trim()]);
  return res.rows[0] || null;
}

async function getAppUserById(id) {
  const res = await pool.query(`${USER_WITH_ORG_SELECT} WHERE u.id = $1`, [id]);
  return res.rows[0] || null;
}

async function listUsersWithCounts() {
  // all_ips/last_login_at: admin pedia pra ver QUAL IP, não só "⚠️ N IPs" —
  // manda a lista inteira de uma vez (tabela de admin é pequena, não compensa
  // 1 request por usuário só pra popular isso na tela principal).
  const res = await pool.query(`
    SELECT u.id, u.name, u.email, u.role, u.can_access_minerador, u.created_at,
           u.failed_login_attempts, u.locked_until, u.suspended, u.role_changed_at,
           u.organization_id, o.name AS organization_name, o.plan AS organization_plan,
           o.expires_at AS organization_expires_at,
           (SELECT c.name FROM app_users c WHERE c.id = u.role_changed_by_id) AS role_changed_by_name,
           COUNT(DISTINCT s.id)::int AS search_count,
           COUNT(DISTINCT l.ip)::int AS ip_count,
           (
             SELECT le.ip FROM login_events le
             WHERE le.app_user_id = u.id
             ORDER BY le.created_at DESC
             LIMIT 1
           ) AS last_ip,
           (
             SELECT le.created_at FROM login_events le
             WHERE le.app_user_id = u.id
             ORDER BY le.created_at DESC
             LIMIT 1
           ) AS last_login_at,
           (
             SELECT array_agg(DISTINCT le.ip) FROM login_events le WHERE le.app_user_id = u.id
           ) AS all_ips
    FROM app_users u
    LEFT JOIN search_logs s ON s.app_user_id = u.id
    LEFT JOIN login_events l ON l.app_user_id = u.id
    LEFT JOIN organizations o ON o.id = u.organization_id
    GROUP BY u.id, o.name, o.plan, o.expires_at
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

async function updateUserPermissions(id, { role, canAccessMinerador, suspended, changedById, organizationId }) {
  const fields = [];
  const values = [];
  let i = 1;
  if (role !== undefined) {
    fields.push(`role = $${i++}`);
    values.push(role);
    // Auditoria: quem promoveu/rebaixou quem, e quando — mostrado na tabela
    // de Usuários pro admin saber depois "quem deu admin pra fulano".
    fields.push(`role_changed_by_id = $${i++}`);
    values.push(changedById || null);
    fields.push(`role_changed_at = now()`);
  }
  // organizationId: null explícito tira o usuário de qualquer organização
  // (admin não pertence a nenhuma) — undefined significa "não mexer nisso".
  // A checagem de limite de usuários do plano/organização de destino já foi
  // feita antes de chamar isto, em server.js (mesma regra do POST /api/admin/users).
  if (organizationId !== undefined) {
    fields.push(`organization_id = $${i++}`);
    values.push(organizationId);
  }
  if (canAccessMinerador !== undefined) {
    fields.push(`can_access_minerador = $${i++}`);
    values.push(canAccessMinerador);
  }
  if (suspended !== undefined) {
    fields.push(`suspended = $${i++}`);
    values.push(suspended);
    if (suspended) {
      // Mesmo mecanismo da troca de senha: mata qualquer sessão já aberta
      // na hora, senão o cookie já emitido (válido por até 30 dias) seguiria
      // funcionando normalmente apesar da suspensão.
      fields.push(`token_version = token_version + 1`);
    }
  }
  if (fields.length === 0) return;
  values.push(id);
  await pool.query(`UPDATE app_users SET ${fields.join(", ")} WHERE id = $${i}`, values);
}

// Bloqueio de login escalonado — pedido explícito do usuário, 3 níveis:
// 3 erros seguidos → 5 min de bloqueio; +2 erros (5 no total) → 10 min;
// +1 erro (6 no total) → bloqueado até um admin redefinir a senha (sem
// fluxo de email — decisão junto com o usuário, ver conversa). O contador só
// avança quando a pessoa TENTA de verdade (login.js só chama isso fora de
// um bloqueio ativo), então "+2 tentativas" e "+1 tentativa" são exatamente
// as tentativas que sobram depois de cada bloqueio expirar.
const LOGIN_LOCK_TIERS = [
  { attempts: 6, minutes: null }, // null = bloqueio permanente (até reset de senha)
  { attempts: 5, minutes: 10 },
  { attempts: 3, minutes: 5 },
];

async function recordFailedLogin(userId) {
  const res = await pool.query(
    "UPDATE app_users SET failed_login_attempts = failed_login_attempts + 1 WHERE id = $1 RETURNING failed_login_attempts",
    [userId]
  );
  const attempts = res.rows[0].failed_login_attempts;
  const tier = LOGIN_LOCK_TIERS.find((t) => attempts === t.attempts || (t.minutes === null && attempts >= t.attempts));
  if (!tier) return { attempts, lockedUntil: null, permanent: false };

  const permanent = tier.minutes === null;
  // "Permanente" = trava bem longe no futuro — updateUserPassword (reset de
  // admin ou autoatendimento) é o único jeito de zerar isso de verdade.
  const lockedUntil = permanent ? new Date("9999-01-01T00:00:00Z") : new Date(Date.now() + tier.minutes * 60 * 1000);
  await pool.query("UPDATE app_users SET locked_until = $1 WHERE id = $2", [lockedUntil, userId]);
  return { attempts, lockedUntil, permanent };
}

async function resetFailedLogins(userId) {
  await pool.query("UPDATE app_users SET failed_login_attempts = 0, locked_until = NULL WHERE id = $1", [userId]);
}

async function updateUserPassword(id, passwordHash) {
  // Redefinir a senha (admin OU a própria pessoa) sempre destrava a conta —
  // é o "escape hatch" do bloqueio permanente, ver LOGIN_LOCK_TIERS acima.
  // token_version +1 invalida toda sessão aberta em outro lugar (ou
  // roubada) na hora — ver nota em migrate() sobre isso. Devolve a versão
  // nova pra quem chamou poder emitir um cookie novo válido pra sessão
  // ATUAL (autoatendimento não pode deslogar a própria pessoa que acabou
  // de trocar a senha com sucesso).
  const res = await pool.query(
    "UPDATE app_users SET password_hash = $1, failed_login_attempts = 0, locked_until = NULL, token_version = token_version + 1 WHERE id = $2 RETURNING token_version",
    [passwordHash, id]
  );
  return res.rows[0].token_version;
}

async function deleteUser(id) {
  await pool.query("DELETE FROM app_users WHERE id = $1", [id]);
}

async function updateUserAvatar(id, avatarUrl) {
  const res = await pool.query("UPDATE app_users SET avatar_url = $1 WHERE id = $2 RETURNING avatar_url", [
    avatarUrl,
    id,
  ]);
  return res.rows[0]?.avatar_url ?? null;
}

async function logSearch(appUserId, tool, domain, url) {
  await pool.query("INSERT INTO search_logs (app_user_id, tool, domain, url) VALUES ($1, $2, $3, $4)", [
    appUserId,
    tool,
    domain,
    url,
  ]);
}

async function logAdminAction(actorId, actorName, targetId, targetName, action, details) {
  await pool.query(
    "INSERT INTO admin_audit_log (actor_id, actor_name, target_id, target_name, action, details) VALUES ($1, $2, $3, $4, $5, $6)",
    [actorId, actorName, targetId, targetName, action, details || null]
  );
}

async function listAdminAuditLog(limit = 100) {
  const res = await pool.query("SELECT * FROM admin_audit_log ORDER BY created_at DESC LIMIT $1", [limit]);
  return res.rows;
}

function planLimitsFor(plan) {
  return PLAN_LIMITS[plan] || PLAN_LIMITS.solo;
}

async function createOrganization({ name, plan, billingCycle, notes }) {
  const days = BILLING_CYCLE_DAYS[billingCycle];
  const res = await pool.query(
    `INSERT INTO organizations (name, plan, billing_cycle, expires_at, notes)
     VALUES ($1, $2, $3, now() + ($4 || ' days')::interval, $5) RETURNING *`,
    [name, plan, billingCycle, days, notes || null]
  );
  return res.rows[0];
}

// Mesmo formato de createOrganization, mas grava a referência da compra
// Cakto que originou essa organização (ver colunas cakto_* em migrate()) —
// é o que permite um evento de cancelamento/reembolso futuro achar essa
// organização de volta.
async function createOrganizationFromCakto({ name, plan, billingCycle, notes, purchaseId, customerEmail }) {
  const days = BILLING_CYCLE_DAYS[billingCycle];
  const res = await pool.query(
    `INSERT INTO organizations (name, plan, billing_cycle, expires_at, notes, cakto_purchase_id, cakto_customer_email)
     VALUES ($1, $2, $3, now() + ($4 || ' days')::interval, $5, $6, $7) RETURNING *`,
    [name, plan, billingCycle, days, notes || null, purchaseId, customerEmail]
  );
  return res.rows[0];
}

async function findOrganizationByCaktoPurchaseId(purchaseId) {
  const res = await pool.query("SELECT * FROM organizations WHERE cakto_purchase_id = $1", [purchaseId]);
  return res.rows[0] || null;
}

// Fallback pra quando o evento de cancelamento/reembolso não referencia o
// mesmo purchase_id da compra original (ex: é o ID da assinatura, não da
// transação) — busca pelo email do comprador. Mais de uma organização pode
// bater (ex: reembolso parcial num histórico antigo) — devolve a mais
// recente, quem chama decide se faz sentido.
async function findOrganizationByCaktoEmail(email) {
  const res = await pool.query(
    "SELECT * FROM organizations WHERE cakto_customer_email = $1 ORDER BY created_at DESC LIMIT 1",
    [email.toLowerCase().trim()]
  );
  return res.rows[0] || null;
}

// Idempotência: devolve true só na primeira vez que esse (purchase_id, event)
// é visto — reenvios da Cakto (retry automático dela) batem no
// ON CONFLICT DO NOTHING e voltam false, sinal pra quem chamou responder
// 200 sem reprocessar (criar organização/usuário duplicado).
async function recordCaktoEvent(purchaseId, event) {
  const res = await pool.query(
    `INSERT INTO cakto_events (purchase_id, event) VALUES ($1, $2)
     ON CONFLICT (purchase_id, event) DO NOTHING RETURNING purchase_id`,
    [purchaseId, event]
  );
  return res.rows.length > 0;
}

async function updateCaktoEventStatus(purchaseId, event, status, detail) {
  await pool.query(
    "UPDATE cakto_events SET status = $1, detail = $2 WHERE purchase_id = $3 AND event = $4",
    [status, detail || null, purchaseId, event]
  );
}

async function storePendingCaktoCredential({ refId, email, password, ttlMinutes }) {
  await pool.query(
    `INSERT INTO cakto_pending_credentials (ref_id, email, password_plain, expires_at)
     VALUES ($1, $2, $3, now() + ($4 || ' minutes')::interval)
     ON CONFLICT (ref_id) DO UPDATE SET email = $2, password_plain = $3, expires_at = now() + ($4 || ' minutes')::interval, retrieved_at = NULL`,
    [refId, email, password, ttlMinutes]
  );
}

// Entrega de uso único: o UPDATE só afeta a linha se ainda não foi
// retirada e ainda não expirou — em concorrência, só uma chamada consegue
// "ganhar" essa transição (garantia do próprio Postgres por linha), as
// outras caem no res.rows.length === 0. Zera a senha em texto puro logo
// depois de ler, numa segunda query — não deixa rastro no banco além do
// necessário pra entregar uma vez.
async function consumeCaktoCredential(refId) {
  const res = await pool.query(
    `UPDATE cakto_pending_credentials SET retrieved_at = now()
     WHERE ref_id = $1 AND retrieved_at IS NULL AND expires_at > now()
     RETURNING email, password_plain`,
    [refId]
  );
  if (res.rows.length === 0) return null;
  const { email, password_plain } = res.rows[0];
  await pool.query("UPDATE cakto_pending_credentials SET password_plain = NULL WHERE ref_id = $1", [refId]);
  return { email, password: password_plain };
}

async function getOrganizationById(id) {
  const res = await pool.query("SELECT * FROM organizations WHERE id = $1", [id]);
  return res.rows[0] || null;
}

async function countUsersInOrg(organizationId) {
  const res = await pool.query("SELECT COUNT(*)::int AS n FROM app_users WHERE organization_id = $1", [
    organizationId,
  ]);
  return res.rows[0].n;
}

async function getOrgMemberIds(organizationId) {
  const res = await pool.query("SELECT id FROM app_users WHERE organization_id = $1", [organizationId]);
  return res.rows.map((r) => r.id);
}

async function listOrganizationsWithCounts() {
  const res = await pool.query(`
    SELECT o.*, COUNT(u.id)::int AS user_count
    FROM organizations o
    LEFT JOIN app_users u ON u.organization_id = o.id
    GROUP BY o.id
    ORDER BY o.created_at DESC
  `);
  return res.rows;
}

// Renovar ANTES de vencer estende a partir da validade atual (não perde o
// tempo que ainda restava); renovar DEPOIS de vencer (relapso) conta a
// partir de agora (não empilha em cima de uma data já bem no passado).
// Também é o caminho usado pra trocar de plano — muda plano+ciclo junto,
// nunca separado, pra não deixar uma combinação plano-A/ciclo-B inconsistente.
async function renewOrganization(id, plan, billingCycle) {
  const org = await getOrganizationById(id);
  if (!org) return null;
  const days = BILLING_CYCLE_DAYS[billingCycle];
  const base = new Date(org.expires_at) > new Date() ? "expires_at" : "now()";
  const res = await pool.query(
    `UPDATE organizations SET plan = $1, billing_cycle = $2, expires_at = ${base} + ($3 || ' days')::interval
     WHERE id = $4 RETURNING *`,
    [plan, billingCycle, days, id]
  );
  return res.rows[0];
}

// Upgrade/downgrade de plano SEM mexer na validade — diferente de
// renewOrganization: usado quando o cliente já pagou a diferença fora do
// app (ex: upgrade no meio do ciclo) e não deve ganhar dias extras de
// brinde nem perder o que já pagou só porque trocou de plano.
async function changeOrganizationPlan(id, plan, billingCycle) {
  const res = await pool.query(
    `UPDATE organizations SET plan = $1, billing_cycle = $2 WHERE id = $3 RETURNING *`,
    [plan, billingCycle, id]
  );
  return res.rows[0];
}

// Escape-hatch manual — cortesia de renovação, correção, ou cancelamento
// antecipado (setar pro passado bloqueia o login na hora, mesmo sem
// cancelamento formal).
async function updateOrganizationExpiry(id, expiresAt) {
  const res = await pool.query("UPDATE organizations SET expires_at = $1 WHERE id = $2 RETURNING *", [
    expiresAt,
    id,
  ]);
  return res.rows[0];
}

async function updateOrganizationDetails(id, { name, notes }) {
  const fields = [];
  const values = [];
  let i = 1;
  if (name !== undefined) {
    fields.push(`name = $${i++}`);
    values.push(name);
  }
  if (notes !== undefined) {
    fields.push(`notes = $${i++}`);
    values.push(notes);
  }
  if (fields.length === 0) return;
  values.push(id);
  await pool.query(`UPDATE organizations SET ${fields.join(", ")} WHERE id = $${i}`, values);
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
  PLAN_LIMITS,
  BILLING_CYCLE_DAYS,
  planLimitsFor,
  migrate,
  ensureMineradorDatabase,
  countUsers,
  countActiveAdmins,
  createUser,
  findUserByEmail,
  getAppUserById,
  listUsersWithCounts,
  updateUserPermissions,
  updateUserPassword,
  recordFailedLogin,
  resetFailedLogins,
  deleteUser,
  updateUserAvatar,
  logSearch,
  historySummaryForUser,
  logLogin,
  ipSummaryForUser,
  logAdminAction,
  listAdminAuditLog,
  createOrganization,
  createOrganizationFromCakto,
  findOrganizationByCaktoPurchaseId,
  findOrganizationByCaktoEmail,
  recordCaktoEvent,
  updateCaktoEventStatus,
  storePendingCaktoCredential,
  consumeCaktoCredential,
  getOrganizationById,
  countUsersInOrg,
  getOrgMemberIds,
  listOrganizationsWithCounts,
  renewOrganization,
  changeOrganizationPlan,
  setOrgDefaultOperationIfUnset,
  updateOrganizationExpiry,
  updateOrganizationDetails,
};

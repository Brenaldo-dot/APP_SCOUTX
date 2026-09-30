// Data de publicação dos produtos no catálogo da Dropi/DropLatam.
// A lista do catálogo não traz a data, só o detalhe de cada produto. Como o ID
// é sequencial (produto novo = ID maior), basta a data de uns ~150 produtos
// espalhados pelo catálogo pra estimar a de qualquer outro por interpolação.
// Produto que apareceu depois que a ScoutX começou a acompanhar usa a data
// exata em que apareceu (first_seen_at).
//
// Uso: node listing-dates.js [amostras]   (padrão 150; usa a conta DROPI_CO_*,
// separada da conta das leituras, pra não derrubar a sessão delas)
const { loadLocalEnv } = require("./env");
const store = require("./store");

const DELAY_MS = 1500;

async function ensureTable() {
  await store.getPool().query(`
    CREATE TABLE IF NOT EXISTS dropi_id_dates (
      country TEXT NOT NULL,
      dropi_id BIGINT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (country, dropi_id)
    );
  `);
}

// Âncoras (id -> data) em memória, recarregadas a cada hora.
let anchorsCache = { at: 0, byCountry: new Map() };
async function anchors(country) {
  if (Date.now() - anchorsCache.at > 3600000) {
    await ensureTable();
    const res = await store.getPool().query("SELECT country, dropi_id, created_at FROM dropi_id_dates ORDER BY country, dropi_id");
    const byCountry = new Map();
    for (const r of res.rows) {
      const list = byCountry.get(r.country) || [];
      list.push([Number(r.dropi_id), new Date(r.created_at).getTime()]);
      byCountry.set(r.country, list);
    }
    anchorsCache = { at: Date.now(), byCountry };
  }
  return anchorsCache.byCountry.get(country) || [];
}

// Data estimada pelo ID (null se não houver âncoras dos dois lados).
async function estimateListedAt(country, dropiId) {
  const list = await anchors(country);
  const id = Number(dropiId);
  if (list.length < 2 || id < list[0][0] || id > list[list.length - 1][0]) return null;
  let lo = 0;
  let hi = list.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (list[mid][0] <= id) lo = mid;
    else hi = mid;
  }
  const [id0, t0] = list[lo];
  const [id1, t1] = list[hi];
  const t = id1 === id0 ? t0 : t0 + ((id - id0) / (id1 - id0)) * (t1 - t0);
  return new Date(Math.min(t, t1));
}

async function collect(samples = 150, log = console.log) {
  const { openSession, getProduct } = require("./dropiClient");
  await ensureTable();
  const db = store.getPool();
  // IDs reais espalhados pelo catálogo (percentis), + o mais novo.
  const res = await db.query(
    `SELECT DISTINCT dropi_id FROM (
       SELECT dropi_id, ntile($1) OVER (ORDER BY dropi_id) AS b FROM dropi_products WHERE country = 'co'
     ) x WHERE dropi_id IN (
       SELECT min(dropi_id) FROM (SELECT dropi_id, ntile($1) OVER (ORDER BY dropi_id) AS b FROM dropi_products WHERE country = 'co') y GROUP BY b
     ) ORDER BY dropi_id`,
    [samples]
  );
  const max = await db.query("SELECT max(dropi_id) AS m FROM dropi_products WHERE country = 'co'");
  const ids = [...res.rows.map((r) => r.dropi_id), max.rows[0].m];
  log(`Datas de publicação: ${ids.length} produtos de referência.`);

  const session = await openSession("app.dropi.co", process.env.DROPI_CO_EMAIL, process.env.DROPI_CO_PASSWORD);
  let saved = 0;
  try {
    for (const id of ids) {
      try {
        const r = await getProduct(session, id);
        const created = r?.objects?.created_at;
        if (created) {
          await db.query(
            `INSERT INTO dropi_id_dates (country, dropi_id, created_at) VALUES ('co', $1, $2)
             ON CONFLICT (country, dropi_id) DO UPDATE SET created_at = EXCLUDED.created_at`,
            [id, created]
          );
          saved++;
        }
      } catch {
        // produto removido ou falha pontual: segue pro próximo
      }
      await new Promise((ok) => setTimeout(ok, DELAY_MS));
    }
  } finally {
    await session.close();
  }
  anchorsCache.at = 0;
  log(`Datas de publicação: ${saved} referências gravadas.`);
  return saved;
}

module.exports = { estimateListedAt, collect };

if (require.main === module) {
  loadLocalEnv();
  collect(Number(process.argv[2]) || 150)
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e.message);
      process.exit(1);
    });
}

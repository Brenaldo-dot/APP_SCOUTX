// Processo que fica rodando e dispara as varreduras de cada plataforma
// (Dropi/DropLatam CO = "co", Mastershop CO = "ms-co"). A cada 1 min, por
// plataforma, se nenhuma varredura dela estiver viva:
// 1. Varredura que parou no meio (sem sinal de vida há 10+ min) e começou há
//    menos de 20h: RETOMA (só Dropi; a da Mastershop leva ~12 min e recomeça).
// 2. Leitura agendada (dropi_sweep_requests) cujo horário já chegou: roda.
// 3. Senão, se a última varredura completa começou há 8h+ (ou nunca rodou):
//    roda a próxima (3 por dia).
// As plataformas rodam em paralelo; falha numa não trava a outra.
// Uso: node worker.js     (agendar: node schedule.js 21:00 | node schedule.js agora)
const { loadLocalEnv } = require("./env");
const store = require("./store");
const { runSweep } = require("./sweep");
const { runMastershopSweep } = require("./mastershopSweep");
const { runDroplatamEsSweep, runDropeaSweep } = require("./spainSweep");
const { MastershopSessionError } = require("./mastershopClient");

loadLocalEnv();

const CHECK_EVERY_MS = 60 * 1000;
// 3 leituras por dia: separa venda de reposição que acontecem no mesmo dia e
// deixa correção manual do fornecedor como um degrau isolado (ver classify.js).
const INTERVAL_HOURS = Number(process.env.DROPI_SWEEP_INTERVAL_HOURS || 8);
const RESUME_WITHIN_HOURS = 20;
const DEAD_AFTER_MINUTES = 10;
const DROPI_COUNTRY = (process.env.DROPI_DOMAIN || "co.droplatam.com.br").split(".")[0];

const PLATFORMS = [
  { name: "Dropi", country: DROPI_COUNTRY, canResume: true, run: (opts) => runSweep(opts), enabled: () => Boolean(process.env.DROPI_EMAIL) },
  // Mastershop leva ~6 min: lê a cada 3h (mais leituras = venda e reposição mais separadas).
  { name: "Mastershop", country: "ms-co", canResume: false, intervalHours: 3, run: (opts) => runMastershopSweep(opts), enabled: () => Boolean(process.env.MASTERSHOP_REFRESH_TOKEN) },
];

// Espanha: DropLatam ES e Dropea são sistemas próprios (spainSweep.js). Catálogos
// pequenos (~2 min cada): leem a cada 3h, como a Mastershop.
PLATFORMS.push(
  { name: "DropLatam ES", country: "dl-es", canResume: false, intervalHours: 3, run: (opts) => runDroplatamEsSweep(opts), enabled: () => Boolean(process.env.DROPI_ES_EMAIL && process.env.DROPI_ES_PASSWORD) },
  { name: "Dropea ES", country: "de-es", canResume: false, intervalHours: 3, run: (opts) => runDropeaSweep(opts), enabled: () => Boolean(process.env.DROPEA_EMAIL && process.env.DROPEA_PASSWORD) }
);

// Outros países da Dropi/DropLatam: DROPI_<PAÍS>_URL/_EMAIL/_PASSWORD no
// .env.local (ex.: DROPI_MX_URL=mx.droplatam.com.br). A Espanha fica de fora:
// lá a DropLatam é outro sistema, com leitor próprio.
const DROPI_SYSTEM_EXCLUDED = new Set(["ES", "CO"]);
for (const key of Object.keys(process.env)) {
  const m = key.match(/^DROPI_([A-Z]{2})_URL$/);
  if (!m || DROPI_SYSTEM_EXCLUDED.has(m[1])) continue;
  const code = m[1];
  const domain = process.env[key].replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim();
  const country = domain.split(".")[0];
  PLATFORMS.push({
    name: `Dropi ${code}`,
    country,
    canResume: true,
    // 2 páginas por vez: a Dropi desses países corta com "Too Many Attempts" em 4.
    run: (opts) => runSweep({ ...opts, domain, concurrency: 2, email: process.env[`DROPI_${code}_EMAIL`], password: process.env[`DROPI_${code}_PASSWORD`] }),
    enabled: () => Boolean(process.env[`DROPI_${code}_EMAIL`] && process.env[`DROPI_${code}_PASSWORD`]),
  });
}

// Aviso de sessão vencida da Mastershop: só 1x por hora no log.
let lastSessionWarning = 0;
const log = (m) => console.log(new Date().toLocaleString("pt-BR"), m);

async function tickPlatform(p) {
  const db = store.getPool();
  await db.query(
    `UPDATE dropi_sweeps SET status = 'interrupted'
     WHERE country = $1 AND status = 'running'
       AND COALESCE(heartbeat_at, started_at) < now() - ($2 || ' minutes')::interval`,
    [p.country, String(DEAD_AFTER_MINUTES)]
  );
  const alive = await db.query("SELECT 1 FROM dropi_sweeps WHERE country = $1 AND status = 'running'", [p.country]);
  if (alive.rowCount > 0) return;

  if (p.canResume) {
    const pending = await db.query(
      `SELECT id FROM dropi_sweeps
       WHERE country = $1 AND status = 'interrupted' AND started_at > now() - ($2 || ' hours')::interval
       ORDER BY id DESC LIMIT 1`,
      [p.country, String(RESUME_WITHIN_HOURS)]
    );
    if (pending.rows[0]) return p.run({ resumeSweepId: pending.rows[0].id, log });
  }

  const due = await db.query(
    "SELECT id, run_at FROM dropi_sweep_requests WHERE country = $1 AND sweep_id IS NULL AND run_at <= now() ORDER BY run_at LIMIT 1",
    [p.country]
  );
  if (due.rows[0]) {
    log(`${p.name}: leitura agendada para ${new Date(due.rows[0].run_at).toLocaleString("pt-BR")} começando.`);
    return p.run({
      log,
      onStart: (sweepId) => db.query("UPDATE dropi_sweep_requests SET sweep_id = $1 WHERE id = $2", [sweepId, due.rows[0].id]),
    });
  }

  const lastFull = await db.query(
    "SELECT started_at FROM dropi_sweeps WHERE country = $1 AND status = 'done' AND products_seen >= $2 ORDER BY started_at DESC LIMIT 1",
    [p.country, store.fullSweepMin(p.country)]
  );
  const hoursSince = lastFull.rows[0] ? (Date.now() - new Date(lastFull.rows[0].started_at).getTime()) / 3600000 : Infinity;
  if (hoursSince < (p.intervalHours || INTERVAL_HOURS)) return;
  return p.run({ log });
}

// Cada plataforma roda independente (a Dropi leva ~1h45, a Mastershop não
// precisa esperar ela terminar).
const busy = new Set();
// Depois de uma falha, espera 30 min antes de tentar de novo aquela plataforma
// (senão cria uma varredura com erro por minuto).
const RETRY_AFTER_FAILURE_MS = 30 * 60 * 1000;
const failedAt = new Map();

async function tick() {
  try {
    await store.ensureSchema();
  } catch (err) {
    console.error("Banco indisponível:", err.message);
    return;
  }
  for (const p of PLATFORMS) {
    if (!p.enabled() || busy.has(p.country)) continue;
    if (Date.now() - (failedAt.get(p.country) || 0) < RETRY_AFTER_FAILURE_MS) continue;
    busy.add(p.country);
    tickPlatform(p)
      .catch((err) => {
        failedAt.set(p.country, Date.now());
        if (err instanceof MastershopSessionError) {
          if (Date.now() - lastSessionWarning > 3600 * 1000) {
            lastSessionWarning = Date.now();
            log(`⚠️ ${err.message}`);
          }
        } else {
          console.error(`${p.name}: varredura falhou:`, err.message);
        }
      })
      .finally(() => busy.delete(p.country));
  }
}

console.log(
  `Worker de estoque ligado (${PLATFORMS.filter((p) => p.enabled()).map((p) => `${p.name} [${p.country}]`).join(", ")}): ` +
    `1 leitura a cada ${INTERVAL_HOURS}h por plataforma + leituras agendadas.`
);
tick();
setInterval(tick, CHECK_EVERY_MS);

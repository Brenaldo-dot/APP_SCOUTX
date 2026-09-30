// Agenda uma leitura extra do catálogo (o worker.js executa na hora marcada).
// Uso: node schedule.js agora
//      node schedule.js 21:00        (hoje, no fuso do computador; se já passou, amanhã)
//      node schedule.js lista         (mostra as agendadas que ainda não rodaram)
const { loadLocalEnv } = require("./env");
const store = require("./store");

loadLocalEnv();
// 2º argumento opcional escolhe a plataforma: "node schedule.js agora mastershop".
const platformArg = (process.argv[3] || "").trim().toLowerCase();
const country = platformArg.startsWith("master") ? "ms-co" : (process.env.DROPI_DOMAIN || "co.droplatam.com.br").split(".")[0];

(async () => {
  await store.ensureSchema();
  const db = store.getPool();
  const arg = (process.argv[2] || "").trim().toLowerCase();

  if (arg === "lista") {
    const r = await db.query("SELECT id, run_at FROM dropi_sweep_requests WHERE country = $1 AND sweep_id IS NULL ORDER BY run_at", [country]);
    if (!r.rows.length) console.log("Nenhuma leitura agendada.");
    for (const row of r.rows) console.log(`#${row.id}  ${new Date(row.run_at).toLocaleString("pt-BR")}`);
  } else {
    let when = new Date();
    if (arg !== "agora") {
      const m = arg.match(/^(\d{1,2}):(\d{2})$/);
      if (!m) throw new Error('Use "agora", "HH:MM" ou "lista".');
      when.setHours(Number(m[1]), Number(m[2]), 0, 0);
      if (when <= new Date()) when.setDate(when.getDate() + 1);
    }
    await db.query("INSERT INTO dropi_sweep_requests (country, run_at) VALUES ($1, $2)", [country, when]);
    console.log(`Leitura agendada para ${when.toLocaleString("pt-BR")}.`);
  }
  await db.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});

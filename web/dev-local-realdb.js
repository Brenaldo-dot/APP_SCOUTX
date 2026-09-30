// Sobe o ScoutX (web) LOCAL contra um Postgres de verdade que PERSISTE entre
// reinícios (pm-board/scoutx-localdb, `node start.js`), diferente do
// dev-local-bootstrap.js (pg-mem, zera tudo). Necessário pro Estoque de
// Fornecedor: o histórico de estoque precisa sobreviver de um dia pro outro.
// Nunca apontar isto pro banco de produção.
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://scoutx:scoutx-local-dev@localhost:54329/scoutx";
if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL)) {
  console.error("dev-local-realdb.js só roda contra Postgres local.");
  process.exit(1);
}
process.env.APP_BASE_URL = process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3001}`;
process.env.SESSION_SECRET = process.env.SESSION_SECRET || "dev-local-only-session-secret-nao-usar-em-producao";
process.env.INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || "dev-local-only-internal-secret";
process.env.CAKTO_WEBHOOK_SECRET = process.env.CAKTO_WEBHOOK_SECRET || "dev-local-only-cakto-secret";
// Radar de Vendas: só aparece aqui no local (em produção fica desligado).
process.env.RADAR_ENABLED = "1";

const bcrypt = require("bcryptjs");
const db = require("./db.js");
const dropiStock = require("./dropi-stock/store");
const { startServer } = require("./server.js");

// Mesmo admin de dev do dev-local-bootstrap.js (só existe neste banco local).
const DEV_ADMIN_NAME = "Samuel";
const DEV_ADMIN_EMAIL = "samuelslaviero@hotmail.com";
const DEV_ADMIN_PASSWORD = "samu1234567@";

startServer(process.env.PORT || 3001)
  .then(async ({ port }) => {
    await dropiStock.ensureSchema();
    if ((await db.countUsers()) === 0) {
      const passwordHash = await bcrypt.hash(DEV_ADMIN_PASSWORD, 10);
      await db.createUser({ name: DEV_ADMIN_NAME, email: DEV_ADMIN_EMAIL, passwordHash, role: "admin" });
      console.log(`Conta admin de dev criada: ${DEV_ADMIN_EMAIL}`);
    }
    console.log(`ScoutX (web) rodando em http://localhost:${port} (DEV LOCAL, Postgres local persistente).`);
  })
  .catch((err) => {
    console.error("Falha ao subir o ScoutX local:", err);
    process.exit(1);
  });

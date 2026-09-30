// Foto (logo) da loja de cada fornecedor, a mesma que aparece na plataforma.
// Guarda só o link da imagem. Roda no fim de cada leitura (ver sweep.js e
// mastershopSweep.js) e pode ser chamado na mão:
//
//   node logos.js             (DropLatam)
//   node logos.js mastershop  (Mastershop)
const { loadLocalEnv } = require("./env");
const store = require("./store");

const IMAGE_BASE = "https://d39ru7awumhhs2.cloudfront.net";
const DROPI_MAX_PER_RUN = 800; // fornecedores por leitura
const DROPI_DELAY_MS = 1200; // 1 pedido a cada ~1,2 s (~16 min por leitura)
const DROPI_STOP_AFTER_FAILS = 5; // recusou 5 seguidas = para e tenta na próxima
const MS_PAGE = 50; // o próprio site pede de 50 em 50

function dropiLogoUrl(path) {
  if (!path) return null;
  return `${IMAGE_BASE}/${String(path).split("/").map(encodeURIComponent).join("/")}`;
}

// DropLatam: 1 chamada por fornecedor (perfil público da loja). Só os que
// ainda não têm foto ou não foram conferidos na última semana, quem vende mais
// primeiro. Devagar e com teto por leitura: em rajada (4 em paralelo) a Dropi
// passou a recusar tudo depois de ~200 e travou o login seguinte. Com 3
// leituras por dia, os ~8 mil fornecedores ficam cobertos em poucos dias.
async function refreshDropiLogos(session, country, { log = console.log, maxAgeDays = 7 } = {}) {
  const ids = await store.suppliersNeedingLogo(country, maxAgeDays, DROPI_MAX_PER_RUN);
  if (!ids.length) return 0;
  log(`Fotos de fornecedores: ${ids.length} para conferir.`);
  let saved = 0;
  let failed = 0;
  let failStreak = 0;
  const pending = [];
  for (const id of ids) {
    try {
      const r = await session.request(`/api/products/supplier/v1?user_id=${encodeURIComponent(id)}`);
      const o = r?.objects || {};
      pending.push({ supplierId: id, logoUrl: dropiLogoUrl(o.users_urls3_logo) });
      failStreak = 0;
    } catch (e) {
      // sem foto dessa vez; tenta de novo na próxima leitura
      failed++;
      if (++failStreak >= DROPI_STOP_AFTER_FAILS) {
        log(`  Fotos pausadas até a próxima leitura (${String(e.message).slice(0, 120)})`);
        break;
      }
    }
    if (pending.length >= 100) saved += await store.saveSupplierLogos(country, pending.splice(0));
    await new Promise((r) => setTimeout(r, DROPI_DELAY_MS));
  }
  saved += await store.saveSupplierLogos(country, pending.splice(0));
  log(`Fotos de fornecedores: ${saved} gravadas, ${failed} falharam.`);
  return saved;
}

// Mastershop: a lista de fornecedores já vem com a foto (profileImage).
async function refreshMastershopLogos(session, country, { log = console.log } = {}) {
  let offset = 0;
  let saved = 0;
  for (;;) {
    const r = await session.request(`providers?offset=${offset}&limit=${MS_PAGE}`, {});
    const list = Array.isArray(r?.data) ? r.data : [];
    const rows = list
      .filter((p) => p.idPublicProfile !== null && p.idPublicProfile !== undefined)
      .map((p) => ({ supplierId: p.idPublicProfile, logoUrl: p.profileImage || null }));
    saved += await store.saveSupplierLogos(country, rows);
    if (list.length < MS_PAGE) break;
    offset += MS_PAGE;
  }
  log(`Fotos de fornecedores (Mastershop): ${saved} gravadas.`);
  return saved;
}

module.exports = { refreshDropiLogos, refreshMastershopLogos };

if (require.main === module) {
  loadLocalEnv();
  (async () => {
    await store.ensureSchema();
    if (process.argv[2] === "mastershop") {
      const { createSession } = require("./mastershopClient");
      await refreshMastershopLogos(createSession(), "ms-co");
    } else {
      const { openSession } = require("./dropiClient");
      const { DROPI_DOMAIN = "co.droplatam.com.br", DROPI_EMAIL, DROPI_PASSWORD } = process.env;
      const session = await openSession(DROPI_DOMAIN, DROPI_EMAIL, DROPI_PASSWORD);
      try {
        await refreshDropiLogos(session, DROPI_DOMAIN.split(".")[0]);
      } finally {
        await session.close();
      }
    }
    process.exit(0);
  })().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}

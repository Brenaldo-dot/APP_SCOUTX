// Varredura do "Mercado de Productos" da Mastershop Colômbia (~44 mil
// produtos, ~12 min). Mesmo modelo da Dropi (store.js): grava o estoque atual,
// as mudanças desde a última leitura e refaz o consolidado do dia.
// Uso: node mastershopSweep.js   (normalmente disparada pelo worker.js)
const { loadLocalEnv } = require("./env");
const { createSession, marketPage } = require("./mastershopClient");
const store = require("./store");
const { refreshMastershopLogos } = require("./logos");

loadLocalEnv();

const COUNTRY = "ms-co";
const PAGE_SIZE = 200;
const CONCURRENCY = 2;
const EMPTY_PAGES_TO_STOP = 2;

function toNumber(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Fornecedor às vezes cadastra estoque absurdo (já vimos 2.147.573.649, que
// nem cabe em INTEGER). Acima de 1 bilhão vira "sem informação".
function saneStock(v) {
  const n = toNumber(v);
  return n === null || n < 0 || n > 1e9 ? null : Math.round(n);
}

function normalize(p) {
  return {
    dropiId: p.idProduct,
    name: String(p.productName || "").slice(0, 500),
    // URL completa (cdn.bemaster.com); a Dropi guarda só o caminho.
    imagePath: p.urlImageProduct || null,
    supplierId: p.idPublicProfile ?? p.idBussiness ?? null,
    supplierName: p.publicName || null,
    categories: p.prodFormatName || null,
    salePrice: toNumber(p.basePrice ?? p.minPrice),
    // Mastershop não tem "preço sugerido" no catálogo; maxPrice é o maior preço entre variações.
    suggestedPrice: null,
    stock: saneStock(p.stock),
    warehouseSig: null,
  };
}

async function runMastershopSweep({ onStart, log = console.log } = {}) {
  await store.ensureSchema();
  const session = createSession();
  await session.ensure(); // falha cedo se a sessão venceu (antes de abrir varredura)
  const sweep = await store.startSweep(COUNTRY);
  await store.updateSweep(sweep.id, {});
  if (onStart) await onStart(sweep.id);
  log(`Varredura #${sweep.id} (Mastershop CO) começou.`);

  let offset = 0;
  let pagesDone = 0;
  let productsSeen = 0;
  let changes = 0;
  let emptyStreak = 0;
  const t0 = Date.now();

  async function fetchPage(off) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        return await marketPage(session, { offset: off, limit: PAGE_SIZE });
      } catch (err) {
        if (attempt === 3) throw err;
        await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
    }
    return [];
  }

  try {
    while (emptyStreak < EMPTY_PAGES_TO_STOP) {
      const offsets = [];
      for (let i = 0; i < CONCURRENCY; i++) offsets.push(offset + i * PAGE_SIZE);
      offset += CONCURRENCY * PAGE_SIZE;
      const results = await Promise.all(offsets.map(fetchPage));
      for (const items of results) {
        if (items.length === 0) {
          emptyStreak++;
          continue;
        }
        emptyStreak = 0;
        changes += await store.upsertPage(COUNTRY, sweep.id, items.map(normalize));
        productsSeen += items.length;
      }
      pagesDone += offsets.length;
      await store.updateSweep(sweep.id, { pages_done: pagesDone, products_seen: productsSeen, changes_recorded: changes, last_start_data: offset });
      if (pagesDone % 40 === 0) log(`  Mastershop: ${productsSeen} produtos, ${changes} mudanças`);
    }
    await store.rollupSweepDay(sweep.id);
    await store.recomputeSales(COUNTRY);
    await store.updateSweep(sweep.id, { status: "done", finished_at: new Date() });
    await refreshMastershopLogos(session, COUNTRY, { log }).catch((e) => log(`Fotos de fornecedores falharam: ${e.message}`));
    log(`Varredura #${sweep.id} (Mastershop) terminou: ${productsSeen} produtos, ${changes} mudanças, ${((Date.now() - t0) / 60000).toFixed(1)} min.`);
    return { sweepId: sweep.id, productsSeen, changes };
  } catch (err) {
    await store.updateSweep(sweep.id, { status: "error", finished_at: new Date(), error: String(err.message).slice(0, 500) });
    throw err;
  }
}

module.exports = { runMastershopSweep, COUNTRY };

if (require.main === module) {
  runMastershopSweep()
    .then(() => store.getPool().end())
    .catch((err) => {
      console.error("Varredura Mastershop falhou:", err.constructor.name, err.message);
      process.exit(1);
    });
}

// Varredura do catálogo da Dropi: percorre TODOS os produtos (ordem por id,
// estável entre chamadas; a ordem padrão do site é aleatória), grava o estoque
// atual e as mudanças desde a última leitura, e recalcula as vendas estimadas.
//
// Uso:  node sweep.js                  (catálogo inteiro, ~277 mil produtos na CO)
//       node sweep.js --max-pages 50   (só as primeiras 50 páginas, pra teste)
//       node sweep.js --newest 50      (as 50 páginas de produtos MAIS NOVOS)
const { loadLocalEnv } = require("./env");
const { openSession, searchCatalog, DropiAuthError } = require("./dropiClient");
const store = require("./store");
const { refreshDropiLogos } = require("./logos");

loadLocalEnv();

const PAGE_SIZE = 100; // 150 já dá erro na API
const CONCURRENCY = Number(process.env.DROPI_SWEEP_CONCURRENCY || 4);
const EMPTY_PAGES_TO_STOP = 3;
const IMAGE_BASE = "https://d39ru7awumhhs2.cloudfront.net";

function toNumber(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function mainImagePath(p) {
  const gallery = p.gallery || [];
  const img = gallery.find((g) => g.main) || gallery[0];
  return img?.urlS3 || null;
}

// Estoque do produto = soma das bodegas que o catálogo devolve. Sem nenhuma
// bodega listada = desconhecido (null), não zero.
function totalStock(p) {
  const wh = p.warehouse_product || [];
  if (wh.length === 0) return null;
  const total = wh.reduce((sum, w) => sum + (toNumber(w.stock) || 0), 0);
  // Estoque absurdo (>1 bilhão, não cabe em INTEGER) = sem informação.
  return total < 0 || total > 1e9 ? null : Math.round(total);
}

function normalize(p) {
  return {
    dropiId: p.id,
    name: String(p.name || "").slice(0, 500),
    imagePath: mainImagePath(p),
    supplierId: p.user?.id ?? null,
    supplierName: p.user?.store_name || p.user?.name || null,
    categories: (p.categories || []).map((c) => c.name).filter(Boolean).join(", ") || null,
    salePrice: toNumber(p.sale_price),
    suggestedPrice: toNumber(p.suggested_price),
    stock: totalStock(p),
    // Quais bodegas o produto tem: se muda entre leituras, a variação de
    // estoque é mudança de bodega (ajuste), não venda.
    warehouseSig:
      (p.warehouse_product || [])
        .map((w) => w.warehouse_id)
        .filter((id) => id !== null && id !== undefined)
        .sort((a, b) => a - b)
        .join(",") || null,
  };
}

function parseArgs(argv) {
  const args = { maxPages: Infinity, newest: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--max-pages") args.maxPages = Number(argv[++i]);
    if (argv[i] === "--newest") {
      args.newest = true;
      args.maxPages = Number(argv[++i]);
    }
  }
  return args;
}

// `resumeSweepId`: continua uma varredura que parou no meio (PC desligou,
// processo caiu) a partir da última página gravada, em vez de recomeçar do zero.
// `domain/email/password`: conta de outro país (ex.: mx.droplatam.com.br);
// sem eles, usa a da Colômbia (DROPI_DOMAIN/DROPI_EMAIL/DROPI_PASSWORD).
async function runSweep({ maxPages = Infinity, newest = false, resumeSweepId = null, onStart, log = console.log, domain, email, password, concurrency } = {}) {
  const parallel = concurrency || CONCURRENCY;
  const DROPI_DOMAIN = domain || process.env.DROPI_DOMAIN || "co.droplatam.com.br";
  const DROPI_EMAIL = email || process.env.DROPI_EMAIL;
  const DROPI_PASSWORD = password || process.env.DROPI_PASSWORD;
  if (!DROPI_EMAIL || !DROPI_PASSWORD) throw new Error(`Login da Dropi não configurado para ${DROPI_DOMAIN}`);
  const country = DROPI_DOMAIN.split(".")[0];
  const order = newest ? { order_by: "created_at", order_type: "desc" } : { order_by: "id", order_type: "asc" };

  await store.ensureSchema();
  const resumed = resumeSweepId ? await store.getSweep(resumeSweepId) : null;
  const sweep = resumed || (await store.startSweep(country));
  if (resumed) await store.updateSweep(sweep.id, { status: "running", error: null, finished_at: null });
  else await store.updateSweep(sweep.id, {});
  if (onStart) await onStart(sweep.id);
  log(
    `Varredura #${sweep.id} (${country}) ${resumed ? `retomada da página ${sweep.pages_done}` : "começou"}. ` +
      `${newest ? "Mais novos primeiro" : "Catálogo inteiro"}, ${parallel} páginas em paralelo.`
  );

  let session = await openSession(DROPI_DOMAIN, DROPI_EMAIL, DROPI_PASSWORD);
  let pagesDone = resumed ? sweep.pages_done : 0;
  let productsSeen = resumed ? sweep.products_seen : 0;
  let changes = resumed ? sweep.changes_recorded : 0;
  let emptyStreak = 0;
  let nextPage = resumed ? Math.floor(sweep.last_start_data / PAGE_SIZE) : 0;
  const t0 = Date.now();

  // A Dropi de alguns países limita o ritmo ("Too Many Attempts"): aí espera
  // (20s, 40s, 60s...) e tenta de novo, em vez de derrubar a leitura.
  const MAX_ATTEMPTS = 6;
  async function fetchPage(pageIndex) {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const res = await searchCatalog(session, { startData: pageIndex * PAGE_SIZE, pageSize: PAGE_SIZE, extra: order });
        if (!res.isSuccess) throw new Error(res.message || "isSuccess=false");
        return res.objects || [];
      } catch (err) {
        const throttled = /too many attempts|429/i.test(String(err.message));
        if (err instanceof DropiAuthError) {
          log("Token da Dropi expirou, logando de novo...");
          await session.close().catch(() => {});
          session = await openSession(DROPI_DOMAIN, DROPI_EMAIL, DROPI_PASSWORD);
        } else if (attempt === MAX_ATTEMPTS || (!throttled && attempt >= 3)) {
          throw err;
        }
        await new Promise((r) => setTimeout(r, throttled ? 20000 * attempt : 2000 * attempt));
      }
    }
    return [];
  }

  try {
    while (emptyStreak < EMPTY_PAGES_TO_STOP && nextPage < maxPages) {
      const batch = [];
      for (let i = 0; i < parallel && nextPage < maxPages; i++) batch.push(nextPage++);
      const results = await Promise.all(batch.map((pg) => fetchPage(pg).then((objs) => ({ pg, objs }))));

      for (const { objs } of results.sort((a, b) => a.pg - b.pg)) {
        if (objs.length === 0) {
          emptyStreak++;
          continue;
        }
        emptyStreak = 0;
        changes += await store.upsertPage(country, sweep.id, objs.map(normalize));
        productsSeen += objs.length;
      }
      pagesDone += batch.length;

      await store.updateSweep(sweep.id, {
        pages_done: pagesDone,
        products_seen: productsSeen,
        changes_recorded: changes,
        last_start_data: nextPage * PAGE_SIZE,
      });
      if (pagesDone % 20 === 0 || pagesDone <= parallel) {
        const min = ((Date.now() - t0) / 60000).toFixed(1);
        log(`  ${pagesDone} páginas, ${productsSeen} produtos, ${changes} mudanças de estoque (${min} min)`);
      }
    }

    await store.rollupSweepDay(sweep.id);
    await store.recomputeSales(country);
    await store.updateSweep(sweep.id, { status: "done", finished_at: new Date() });
    await refreshDropiLogos(session, country, { log }).catch((e) => log(`Fotos de fornecedores falharam: ${e.message}`));
    const min = ((Date.now() - t0) / 60000).toFixed(1);
    log(`Varredura #${sweep.id} terminou: ${productsSeen} produtos, ${changes} mudanças, ${min} min.`);
    return { sweepId: sweep.id, productsSeen, changes };
  } catch (err) {
    await store.updateSweep(sweep.id, { status: "interrupted", finished_at: new Date(), error: String(err.message).slice(0, 500) });
    throw err;
  } finally {
    await session.close().catch(() => {});
  }
}

module.exports = { runSweep, normalize, IMAGE_BASE };

if (require.main === module) {
  runSweep(parseArgs(process.argv.slice(2)))
    .then(() => store.getPool().end())
    .catch((err) => {
      console.error("Varredura falhou:", err.constructor.name, err.message);
      process.exit(1);
    });
}

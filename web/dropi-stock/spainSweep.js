// Leituras da Espanha. Lá nenhuma das duas plataformas é a Dropi:
// - DropLatam Espanha ("dl-es"): site próprio, catálogo em páginas HTML
//   (/app/products?page=N, 18 produtos por página, ~1.400 produtos);
// - Dropea ("de-es"): API GraphQL (op "Products", 100 por página, ~4.200).
// Mesmo modelo das outras plataformas (store.js): grava o estoque atual, as
// mudanças desde a leitura anterior e refaz o consolidado do dia.
// Uso: node spainSweep.js droplatam | dropea   (normalmente pelo worker.js)
const { chromium } = require("playwright");
const { loadLocalEnv } = require("./env");
const { launchOptions } = require("./dropiClient");
const store = require("./store");

loadLocalEnv();

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const PAUSE_MS = 800; // entre páginas: as duas são sites pequenos, sem pressa
const MAX_PAGES = 1000;

function toNumber(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function saneStock(v) {
  const n = toNumber(v);
  return n === null || n < 0 || n > 1e9 ? null : Math.round(n);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- DropLatam Espanha ----------
const DL_ES = "https://es.droplatam.com.br";

async function droplatamEsSession() {
  const email = process.env.DROPI_ES_EMAIL;
  const password = process.env.DROPI_ES_PASSWORD;
  if (!email || !password) throw new Error("DROPI_ES_EMAIL/DROPI_ES_PASSWORD não configurados");
  const browser = await chromium.launch(launchOptions());
  try {
    const page = await (await browser.newContext({ userAgent: USER_AGENT })).newPage();
    await page.goto(`${DL_ES}/`, { waitUntil: "domcontentloaded" });
    await page.locator('input[type="email"], input[name*="mail" i], input[type="text"]').first().fill(email);
    await page.locator('input[type="password"]').first().fill(password);
    await page.locator('button:has-text("Iniciar sesión"), button[type="submit"]').first().click();
    await page.waitForURL((u) => !/\/$|\/login/.test(u.pathname), { timeout: 20000 }).catch(() => {});
    if (await page.locator('iframe[src*="challenges.cloudflare.com"], iframe[src*="recaptcha"], iframe[src*="hcaptcha"]').count()) {
      throw new Error("Captcha apareceu no login da DropLatam Espanha, não tentei resolver.");
    }
    if (await page.locator('input[type="password"]').count()) throw new Error("Login da DropLatam Espanha não completou.");
    return { page, close: () => browser.close() };
  } catch (err) {
    await browser.close();
    throw err;
  }
}

// Uma página do catálogo: baixa o HTML de dentro do navegador logado e lê os cards.
async function droplatamEsPage(session, n) {
  const cards = await session.page.evaluate(async (url) => {
    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const doc = new DOMParser().parseFromString(await res.text(), "text/html");
    return [...doc.querySelectorAll("a.btn_view_product[data-id]")].map((a) => ({
      id: a.getAttribute("data-id"),
      img: a.querySelector("img")?.getAttribute("src") || null,
      name: (a.querySelector(".inventory-product-title")?.textContent || a.querySelector("img")?.getAttribute("alt") || "").trim(),
      text: a.innerText || a.textContent || "",
    }));
  }, `${DL_ES}/app/products?page=${n}`);
  return cards
    .map((c) => {
      const price = (c.text.match(/(\d+(?:[.,]\d+)?)\s*€/) || [])[1];
      const stock = (c.text.match(/Stock disponible:\s*([\d.]+)/i) || [])[1];
      if (!/^\d+$/.test(String(c.id))) return null;
      return {
        dropiId: Number(c.id),
        name: c.name.slice(0, 500),
        imagePath: c.img ? new URL(c.img, DL_ES).href : null,
        supplierId: null,
        supplierName: null,
        categories: null,
        salePrice: price ? Number(price.replace(",", ".")) : null,
        suggestedPrice: null,
        stock: stock ? saneStock(stock.replace(/\./g, "")) : null,
        warehouseSig: null,
        // Não existe página própria do produto: o link abre a página do catálogo em que ele está.
        productUrl: `${DL_ES}/app/products?page=${n}`,
      };
    })
    .filter(Boolean);
}

// ---------- Dropea ----------
const DROPEA_APP = "https://v2.app.dropea.com";

async function dropeaSession() {
  const email = process.env.DROPEA_EMAIL;
  const password = process.env.DROPEA_PASSWORD;
  if (!email || !password) throw new Error("DROPEA_EMAIL/DROPEA_PASSWORD não configurados");
  const browser = await chromium.launch(launchOptions());
  try {
    const page = await (await browser.newContext({ userAgent: USER_AGENT })).newPage();
    // O pedido "Products" que o próprio site faz traz os cabeçalhos certos
    // (token, papel, mercado): guardamos e reaproveitamos.
    let captured = null;
    page.on("request", (r) => {
      if (/graphql\?op=Products\b/.test(r.url()) && !captured) captured = { url: r.url(), headers: r.headers(), body: r.postData() };
    });
    await page.goto(`${DROPEA_APP}/login`, { waitUntil: "domcontentloaded" });
    await page.locator('input[type="email"], input[name*="mail" i], input[type="text"]').first().fill(email);
    await page.locator('input[type="password"]').first().fill(password);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 20000 }).catch(() => {});
    if (await page.locator('input[type="password"]').count()) throw new Error("Login da Dropea não completou.");
    await page.goto(`${DROPEA_APP}/es/dropshipper/products?showOutOfStock=true`, { waitUntil: "domcontentloaded" });
    for (let i = 0; i < 30 && !captured; i++) await sleep(500);
    if (!captured) throw new Error("Dropea: não vi o pedido do catálogo.");
    const keep = ["authorization", "x-active-role", "x-api-key", "x-market", "content-type", "accept"];
    const headers = Object.fromEntries(Object.entries(captured.headers).filter(([k]) => keep.includes(k)));
    const body = JSON.parse(captured.body);
    return { page, url: captured.url, headers, body, close: () => browser.close() };
  } catch (err) {
    await browser.close();
    throw err;
  }
}

function dropeaNormalize(p) {
  const v = (p.variants || [])[0] || {};
  const img = (p.images || [])[0];
  return {
    dropiId: Number(p.product_number),
    name: String(p.name || "").slice(0, 500),
    imagePath: img ? `https://es.api.dropea.com/api/media/file/product/${p.id}/thumb_${img}` : null,
    supplierId: p.supplier?.user_number ?? null,
    supplierName: [p.supplier?.first_name, p.supplier?.last_name].filter(Boolean).join(" ") || p.supplier?.display_id || null,
    categories: p.category?.name || null,
    // Preço pro dropshipper (atacado) e o preço de venda recomendado (PVPR).
    salePrice: toNumber(v.user_wholesale_price ?? v.wholesale_price),
    suggestedPrice: toNumber(v.price) > 0 ? toNumber(v.price) : null, // 0 = sem PVPR
    stock: saneStock(p.stock),
    warehouseSig: null,
    productUrl: `${DROPEA_APP}/es/dropshipper/products?showOutOfStock=true`,
    listedAt: p.created_at || null,
  };
}

async function dropeaPage(session, n) {
  const body = { ...session.body, variables: { filters: { is_bundle: false }, pagination: { page: n, limit: 100 } } };
  const r = await session.page.evaluate(
    async ({ url, headers, body }) => {
      const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
      const j = await res.json().catch(() => null);
      return { status: res.status, root: j?.data?.products || null, error: j?.errors?.[0]?.message || null };
    },
    { url: session.url, headers: session.headers, body }
  );
  if (!r.root) throw new Error(`Dropea: ${r.error || `HTTP ${r.status}`}`);
  return (r.root.data || []).filter((p) => p.product_number).map(dropeaNormalize);
}

// ---------- leitura genérica, página por página ----------
async function runPagedSweep({ country, label, openSession, readPage, onStart, log = console.log }) {
  await store.ensureSchema();
  const session = await openSession(); // falha cedo (login) antes de abrir a varredura
  const sweep = await store.startSweep(country);
  await store.updateSweep(sweep.id, {});
  if (onStart) await onStart(sweep.id);
  log(`Varredura #${sweep.id} (${label}) começou.`);
  const t0 = Date.now();
  let productsSeen = 0;
  let changes = 0;
  let pagesDone = 0;
  try {
    for (let n = 1; n <= MAX_PAGES; n++) {
      let items = null;
      for (let attempt = 1; attempt <= 3 && items === null; attempt++) {
        try {
          items = await readPage(session, n);
        } catch (err) {
          if (attempt === 3) throw err;
          await sleep(5000 * attempt);
        }
      }
      if (!items.length) break;
      changes += await store.upsertPage(country, sweep.id, items);
      productsSeen += items.length;
      pagesDone = n;
      await store.updateSweep(sweep.id, { pages_done: pagesDone, products_seen: productsSeen, changes_recorded: changes, last_start_data: n });
      if (n % 20 === 0) log(`  ${label}: ${n} páginas, ${productsSeen} produtos`);
      await sleep(PAUSE_MS);
    }
    await store.rollupSweepDay(sweep.id);
    await store.recomputeSales(country);
    await store.updateSweep(sweep.id, { status: "done", finished_at: new Date() });
    log(`Varredura #${sweep.id} (${label}) terminou: ${productsSeen} produtos, ${changes} mudanças, ${((Date.now() - t0) / 60000).toFixed(1)} min.`);
    return { sweepId: sweep.id, productsSeen, changes };
  } catch (err) {
    await store.updateSweep(sweep.id, { status: "error", finished_at: new Date(), error: String(err.message).slice(0, 500) });
    throw err;
  } finally {
    await session.close().catch(() => {});
  }
}

const runDroplatamEsSweep = (opts = {}) =>
  runPagedSweep({ ...opts, country: "dl-es", label: "DropLatam ES", openSession: droplatamEsSession, readPage: droplatamEsPage });
const runDropeaSweep = (opts = {}) => runPagedSweep({ ...opts, country: "de-es", label: "Dropea ES", openSession: dropeaSession, readPage: dropeaPage });

module.exports = { runDroplatamEsSweep, runDropeaSweep };

if (require.main === module) {
  const which = process.argv[2];
  const run = which === "dropea" ? runDropeaSweep : runDroplatamEsSweep;
  run()
    .then(() => store.getPool().end())
    .catch((err) => {
      console.error("Varredura da Espanha falhou:", err.message);
      process.exit(1);
    });
}

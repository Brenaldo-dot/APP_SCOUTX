// Rotas HTTP do Estoque de Fornecedor (só leitura). Registradas pelo server.js
// com a mesma permissão da aba Concorrentes (requireMineradorAccess).
const store = require("./store");
const listingDates = require("./listing-dates");
const mastershopClient = require("./mastershopClient");
const { loadLocalEnv } = require("./env");

// Fontes disponíveis. A chave é o "country" gravado nas tabelas.
const DROPI_CDN = "https://d39ru7awumhhs2.cloudfront.net";
const COUNTRIES = {
  co: { platform: "droplatam", imageBase: DROPI_CDN, site: "https://co.droplatam.com.br" },
  mx: { platform: "droplatam", imageBase: DROPI_CDN, site: "https://mx.droplatam.com.br" },
  ec: { platform: "droplatam", imageBase: DROPI_CDN, site: "https://ec.droplatam.com.br" },
  // Guatemala guarda as fotos em outro CDN (ainda não descoberto): sem foto por enquanto.
  gt: { platform: "droplatam", imageBase: null, site: "https://gt.droplatam.com.br" },
  "ms-co": { platform: "mastershop" },
  // Espanha: sistemas próprios; a foto já vem com URL completa e o link vem
  // gravado no produto (product_url).
  "dl-es": { platform: "droplatam" },
  "de-es": { platform: "dropea" },
};
const PERIODS = new Set([3, 7, 14, 30, 60, 90]);

function country(req) {
  const c = String(req.query.country || "co").toLowerCase();
  return COUNTRIES[c] ? c : null;
}

function intParam(v, { min = 0, max = Infinity, def = 0 } = {}) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

function period(req, def = 7) {
  const d = intParam(req.query.days, { def });
  return PERIODS.has(d) ? d : def;
}

function paging(req) {
  return { page: intParam(req.query.page, { min: 1, def: 1 }), limit: intParam(req.query.limit, { min: 1, max: 120, def: 30 }) };
}

function filters(req) {
  return {
    q: String(req.query.q || "").trim().slice(0, 100) || null,
    category: String(req.query.category || "").trim().slice(0, 60) || null,
    supplierId: intParam(req.query.supplier_id, { min: 1, def: 0 }) || null,
    minPrice: intParam(req.query.min_price, { min: 0, def: 0 }) || null,
    maxPrice: intParam(req.query.max_price, { min: 0, def: 0 }) || null,
    minStock: intParam(req.query.min_stock, { min: 0, def: 0 }) || null,
  };
}

// Mesmo slug que o próprio site da Dropi monta ao abrir um produto
// (/dashboard/product-details/{id}/{slug}); só o id, sem slug, cai na home.
function productSlug(name) {
  return (
    String(name || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9\s]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase()
      .substring(0, 100) || "producto"
  );
}

function productUrl(p) {
  if (p.product_url) return p.product_url;
  if (p.country === "ms-co") return `https://app.mastershop.com/products/market/${p.dropi_id}`;
  const site = COUNTRIES[p.country]?.site;
  return site ? `${site}/dashboard/product-details/${p.dropi_id}/${productSlug(p.name)}` : null;
}

// Dropi guarda só o caminho da foto (monta com o CDN dela); Mastershop já
// manda a URL completa.
function imageUrl(p) {
  if (!p.image_path) return null;
  if (/^https?:\/\//i.test(p.image_path)) return p.image_path;
  const base = COUNTRIES[p.country]?.imageBase;
  return base ? `${base}/${encodeURI(p.image_path)}` : null;
}

// Valores absurdos cadastrados pelo fornecedor viram "sem informação" (mesmo
// limite de store.js).
function sanePrice(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return n > 20000000 ? null : n;
}

function serializeProduct(p) {
  return {
    id: p.id,
    dropiId: String(p.dropi_id),
    name: p.name,
    imageUrl: imageUrl(p),
    productUrl: productUrl(p),
    platform: COUNTRIES[p.country]?.platform || null,
    supplierId: p.supplier_id === null ? null : String(p.supplier_id),
    supplierName: p.supplier_name,
    categories: p.categories,
    salePrice: sanePrice(p.sale_price),
    suggestedPrice: sanePrice(p.suggested_price),
    stock: p.stock === null || p.stock > 1000000 ? null : p.stock,
    sold1d: p.sold_1d,
    sold7d: p.sold_7d,
    sold30d: p.sold_30d,
  };
}

// Tendência: compara a média diária da 2ª metade do período com a 1ª metade.
function trendOf(series) {
  if (series.length < 4) return "estavel";
  const half = Math.floor(series.length / 2);
  const avg = (arr) => arr.reduce((s, d) => s + d.sold, 0) / arr.length;
  const a = avg(series.slice(0, half));
  const b = avg(series.slice(half));
  if (a === 0 && b === 0) return "estavel";
  if (b >= a * 1.25 || (a === 0 && b > 0)) return "subindo";
  if (b <= a * 0.75) return "caindo";
  return "estavel";
}

// Tabela de tabelas não existe ainda = worker nunca rodou neste banco.
function emptyIfNoTables(res, empty) {
  return (err) => {
    if (err.code === "42P01") return res.json(empty);
    throw err;
  };
}

// A Dropi (app.dropi.co) tem o MESMO catálogo e estoque da DropLatam (é a
// marca-mãe; conferido em 2026-09-29: mesmos IDs, estoque e preço). Então
// "dp-co" usa os dados de "co" e só troca o link do produto e o nome da
// plataforma na resposta.
// Mesma regra nos outros países (DropLatam <cc>.droplatam.com.br = Dropi app.dropi.<cc>).
const ALIASES = Object.fromEntries(
  ["co", "mx", "ec", "gt"].map((cc) => [
    `dp-${cc}`,
    { data: cc, platform: "dropi", from: `https://${cc}.droplatam.com.br/`, to: `https://app.dropi.${cc}/` },
  ])
);

function rewriteForAlias(value, alias) {
  if (Array.isArray(value)) return value.map((v) => rewriteForAlias(v, alias));
  if (!value || typeof value !== "object" || value instanceof Date) return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (k === "productUrl" && typeof v === "string" && v.startsWith(alias.from)) out[k] = alias.to + v.slice(alias.from.length);
    else if (k === "platform" && v === COUNTRIES[alias.data].platform) out[k] = alias.platform;
    else out[k] = rewriteForAlias(v, alias);
  }
  return out;
}

// Situação do produto pro painel da extensão.
function productStatus(r, hot) {
  if (!r.sold_30d) return "parado";
  if (hot) return "em_alta";
  if (!r.sold_7d) return "caindo";
  if (r.prev7 > 0) {
    const ratio = r.sold_7d / r.prev7;
    if (ratio >= 1.25) return "subindo";
    if (ratio <= 0.75) return "caindo";
    return "estavel";
  }
  return "vendendo";
}

// Quando o produto entrou no catálogo: exato se apareceu depois que a ScoutX
// começou a acompanhar; senão estimado pelo ID (Dropi/DropLatam, mês/ano).
async function listedInfo(c, r, since) {
  // Plataforma que informa a data de publicação (Dropea): essa vale.
  if (r.listed_at) return { listedAt: new Date(r.listed_at).toISOString(), listedPrecision: "day" };
  const seen = r.first_seen_at ? new Date(r.first_seen_at) : null;
  if (seen && since && seen - since > 36 * 3600000) return { listedAt: seen.toISOString(), listedPrecision: "day" };
  if (c === "co") {
    const est = await listingDates.estimateListedAt(c, r.dropi_id);
    if (est) return { listedAt: est.toISOString(), listedPrecision: "month" };
  }
  return { listedAt: null, listedPrecision: null };
}

function register(app, guard) {
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

  app.use("/api/radar", (req, res, next) => {
    const alias = ALIASES[String(req.query.country || "").toLowerCase()];
    if (!alias) return next();
    req.query.country = alias.data;
    const json = res.json.bind(res);
    res.json = (body) => json(rewriteForAlias(body, alias));
    next();
  });

  app.get(
    "/api/radar/overview",
    guard,
    wrap(async (req, res) => {
      const c = country(req);
      if (!c) return res.status(400).json({ error: "País ainda não disponível." });
      const o = await store.overview(c).catch(emptyIfNoTables(res, { products: 0, latestDay: null }));
      if (!o || res.headersSent) return;
      // Resposta mínima de propósito: nada sobre varredura/leitura/estoque
      // anterior sai pro navegador (o método de coleta não pode vazar).
      res.json({ products: o.products, latestDay: o.latestDay });
    })
  );

  app.get(
    "/api/radar/categories",
    guard,
    wrap(async (req, res) => {
      const c = country(req);
      if (!c) return res.status(400).json({ error: "País ainda não disponível." });
      res.json(await store.listCategories(c));
    })
  );

  app.get(
    "/api/radar/suppliers/search",
    guard,
    wrap(async (req, res) => {
      const c = country(req);
      const q = String(req.query.q || "").trim().slice(0, 60);
      if (!c || q.length < 2) return res.json([]);
      const rows = await store.searchSuppliers(c, q);
      res.json(rows.map((r) => ({ id: String(r.supplier_id), name: r.supplier_name, products: r.products })));
    })
  );

  app.get(
    "/api/radar/catalog",
    guard,
    wrap(async (req, res) => {
      const c = country(req);
      if (!c) return res.status(400).json({ error: "País ainda não disponível." });
      const { items, total } = await store.listCatalog({ country: c, filters: filters(req), sort: req.query.sort, ...paging(req) });
      res.json({ items: items.map(serializeProduct), total });
    })
  );

  app.get(
    "/api/radar/trends",
    guard,
    wrap(async (req, res) => {
      const c = country(req);
      if (!c) return res.status(400).json({ error: "País ainda não disponível." });
      const days = period(req, 7);
      const minSales = intParam(req.query.min_sales, { min: 1, max: 100000, def: 1 });
      const r = await store.listTrends({ country: c, days, filters: filters(req), sort: req.query.sort, minSales, ...paging(req) });
      res.json({
        days,
        anchor: r.anchor,
        total: r.total,
        summary: r.summary && {
          units: Number(r.summary.units),
          revenue: Number(r.summary.revenue),
          avgPrice: r.summary.avg_price,
          avgActiveDays: Number(r.summary.avg_active),
        },
        items: r.items.map((p) => ({ ...serializeProduct(p), periodSold: p.period_sold, activeDays: p.active_days, record: p.record })),
      });
    })
  );

  app.get(
    "/api/radar/winners",
    guard,
    wrap(async (req, res) => {
      const c = country(req);
      if (!c) return res.status(400).json({ error: "País ainda não disponível." });
      const days = period(req, 14);
      const label = ["novo", "explosivo", "fogo", "crescendo"].includes(req.query.label) ? req.query.label : null;
      const r = await store.listWinners({ country: c, days, label, filters: filters(req), ...paging(req) });
      res.json({
        days,
        anchor: r.anchor,
        total: r.total,
        summary: r.summary && { units: Number(r.summary.units), brandNew: r.summary.brand_new, avgPrice: r.summary.avg_price },
        items: r.items.map((p) => ({ ...serializeProduct(p), recent: p.recent, previous: p.previous })),
      });
    })
  );

  app.get(
    "/api/radar/days",
    guard,
    wrap(async (req, res) => {
      const c = country(req);
      if (!c) return res.status(400).json({ error: "País ainda não disponível." });
      const rows = await store.listDays(c, 60);
      res.json(rows.map((r) => ({ day: r.day, units: r.units, products: r.products, revenue: Number(r.revenue) })));
    })
  );

  app.get(
    "/api/radar/days/:day",
    guard,
    wrap(async (req, res) => {
      const c = country(req);
      const day = String(req.params.day);
      if (!c || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return res.status(400).json({ error: "Dia inválido." });
      // ?to=AAAA-MM-DD transforma em intervalo (período personalizado, até 90 dias).
      let to = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to || "")) ? String(req.query.to) : null;
      if (to && to < day) to = null;
      if (to && (new Date(to) - new Date(day)) / 86400000 > 90) return res.status(400).json({ error: "Período máximo de 90 dias." });
      const { items, total, summary } = await store.listDaySales({ country: c, day, to, filters: filters(req), ...paging(req) });
      res.json({ day, to: to || day, total, summary, items: items.map((p) => ({ ...serializeProduct(p), daySold: p.day_sold })) });
    })
  );

  app.get(
    "/api/radar/suppliers",
    guard,
    wrap(async (req, res) => {
      const c = country(req);
      if (!c) return res.status(400).json({ error: "País ainda não disponível." });
      const days = period(req, 14);
      const q = String(req.query.q || "").trim().slice(0, 60) || null;
      const minSales = intParam(req.query.min_sales, { min: 1, max: 100000, def: 1 });
      const r = await store.listTopSuppliers({ country: c, days, q, sort: req.query.sort, minSales, ...paging(req) });
      res.json({
        days,
        anchor: r.anchor,
        total: r.total,
        summary: r.summary && {
          units: Number(r.summary.units),
          revenue: Number(r.summary.revenue),
          ticket: r.summary.ticket === null ? null : Number(r.summary.ticket),
          topName: r.summary.top_name,
        },
        items: r.items.map((s) => ({
          id: String(s.supplier_id),
          name: s.supplier_name,
          sold: s.sold,
          productsSelling: s.products_selling,
          revenue: Number(s.revenue),
          ticket: s.ticket === null ? null : Number(s.ticket),
          totalProducts: s.total_products,
          logoUrl: s.logo_url || null,
          topProducts: (s.top_products || []).map((t) => ({ id: t.id, name: t.name, imageUrl: imageUrl(t), sold30d: t.sold_30d })),
        })),
      });
    })
  );

  // Painel de um fornecedor (os produtos dele vêm do /catalog?supplier_id=).
  app.get(
    "/api/radar/suppliers/:id",
    guard,
    wrap(async (req, res) => {
      const c = country(req);
      const id = parseInt(req.params.id, 10);
      if (!c || !Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Fornecedor inválido." });
      const s = await store.supplierSummary(c, id);
      if (!s) return res.status(404).json({ error: "Fornecedor não encontrado." });
      res.json({
        id: String(s.supplier_id),
        name: s.name,
        logoUrl: s.logo_url || null,
        platform: COUNTRIES[c].platform,
        products: s.products,
        selling: s.selling,
        inStock: s.in_stock,
        sold1d: s.sold1,
        sold7d: s.sold7,
        sold30d: s.sold30,
        revenue30d: Number(s.revenue30),
        ticket: s.ticket === null ? null : Number(s.ticket),
        avgPrice: s.avg_price === null ? null : Number(s.avg_price),
        rank: s.rank,
        ranked: s.ranked,
        categories: s.categories,
      });
    })
  );

  // Extensão do Chrome: recebe os IDs que aparecem na tela da plataforma e
  // devolve só os números do selo (vendas 24h/7d e se está "em alta").
  // Mesmo guard das outras rotas: sem login/permissão na ScoutX, nada volta.
  // Renovação da sessão da Mastershop pela extensão (só a conta admin, com a
  // chave ligada no popup). Recebe o token, testa e passa a usar; nunca devolve
  // o token nem nada da conta.
  app.post(
    "/api/radar/admin/mastershop-session",
    guard,
    wrap(async (req, res) => {
      if (req.appUser?.role !== "admin") return res.status(403).json({ error: "Só o admin." });
      const token = String(req.body?.token || "").trim();
      if (token.length < 100 || token.length > 8000 || !/^[A-Za-z0-9._~+/=-]+$/.test(token)) {
        return res.status(400).json({ error: "Token inválido." });
      }
      loadLocalEnv();
      try {
        const r = await mastershopClient.adoptRefreshToken(token);
        res.json({ ok: true, validUntil: r.expiresAt ? new Date(r.expiresAt).toISOString() : null });
      } catch (err) {
        res.status(422).json({ ok: false, error: err instanceof mastershopClient.MastershopSessionError ? "A Mastershop recusou esse token." : "Não consegui testar o token agora." });
      }
    })
  );

  app.get(
    "/api/radar/lookup",
    guard,
    wrap(async (req, res) => {
      const c = country(req);
      if (!c) return res.status(400).json({ error: "Plataforma inválida." });
      const ids = String(req.query.ids || "")
        .split(",")
        .map((x) => x.trim())
        .filter((x) => /^\d{1,12}$/.test(x))
        .slice(0, 200);
      if (ids.length === 0) return res.json({ items: {} });
      const [rows, since] = await Promise.all([store.lookupByDropiIds(c, ids), store.trackingStart(c)]);
      const items = {};
      for (const r of rows) {
        // "Em alta": vendeu bem no último dia E 30%+ acima da média dos 6 dias
        // anteriores. Precisa ter vendido antes também (sem isso, no começo do
        // histórico, tudo que vende "estaria em alta").
        const before = r.sold_7d - r.sold_1d;
        const hot = r.sold_1d >= 10 && before > 0 && r.sold_1d >= (before / 6) * 1.3;
        items[String(r.dropi_id)] = {
          id: r.id,
          sold1d: r.sold_1d,
          sold7d: r.sold_7d,
          sold30d: r.sold_30d,
          hot,
          status: productStatus(r, hot),
          days7: r.days7 || null,
          activeDays7: r.days7 ? r.days7.filter((n) => n > 0).length : null,
          peak30: r.peak30 ?? null,
          revenue7d: r.price === null || r.price === undefined ? null : Number(r.price) * r.sold_7d,
          category: r.category || null,
          categoryRank: r.category_rank ?? null,
          ...(await listedInfo(c, r, since)),
        };
      }
      res.json({ items });
    })
  );

  app.get(
    "/api/radar/products/:id",
    guard,
    wrap(async (req, res) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Produto inválido." });
      const product = await store.getProduct(id);
      if (!product) return res.status(404).json({ error: "Produto não encontrado." });
      const days = period(req, 7);
      const [{ anchor, series }, allTime, insights] = await Promise.all([
        store.productDaily(product, days),
        store.productDaily(product, 90),
        store.productInsights(product, days),
      ]);
      const total = series.reduce((s, d) => s + d.sold, 0);
      const activeDays = series.filter((d) => d.sold > 0).length;
      const recordDay = allTime.series.reduce((best, d) => (d.sold > (best?.sold || 0) ? d : best), null);
      const dailyAverage = series.length ? total / series.length : 0;
      const price = sanePrice(product.sale_price);
      const stock = product.stock === null || product.stock > 1000000 ? null : product.stock;
      const sup = insights.supplier;
      res.json({
        product: serializeProduct(product),
        days,
        anchor,
        stats: {
          total,
          dailyAverage: Math.round(dailyAverage * 10) / 10,
          maxDaily: series.reduce((m, d) => Math.max(m, d.sold), 0),
          activeDays,
          trackedDays: series.length,
          frequency: series.length ? Math.round((activeDays / series.length) * 100) : 0,
          trend: trendOf(series),
          record: recordDay ? { day: recordDay.day, sold: recordDay.sold } : null,
          revenue: price !== null ? Math.round(total * price) : null,
          // No ritmo médio do período, quantos dias o estoque atual aguenta.
          stockDays: stock !== null && dailyAverage > 0 ? Math.round(stock / dailyAverage) : null,
          allTimeTotal: allTime.series.reduce((s, d) => s + d.sold, 0),
        },
        // Só dia + vendas: reposição/ajuste ficam no servidor.
        series: series.map((d) => ({ day: d.day, sold: d.sold })),
        supplier: sup && {
          id: String(sup.supplier_id),
          name: product.supplier_name,
          logoUrl: sup.logo_url || null,
          products: sup.products,
          selling: sup.selling,
          sold7d: sup.sold7,
          sold30d: sup.sold30,
          ticket: sup.ticket === null ? null : Number(sup.ticket),
          rank: sup.rank,
          ranked: sup.ranked,
        },
        category: insights.category,
        similar: insights.similar.map(serializeProduct),
        priceHistory: insights.prices.map((h) => ({ at: h.at, salePrice: sanePrice(h.sale_price), suggestedPrice: sanePrice(h.suggested_price) })),
      });
    })
  );
}

module.exports = { register };

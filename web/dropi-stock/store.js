// Tabelas e consultas do "Estoque de Fornecedor" (Dropi). Fica fora do db.js
// de propósito: o worker de varredura roda como processo próprio (futuro
// serviço Railway separado, com Chromium) e o web só LÊ daqui, sem
// precisar do Playwright.
//
// Modelo (o catálogo CO tem ~277 mil produtos, não dá pra guardar uma foto
// de cada um por dia):
// - dropi_products: estado atual de cada produto (estoque, preço...).
// - dropi_stock_changes: só as vezes em que o estoque MUDOU entre leituras.
// - dropi_daily_sales: consolidado por produto por DIA (dia = data da
//   varredura no horário de Brasília). É daqui que saem todos os rankings.
// Queda de estoque = venda estimada; subida = reposição. Queda absurda
// (zerou de uma vez um estoque grande) vira "ajuste" e não conta como venda,
// porque normalmente é o fornecedor tirando o produto do ar ou trocando de bodega.
const { Pool } = require("pg");
const { classifyChange, findBatchEdits } = require("./classify");

// Uma varredura só conta como "leitura completa" se leu pelo menos isso
// (testes parciais com --max-pages ficam de fora). Dropi CO tem ~277 mil
// produtos, Mastershop CO ~44 mil.
// Mínimo de produtos pra uma leitura contar como "completa" (catálogo inteiro).
// País novo sem número calibrado usa 1000: senão uma leitura inteira de um
// catálogo menor nunca contaria e o worker leria sem parar.
const FULL_SWEEP_MIN_BY_COUNTRY = { co: 100000, "ms-co": 20000 };
function fullSweepMin(country) {
  return FULL_SWEEP_MIN_BY_COUNTRY[country] ?? 1000;
}
const FULL_SWEEP_MIN_PRODUCTS = FULL_SWEEP_MIN_BY_COUNTRY.co;
// O dia do Radar segue o horário de Brasília (pedido do Samuel): uma leitura
// feita às 01h de 29/09 em Brasília conta como 29/09, mesmo sendo 23h em Bogotá.
const TZ = "America/Sao_Paulo";
// Janela de histórico usada pra saber o "ritmo normal" de cada produto.
const BASELINE_DAYS = 14;

let pool;
function getPool() {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
  return pool;
}

async function ensureSchema() {
  const db = getPool();
  await db.query(`
    CREATE TABLE IF NOT EXISTS dropi_sweeps (
      id SERIAL PRIMARY KEY,
      country TEXT NOT NULL,
      started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      finished_at TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT 'running',
      pages_done INTEGER NOT NULL DEFAULT 0,
      products_seen INTEGER NOT NULL DEFAULT 0,
      changes_recorded INTEGER NOT NULL DEFAULT 0,
      last_start_data INTEGER NOT NULL DEFAULT 0,
      error TEXT
    );
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS dropi_products (
      id SERIAL PRIMARY KEY,
      country TEXT NOT NULL,
      dropi_id BIGINT NOT NULL,
      name TEXT NOT NULL,
      image_path TEXT,
      supplier_id BIGINT,
      supplier_name TEXT,
      categories TEXT,
      sale_price NUMERIC,
      suggested_price NUMERIC,
      stock INTEGER,
      first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      stock_changed_at TIMESTAMPTZ,
      sold_1d INTEGER NOT NULL DEFAULT 0,
      sold_7d INTEGER NOT NULL DEFAULT 0,
      sold_30d INTEGER NOT NULL DEFAULT 0,
      restocked_30d INTEGER NOT NULL DEFAULT 0,
      UNIQUE (country, dropi_id)
    );
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS dropi_stock_changes (
      id BIGSERIAL PRIMARY KEY,
      product_id INTEGER NOT NULL REFERENCES dropi_products(id) ON DELETE CASCADE,
      sweep_id INTEGER REFERENCES dropi_sweeps(id) ON DELETE SET NULL,
      observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      stock INTEGER NOT NULL,
      delta INTEGER NOT NULL
    );
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS dropi_daily_sales (
      product_id INTEGER NOT NULL REFERENCES dropi_products(id) ON DELETE CASCADE,
      day DATE NOT NULL,
      sold INTEGER NOT NULL DEFAULT 0,
      restocked INTEGER NOT NULL DEFAULT 0,
      adjusted INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (product_id, day)
    );
  `);
  // Sinal de vida da varredura: atualizado a cada lote de páginas. Sem sinal
  // há 10+ min = processo morreu (e não "está demorando").
  await db.query(`ALTER TABLE dropi_sweeps ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ;`);
  // Bodegas do produto (ids ordenados): se mudar entre leituras, a variação é ajuste.
  await db.query(`ALTER TABLE dropi_products ADD COLUMN IF NOT EXISTS warehouse_sig TEXT;`);
  await db.query(`ALTER TABLE dropi_stock_changes ADD COLUMN IF NOT EXISTS wh_changed BOOLEAN NOT NULL DEFAULT false;`);
  // Link do produto quando a plataforma não segue o padrão da Dropi (Espanha) e
  // data de publicação quando a plataforma informa (Dropea).
  await db.query(`ALTER TABLE dropi_products ADD COLUMN IF NOT EXISTS product_url TEXT;`);
  await db.query(`ALTER TABLE dropi_products ADD COLUMN IF NOT EXISTS listed_at TIMESTAMPTZ;`);
  // sale | restock | adjust (preenchido no consolidado do dia, ver classify.js).
  await db.query(`ALTER TABLE dropi_stock_changes ADD COLUMN IF NOT EXISTS kind TEXT;`);
  // Vendas estimadas em intervalos com reposição (já somadas em `sold`).
  await db.query(`ALTER TABLE dropi_daily_sales ADD COLUMN IF NOT EXISTS imputed INTEGER NOT NULL DEFAULT 0;`);
  // Leituras agendadas para um horário específico (além da diária automática).
  await db.query(`
    CREATE TABLE IF NOT EXISTS dropi_sweep_requests (
      id SERIAL PRIMARY KEY,
      country TEXT NOT NULL,
      run_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      sweep_id INTEGER REFERENCES dropi_sweeps(id) ON DELETE SET NULL
    );
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_dropi_changes_product_time ON dropi_stock_changes(product_id, observed_at);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_dropi_changes_sweep ON dropi_stock_changes(sweep_id);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_dropi_daily_day ON dropi_daily_sales(day, sold DESC);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_dropi_products_sold7 ON dropi_products(country, sold_7d DESC);`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_dropi_products_supplier ON dropi_products(country, supplier_id);`);
  // Foto (logo) da loja de cada fornecedor, como aparece na plataforma.
  await db.query(`
    CREATE TABLE IF NOT EXISTS dropi_supplier_logos (
      country TEXT NOT NULL,
      supplier_id BIGINT NOT NULL,
      logo_url TEXT,
      checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (country, supplier_id)
    );
  `);
  // Preço do fornecedor/sugerido ao longo do tempo (só grava quando muda).
  await db.query(`
    CREATE TABLE IF NOT EXISTS dropi_price_history (
      id BIGSERIAL PRIMARY KEY,
      product_id INTEGER NOT NULL REFERENCES dropi_products(id) ON DELETE CASCADE,
      observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      sale_price NUMERIC,
      suggested_price NUMERIC
    );
  `);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_dropi_price_history_product ON dropi_price_history(product_id, observed_at);`);
}

// ---------- escrita (worker) ----------

async function startSweep(country) {
  const res = await getPool().query("INSERT INTO dropi_sweeps (country) VALUES ($1) RETURNING *", [country]);
  return res.rows[0];
}

async function getSweep(id) {
  const res = await getPool().query("SELECT * FROM dropi_sweeps WHERE id = $1", [id]);
  return res.rows[0] || null;
}

async function updateSweep(id, fields) {
  const keys = Object.keys(fields);
  const sets = [...keys.map((k, i) => `${k} = $${i + 2}`), "heartbeat_at = now()"].join(", ");
  await getPool().query(`UPDATE dropi_sweeps SET ${sets} WHERE id = $1`, [id, ...keys.map((k) => fields[k])]);
}

// Grava uma página do catálogo numa transação: upsert de cada produto e, se o
// estoque mudou desde a última leitura, uma linha em dropi_stock_changes.
// Produto visto pela 1ª vez NÃO gera mudança (não sabemos o estoque anterior).
async function upsertPage(country, sweepId, items) {
  if (items.length === 0) return 0;
  const client = await getPool().connect();
  let changes = 0;
  try {
    await client.query("BEGIN");
    const ids = items.map((p) => p.dropiId);
    const prev = await client.query(
      "SELECT id, dropi_id, stock, warehouse_sig, sale_price, suggested_price FROM dropi_products WHERE country = $1 AND dropi_id = ANY($2::bigint[])",
      [country, ids]
    );
    const prevById = new Map(prev.rows.map((r) => [String(r.dropi_id), r]));

    for (const p of items) {
      const before = prevById.get(String(p.dropiId));
      const up = await client.query(
        `INSERT INTO dropi_products
           (country, dropi_id, name, image_path, supplier_id, supplier_name, categories, sale_price, suggested_price, stock, warehouse_sig, stock_changed_at, product_url, listed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, NULL, $12, $13)
         ON CONFLICT (country, dropi_id) DO UPDATE SET
           name = EXCLUDED.name,
           product_url = COALESCE(EXCLUDED.product_url, dropi_products.product_url),
           listed_at = COALESCE(EXCLUDED.listed_at, dropi_products.listed_at),
           image_path = EXCLUDED.image_path,
           supplier_id = EXCLUDED.supplier_id,
           supplier_name = EXCLUDED.supplier_name,
           categories = EXCLUDED.categories,
           sale_price = EXCLUDED.sale_price,
           suggested_price = EXCLUDED.suggested_price,
           stock = EXCLUDED.stock,
           warehouse_sig = EXCLUDED.warehouse_sig,
           last_seen_at = now(),
           stock_changed_at = CASE WHEN dropi_products.stock IS DISTINCT FROM EXCLUDED.stock
                                   THEN now() ELSE dropi_products.stock_changed_at END
         RETURNING id`,
        [
          country,
          p.dropiId,
          p.name,
          p.imagePath,
          p.supplierId,
          p.supplierName,
          p.categories,
          p.salePrice,
          p.suggestedPrice,
          p.stock,
          p.warehouseSig,
          p.productUrl ?? null,
          p.listedAt ?? null,
        ]
      );
      if (before && before.stock !== null && p.stock !== null && before.stock !== p.stock) {
        const whChanged = Boolean(before.warehouse_sig && p.warehouseSig && before.warehouse_sig !== p.warehouseSig);
        await client.query(
          "INSERT INTO dropi_stock_changes (product_id, sweep_id, stock, delta, wh_changed) VALUES ($1, $2, $3, $4, $5)",
          [up.rows[0].id, sweepId, p.stock, p.stock - before.stock, whChanged]
        );
        changes++;
      }
      // Histórico de preço: 1ª leitura do produto (ponto de partida) ou quando
      // o preço do fornecedor/sugerido mudou.
      const priceChanged =
        !before ||
        Number(before.sale_price ?? -1) !== Number(p.salePrice ?? -1) ||
        Number(before.suggested_price ?? -1) !== Number(p.suggestedPrice ?? -1);
      if (priceChanged && (p.salePrice !== null || p.suggestedPrice !== null)) {
        await client.query("INSERT INTO dropi_price_history (product_id, sale_price, suggested_price) VALUES ($1, $2, $3)", [
          up.rows[0].id,
          p.salePrice,
          p.suggestedPrice,
        ]);
      }
    }
    await client.query("COMMIT");
    return changes;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Reconstrói o consolidado diário do DIA dessa varredura (data de início no
// horário de Brasília) a partir de TODAS as mudanças das varreduras daquele dia
// (se rodar várias no dia, ou uma retomada, não duplica). Cada mudança é
// classificada em venda/reposição/ajuste por classify.js, usando o ritmo do
// produto nos BASELINE_DAYS dias ANTERIORES (o próprio dia não entra na régua).
async function rollupSweepDay(sweepId) {
  const db = getPool();
  const dayRes = await db.query(
    `SELECT to_char((started_at AT TIME ZONE '${TZ}')::date, 'YYYY-MM-DD') AS day, country FROM dropi_sweeps WHERE id = $1`,
    [sweepId]
  );
  if (!dayRes.rows[0]) return null;
  const { day, country } = dayRes.rows[0];

  // Intervalo de cada varredura = horas desde a varredura completa anterior
  // (define quantas vendas "cabem" naquela leitura).
  const sweeps = await db.query(
    `SELECT id, started_at FROM dropi_sweeps
     WHERE country = $1 AND ((status = 'done' AND products_seen >= $3) OR id = $2)
     ORDER BY started_at`,
    [country, sweepId, fullSweepMin(country)]
  );
  const intervalBySweep = new Map();
  for (let i = 0; i < sweeps.rows.length; i++) {
    const cur = sweeps.rows[i];
    const prev = sweeps.rows[i - 1];
    const hours = prev ? (new Date(cur.started_at) - new Date(prev.started_at)) / 3600000 : 24;
    intervalBySweep.set(cur.id, Math.min(48, Math.max(1, hours)));
  }

  const changes = await db.query(
    `SELECT c.id, c.product_id, c.delta, c.stock, c.wh_changed, c.sweep_id, p.supplier_id
     FROM dropi_stock_changes c JOIN dropi_sweeps s ON s.id = c.sweep_id
     JOIN dropi_products p ON p.id = c.product_id
     WHERE s.country = $1 AND (s.started_at AT TIME ZONE '${TZ}')::date = $2::date
     ORDER BY c.product_id, c.observed_at`,
    [country, day]
  );
  const productIds = [...new Set(changes.rows.map((c) => c.product_id))];

  const hist = productIds.length
    ? await db.query(
        `SELECT p.id,
           LEAST($3::int, GREATEST(0, $2::date - (p.first_seen_at AT TIME ZONE '${TZ}')::date))::int AS history_days,
           COALESCE(SUM(d.sold), 0)::int AS sold, COALESCE(MAX(d.sold), 0)::int AS peak
         FROM dropi_products p
         LEFT JOIN dropi_daily_sales d ON d.product_id = p.id AND d.day >= $2::date - $3::int AND d.day < $2::date
         WHERE p.id = ANY($1::int[])
         GROUP BY p.id`,
        [productIds, day, BASELINE_DAYS]
      )
    : { rows: [] };
  const ctxById = new Map(
    hist.rows.map((h) => [h.id, { historyDays: h.history_days, baseline: h.history_days ? h.sold / h.history_days : 0, peak: h.peak }])
  );

  const batchEdits = findBatchEdits(changes.rows);
  const totals = new Map();
  const kindIds = { sale: [], restock: [], adjust: [] };
  for (const c of changes.rows) {
    const ctx = { ...(ctxById.get(c.product_id) || {}), intervalHours: intervalBySweep.get(c.sweep_id) || 24 };
    const r = classifyChange({ delta: c.delta, stock: c.stock, whChanged: c.wh_changed, batchEdit: batchEdits.has(c.id) }, ctx);
    kindIds[r.kind].push(c.id);
    const t = totals.get(c.product_id) || { sold: 0, restocked: 0, adjusted: 0, imputed: 0 };
    t.sold += r.sold + r.imputed;
    t.restocked += r.restocked;
    t.adjusted += r.adjusted;
    t.imputed += r.imputed;
    totals.set(c.product_id, t);
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    for (const [kind, ids] of Object.entries(kindIds)) {
      if (ids.length) await client.query("UPDATE dropi_stock_changes SET kind = $1 WHERE id = ANY($2::bigint[])", [kind, ids]);
    }
    await client.query(
      `DELETE FROM dropi_daily_sales d USING dropi_products p
       WHERE d.product_id = p.id AND p.country = $1 AND d.day = $2::date`,
      [country, day]
    );
    const rows = [...totals.entries()];
    for (let i = 0; i < rows.length; i += 1000) {
      const chunk = rows.slice(i, i + 1000);
      await client.query(
        `INSERT INTO dropi_daily_sales (product_id, day, sold, restocked, adjusted, imputed)
         SELECT u.pid, $1::date, u.sold, u.restocked, u.adjusted, u.imputed
         FROM unnest($2::int[], $3::int[], $4::int[], $5::int[], $6::int[]) AS u(pid, sold, restocked, adjusted, imputed)`,
        [
          day,
          chunk.map(([pid]) => pid),
          chunk.map(([, t]) => t.sold),
          chunk.map(([, t]) => t.restocked),
          chunk.map(([, t]) => t.adjusted),
          chunk.map(([, t]) => t.imputed),
        ]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
  return { day, changes: changes.rowCount, sale: kindIds.sale.length, restock: kindIds.restock.length, adjust: kindIds.adjust.length };
}

// Cache das vendas 1/7/30 dias em dropi_products (lista do Catálogo ordena
// por isso sem agregar). Janela ancorada no último dia com dados.
async function recomputeSales(country) {
  const db = getPool();
  const anchor = await latestDay(country);
  await db.query(
    `UPDATE dropi_products p SET sold_1d = 0, sold_7d = 0, sold_30d = 0, restocked_30d = 0
     WHERE p.country = $1 AND (p.sold_30d <> 0 OR p.restocked_30d <> 0)`,
    [country]
  );
  if (!anchor) return;
  await db.query(
    `UPDATE dropi_products p SET
       sold_1d = a.s1, sold_7d = a.s7, sold_30d = a.s30, restocked_30d = a.r30
     FROM (
       SELECT d.product_id,
         SUM(CASE WHEN d.day = $2::date THEN d.sold ELSE 0 END)::int AS s1,
         SUM(CASE WHEN d.day > $2::date - 7 THEN d.sold ELSE 0 END)::int AS s7,
         SUM(d.sold)::int AS s30,
         SUM(d.restocked)::int AS r30
       FROM dropi_daily_sales d
       WHERE d.day > $2::date - 30 AND d.day <= $2::date
       GROUP BY d.product_id
     ) a
     WHERE p.id = a.product_id AND p.country = $1`,
    [country, anchor]
  );
}

// ---------- leitura (web) ----------

// Último dia com vendas consolidadas; as janelas (7d, 14d...) terminam nele,
// não em "hoje", pra a tela não ficar zerada enquanto a varredura do dia roda.
async function latestDay(country) {
  const res = await getPool().query(
    `SELECT to_char(max(d.day), 'YYYY-MM-DD') AS day FROM dropi_daily_sales d
     JOIN dropi_products p ON p.id = d.product_id WHERE p.country = $1`,
    [country]
  );
  return res.rows[0]?.day || null;
}

// Filtros comuns a todas as abas. Devolve { sql, params } pra colar num WHERE
// sobre dropi_products (alias p). `params` já começa com o que veio antes.
function productFilters(f, params) {
  const where = ["p.country = $1"];
  if (f.q) {
    params.push(`%${f.q}%`, f.q.trim());
    where.push(`(p.name ILIKE $${params.length - 1} OR p.supplier_name ILIKE $${params.length - 1} OR p.dropi_id::text = $${params.length})`);
  }
  if (f.category) {
    params.push(`%${f.category}%`);
    where.push(`p.categories ILIKE $${params.length}`);
  }
  if (f.supplierId) {
    params.push(f.supplierId);
    where.push(`p.supplier_id = $${params.length}`);
  }
  if (f.minPrice) {
    params.push(f.minPrice);
    where.push(`p.sale_price >= $${params.length}`);
  }
  if (f.maxPrice) {
    params.push(f.maxPrice);
    where.push(`p.sale_price <= $${params.length}`);
  }
  if (f.minStock) {
    params.push(f.minStock);
    where.push(`p.stock >= $${params.length}`);
  }
  return where.join(" AND ");
}

// Fornecedor às vezes cadastra valores absurdos (estoque de 2 bilhões, preço
// de 30 bilhões de pesos). Acima destes limites o valor é tratado como "sem
// informação": não ordena no topo nem aparece na tela.
const MAX_SANE_STOCK = 1000000;
const MAX_SANE_PRICE = 20000000;
const SANE_STOCK = `(CASE WHEN p.stock <= ${MAX_SANE_STOCK} THEN p.stock END)`;
const SANE_PRICE = `(CASE WHEN p.sale_price <= ${MAX_SANE_PRICE} THEN p.sale_price END)`;

const CATALOG_SORTS = {
  sold_7d: `p.sold_7d DESC, p.sold_30d DESC, ${SANE_STOCK} DESC NULLS LAST`,
  sold_1d: `p.sold_1d DESC, p.sold_7d DESC, ${SANE_STOCK} DESC NULLS LAST`,
  sold_30d: `p.sold_30d DESC, ${SANE_STOCK} DESC NULLS LAST`,
  stock: `${SANE_STOCK} DESC NULLS LAST`,
  newest: "p.dropi_id DESC",
  price_asc: `${SANE_PRICE} ASC NULLS LAST`,
  price_desc: `${SANE_PRICE} DESC NULLS LAST`,
};

async function listCatalog({ country, filters = {}, sort, page = 1, limit = 30 }) {
  const params = [country];
  const whereSql = productFilters(filters, params);
  const orderSql = CATALOG_SORTS[sort] || CATALOG_SORTS.sold_7d;
  const offset = (Math.max(1, page) - 1) * limit;
  const [rows, total] = await Promise.all([
    getPool().query(`SELECT p.* FROM dropi_products p WHERE ${whereSql} ORDER BY ${orderSql} LIMIT ${Number(limit)} OFFSET ${Number(offset)}`, params),
    getPool().query(`SELECT count(*)::int AS n FROM dropi_products p WHERE ${whereSql}`, params),
  ]);
  return { items: rows.rows, total: total.rows[0].n };
}

// Ranking de um período: vendas somadas, dias com venda, recorde de 1 dia.
// Usado por Tendências (ordena por vendas ou por atividade) e Produtos do Mês.
async function listTrends({ country, days, filters = {}, sort = "sold", minSales = 1, page = 1, limit = 30 }) {
  const anchor = await latestDay(country);
  if (!anchor) return { items: [], total: 0, anchor: null, days };
  const params = [country, anchor, days, Math.max(1, minSales)];
  const whereSql = productFilters(filters, params);
  const orderSql =
    sort === "activity" ? "a.active_days DESC, a.sold DESC" : sort === "record" ? "a.record DESC, a.sold DESC" : "a.sold DESC, a.active_days DESC";
  const offset = (Math.max(1, page) - 1) * limit;
  const base = `
    WITH a AS (
      SELECT d.product_id, SUM(d.sold)::int AS sold, COUNT(*) FILTER (WHERE d.sold > 0)::int AS active_days, MAX(d.sold)::int AS record
      FROM dropi_daily_sales d
      WHERE d.day > $2::date - $3::int AND d.day <= $2::date
      GROUP BY d.product_id
      HAVING SUM(d.sold) >= $4
    )`;
  const [rows, total, sum] = await Promise.all([
    getPool().query(
      `${base} SELECT p.*, a.sold AS period_sold, a.active_days, a.record
       FROM a JOIN dropi_products p ON p.id = a.product_id
       WHERE ${whereSql} ORDER BY ${orderSql} LIMIT ${Number(limit)} OFFSET ${Number(offset)}`,
      params
    ),
    getPool().query(`${base} SELECT count(*)::int AS n FROM a JOIN dropi_products p ON p.id = a.product_id WHERE ${whereSql}`, params),
    getPool().query(
      `${base} SELECT COALESCE(SUM(a.sold),0)::bigint AS units, COALESCE(SUM(a.sold * ${SANE_PRICE}),0)::bigint AS revenue,
              COALESCE(AVG(${SANE_PRICE}),0)::int AS avg_price, COALESCE(AVG(a.active_days),0)::numeric(10,1) AS avg_active
       FROM a JOIN dropi_products p ON p.id = a.product_id WHERE ${whereSql}`,
      params
    ),
  ]);
  return { items: rows.rows, total: total.rows[0].n, summary: sum.rows[0], anchor, days };
}

// Novos vencedores: vendas no período atual vs o período anterior do mesmo
// tamanho. Mínimo de vendas recentes pra entrar (evita "infinito%" de 1 venda).
async function listWinners({ country, days, filters = {}, label, minRecent = 20, page = 1, limit = 30 }) {
  const anchor = await latestDay(country);
  if (!anchor) return { items: [], total: 0, anchor: null, days };
  const params = [country, anchor, days, minRecent];
  const whereSql = productFilters(filters, params);
  const labelSql = {
    novo: "w.previous = 0",
    explosivo: "w.previous > 0 AND w.recent >= w.previous * 10",
    fogo: "w.previous > 0 AND w.recent >= w.previous * 3 AND w.recent < w.previous * 10",
    crescendo: "w.previous > 0 AND w.recent >= w.previous * 1.5 AND w.recent < w.previous * 3",
  }[label];
  const base = `
    WITH w AS (
      SELECT d.product_id,
        SUM(CASE WHEN d.day > $2::date - $3::int THEN d.sold ELSE 0 END)::int AS recent,
        SUM(CASE WHEN d.day <= $2::date - $3::int THEN d.sold ELSE 0 END)::int AS previous
      FROM dropi_daily_sales d
      WHERE d.day > $2::date - ($3::int * 2) AND d.day <= $2::date
      GROUP BY d.product_id
    )`;
  const cond = `w.recent >= $4 AND (w.previous = 0 OR w.recent >= w.previous * 1.5) ${labelSql ? `AND ${labelSql}` : ""}`;
  const offset = (Math.max(1, page) - 1) * limit;
  const [rows, total, sum] = await Promise.all([
    getPool().query(
      `${base} SELECT p.*, w.recent, w.previous FROM w JOIN dropi_products p ON p.id = w.product_id
       WHERE ${cond} AND ${whereSql} ORDER BY w.recent DESC LIMIT ${Number(limit)} OFFSET ${Number(offset)}`,
      params
    ),
    getPool().query(`${base} SELECT count(*)::int AS n FROM w JOIN dropi_products p ON p.id = w.product_id WHERE ${cond} AND ${whereSql}`, params),
    getPool().query(
      `${base} SELECT COALESCE(SUM(w.recent),0)::bigint AS units, COUNT(*) FILTER (WHERE w.previous = 0)::int AS brand_new,
              COALESCE(AVG(${SANE_PRICE}),0)::int AS avg_price
       FROM w JOIN dropi_products p ON p.id = w.product_id WHERE ${cond} AND ${whereSql}`,
      params
    ),
  ]);
  return { items: rows.rows, total: total.rows[0].n, summary: sum.rows[0], anchor, days };
}

// Dias disponíveis (últimos N com dados) com os totais de cada um.
async function listDays(country, limit = 14) {
  const res = await getPool().query(
    `SELECT to_char(d.day, 'YYYY-MM-DD') AS day, SUM(d.sold)::int AS units,
            COUNT(*) FILTER (WHERE d.sold > 0)::int AS products,
            COALESCE(SUM(d.sold * ${SANE_PRICE}), 0)::bigint AS revenue
     FROM dropi_daily_sales d JOIN dropi_products p ON p.id = d.product_id
     WHERE p.country = $1
     GROUP BY d.day ORDER BY d.day DESC LIMIT $2`,
    [country, limit]
  );
  return res.rows;
}

// Vendas de um dia OU de um intervalo (day..to, inclusive): produtos somados
// no período + totais (unidades, produtos vendendo, faturamento estimado).
async function listDaySales({ country, day, to, filters = {}, page = 1, limit = 30 }) {
  const params = [country, day, to || day];
  const whereSql = productFilters(filters, params);
  const offset = (Math.max(1, page) - 1) * limit;
  const base = `
    WITH r AS (
      SELECT p.id AS pid, SUM(d.sold)::int AS sold
      FROM dropi_daily_sales d JOIN dropi_products p ON p.id = d.product_id
      WHERE d.day BETWEEN $2::date AND $3::date AND d.sold > 0 AND ${whereSql}
      GROUP BY p.id
    )`;
  const [rows, total] = await Promise.all([
    getPool().query(
      `${base} SELECT p.*, r.sold AS day_sold FROM r JOIN dropi_products p ON p.id = r.pid
       ORDER BY r.sold DESC, p.id LIMIT ${Number(limit)} OFFSET ${Number(offset)}`,
      params
    ),
    getPool().query(
      `${base} SELECT count(*)::int AS n, COALESCE(SUM(r.sold),0)::bigint AS units,
              COALESCE(SUM(r.sold * ${SANE_PRICE}),0)::bigint AS revenue
       FROM r JOIN dropi_products p ON p.id = r.pid`,
      params
    ),
  ]);
  const t = total.rows[0];
  return { items: rows.rows, total: t.n, summary: { units: Number(t.units), products: t.n, revenue: Number(t.revenue) } };
}

// Ticket médio = faturamento / unidades vendidas no período (preço médio
// efetivamente vendido daquele fornecedor, ponderado pelas vendas).
const SUPPLIER_SORTS = {
  sold_desc: "sold DESC",
  sold_asc: "sold ASC",
  ticket_desc: "ticket DESC NULLS LAST, sold DESC",
  ticket_asc: "ticket ASC NULLS LAST, sold DESC",
  products_desc: "products_selling DESC, sold DESC",
  revenue_desc: "revenue DESC",
};

async function listTopSuppliers({ country, days, q, sort, minSales = 1, page = 1, limit = 30 }) {
  const anchor = await latestDay(country);
  if (!anchor) return { items: [], total: 0, summary: null, anchor: null, days };
  const params = [country, anchor, days, Math.max(1, minSales)];
  let qSql = "";
  if (q) {
    params.push(`%${q}%`);
    qSql = `AND p.supplier_name ILIKE $${params.length}`;
  }
  // Só produtos com preço sano entram no faturamento/ticket (ver MAX_SANE_PRICE).
  const base = `
    WITH s AS (
      SELECT p.supplier_id, MAX(p.supplier_name) AS supplier_name,
        SUM(d.sold)::int AS sold, COUNT(DISTINCT d.product_id) FILTER (WHERE d.sold > 0)::int AS products_selling,
        COALESCE(SUM(d.sold * ${SANE_PRICE}), 0)::bigint AS revenue,
        (SUM(d.sold * ${SANE_PRICE}) / NULLIF(SUM(CASE WHEN ${SANE_PRICE} IS NOT NULL THEN d.sold END), 0))::bigint AS ticket
      FROM dropi_daily_sales d JOIN dropi_products p ON p.id = d.product_id
      WHERE p.country = $1 AND d.day > $2::date - $3::int AND d.day <= $2::date AND p.supplier_id IS NOT NULL ${qSql}
      GROUP BY p.supplier_id
      HAVING SUM(d.sold) >= $4
    )`;
  const orderSql = SUPPLIER_SORTS[sort] || SUPPLIER_SORTS.sold_desc;
  const offset = (Math.max(1, page) - 1) * limit;
  const [rows, total, sum] = await Promise.all([
    // + total de produtos do fornecedor e os 3 mais vendidos (foto nos cards)
    getPool().query(
      `${base}, page AS (SELECT * FROM s ORDER BY ${orderSql} LIMIT ${Number(limit)} OFFSET ${Number(offset)})
       SELECT page.*,
         (SELECT count(*)::int FROM dropi_products x WHERE x.country = $1 AND x.supplier_id = page.supplier_id) AS total_products,
         (SELECT l.logo_url FROM dropi_supplier_logos l WHERE l.country = $1 AND l.supplier_id = page.supplier_id) AS logo_url,
         (SELECT json_agg(t) FROM (
            SELECT x.id, x.name, x.image_path, x.country, x.sold_30d FROM dropi_products x
            WHERE x.country = $1 AND x.supplier_id = page.supplier_id
            ORDER BY x.sold_30d DESC, x.sold_7d DESC LIMIT 3) t) AS top_products
       FROM page ORDER BY ${orderSql}`,
      params
    ),
    getPool().query(`${base} SELECT count(*)::int AS n FROM s`, params),
    getPool().query(
      `${base} SELECT COALESCE(SUM(sold),0)::bigint AS units, COALESCE(SUM(revenue),0)::bigint AS revenue,
              (SELECT supplier_name FROM s ORDER BY sold DESC LIMIT 1) AS top_name,
              (SUM(revenue) / NULLIF(SUM(sold), 0))::bigint AS ticket FROM s`,
      params
    ),
  ]);
  return { items: rows.rows, total: total.rows[0].n, summary: sum.rows[0], anchor, days };
}

async function getProduct(id) {
  const res = await getPool().query("SELECT * FROM dropi_products WHERE id = $1", [id]);
  return res.rows[0] || null;
}

// Série diária completa (dias sem venda viram 0) dos últimos `days` dias até o
// último dia com dados. Só inclui dias a partir de quando o produto passou a
// ser acompanhado (antes disso não é "0 vendas", é "sem dado").
async function productDaily(product, days) {
  const anchor = (await latestDay(product.country)) || null;
  if (!anchor) return { anchor: null, series: [] };
  const res = await getPool().query(
    `SELECT to_char(g.day, 'YYYY-MM-DD') AS day, COALESCE(d.sold, 0)::int AS sold,
            COALESCE(d.restocked, 0)::int AS restocked, COALESCE(d.adjusted, 0)::int AS adjusted
     FROM generate_series($2::date - ($3::int - 1), $2::date, interval '1 day') AS g(day)
     LEFT JOIN dropi_daily_sales d ON d.product_id = $1 AND d.day = g.day::date
     WHERE g.day::date >= ($4::timestamptz AT TIME ZONE '${TZ}')::date
     ORDER BY g.day`,
    [product.id, anchor, days, product.first_seen_at]
  );
  return { anchor, series: res.rows };
}

// ---------- análise aprofundada de 1 produto ----------

// Palavras "fortes" do nome (4+ letras, sem acento, sem palavras genéricas)
// pra achar o mesmo produto em outros fornecedores.
const STOPWORDS = new Set(["para", "con", "sin", "unidades", "unidad", "pack", "combo", "kit", "x2", "x3", "set", "juego", "original", "nuevo", "nueva", "premium", "super", "mini", "grande"]);
function keyWords(name) {
  return String(name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w) && !/^\d+$/.test(w))
    .slice(0, 3);
}

async function productInsights(product, days) {
  const db = getPool();
  const anchor = await latestDay(product.country);

  const supplierQ = product.supplier_id
    ? db.query(
        `WITH s AS (
           SELECT p.supplier_id, count(*)::int AS products, count(*) FILTER (WHERE p.sold_30d > 0)::int AS selling,
                  COALESCE(sum(p.sold_7d),0)::int AS sold7, COALESCE(sum(p.sold_30d),0)::int AS sold30,
                  (sum(p.sold_30d * ${SANE_PRICE}) / NULLIF(sum(CASE WHEN ${SANE_PRICE} IS NOT NULL THEN p.sold_30d END), 0))::bigint AS ticket
           FROM dropi_products p WHERE p.country = $1 AND p.supplier_id IS NOT NULL GROUP BY p.supplier_id
         ), r AS (SELECT s.*, rank() OVER (ORDER BY sold30 DESC) AS rnk, count(*) OVER () AS total FROM s WHERE sold30 > 0)
         SELECT s.*, r.rnk::int AS rank, r.total::int AS ranked,
           (SELECT l.logo_url FROM dropi_supplier_logos l WHERE l.country = $1 AND l.supplier_id = s.supplier_id) AS logo_url
         FROM s LEFT JOIN r ON r.supplier_id = s.supplier_id WHERE s.supplier_id = $2`,
        [product.country, product.supplier_id]
      )
    : Promise.resolve({ rows: [] });

  const category = product.categories ? product.categories.split(", ")[0] : null;
  const categoryQ = category
    ? db.query(
        `SELECT count(*) FILTER (WHERE sold_30d > $3)::int + 1 AS rank, count(*) FILTER (WHERE sold_30d > 0)::int AS selling, count(*)::int AS total
         FROM dropi_products WHERE country = $1 AND categories ILIKE $2`,
        [product.country, `%${category}%`, product.sold_30d || 0]
      )
    : Promise.resolve({ rows: [] });

  const words = keyWords(product.name);
  const similarQ = words.length
    ? db.query(
        `SELECT * FROM dropi_products
         WHERE country = $1 AND id <> $2 AND ${words.map((_, i) => `unaccent_name ILIKE $${i + 3}`).join(" AND ")}
         ORDER BY sold_30d DESC, sold_7d DESC, stock DESC NULLS LAST LIMIT 8`.replace(
          /unaccent_name/g,
          "translate(lower(name), 'áéíóúàèìòùâêîôûãõçñ', 'aeiouaeiouaeiouaocn')"
        ),
        [product.country, product.id, ...words.map((w) => `%${w}%`)]
      )
    : Promise.resolve({ rows: [] });

  const priceQ = db.query(
    `SELECT to_char(observed_at AT TIME ZONE '${TZ}', 'YYYY-MM-DD"T"HH24:MI') AS at, sale_price, suggested_price
     FROM dropi_price_history WHERE product_id = $1 ORDER BY observed_at`,
    [product.id]
  );

  const [supplier, cat, similar, prices] = await Promise.all([supplierQ, categoryQ, similarQ, priceQ]);
  return { anchor, supplier: supplier.rows[0] || null, category: category ? { name: category, ...cat.rows[0] } : null, similar: similar.rows, prices: prices.rows };
}

// Painel de um fornecedor: números gerais, posição no ranking (30 dias) e
// categorias em que ele mais atua. Os produtos vêm do /catalog?supplier_id.
async function supplierSummary(country, supplierId) {
  const db = getPool();
  const [base, cats] = await Promise.all([
    db.query(
      `WITH s AS (
         SELECT p.supplier_id, max(p.supplier_name) AS name, count(*)::int AS products,
                count(*) FILTER (WHERE p.sold_30d > 0)::int AS selling,
                count(*) FILTER (WHERE p.stock > 0)::int AS in_stock,
                COALESCE(sum(p.sold_1d),0)::int AS sold1, COALESCE(sum(p.sold_7d),0)::int AS sold7, COALESCE(sum(p.sold_30d),0)::int AS sold30,
                COALESCE(sum(p.sold_30d * ${SANE_PRICE}),0)::bigint AS revenue30,
                (sum(p.sold_30d * ${SANE_PRICE}) / NULLIF(sum(CASE WHEN ${SANE_PRICE} IS NOT NULL THEN p.sold_30d END), 0))::bigint AS ticket,
                avg(${SANE_PRICE})::bigint AS avg_price
         FROM dropi_products p WHERE p.country = $1 AND p.supplier_id IS NOT NULL GROUP BY p.supplier_id
       ), r AS (SELECT supplier_id, rank() OVER (ORDER BY sold30 DESC) AS rnk, count(*) OVER () AS total FROM s WHERE sold30 > 0)
       SELECT s.*, r.rnk::int AS rank, r.total::int AS ranked,
         (SELECT l.logo_url FROM dropi_supplier_logos l WHERE l.country = $1 AND l.supplier_id = s.supplier_id) AS logo_url
       FROM s LEFT JOIN r ON r.supplier_id = s.supplier_id WHERE s.supplier_id = $2`,
      [country, supplierId]
    ),
    db.query(
      `SELECT c AS name, count(*)::int AS n FROM dropi_products p, unnest(string_to_array(p.categories, ', ')) AS c
       WHERE p.country = $1 AND p.supplier_id = $2 GROUP BY c ORDER BY n DESC LIMIT 5`,
      [country, supplierId]
    ),
  ]);
  return base.rows[0] ? { ...base.rows[0], categories: cats.rows } : null;
}

// Consulta em lote pela extensão do Chrome (IDs vistos na tela da plataforma).
// Traz o painel completo: vendas 1/7/30d, os 7 últimos dias um a um, a semana
// anterior (tendência), recorde em 30d, dias vendendo, posição na categoria e
// quando o produto apareceu (first_seen).
async function lookupByDropiIds(country, dropiIds) {
  const anchor = await latestDay(country);
  if (!anchor) {
    const res = await getPool().query(
      "SELECT id, dropi_id, sold_1d, sold_7d, sold_30d FROM dropi_products WHERE country = $1 AND dropi_id = ANY($2::bigint[])",
      [country, dropiIds]
    );
    return res.rows;
  }
  const res = await getPool().query(
    `SELECT p.id, p.dropi_id, p.sold_1d, p.sold_7d, p.sold_30d, p.stock, p.first_seen_at, p.listed_at,
       ${SANE_PRICE} AS price, split_part(p.categories, ', ', 1) AS category,
       (SELECT array_agg(COALESCE(d.sold, 0) ORDER BY g.day)
          FROM generate_series($3::date - 6, $3::date, interval '1 day') AS g(day)
          LEFT JOIN dropi_daily_sales d ON d.product_id = p.id AND d.day = g.day::date) AS days7,
       (SELECT COALESCE(sum(d.sold), 0)::int FROM dropi_daily_sales d
          WHERE d.product_id = p.id AND d.day > $3::date - 14 AND d.day <= $3::date - 7) AS prev7,
       (SELECT COALESCE(max(d.sold), 0)::int FROM dropi_daily_sales d
          WHERE d.product_id = p.id AND d.day > $3::date - 30 AND d.day <= $3::date) AS peak30,
       CASE WHEN p.sold_7d > 0 AND p.categories IS NOT NULL THEN
         (SELECT count(*)::int + 1 FROM dropi_products x
            WHERE x.country = p.country AND x.sold_7d > p.sold_7d
              AND split_part(x.categories, ', ', 1) = split_part(p.categories, ', ', 1))
       END AS category_rank
     FROM dropi_products p
     WHERE p.country = $1 AND p.dropi_id = ANY($2::bigint[])`,
    [country, dropiIds, anchor]
  );
  return res.rows;
}

// Primeiro dia em que a plataforma foi acompanhada: produto que apareceu
// depois disso é novo de verdade (a data em que apareceu é a de publicação).
const trackingStartCache = new Map();
async function trackingStart(country) {
  const hit = trackingStartCache.get(country);
  if (hit && Date.now() - hit.at < 3600000) return hit.value;
  const res = await getPool().query("SELECT min(first_seen_at) AS t FROM dropi_products WHERE country = $1", [country]);
  const value = res.rows[0]?.t ? new Date(res.rows[0].t) : null;
  trackingStartCache.set(country, { at: Date.now(), value });
  return value;
}

async function seedPriceHistoryBaseline() {
  // Produtos que ainda não têm nenhum ponto no histórico ganham o preço atual
  // como ponto de partida (roda 1x; depois o upsertPage só grava mudanças).
  const res = await getPool().query(
    `INSERT INTO dropi_price_history (product_id, sale_price, suggested_price)
     SELECT p.id, p.sale_price, p.suggested_price FROM dropi_products p
     WHERE NOT EXISTS (SELECT 1 FROM dropi_price_history h WHERE h.product_id = p.id)
       AND (p.sale_price IS NOT NULL OR p.suggested_price IS NOT NULL)`
  );
  return res.rowCount;
}

async function listChanges(productId, days = 30) {
  const res = await getPool().query(
    `SELECT observed_at, stock, delta FROM dropi_stock_changes
     WHERE product_id = $1 AND observed_at >= now() - ($2 || ' days')::interval
     ORDER BY observed_at`,
    [productId, String(days)]
  );
  return res.rows;
}

// Categorias distintas (o campo guarda "A, B, C"). Cache em memória: muda pouco.
let categoriesCache = { at: 0, country: null, rows: [] };
async function listCategories(country) {
  if (categoriesCache.country === country && Date.now() - categoriesCache.at < 3600 * 1000) return categoriesCache.rows;
  const res = await getPool().query(
    `SELECT c AS name, count(*)::int AS n
     FROM dropi_products p, unnest(string_to_array(p.categories, ', ')) AS c
     WHERE p.country = $1 AND p.categories IS NOT NULL
     GROUP BY c ORDER BY n DESC LIMIT 60`,
    [country]
  );
  categoriesCache = { at: Date.now(), country, rows: res.rows };
  return res.rows;
}

async function searchSuppliers(country, q) {
  const res = await getPool().query(
    `SELECT supplier_id, MAX(supplier_name) AS supplier_name, count(*)::int AS products
     FROM dropi_products WHERE country = $1 AND supplier_id IS NOT NULL AND supplier_name ILIKE $2
     GROUP BY supplier_id ORDER BY products DESC LIMIT 15`,
    [country, `%${q}%`]
  );
  return res.rows;
}

async function overview(country) {
  const [stats, sweep, doneSweeps, anchor, dayCount] = await Promise.all([
    getPool().query(
      `SELECT count(*)::int AS products, count(*) FILTER (WHERE stock > 0)::int AS in_stock,
              count(*) FILTER (WHERE sold_7d > 0)::int AS selling_7d,
              COALESCE(sum(sold_1d), 0)::int AS sold_1d, COALESCE(sum(sold_7d), 0)::int AS sold_7d,
              min(first_seen_at) AS tracking_since
       FROM dropi_products WHERE country = $1`,
      [country]
    ),
    getPool().query("SELECT * FROM dropi_sweeps WHERE country = $1 ORDER BY id DESC LIMIT 1", [country]),
    getPool().query("SELECT count(*)::int AS n FROM dropi_sweeps WHERE country = $1 AND status = 'done' AND products_seen >= $2", [
      country,
      fullSweepMin(country),
    ]),
    latestDay(country),
    getPool().query(
      `SELECT count(DISTINCT d.day)::int AS n FROM dropi_daily_sales d JOIN dropi_products p ON p.id = d.product_id WHERE p.country = $1`,
      [country]
    ),
  ]);
  return { ...stats.rows[0], lastSweep: sweep.rows[0] || null, completedSweeps: doneSweeps.rows[0].n, latestDay: anchor, daysWithData: dayCount.rows[0].n };
}

// ---------- logos dos fornecedores ----------

// Fornecedores sem logo conferido nos últimos `maxAgeDays` (quem vende mais primeiro).
async function suppliersNeedingLogo(country, maxAgeDays = 7, limit = 20000) {
  const res = await getPool().query(
    `SELECT p.supplier_id FROM dropi_products p
     LEFT JOIN dropi_supplier_logos l ON l.country = p.country AND l.supplier_id = p.supplier_id
     WHERE p.country = $1 AND p.supplier_id IS NOT NULL
       AND (l.checked_at IS NULL OR l.checked_at < now() - ($2 || ' days')::interval)
     GROUP BY p.supplier_id ORDER BY COALESCE(sum(p.sold_30d), 0) DESC LIMIT $3`,
    [country, String(maxAgeDays), limit]
  );
  return res.rows.map((r) => r.supplier_id);
}

async function saveSupplierLogos(country, rows) {
  if (!rows.length) return 0;
  const res = await getPool().query(
    `INSERT INTO dropi_supplier_logos (country, supplier_id, logo_url, checked_at)
     SELECT $1, x.id, x.url, now() FROM unnest($2::bigint[], $3::text[]) AS x(id, url)
     ON CONFLICT (country, supplier_id) DO UPDATE SET logo_url = EXCLUDED.logo_url, checked_at = now()`,
    [country, rows.map((r) => r.supplierId), rows.map((r) => r.logoUrl || null)]
  );
  return res.rowCount;
}

module.exports = {
  suppliersNeedingLogo,
  saveSupplierLogos,
  FULL_SWEEP_MIN_PRODUCTS,
  fullSweepMin,
  getPool,
  ensureSchema,
  startSweep,
  getSweep,
  updateSweep,
  upsertPage,
  rollupSweepDay,
  recomputeSales,
  latestDay,
  listCatalog,
  listTrends,
  listWinners,
  listDays,
  listDaySales,
  listTopSuppliers,
  getProduct,
  productDaily,
  productInsights,
  lookupByDropiIds,
  trackingStart,
  supplierSummary,
  seedPriceHistoryBaseline,
  listChanges,
  listCategories,
  searchSuppliers,
  overview,
};

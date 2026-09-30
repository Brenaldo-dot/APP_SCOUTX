// Reconhecimento: loga na Dropi, faz 1 busca no catálogo com estoque e 1
// consulta de produto, e mostra QUAIS campos existem (principalmente os de
// estoque). Não grava nada em banco. Uso: node probe.js [palavra-chave] [saida.json]
const fs = require("fs");
const { loadLocalEnv } = require("./env");
const { openSession, searchCatalog, getProduct } = require("./dropiClient");

loadLocalEnv();

// Caminhos (chave.subchave) cujo nome sugere estoque, pra achar onde a Dropi guarda isso.
function stockPaths(obj, prefix = "", out = []) {
  if (!obj || typeof obj !== "object") return out;
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (/stock|warehouse|bodega|inventor|quantity|amount|sold|venta|sale/i.test(k)) {
      out.push(`${p} = ${JSON.stringify(v)?.slice(0, 120)}`);
    }
    if (v && typeof v === "object" && out.length < 80) stockPaths(Array.isArray(v) ? v[0] : v, p + (Array.isArray(v) ? "[0]" : ""), out);
  }
  return out;
}

async function main() {
  const { DROPI_DOMAIN = "co.droplatam.com.br", DROPI_EMAIL, DROPI_PASSWORD } = process.env;
  if (!DROPI_EMAIL || !DROPI_PASSWORD) {
    console.error("Preencha DROPI_EMAIL e DROPI_PASSWORD em web/dropi-stock/.env.local");
    process.exit(1);
  }
  const keyword = process.argv[2] || "";
  const outFile = process.argv[3];

  console.log(`Logando em ${DROPI_DOMAIN}...`);
  const session = await openSession(DROPI_DOMAIN, DROPI_EMAIL, DROPI_PASSWORD);
  try {
    const t0 = Date.now();
    const search = await searchCatalog(session, { keywords: keyword || undefined, pageSize: 5 });
    console.log(`\nBusca no catálogo (${Date.now() - t0}ms): isSuccess=${search.isSuccess} count=${search.count}`);
    console.log("Chaves no topo da resposta:", Object.keys(search));
    const first = (search.objects || [])[0];
    if (!first) {
      console.log("Nenhum produto voltou. Mensagem:", search.message);
      return;
    }
    console.log("\nChaves do 1º produto:", Object.keys(first).join(", "));
    console.log("\nCampos com cara de estoque/venda na busca:");
    for (const line of stockPaths(first)) console.log("  " + line);

    const t1 = Date.now();
    const detail = await getProduct(session, first.id);
    const obj = detail.objects || detail;
    console.log(`\nDetalhe do produto ${first.id} (${Date.now() - t1}ms): ${obj.name}`);
    console.log("Campos com cara de estoque/venda no detalhe:");
    for (const line of stockPaths(obj)) console.log("  " + line);

    if (outFile) {
      fs.writeFileSync(outFile, JSON.stringify({ search, detail }, null, 2));
      console.log(`\nResposta completa salva em ${outFile}`);
    }
  } finally {
    await session.close();
  }
}

main().catch((err) => {
  console.error("Falhou:", err.constructor.name, err.message);
  process.exit(1);
});

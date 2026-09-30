// Classifica cada mudança de estoque entre duas leituras em VENDA, REPOSIÇÃO
// ou AJUSTE (correção manual do fornecedor, troca de bodega), pra não contar
// como venda o que não é.
//
// Sinais usados numa QUEDA de D unidades (estoque P -> N):
// - troca de bodega na mesma leitura -> ajuste;
// - D enorme (20.000+) -> ajuste;
// - "degrau de correção": levou metade ou mais do estoque de uma vez E
//   (a) a quantidade que saiu é redonda (50, 100, 200... "venda cravada"), ou
//   (b) zerou 100+ de uma vez, ou
//   (c) parou num número redondo com queda de 300+ (1000 -> 200).
//   Venda real cai quebrada (1000 -> 973 -> 941).
//   - Com histórico (5+ dias acompanhado): só é ajuste se ALÉM disso a queda
//     for muito fora do ritmo do próprio produto (5x o esperado pro intervalo
//     e 2x o maior dia recente). Assim produto que explode de verdade continua
//     contando.
//   - Sem histórico: só é ajuste se D >= 300.
// Numa SUBIDA: reposição. As vendas que aconteceram no mesmo intervalo ficam
// escondidas pela chegada de mercadoria, então estimamos pelo ritmo normal do
// produto (só com 3+ dias de histórico).
const ABSOLUTE_ADJUST = 20000;
const ROUND_STEP = 50;
const NO_HISTORY_MIN_DROP = 300;
const ZEROED_MIN_DROP = 100;
const MIN_HISTORY_DAYS = 5;
const MIN_HISTORY_FOR_IMPUTE = 3;

// Também são ajuste:
// - edição em lote: o mesmo fornecedor, na mesma leitura, com vários produtos
//   caindo EXATAMENTE a mesma quantidade (ex.: 3 caixas 3000 -> 2000). Vem
//   pronto do consolidado (batchEdit), porque precisa olhar os outros produtos;
// - degrau redondo dos dois lados: de um múltiplo de 100 pra outro, queda de
//   200+ (3000 -> 2000), mesmo levando menos da metade do estoque;
// - quase zerou de uma vez: levou 80%+ do estoque numa leitura, queda de 200+.
//   Esses dois passam pela mesma régua de histórico do "degrau de correção".
const ROUND_BIG = 100;
const ROUND_BIG_MIN_DROP = 200;
const WIPE_SHARE = 0.8;
const WIPE_MIN_DROP = 200;

function classifyChange({ delta, stock, whChanged, batchEdit = false }, { baseline = 0, peak = 0, historyDays = 0, intervalHours = 24 } = {}) {
  const expected = (baseline * intervalHours) / 24;

  if (delta > 0) {
    const imputed = historyDays >= MIN_HISTORY_FOR_IMPUTE ? Math.round(expected) : 0;
    return { kind: "restock", sold: 0, restocked: delta, adjusted: 0, imputed };
  }

  const drop = -delta;
  const before = stock + drop;
  const adjust = { kind: "adjust", sold: 0, restocked: 0, adjusted: drop, imputed: 0 };
  if (whChanged) return adjust;
  if (drop >= ABSOLUTE_ADJUST) return adjust;
  if (batchEdit) return adjust;

  const bigShare = drop >= before * 0.5;
  const roundLanding = stock % ROUND_STEP === 0;
  // "Venda cravada": saiu exatamente 50, 100, 200... de uma vez. Venda real
  // quase nunca dá número redondo; correção/retirada do fornecedor dá.
  const roundDrop = drop >= ROUND_STEP && drop % ROUND_STEP === 0;
  // Zerou 100+ de uma vez: normalmente o fornecedor tirando o produto/lote do ar.
  const zeroedOut = stock === 0 && drop >= ZEROED_MIN_DROP;

  const roundStep = drop >= ROUND_BIG_MIN_DROP && drop % ROUND_BIG === 0 && stock % ROUND_BIG === 0;
  const nearWipe = drop >= WIPE_MIN_DROP && drop >= before * WIPE_SHARE;

  const pattern = roundStep || nearWipe || (bigShare && (roundDrop || zeroedOut || (roundLanding && drop >= NO_HISTORY_MIN_DROP)));
  if (pattern) {
    if (historyDays >= MIN_HISTORY_DAYS) {
      // Com histórico, só é ajuste se ALÉM do padrão a queda for muito fora do
      // ritmo do produto (produto explodindo de verdade continua contando).
      const outlier = drop >= 30 && drop > Math.max(5 * Math.max(expected, 1), 2 * peak);
      if (outlier) return adjust;
    } else {
      return adjust;
    }
  }
  return { kind: "sale", sold: drop, restocked: 0, adjusted: 0, imputed: 0 };
}

// Marca as quedas que são edição em lote: mesmo fornecedor + mesma leitura +
// mesma quantidade exata em 2+ produtos (queda 100+) ou 3+ produtos (queda 50+).
// `changes`: [{ id, delta, sweep_id, supplier_id }]. Devolve Set de ids.
function findBatchEdits(changes) {
  const groups = new Map();
  for (const c of changes) {
    if (c.delta >= 0 || -c.delta < ROUND_STEP || c.supplier_id === null || c.supplier_id === undefined) continue;
    const key = `${c.sweep_id}:${c.supplier_id}:${c.delta}`;
    const g = groups.get(key) || [];
    g.push(c.id);
    groups.set(key, g);
  }
  const out = new Set();
  for (const [key, ids] of groups) {
    const drop = -Number(key.split(":")[2]);
    if (ids.length >= 3 || (ids.length >= 2 && drop >= ROUND_BIG)) for (const id of ids) out.add(id);
  }
  return out;
}

module.exports = { classifyChange, findBatchEdits };

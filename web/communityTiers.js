// Níveis de embaixador da Comunidade — quanto mais membros ATIVOS a
// comunidade dele tem NO TOTAL (todo mundo, referido pelo embaixador ou não
// — decisão do usuário, 2026-09-19), maior o percentual do nível. Mas esse
// percentual só é de fato PAGO sobre a recorrência de quem community_members.source
// = 'affiliate' (foi trazido pelo link do embaixador de verdade, ver
// cakto.js:recordCommunityCommissionIfAny) — quem entrou pelo diretório sem
// ter sido trazido por ele ajuda a subir de nível, mas não gera comissão
// nenhuma (a plataforma não paga comissão sobre clientes que ela mesma
// trouxe organicamente). Recalculado a cada renovação que chega, não fica
// travado no pico — se a comunidade encolher, a % do mês seguinte cai junto
// (decisão do usuário, 2026-09-10).
const TIERS = [
  { name: "gold", label: "Gold", max: 15, percentage: 25 },
  { name: "platinum", label: "Platinum", max: 25, percentage: 30 },
  // Sem teto de membros — 26+ continua em Diamond, trava em 35% (decisão do
  // usuário: não cria um 4º nível por enquanto).
  { name: "diamond", label: "Diamond", max: Infinity, percentage: 35 },
];

function tierForActiveMembers(count) {
  return TIERS.find((t) => count <= t.max) || TIERS[TIERS.length - 1];
}

module.exports = { TIERS, tierForActiveMembers };

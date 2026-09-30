// Níveis de comissão de RECORRÊNCIA do afiliado comum (pedido do usuário,
// 2026-09-29 — reverte a decisão de 2026-09-19 que tinha zerado recorrência
// pro afiliado comum e mandado tudo pra comissão da Comunidade, ver
// communityTiers.js). Quanto mais clientes DISTINTOS esse afiliado já
// trouxe (qualquer comissão registrada em affiliate_commissions, ver
// db.getAffiliateEarningsSummary), maior o percentual sobre CADA renovação
// futura — recalculado a cada cobrança que chega, não trava no pico (mesmo
// espírito de communityTiers.js: se ele parar de trazer gente, a % do mês
// seguinte não sobe mais, mas as tiers de baixo não recuam).
const AFFILIATE_RECURRING_TIERS = [
  { name: "ate10", max: 10, percentage: 25 },
  { name: "ate20", max: 20, percentage: 30 },
  // Sem teto — acima de 20 continua em 35%, mesmo padrão do "Diamond" da
  // Comunidade (nunca cria um 4º nível sem pedido explícito).
  { name: "acima20", max: Infinity, percentage: 35 },
];

function recurringPercentageForReferredCount(count) {
  return (AFFILIATE_RECURRING_TIERS.find((t) => count <= t.max) || AFFILIATE_RECURRING_TIERS[AFFILIATE_RECURRING_TIERS.length - 1])
    .percentage;
}

module.exports = { AFFILIATE_RECURRING_TIERS, recurringPercentageForReferredCount };

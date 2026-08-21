// Sem `timeZone` explícito, toLocaleString usa o fuso do navegador/servidor
// onde o app está rodando — que não necessariamente é o do usuário. Fixado
// em horário de Brasília porque é pra quem usa o app, independente de onde
// o backend/frontend está hospedado.
const TIMEZONE = 'America/Sao_Paulo'

// O backend sempre grava em UTC, mas o SQLite (usado no atalho local sem
// Docker) não preserva o fuso mesmo a coluna sendo "timezone-aware" no
// modelo — devolve algo tipo "2026-08-15T02:29:28", sem "Z" nem offset. Sem
// indicador de fuso, o JS interpreta como horário LOCAL do navegador/servidor
// (não UTC), o que já entrega hora errada pro toLocaleString de propósito
// nenhum corrigir depois. Corrige a INTERPRETAÇÃO adicionando "Z" quando não
// tem nenhum indicador de fuso — no Postgres (docker-compose) o valor já vem
// com offset, então isso vira um no-op.
function toUtcIso(value) {
  if (typeof value === 'string' && !/[Zz]|[+-]\d{2}:\d{2}$/.test(value)) {
    return `${value}Z`
  }
  return value
}

export function formatDateTime(value) {
  if (!value) return '—'
  return new Date(toUtcIso(value)).toLocaleString('pt-BR', { timeZone: TIMEZONE })
}

export function formatDate(value) {
  if (!value) return '—'
  return new Date(toUtcIso(value)).toLocaleDateString('pt-BR', { timeZone: TIMEZONE })
}

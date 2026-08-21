// Cor de marca de cada plataforma — não a paleta genérica do resto do app,
// de propósito: aqui o objetivo é bater o olho e reconhecer Meta/Google/
// TikTok na hora, não seguir a linguagem visual interna dos outros badges.
const PLATFORM_STYLES = {
  meta: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  google: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  tiktok: 'bg-pink-500/15 text-pink-400 border-pink-500/30',
}

const PLATFORM_LABELS = {
  meta: 'Meta',
  google: 'Google',
  tiktok: 'TikTok',
}

// Mesmas cores de marca do badge acima, em hex — Recharts precisa de cor
// crua (fill/stroke), não dá pra usar classe Tailwind ali. "Cor segue a
// entidade" (guia de dataviz): Meta/Google/TikTok sempre a mesma cor em
// qualquer gráfico do app, não é uma paleta categórica genérica. Validado
// com scripts/validate_palette.js da skill de dataviz (a dupla laranja/rosa
// original — orange-700+pink-700 — não passava no piso de visão normal:
// ΔE 11.7, abaixo do mínimo 15).
export const PLATFORM_HEX = {
  meta: '#1d4ed8',
  google: '#b45309',
  tiktok: '#9d174d',
}

export function PlatformBadge({ platform }) {
  const style = PLATFORM_STYLES[platform] || 'bg-[#222538] text-gray-400 border-[#2d3148]'
  return (
    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium uppercase ${style}`}>
      {PLATFORM_LABELS[platform] || platform}
    </span>
  )
}

const STATUS_STYLES = {
  checking: 'bg-amber-500/15 text-amber-400',
  active: 'bg-emerald-500/15 text-emerald-400',
  paused: 'bg-[#222538] text-gray-400',
  not_shopify: 'bg-red-500/15 text-red-400',
}

const STATUS_LABELS = {
  checking: '🔍 Verificando…',
  active: 'Ativo',
  paused: 'Pausado',
  not_shopify: 'Não é Shopify',
}

export function StatusBadge({ status }) {
  return (
    <span
      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[status] || 'bg-[#222538] text-gray-400'}`}
    >
      {STATUS_LABELS[status] || status}
    </span>
  )
}

const CLASS_STYLES = {
  testando: 'bg-amber-500/15 text-amber-400',
  operacao_media: 'bg-blue-500/15 text-blue-400',
  escalando: 'bg-violet-500/15 text-violet-400',
}

const CLASS_LABELS = {
  testando: 'Testando',
  operacao_media: 'Operação média',
  escalando: 'Escalando',
}

export function ClassificationBadge({ classification }) {
  if (!classification) return <span className="text-xs text-gray-500">—</span>
  return (
    <span
      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${CLASS_STYLES[classification] || 'bg-[#222538] text-gray-400'}`}
    >
      {CLASS_LABELS[classification] || classification}
    </span>
  )
}

// Faixas do Módulo 5: 0–30 Frio, 31–55 Morno, 56–79 Quente, 80–100 Escalando.
const SCORE_LABEL_STYLES = {
  Frio: 'bg-[#222538] text-gray-400',
  Morno: 'bg-amber-500/15 text-amber-400',
  Quente: 'bg-orange-500/15 text-orange-400',
  Escalando: 'bg-red-500/15 text-red-400',
}

// Rampa ordinal 1-hue-só (vermelho, claro→escuro) pro gráfico de barra —
// diferente das 4 cores do badge acima de propósito: o badge é lido isolado
// (não precisa de ordem perceptual), mas aqui as 4 faixas ficam lado a lado
// e viram uma comparação direta, onde a regra do guia de dataviz vale igual
// (1 hue, luminosidade monótona) — a mistura slate/amber/orange/red do badge
// falhou no validador (matiz espalhado 130°, dois degraus quase idênticos).
// Validado com scripts/validate_palette.js --ordinal.
export const SCORE_LABEL_HEX = {
  Frio: '#f87171',
  Morno: '#dc2626',
  Quente: '#b91c1c',
  Escalando: '#7f1d1d',
}

export function ScoreBadge({ score, label }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${SCORE_LABEL_STYLES[label] || 'bg-[#222538] text-gray-400'}`}
    >
      {score} · {label}
    </span>
  )
}

export function ScalingBadge({ scaling }) {
  if (!scaling) return null
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/15 px-2.5 py-0.5 text-xs font-medium text-violet-400">
      🚀 Escalando
    </span>
  )
}

// duplicateCount = quantas OUTRAS páginas foram agrupadas com essa (mesmo
// supplier_id ou imagem reaproveitada — scrapers/duplicate_detector.py).
// O tooltip (hover) mostra quais, sem precisar de mais uma tela.
export function DuplicateBadge({ duplicateCount, duplicateOf }) {
  if (!duplicateCount) return null
  const titles = (duplicateOf || []).map((d) => d.title).join(' · ')
  return (
    <span
      className="rounded bg-orange-500/15 px-1.5 py-0.5 text-xs text-orange-400"
      title={titles ? `Mesma oferta de:\n${titles}` : undefined}
    >
      duplicado ({duplicateCount}x)
    </span>
  )
}

// Verde = tem código de fornecedor confirmado; vermelho = não tem. A cor
// facilita bater o olho na tabela inteira sem precisar ler célula por célula.
export function SupplierIdTag({ supplierId }) {
  if (!supplierId) {
    return (
      <span
        className="rounded bg-red-500/15 px-1.5 py-0.5 font-mono text-xs text-red-400"
        title="Nenhum código de fornecedor confirmado pra este produto"
      >
        —
      </span>
    )
  }
  return (
    <span
      className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-xs text-emerald-400"
      title="Código do fornecedor (barcode/SKU) confirmado"
    >
      {supplierId}
    </span>
  )
}

const ALERT_LABELS = {
  new_product: 'Novo produto',
  product_removed: 'Produto removido',
  price_change: 'Mudança de preço',
  stock_change: 'Mudança de estoque',
  variations_added: 'Novas variações',
  title_change: 'Título mudou',
  image_change: 'Imagem mudou',
  urgency_detected: 'Urgência detectada',
  vendor_changed: 'Fornecedor trocou',
  supplier_id_changed: 'Cód. fornecedor mudou',
  duplicate_detected: 'Duplicado detectado',
  scaling_detected: 'Escalando',
  new_ad: 'Novo anúncio',
  winning_ad: 'Anúncio vencedor',
  ad_killed: 'Anúncio morreu',
  not_shopify: 'Não é Shopify',
}

export function alertLabel(type) {
  return ALERT_LABELS[type] || type
}

// Categoria — pra separar o feed de alerta por assunto (usuário pediu:
// fornecedor mudou num lugar, anúncio em outro) em vez de um único fluxo
// cronológico misturando tudo. Ordem aqui também é a ordem das abas na tela.
export const ALERT_CATEGORIES = [
  {
    key: 'produto',
    label: 'Produto novo/sumiu',
    icon: '📦',
    types: ['new_product', 'product_removed'],
  },
  {
    key: 'fornecedor',
    label: 'Fornecedor',
    icon: '🏭',
    types: ['vendor_changed', 'supplier_id_changed'],
  },
  {
    key: 'anuncios',
    label: 'Anúncios',
    icon: '📣',
    types: ['new_ad', 'winning_ad', 'ad_killed'],
  },
  {
    key: 'escala',
    label: 'Sinais de escala',
    icon: '🚀',
    types: ['scaling_detected', 'duplicate_detected', 'variations_added'],
  },
  {
    key: 'preco_estoque',
    label: 'Preço e estoque',
    icon: '💲',
    types: ['price_change', 'stock_change'],
  },
  {
    key: 'outros',
    label: 'Outros',
    icon: '⚠️',
    types: ['not_shopify', 'title_change', 'image_change', 'urgency_detected'],
  },
]

const TYPE_TO_CATEGORY = Object.fromEntries(
  ALERT_CATEGORIES.flatMap((cat) => cat.types.map((type) => [type, cat.key])),
)

export function alertCategory(type) {
  return TYPE_TO_CATEGORY[type] || 'outros'
}

// Cor por tipo de alerta — a mesma linguagem visual dos outros badges
// (verde/roxo pra sinal positivo, vermelho pra negativo, azul pra neutro),
// pra bater o olho e já saber o tipo sem ler o texto inteiro.
const ALERT_TYPE_STYLES = {
  new_product: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  stock_change: 'bg-red-500/15 text-red-400 border-red-500/30',
  variations_added: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  new_ad: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  price_change: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  urgency_detected: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  vendor_changed: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  supplier_id_changed: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  duplicate_detected: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  scaling_detected: 'bg-violet-500/15 text-violet-400 border-violet-500/30',
  winning_ad: 'bg-violet-500/15 text-violet-400 border-violet-500/30',
  product_removed: 'bg-red-500/15 text-red-400 border-red-500/30',
  ad_killed: 'bg-red-500/15 text-red-400 border-red-500/30',
  not_shopify: 'bg-red-500/15 text-red-400 border-red-500/30',
}

export function AlertTypeBadge({ type }) {
  const style = ALERT_TYPE_STYLES[type] || 'bg-[#222538] text-gray-400 border-[#2d3148]'
  return (
    <span className={`inline-block shrink-0 rounded-md border px-2 py-1 text-xs font-semibold ${style}`}>
      {alertLabel(type)}
    </span>
  )
}

import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AlertTriangle, DollarSign, Factory, LayoutGrid, Megaphone, Package, Rocket } from 'lucide-react'
import { api } from '../api/client.js'
import EmptyState from '../components/EmptyState.jsx'
import Pagination from '../components/Pagination.jsx'
import { ALERT_CATEGORIES, AlertTypeBadge, alertAccentClass } from '../components/Badges.jsx'
import LinkChip from '../components/LinkChip.jsx'
import ProductThumb from '../components/ProductThumb.jsx'
import PriceChangeRow from '../components/PriceChangeRow.jsx'
import LedIcon from '../components/LedIcon.jsx'
import { formatDateTime, formatRelativeTime, isRecent } from '../utils/date.js'
import { useOperation } from '../context/OperationContext.jsx'

const PAGE_SIZE = 50

// Emoji cru nos filtros ("📦 Produto", "🏭 Fornecedor"...) destoava do resto
// do app depois da troca do menu pra ícone-em-pastilha-LED — mesmo
// tratamento aqui, por categoria.
const CATEGORY_ICONS = {
  produto: Package,
  fornecedor: Factory,
  anuncios: Megaphone,
  escala: Rocket,
  preco_estoque: DollarSign,
  outros: AlertTriangle,
}

export default function Alerts() {
  const { operation } = useOperation()
  const [searchParams, setSearchParams] = useSearchParams()
  const category = searchParams.get('categoria') || ''
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1)

  const [alerts, setAlerts] = useState(null)
  const [total, setTotal] = useState(0)
  const [counts, setCounts] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    api.getAlertCounts({ operation }).then(setCounts).catch(() => {})
  }, [operation])

  useEffect(() => {
    api
      .listAlerts({ operation, category: category || undefined, page, limit: PAGE_SIZE })
      .then(({ items, total }) => {
        setAlerts(items)
        setTotal(total)
      })
      .catch((e) => setError(e.message))
  }, [operation, category, page])

  function selectCategory(key) {
    const next = new URLSearchParams(searchParams)
    if (key) next.set('categoria', key)
    else next.delete('categoria')
    next.delete('page')
    setSearchParams(next)
  }

  function goToPage(nextPage) {
    const next = new URLSearchParams(searchParams)
    if (nextPage <= 1) next.delete('page')
    else next.set('page', String(nextPage))
    setSearchParams(next)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Alertas</h2>
        <p className="text-sm text-[var(--text-muted)]">
          Separado por assunto — fornecedor, anúncios, produto etc. cada um no seu canto, em vez de um fluxo só
          misturando tudo. Histórico completo, sempre — nada some por causa de outro alerta mais novo.
        </p>
      </div>

      {counts && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => selectCategory('')}
            className={`flex items-center gap-2 rounded-full border py-1.5 pl-1.5 pr-3.5 text-sm font-medium transition-colors ${
              category === '' ? 'border-brand-600 bg-brand-600 text-white' : 'border-[var(--border)] text-[var(--text-tertiary)] hover:bg-[var(--hover-surface)]'
            }`}
          >
            {category === '' ? <LayoutGrid size={14} /> : <LedIcon Icon={LayoutGrid} />}
            Todos ({counts.total})
          </button>
          {ALERT_CATEGORIES.map((cat) => {
            const CatIcon = CATEGORY_ICONS[cat.key]
            return (
              <button
                key={cat.key}
                onClick={() => selectCategory(cat.key)}
                disabled={!counts.by_category[cat.key]}
                className={`flex items-center gap-2 rounded-full border py-1.5 pl-1.5 pr-3.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                  category === cat.key
                    ? 'border-brand-600 bg-brand-600 text-white'
                    : 'border-[var(--border)] text-[var(--text-tertiary)] hover:bg-[var(--hover-surface)]'
                }`}
              >
                {category === cat.key ? <CatIcon size={14} /> : <LedIcon Icon={CatIcon} />}
                {cat.label} ({counts.by_category[cat.key] || 0})
              </button>
            )
          })}
        </div>
      )}

      {error && <EmptyState title="Não deu pra carregar os alertas" subtitle={error} />}

      {alerts && alerts.length === 0 && (
        <EmptyState
          title="Nenhum alerta aqui ainda"
          subtitle={
            category
              ? 'Nenhum alerta dessa categoria até agora.'
              : 'Cadastre um concorrente pra começar a receber alertas.'
          }
        />
      )}

      {alerts && alerts.length > 0 && (
        <div className="space-y-2.5">
          {alerts.map((alert) => (
            <div
              key={alert.id}
              className={`flex gap-3 rounded-2xl border border-[var(--border)] border-l-4 bg-[var(--bg-surface)] p-4 transition-colors hover:border-brand-500/40 ${alertAccentClass(alert.alert_type)}`}
            >
              <ProductThumb src={alert.product_image_url} title={alert.competitor_name} size="h-12 w-12" rounded="rounded-lg" />
              <div className="min-w-0 flex-1">
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <AlertTypeBadge type={alert.alert_type} />
                  <span className="rounded-full bg-[var(--hover-surface)] px-2 py-0.5 text-xs font-medium text-[var(--text-tertiary)]">
                    🏬 {alert.competitor_name}
                  </span>
                  {isRecent(alert.created_at) && (
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-400">
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                      Novo
                    </span>
                  )}
                  <span className="ml-auto shrink-0 text-xs text-[var(--text-muted)]" title={formatDateTime(alert.created_at)}>
                    {formatRelativeTime(alert.created_at)}
                  </span>
                </div>
                <p className="text-sm leading-snug text-[var(--text-secondary)]">{alert.message}</p>
                <PriceChangeRow payload={alert.payload} message={alert.message} />
                <div className="mt-2.5 flex flex-wrap items-center gap-2">
                  <LinkChip href={alert.product_url} variant="brand">
                    🔗 Ver produto ↗
                  </LinkChip>
                  <LinkChip href={alert.ad_library_url} variant="violet">
                    📣 Ver na biblioteca ↗
                  </LinkChip>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {alerts && alerts.length > 0 && (
        <Pagination page={page} totalPages={totalPages} total={total} onChange={goToPage} />
      )}
    </div>
  )
}

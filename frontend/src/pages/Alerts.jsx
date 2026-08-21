import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../api/client.js'
import EmptyState from '../components/EmptyState.jsx'
import Pagination from '../components/Pagination.jsx'
import { ALERT_CATEGORIES, AlertTypeBadge } from '../components/Badges.jsx'
import { formatDateTime } from '../utils/date.js'
import { useOperation } from '../context/OperationContext.jsx'

const PAGE_SIZE = 50

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
        <p className="text-sm text-gray-500">
          Separado por assunto — fornecedor, anúncios, produto etc. cada um no seu canto, em vez de um fluxo só
          misturando tudo. Histórico completo, sempre — nada some por causa de outro alerta mais novo.
        </p>
      </div>

      {counts && (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => selectCategory('')}
            className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
              category === '' ? 'border-brand-600 bg-brand-600 text-white' : 'border-[#2d3148] text-gray-400 hover:bg-[#222538]'
            }`}
          >
            Todos ({counts.total})
          </button>
          {ALERT_CATEGORIES.map((cat) => (
            <button
              key={cat.key}
              onClick={() => selectCategory(cat.key)}
              disabled={!counts.by_category[cat.key]}
              className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                category === cat.key
                  ? 'border-brand-600 bg-brand-600 text-white'
                  : 'border-[#2d3148] text-gray-400 hover:bg-[#222538]'
              }`}
            >
              {cat.icon} {cat.label} ({counts.by_category[cat.key] || 0})
            </button>
          ))}
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
        <div className="divide-y divide-[#2d3148] rounded-xl border border-[#2d3148] bg-[#1c1f2e]">
          {alerts.map((alert) => (
            <div key={alert.id} className="flex items-start justify-between gap-4 px-4 py-3 text-sm">
              <div className="min-w-0 flex-1">
                <div className="mb-1.5 flex flex-wrap items-center gap-2">
                  <AlertTypeBadge type={alert.alert_type} />
                  <span className="rounded-full bg-[#222538] px-2 py-0.5 text-xs font-medium text-gray-400">
                    🏬 {alert.competitor_name}
                  </span>
                  {alert.product_url && (
                    <a
                      href={alert.product_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="whitespace-nowrap text-xs font-medium text-brand-600 hover:underline"
                    >
                      Ver produto ↗
                    </a>
                  )}
                  {alert.ad_library_url && (
                    <a
                      href={alert.ad_library_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="whitespace-nowrap text-xs font-medium text-brand-600 hover:underline"
                    >
                      Ver na biblioteca ↗
                    </a>
                  )}
                </div>
                <p>{alert.message}</p>
              </div>
              <span className="shrink-0 text-xs text-gray-500">{formatDateTime(alert.created_at)}</span>
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

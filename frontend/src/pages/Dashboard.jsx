import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client.js'
import StatCard from '../components/StatCard.jsx'
import EmptyState from '../components/EmptyState.jsx'
import { AlertTypeBadge, alertAccentClass } from '../components/Badges.jsx'
import NewProductsChart from '../components/NewProductsChart.jsx'
import AdsTimelineChart from '../components/AdsTimelineChart.jsx'
import ScoreDistributionChart from '../components/ScoreDistributionChart.jsx'
import DateRangeFilter from '../components/DateRangeFilter.jsx'
import Select from '../components/Select.jsx'
import LinkChip from '../components/LinkChip.jsx'
import ProductThumb from '../components/ProductThumb.jsx'
import PriceChangeRow from '../components/PriceChangeRow.jsx'
import { formatDateTime, formatRelativeTime, isRecent } from '../utils/date.js'
import { useOperation } from '../context/OperationContext.jsx'
import { useAuth } from '../context/AuthContext.jsx'

function greeting() {
  const hour = new Date().getHours()
  if (hour < 12) return 'Bom dia'
  if (hour < 18) return 'Boa tarde'
  return 'Boa noite'
}

const TODAY_LABEL = new Date().toLocaleDateString('pt-BR', {
  weekday: 'long',
  day: '2-digit',
  month: 'long',
})

export default function Dashboard() {
  const { operation } = useOperation()
  const { me } = useAuth()
  const [summary, setSummary] = useState(null)
  const [error, setError] = useState(null)
  const [competitors, setCompetitors] = useState([])
  const [chartCompetitorId, setChartCompetitorId] = useState('')
  const [range, setRange] = useState({ mode: 'preset', days: 30 })

  useEffect(() => {
    setSummary(null)
    setChartCompetitorId('')
    api.getDashboardSummary({ operation }).then(setSummary).catch((e) => setError(e.message))
    api.listCompetitors({ operation }).then(setCompetitors).catch(() => {})
  }, [operation])

  if (error) return <EmptyState title="Não deu pra carregar o dashboard" subtitle={error} />
  if (!summary) return <p className="text-sm text-[var(--text-muted)]">Carregando…</p>

  return (
    <div className="space-y-8">
      <div className="relative overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-6">
        <div className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-gradient-to-br from-brand-600/25 to-transparent blur-3xl" />
        <div className="relative">
          <h2 className="text-xl font-semibold">
            {greeting()}
            {me?.name ? `, ${me.name.split(' ')[0]}` : ''}
          </h2>
          <p className="mt-1 text-sm capitalize text-[var(--text-muted)]">{TODAY_LABEL}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard
          icon="🏬"
          label="Concorrentes ativos"
          value={summary.active_competitors}
          hint={`${summary.total_competitors} cadastrados`}
        />
        <StatCard icon="📦" label="Produtos monitorados" value={summary.total_products} />
        <StatCard icon="🔥" label="Produtos Quentes" value={summary.hot_products} hint="score 56+/100" />
        <StatCard icon="🔔" label="Alertas (24h)" value={summary.alerts_last_24h} />
      </div>

      {/* Filtros escopam TODOS os gráficos abaixo — uma linha só, acima de
          tudo, pra loja+período nunca desacordarem entre um gráfico e outro. */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Select
          className="w-48"
          value={chartCompetitorId}
          onChange={setChartCompetitorId}
          options={[{ value: '', label: 'Todas as lojas' }, ...competitors.map((c) => ({ value: String(c.id), label: c.name }))]}
        />
        <DateRangeFilter range={range} onChange={setRange} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-4 lg:col-span-2">
          <h3 className="mb-1 text-base font-semibold">Produtos novos por dia</h3>
          <p className="mb-2 text-xs text-[var(--text-muted)]">Quando cada loja sobe produto — queda e alta de verdade, dia a dia</p>
          <NewProductsChart competitorId={chartCompetitorId} operation={operation} range={range} />
        </div>

        <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-4 lg:col-span-2">
          <h3 className="mb-1 text-base font-semibold">Anúncios encontrados por dia</h3>
          <p className="mb-2 text-xs text-[var(--text-muted)]">Por plataforma — ritmo de criativo novo indica se o concorrente tá escalando mídia</p>
          <AdsTimelineChart competitorId={chartCompetitorId} operation={operation} range={range} />
        </div>

        <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-4">
          <h3 className="mb-1 text-base font-semibold">Produtos por faixa de score</h3>
          <p className="mb-2 text-xs text-[var(--text-muted)]">Raio-x de agora — quantos produtos em cada faixa (Frio → Escalando)</p>
          <ScoreDistributionChart competitorId={chartCompetitorId} operation={operation} />
        </div>
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold">Últimos alertas</h3>
          <Link to="/alertas" className="text-sm text-brand-600 hover:underline">
            Ver todos
          </Link>
        </div>
        {summary.recent_alerts.length === 0 ? (
          <EmptyState
            title="Nenhum alerta ainda"
            subtitle="Assim que um concorrente for cadastrado e monitorado, os alertas aparecem aqui."
          />
        ) : (
          <div className="space-y-2.5">
            {summary.recent_alerts.map((alert) => (
              <div
                key={alert.id}
                className={`flex gap-3 rounded-2xl border border-[var(--border)] border-l-4 bg-[var(--bg-surface)] p-3.5 text-sm transition-colors hover:border-brand-500/40 ${alertAccentClass(alert.alert_type)}`}
              >
                <ProductThumb src={alert.product_image_url} title={alert.competitor_name} size="h-11 w-11" rounded="rounded-lg" />
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
                  <p className="leading-snug text-[var(--text-secondary)]">{alert.message}</p>
                  <PriceChangeRow payload={alert.payload} message={alert.message} />
                  <div className="mt-2 flex flex-wrap items-center gap-2">
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
      </div>
    </div>
  )
}

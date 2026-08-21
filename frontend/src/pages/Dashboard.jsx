import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client.js'
import StatCard from '../components/StatCard.jsx'
import EmptyState from '../components/EmptyState.jsx'
import { AlertTypeBadge } from '../components/Badges.jsx'
import NewProductsChart from '../components/NewProductsChart.jsx'
import AdsTimelineChart from '../components/AdsTimelineChart.jsx'
import ScoreDistributionChart from '../components/ScoreDistributionChart.jsx'
import DateRangeFilter from '../components/DateRangeFilter.jsx'
import { formatDateTime } from '../utils/date.js'
import { useOperation } from '../context/OperationContext.jsx'

export default function Dashboard() {
  const { operation } = useOperation()
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
  if (!summary) return <p className="text-sm text-gray-500">Carregando…</p>

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-semibold">Dashboard</h2>
        <p className="text-sm text-gray-500">Visão geral do monitoramento de concorrentes COD</p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard
          label="Concorrentes ativos"
          value={summary.active_competitors}
          hint={`${summary.total_competitors} cadastrados`}
        />
        <StatCard label="Produtos monitorados" value={summary.total_products} />
        <StatCard label="Produtos escalando" value={summary.scaling_products} hint="score 80+/100" />
        <StatCard label="Alertas (24h)" value={summary.alerts_last_24h} />
      </div>

      {/* Filtros escopam TODOS os gráficos abaixo — uma linha só, acima de
          tudo, pra loja+período nunca desacordarem entre um gráfico e outro. */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <select
          value={chartCompetitorId}
          onChange={(e) => setChartCompetitorId(e.target.value)}
          className="rounded-lg border border-[#2d3148] bg-[#161824] px-3 py-1.5 text-xs font-medium text-gray-400 focus:border-brand-500 focus:outline-none"
        >
          <option value="">Todas as lojas</option>
          {competitors.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <DateRangeFilter range={range} onChange={setRange} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-[#2d3148] bg-[#1c1f2e] p-4 lg:col-span-2">
          <h3 className="mb-1 text-base font-semibold">Produtos novos por dia</h3>
          <p className="mb-2 text-xs text-gray-500">Quando cada loja sobe produto — queda e alta de verdade, dia a dia</p>
          <NewProductsChart competitorId={chartCompetitorId} operation={operation} range={range} />
        </div>

        <div className="rounded-xl border border-[#2d3148] bg-[#1c1f2e] p-4 lg:col-span-2">
          <h3 className="mb-1 text-base font-semibold">Anúncios encontrados por dia</h3>
          <p className="mb-2 text-xs text-gray-500">Por plataforma — ritmo de criativo novo indica se o concorrente tá escalando mídia</p>
          <AdsTimelineChart competitorId={chartCompetitorId} operation={operation} range={range} />
        </div>

        <div className="rounded-xl border border-[#2d3148] bg-[#1c1f2e] p-4">
          <h3 className="mb-1 text-base font-semibold">Produtos por faixa de score</h3>
          <p className="mb-2 text-xs text-gray-500">Raio-x de agora — quantos produtos em cada faixa (Frio → Escalando)</p>
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
          <div className="divide-y divide-[#2d3148] rounded-xl border border-[#2d3148] bg-[#1c1f2e]">
            {summary.recent_alerts.map((alert) => (
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
                <span className="shrink-0 text-xs text-gray-500">
                  {formatDateTime(alert.created_at)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

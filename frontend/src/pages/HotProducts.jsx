import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../api/client.js'
import EmptyState from '../components/EmptyState.jsx'
import Pagination from '../components/Pagination.jsx'
import { DuplicateBadge, ScoreBadge, SupplierIdTag } from '../components/Badges.jsx'
import { useOperation } from '../context/OperationContext.jsx'

const PAGE_SIZE = 60

// score_date é uma data de calendário pura (sem hora), não um timestamp —
// não passa por conversão de fuso (utils/date.js formatDate assume UTC e
// desconta pra Brasília, o que joga uma data "2026-08-15" pra "14/08/2026"
// por engano, já que meia-noite UTC já é dia anterior em UTC-3).
function formatScoreDate(isoDate) {
  if (!isoDate) return '—'
  const [year, month, day] = isoDate.split('-')
  return `${day}/${month}/${year}`
}

// Ícones por sinal — pesos e critérios em scoring_service.py, definidos a
// partir de como o usuário mesmo julga se um concorrente tá escalando (não
// é uma fórmula genérica): tempo de anúncio no ar e quantidade de anúncio
// crescendo são os dois sinais mais fortes, de propósito.
const SIGNAL_ICONS = [
  [/^anuncio_ativo/, '📢'],
  [/^anuncios_crescendo/, '🚀'],
  [/^paginas_duplicadas/, '📄'],
  [/^fornecedor_mudou/, '🔄'],
  [/^estoque_caindo/, '📦'],
  [/^variacoes_aumentaram/, '🎨'],
]

function signalIcon(signal) {
  const match = SIGNAL_ICONS.find(([re]) => re.test(signal))
  return match ? match[1] : '•'
}

export default function HotProducts() {
  const { operation } = useOperation()
  const [searchParams, setSearchParams] = useSearchParams()
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1)

  const [competitors, setCompetitors] = useState([])
  const [products, setProducts] = useState(null)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState(null)

  useEffect(() => {
    api.listCompetitors({ operation }).then(setCompetitors).catch(() => {})
    // Troca de operação sempre volta pra página 1 — senão a pessoa pode
    // ficar presa numa página vazia (ex: página 3 na Colômbia não existe
    // pro México, que tem menos produto quente).
    const next = new URLSearchParams(searchParams)
    next.delete('page')
    setSearchParams(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operation])

  useEffect(() => {
    api
      .listHotProducts({ min_score: 56, operation, page, limit: PAGE_SIZE })
      .then(({ items, total }) => {
        setProducts(items)
        setTotal(total)
      })
      .catch((e) => setError(e.message))
  }, [operation, page])

  function goToPage(nextPage) {
    const next = new URLSearchParams(searchParams)
    if (nextPage <= 1) next.delete('page')
    else next.set('page', String(nextPage))
    setSearchParams(next)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const competitorNames = Object.fromEntries(competitors.map((c) => [c.id, c.name]))
  const competitorDomains = Object.fromEntries(competitors.map((c) => [c.id, c.domain]))

  function productUrl(p) {
    const domain = competitorDomains[p.competitor_id]
    return domain ? `https://${domain}/products/${p.handle}` : null
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Produtos Quentes{total > 0 ? ` (${total})` : ''}</h2>
        <p className="text-sm text-gray-500">
          Score 56+ (Quente ou Escalando). Os dois sinais que mais pesam: há quanto tempo o anúncio do produto tá no
          ar (7d já é bom indício, 30d é quase certeza) e a quantidade de anúncios ativos do produto crescendo dia a
          dia — ver <span className="font-mono text-xs">scoring_service.py</span>. Produto recém-visto começa em 0:
          todo sinal baseado em histórico só aparece depois de alguns dias de monitoramento.
        </p>
      </div>

      {error && <EmptyState title="Não deu pra carregar os produtos quentes" subtitle={error} />}

      {products && products.length === 0 && (
        <EmptyState
          title="Nenhum produto quente ainda"
          subtitle="Nenhum produto bateu score 56+ até agora — normal em lojas recém-cadastradas, que ainda não acumularam histórico suficiente. Volte a checar depois do próximo snapshot diário."
        />
      )}

      {products && products.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {products.map((p) => (
            <div key={p.id} className="flex flex-col gap-3 rounded-xl border border-[#2d3148] bg-[#1c1f2e] p-4">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold leading-snug text-gray-200">{p.title}</p>
                <ScoreBadge score={p.score} label={p.score_label} />
              </div>

              <p className="text-xs text-gray-500">{competitorNames[p.competitor_id] || `#${p.competitor_id}`}</p>

              <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500">
                <span>Cód. fornecedor:</span>
                <SupplierIdTag supplierId={p.supplier_id} />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <DuplicateBadge duplicateCount={p.duplicate_count} duplicateOf={p.duplicate_of} />
                {p.active_ad_count > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/15 px-2.5 py-0.5 text-xs font-medium text-blue-400">
                    📣 {p.active_ad_count} anúncio{p.active_ad_count === 1 ? '' : 's'} ativo
                    {p.active_ad_count === 1 ? '' : 's'}
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-3 text-xs">
                {productUrl(p) && (
                  <a
                    href={productUrl(p)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-brand-600 hover:underline"
                  >
                    Ver produto ↗
                  </a>
                )}
                {p.latest_ad_library_url && (
                  <a
                    href={p.latest_ad_library_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-brand-600 hover:underline"
                  >
                    Ver anúncio ↗
                  </a>
                )}
              </div>

              {p.signals.length > 0 && (
                <div className="flex flex-wrap gap-1.5" title={p.signals.join(', ')}>
                  {p.signals.map((s) => (
                    <span key={s} className="rounded bg-[#222538] px-1.5 py-0.5 text-xs text-gray-400">
                      {signalIcon(s)} {s.replace(/_/g, ' ')}
                    </span>
                  ))}
                </div>
              )}

              <p className="mt-auto text-xs text-gray-500">Score calculado em {formatScoreDate(p.score_date)}</p>
            </div>
          ))}
        </div>
      )}

      {products && products.length > 0 && (
        <Pagination page={page} totalPages={totalPages} total={total} onChange={goToPage} />
      )}
    </div>
  )
}

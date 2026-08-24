import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../api/client.js'
import EmptyState from '../components/EmptyState.jsx'
import Pagination from '../components/Pagination.jsx'
import Select from '../components/Select.jsx'
import { DuplicateBadge, ScoreBadge, SignalChip, SupplierIdTag } from '../components/Badges.jsx'
import LinkChip from '../components/LinkChip.jsx'
import ProductThumb from '../components/ProductThumb.jsx'
import { metaAdsLibrarySearchUrl } from '../utils/adLibrary.js'
import { useOperation } from '../context/OperationContext.jsx'

const PAGE_SIZE = 60

// "Filtrar por mais escalados/anúncios ativos/tempo de anúncio ativo"
// (pedido do usuário) são mutuamente exclusivos — vira um `sort` só, igual
// um "ordenar por" — mesmo padrão (label + Select) já usado em Ads.jsx, mais
// fácil de entender que um monte de chip do mesmo jeito lado a lado (era o
// que tinha antes; usuário achou confuso). Fornecedor conectado e anúncios
// crescendo são categóricos (tem ou não tem), por isso viram checkbox.
const SORT_OPTIONS = [
  { value: 'score', label: 'Mais escalados primeiro' },
  { value: 'active_ads', label: 'Mais anúncios ativos primeiro' },
  { value: 'ad_duration', label: 'Mais tempo de anúncio ativo primeiro' },
]

// score_date é uma data de calendário pura (sem hora), não um timestamp —
// não passa por conversão de fuso (utils/date.js formatDate assume UTC e
// desconta pra Brasília, o que joga uma data "2026-08-15" pra "14/08/2026"
// por engano, já que meia-noite UTC já é dia anterior em UTC-3).
function formatScoreDate(isoDate) {
  if (!isoDate) return '—'
  const [year, month, day] = isoDate.split('-')
  return `${day}/${month}/${year}`
}

export default function HotProducts() {
  const { operation } = useOperation()
  const [searchParams, setSearchParams] = useSearchParams()
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1)
  const sort = searchParams.get('sort') || 'score'
  const hasSupplier = searchParams.get('has_supplier') === '1'
  const growingOnly = searchParams.get('growing_only') === '1'

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
      .listHotProducts({
        min_score: 56,
        operation,
        sort,
        has_supplier: hasSupplier || undefined,
        growing_only: growingOnly || undefined,
        page,
        limit: PAGE_SIZE,
      })
      .then(({ items, total }) => {
        setProducts(items)
        setTotal(total)
      })
      .catch((e) => setError(e.message))
  }, [operation, sort, hasSupplier, growingOnly, page])

  function goToPage(nextPage) {
    const next = new URLSearchParams(searchParams)
    if (nextPage <= 1) next.delete('page')
    else next.set('page', String(nextPage))
    setSearchParams(next)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // Trocar filtro/ordenação sempre volta pra página 1 — mesma razão da
  // troca de operação acima (a página atual pode simplesmente não existir
  // mais no resultado filtrado).
  function updateFilter(patch) {
    const next = new URLSearchParams(searchParams)
    for (const [key, value] of Object.entries(patch)) {
      if (!value || value === 'score') next.delete(key)
      else next.set(key, value)
    }
    next.delete('page')
    setSearchParams(next)
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
        <p className="text-sm text-[var(--text-muted)]">
          Score 56+ (Quente ou Escalando). Os dois sinais que mais pesam: há quanto tempo o anúncio do produto tá no
          ar (7d já é bom indício, 30d é quase certeza) e a quantidade de anúncios ativos do produto crescendo dia a
          dia — ver <span className="font-mono text-xs">scoring_service.py</span>. Produto recém-visto começa em 0:
          todo sinal baseado em histórico só aparece depois de alguns dias de monitoramento.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-4 rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-4">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-[var(--text-muted)]">Ordenar por</label>
          <Select
            className="w-64"
            value={sort}
            onChange={(v) => updateFilter({ sort: v })}
            options={SORT_OPTIONS}
          />
        </div>

        <label className="flex items-center gap-2 pb-2 text-sm text-[var(--text-tertiary)]">
          <input
            type="checkbox"
            checked={hasSupplier}
            onChange={(e) => updateFilter({ has_supplier: e.target.checked ? '1' : '' })}
          />
          Só com fornecedor conectado
        </label>

        <label className="flex items-center gap-2 pb-2 text-sm text-[var(--text-tertiary)]">
          <input
            type="checkbox"
            checked={growingOnly}
            onChange={(e) => updateFilter({ growing_only: e.target.checked ? '1' : '' })}
          />
          Só anúncios crescendo
        </label>
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
            <div
              key={p.id}
              className="group relative flex flex-col gap-3 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-4 transition-colors hover:border-brand-500/50"
            >
              <div className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-gradient-to-br from-brand-500/20 to-transparent blur-2xl transition-opacity group-hover:opacity-90" />

              <div className="relative flex items-start gap-3">
                <ProductThumb src={p.main_image_url} title={p.title} size="h-16 w-16" rounded="rounded-xl" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="line-clamp-2 text-sm font-semibold leading-snug text-[var(--text-primary)]">{p.title}</p>
                    <ScoreBadge score={p.score} label={p.score_label} />
                  </div>
                  <p className="mt-1 truncate text-xs text-[var(--text-muted)]">{competitorNames[p.competitor_id] || `#${p.competitor_id}`}</p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-x-3 gap-y-2 rounded-xl bg-[var(--bg-surface-2)] p-2.5 text-xs">
                <div>
                  <p className="mb-1 text-[10px] uppercase tracking-wide text-[var(--text-faint)]">Cód. fornecedor</p>
                  <SupplierIdTag supplierId={p.supplier_id} />
                </div>
                <div>
                  <p className="mb-1 text-[10px] uppercase tracking-wide text-[var(--text-faint)]">Anúncios ativos</p>
                  {p.active_ad_count > 0 ? (
                    <span className="inline-flex items-center gap-1 font-semibold text-blue-400">📣 {p.active_ad_count}</span>
                  ) : (
                    <span className="text-[var(--text-muted)]">—</span>
                  )}
                </div>
                {p.duplicate_count > 0 && (
                  <div className="col-span-2">
                    <DuplicateBadge duplicateCount={p.duplicate_count} duplicateOf={p.duplicate_of} />
                  </div>
                )}
              </div>

              {p.signals.length > 0 && (
                <div>
                  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-faint)]">Sinais de escala</p>
                  <div className="flex flex-wrap gap-1.5">
                    {p.signals.map((s) => (
                      <SignalChip key={s} signal={s} />
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
                <LinkChip to={`/produtos?q=${encodeURIComponent(p.title)}`} variant="neutral">
                  🔎 Buscar em Produtos
                </LinkChip>
                <LinkChip href={productUrl(p)} variant="brand">
                  🔗 Ver produto ↗
                </LinkChip>
                {/* Sempre busca por DOMÍNIO — o link direto de um anúncio
                    específico (?id=...) só mostra os anúncios daquela UMA
                    página/anunciante, e uma mesma loja costuma ter vários
                    anunciantes diferentes rodando anúncio pra ela ao mesmo
                    tempo (confirmado ao vivo). */}
                <LinkChip href={metaAdsLibrarySearchUrl(competitorDomains[p.competitor_id], operation)} variant="violet">
                  📣 Ver anúncio ↗
                </LinkChip>
              </div>

              <p className="text-[11px] text-[var(--text-muted)]">Score calculado em {formatScoreDate(p.score_date)}</p>
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

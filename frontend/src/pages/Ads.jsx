import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../api/client.js'
import EmptyState from '../components/EmptyState.jsx'
import { DaysActiveBadge, PlatformBadge } from '../components/Badges.jsx'
import Pagination from '../components/Pagination.jsx'
import Select from '../components/Select.jsx'
import LinkChip from '../components/LinkChip.jsx'
import ProductThumb from '../components/ProductThumb.jsx'
import { useOperation } from '../context/OperationContext.jsx'

const RESCAN_POLL_MS = 6000
const RESCAN_POLL_ROUNDS = 12 // ~72s — scan de 3 plataformas costuma terminar bem antes disso
const PAGE_SIZE = 60

const PLATFORMS = [
  { value: 'meta', label: 'Facebook / Meta' },
  { value: 'google', label: 'Google' },
  { value: 'tiktok', label: 'TikTok' },
]

export default function Ads() {
  const { operation } = useOperation()
  const [searchParams, setSearchParams] = useSearchParams()
  const competitorId = searchParams.get('competitor_id') || ''
  const platform = searchParams.get('platform') || ''
  const sort = searchParams.get('sort') === 'days_active' ? 'days_active' : 'recent'
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1)

  const [competitors, setCompetitors] = useState([])
  const [ads, setAds] = useState(null)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState(null)
  const [winningOnly, setWinningOnly] = useState(false)
  const [rescanning, setRescanning] = useState(false)
  const [rescanMessage, setRescanMessage] = useState(null)
  const pollRef = useRef(null)

  useEffect(() => {
    api.listCompetitors({ operation }).then(setCompetitors).catch(() => {})
  }, [operation])

  function fetchAds() {
    return api
      .listAds({
        competitor_id: competitorId || undefined,
        operation: competitorId ? undefined : operation,
        platform: platform || undefined,
        winning_only: winningOnly || undefined,
        sort,
        page,
        limit: PAGE_SIZE,
      })
      .then(({ items, total }) => {
        setAds(items)
        setTotal(total)
        return items
      })
      .catch((e) => {
        setError(e.message)
        return null
      })
  }

  useEffect(() => {
    fetchAds()
  }, [competitorId, operation, platform, winningOnly, sort, page])

  useEffect(() => () => clearTimeout(pollRef.current), [])

  function updateParam(key, value) {
    const next = new URLSearchParams(searchParams)
    if (value) next.set(key, value)
    else next.delete(key)
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

  async function handleRescan() {
    if (!competitorId) return
    clearTimeout(pollRef.current)
    setRescanning(true)
    setRescanMessage('Escaneando Meta, Google e TikTok agora — pode levar até 1 minuto…')
    try {
      await api.rescanAds(competitorId)
      const before = ads?.length ?? 0
      let round = 0
      const poll = async () => {
        round += 1
        const fresh = await fetchAds()
        const now = fresh?.length ?? before
        if (now > before || round >= RESCAN_POLL_ROUNDS) {
          setRescanning(false)
          setRescanMessage(
            now > before
              ? `Achou ${now - before} anúncio(s) novo(s).`
              : 'Scan terminou sem achar anúncio novo agora — o concorrente pode não estar anunciando no momento.',
          )
          return
        }
        pollRef.current = setTimeout(poll, RESCAN_POLL_MS)
      }
      pollRef.current = setTimeout(poll, RESCAN_POLL_MS)
    } catch (e) {
      setRescanning(false)
      setRescanMessage(`Não deu pra escanear: ${e.message}`)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Anúncios{total > 0 ? ` (${total})` : ''}</h2>
        <p className="text-sm text-[var(--text-muted)]">
          Encontrados na Meta Ads Library, no Google Ads Transparency Center e no TikTok Creative Center
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-[var(--text-muted)]">Loja</label>
          <Select
            className="w-44"
            value={competitorId}
            onChange={(v) => updateParam('competitor_id', v)}
            options={[{ value: '', label: 'Todas as lojas' }, ...competitors.map((c) => ({ value: String(c.id), label: c.name }))]}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-[var(--text-muted)]">Ferramenta</label>
          <Select
            className="w-44"
            value={platform}
            onChange={(v) => updateParam('platform', v)}
            options={[{ value: '', label: 'Todas as ferramentas' }, ...PLATFORMS]}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-[var(--text-muted)]">Ordenar por</label>
          <Select
            className="w-52"
            value={sort}
            onChange={(v) => updateParam('sort', v === 'days_active' ? 'days_active' : '')}
            options={[
              { value: 'recent', label: 'Mais recentes primeiro' },
              { value: 'days_active', label: 'Mais dias ativos primeiro' },
            ]}
          />
        </div>

        <label className="flex items-center gap-2 pb-2 text-sm text-[var(--text-tertiary)]">
          <input
            type="checkbox"
            checked={winningOnly}
            onChange={(e) => {
              setWinningOnly(e.target.checked)
              updateParam('page', '')
            }}
          />
          Só anúncios vencedores (ativos há 7+ dias)
        </label>

        {competitorId && (
          <button
            type="button"
            onClick={handleRescan}
            disabled={rescanning}
            title="Dispara um scan agora em vez de esperar o cron diário (8h)"
            className="mb-2 rounded-lg border border-[var(--border)] bg-[var(--bg-surface-2)] px-3 py-2 text-sm font-medium text-[var(--text-secondary)] hover:border-brand-500 hover:text-brand-500 disabled:opacity-50"
          >
            {rescanning ? '🔄 Escaneando…' : '🔄 Escanear agora'}
          </button>
        )}
      </div>

      {rescanMessage && <p className="text-xs text-[var(--text-muted)]">{rescanMessage}</p>}

      {error && <EmptyState title="Não deu pra carregar os anúncios" subtitle={error} />}

      {ads && ads.length === 0 && platform === 'tiktok' && (
        <EmptyState
          title="TikTok não publica anúncio pra Colômbia — não é falha da raspagem"
          subtitle={
            <>
              Testado ao vivo direto na ferramenta oficial do TikTok (
              <a
                href="https://library.tiktok.com/ads"
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand-600 hover:underline"
              >
                library.tiktok.com/ads ↗
              </a>
              ), inclusive com "Todos os países" selecionado (o filtro mais amplo que existe lá) e
              buscando tanto pelo domínio quanto pelo nome real do anunciante: zero resultado, sempre.
              A Commercial Content Library do TikTok só existe por exigência legal da União Europeia
              (DSA) — nenhum país da América Latina é coberto. Isso não quer dizer que a loja não
              anuncia no TikTok (aliás, quando ela tem TikTok Pixel instalado no site — visível na
              aba Concorrentes — isso é sinal forte de que anuncia sim), só que essa informação não é
              pública em lugar nenhum hoje, oficial ou de terceiro.
            </>
          }
        />
      )}

      {ads && ads.length === 0 && platform !== 'tiktok' && (
        <EmptyState
          title="Nenhum anúncio encontrado ainda"
          subtitle="O monitoramento de anúncios roda diariamente para concorrentes ativos."
        />
      )}

      {ads && ads.length > 0 && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {ads.map((ad) => (
            <div key={ad.id} className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-4">
              <div className="mb-2 flex items-start gap-3">
                <ProductThumb src={ad.product_image_url} title={ad.product_title} size="h-14 w-14" rounded="rounded-xl" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <PlatformBadge platform={ad.platform} />
                    <DaysActiveBadge
                      days={ad.days_active}
                      title={
                        ad.started_at_raw
                          ? 'Data informada pela própria biblioteca de anúncios'
                          : 'Sem data de início confirmada pela biblioteca — contando desde que nosso sistema viu esse anúncio'
                      }
                    />
                    {ad.is_winning && (
                      <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-xs font-medium text-violet-400">
                        🏆 vencedor
                      </span>
                    )}
                    {ad.status === 'inactive' && (
                      <span className="rounded-full bg-[var(--hover-surface)] px-2 py-0.5 text-xs font-medium text-[var(--text-muted)]">
                        inativo
                      </span>
                    )}
                  </div>
                  {ad.product_title && (
                    <p className="mt-1 truncate text-xs font-medium text-[var(--text-secondary)]">{ad.product_title}</p>
                  )}
                </div>
              </div>
              {ad.advertiser_name && (
                <p className="mb-1 text-xs font-medium text-[var(--text-muted)]">
                  Anunciante: <span className="text-[var(--text-secondary)]">{ad.advertiser_name}</span>
                </p>
              )}
              <p className="line-clamp-3 text-sm text-[var(--text-secondary)]">
                {ad.creative_text || 'Sem texto de criativo capturado'}
              </p>
              <div className="mt-3 flex items-center justify-between gap-2 text-xs text-[var(--text-muted)]">
                <span title={ad.started_at_raw ? 'Data informada pela própria biblioteca de anúncios' : 'Sem data de início confirmada pela biblioteca — contando desde que nosso sistema viu esse anúncio'}>
                  {ad.started_at_raw || (ad.days_active != null ? `${ad.days_active} dias sob nosso monitoramento` : '—')}
                </span>
                <LinkChip href={ad.library_url} variant="violet">
                  📣 Ver na biblioteca ↗
                </LinkChip>
              </div>
            </div>
          ))}
        </div>
      )}

      {ads && ads.length > 0 && (
        <Pagination
          page={page}
          totalPages={Math.max(1, Math.ceil(total / PAGE_SIZE))}
          total={total}
          onChange={goToPage}
        />
      )}
    </div>
  )
}

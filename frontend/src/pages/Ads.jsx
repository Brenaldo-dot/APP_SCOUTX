import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../api/client.js'
import EmptyState from '../components/EmptyState.jsx'
import { PlatformBadge } from '../components/Badges.jsx'
import Pagination from '../components/Pagination.jsx'
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
        <p className="text-sm text-gray-500">
          Encontrados na Meta Ads Library, no Google Ads Transparency Center e no TikTok Creative Center
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">Loja</label>
          <select
            value={competitorId}
            onChange={(e) => updateParam('competitor_id', e.target.value)}
            className="rounded-lg border border-[#2d3148] bg-[#161824] px-3 py-2 text-sm text-gray-100 focus:border-brand-500 focus:outline-none"
          >
            <option value="">Todas as lojas</option>
            {competitors.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">Ferramenta</label>
          <select
            value={platform}
            onChange={(e) => updateParam('platform', e.target.value)}
            className="rounded-lg border border-[#2d3148] bg-[#161824] px-3 py-2 text-sm text-gray-100 focus:border-brand-500 focus:outline-none"
          >
            <option value="">Todas as ferramentas</option>
            {PLATFORMS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-gray-500">Ordenar por</label>
          <select
            value={sort}
            onChange={(e) => updateParam('sort', e.target.value === 'days_active' ? 'days_active' : '')}
            className="rounded-lg border border-[#2d3148] bg-[#161824] px-3 py-2 text-sm text-gray-100 focus:border-brand-500 focus:outline-none"
          >
            <option value="recent">Mais recentes primeiro</option>
            <option value="days_active">Mais dias ativos primeiro</option>
          </select>
        </div>

        <label className="flex items-center gap-2 pb-2 text-sm text-gray-400">
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
            className="mb-2 rounded-lg border border-[#2d3148] bg-[#161824] px-3 py-2 text-sm font-medium text-gray-300 hover:border-brand-500 hover:text-brand-500 disabled:opacity-50"
          >
            {rescanning ? '🔄 Escaneando…' : '🔄 Escanear agora'}
          </button>
        )}
      </div>

      {rescanMessage && <p className="text-xs text-gray-500">{rescanMessage}</p>}

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
            <div key={ad.id} className="rounded-xl border border-[#2d3148] bg-[#1c1f2e] p-4">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <PlatformBadge platform={ad.platform} />
                {ad.days_active != null && (
                  <span
                    className="rounded-full bg-[#222538] px-2 py-0.5 text-xs font-medium text-gray-400"
                    title={
                      ad.started_at_raw
                        ? 'Data informada pela própria biblioteca de anúncios'
                        : 'Sem data de início confirmada pela biblioteca — contando desde que nosso sistema viu esse anúncio'
                    }
                  >
                    📅 {ad.days_active}d ativo
                  </span>
                )}
                {ad.is_winning && (
                  <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-xs font-medium text-violet-400">
                    🏆 vencedor
                  </span>
                )}
                {ad.status === 'inactive' && (
                  <span className="rounded-full bg-[#222538] px-2 py-0.5 text-xs font-medium text-gray-500">
                    inativo
                  </span>
                )}
              </div>
              {ad.advertiser_name && (
                <p className="mb-1 text-xs font-medium text-gray-500">
                  Anunciante: <span className="text-gray-300">{ad.advertiser_name}</span>
                </p>
              )}
              <p className="line-clamp-3 text-sm text-gray-300">
                {ad.creative_text || 'Sem texto de criativo capturado'}
              </p>
              <div className="mt-3 flex items-center justify-between gap-2 text-xs text-gray-500">
                <span title={ad.started_at_raw ? 'Data informada pela própria biblioteca de anúncios' : 'Sem data de início confirmada pela biblioteca — contando desde que nosso sistema viu esse anúncio'}>
                  {ad.started_at_raw || (ad.days_active != null ? `${ad.days_active} dias sob nosso monitoramento` : '—')}
                </span>
                {ad.library_url && (
                  <a
                    href={ad.library_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-brand-600 hover:underline"
                  >
                    Ver na biblioteca ↗
                  </a>
                )}
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

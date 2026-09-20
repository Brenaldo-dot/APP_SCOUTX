import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, Globe, Info, Plus, Sparkles, X } from 'lucide-react'
import { api } from '../api/client.js'
import { rawApi } from '../api/rawClient.js'
import { operationLabel, useOperation } from '../context/OperationContext.jsx'
import CompetitorLogo from './CompetitorLogo.jsx'

const PAGE_SIZE = 15
const COLUMNS = 3

function normalizeDomain(domain) {
  return String(domain || '')
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '')
}

function shuffle(list) {
  const out = [...list]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

const ANIMATIONS = `
@keyframes sx-card-in { from { opacity: 0; transform: translateY(10px) scale(0.98); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .sx-card-in { animation: none !important; } }
`

// Botão que abre o painel de lojas sugeridas do país atual. Um clique em
// "Adicionar" cadastra como concorrente (mesmo endpoint, e mesmos limites de
// plano, do formulário da página). De propósito não mostra quantas lojas nem
// quantas páginas existem: a ideia é parecer um catálogo sem fim. A ordem é
// embaralhada de novo toda vez que o painel abre e toda vez que a última
// página dá a volta pra primeira.
export default function SuggestedCompetitors({ operation, trackedDomains, disabled, onAdded }) {
  const { orderedOperations } = useOperation()
  const [suggestions, setSuggestions] = useState(null)
  const [open, setOpen] = useState(false)
  const [entered, setEntered] = useState(false)
  const [order, setOrder] = useState([])
  const [page, setPage] = useState(0)
  const [addingDomain, setAddingDomain] = useState(null)
  const [justAdded, setJustAdded] = useState(false)
  // Lojas adicionadas nesta sessão do painel: somem na hora, sem esperar a
  // lista da página recarregar (evita clicar 2x na mesma e tomar um 409).
  const [addedDomains, setAddedDomains] = useState(() => new Set())
  const [error, setError] = useState(null)
  const scrollerRef = useRef(null)
  const justAddedTimerRef = useRef(null)

  useEffect(() => () => clearTimeout(justAddedTimerRef.current), [])

  useEffect(() => {
    let cancelled = false
    setSuggestions(null)
    rawApi
      .listSuggestedCompetitors(operation)
      .then((list) => !cancelled && setSuggestions(list))
      .catch(() => !cancelled && setSuggestions([]))
    return () => {
      cancelled = true
    }
  }, [operation])

  useEffect(() => {
    if (!open) return
    setEntered(false)
    const raf = requestAnimationFrame(() => setEntered(true))
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => {
      cancelAnimationFrame(raf)
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const tracked = useMemo(() => new Set((trackedDomains || []).map(normalizeDomain)), [trackedDomains])
  const available = useMemo(
    () => (suggestions || []).filter((s) => !tracked.has(normalizeDomain(s.domain)) && !addedDomains.has(s.domain)),
    [suggestions, tracked, addedDomains]
  )
  // A ordem embaralhada fica guardada (order) pra não pular de lugar a cada
  // loja adicionada: quem já foi adicionada só sai da fila, o resto mantém a
  // posição relativa e as páginas se reencaixam.
  const ordered = useMemo(() => {
    const byDomain = new Map(available.map((s) => [s.domain, s]))
    const inOrder = order.filter((d) => byDomain.has(d)).map((d) => byDomain.get(d))
    const seen = new Set(order)
    return [...inOrder, ...available.filter((s) => !seen.has(s.domain))]
  }, [order, available])

  // Páginas de linhas cheias (grid de 3 colunas) e de tamanho parecido:
  // só entra na rodada um número de lojas múltiplo de 3 (as 1 ou 2 que
  // sobram ficam de fora até o próximo embaralhamento, então mudam a cada
  // rodada), dividido igualmente em páginas de no máximo PAGE_SIZE. Ex: 64
  // lojas viram 63 em 5 páginas de 15, 12, 12, 12 e 12.
  const usableCount = ordered.length < COLUMNS ? ordered.length : ordered.length - (ordered.length % COLUMNS)
  const totalRows = Math.ceil(usableCount / COLUMNS)
  const pageCount = Math.max(1, Math.ceil(totalRows / (PAGE_SIZE / COLUMNS)))
  const safePage = Math.min(page, pageCount - 1)
  const baseRows = Math.floor(totalRows / pageCount)
  const extraPages = totalRows % pageCount
  const startRow = safePage * baseRows + Math.min(safePage, extraPages)
  const rowsInPage = baseRows + (safePage < extraPages ? 1 : 0)
  const pageItems = ordered.slice(0, usableCount).slice(startRow * COLUMNS, (startRow + rowsInPage) * COLUMNS)

  if (!suggestions || (available.length === 0 && !open)) return null

  const flag = orderedOperations.find((op) => op.value === operation)?.flag || '🌎'

  function reshuffle() {
    setOrder(shuffle(available.map((s) => s.domain)))
    setPage(0)
  }

  function scrollToTop() {
    scrollerRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function openPanel() {
    reshuffle()
    setError(null)
    setJustAdded(false)
    setAddedDomains(new Set())
    setOpen(true)
  }

  function goNext() {
    if (safePage + 1 >= pageCount) reshuffle()
    else setPage(safePage + 1)
    scrollToTop()
  }

  function goPrev() {
    setPage(safePage === 0 ? pageCount - 1 : safePage - 1)
    scrollToTop()
  }

  async function handleAdd(suggestion) {
    setAddingDomain(suggestion.domain)
    setError(null)
    try {
      await api.createCompetitor({
        domain: suggestion.domain,
        name: suggestion.name || null,
        niche: null,
        tags: [],
        operation,
      })
      setAddedDomains((prev) => new Set(prev).add(suggestion.domain))
      setJustAdded(true)
      clearTimeout(justAddedTimerRef.current)
      justAddedTimerRef.current = setTimeout(() => setJustAdded(false), 4000)
      onAdded?.()
    } catch (err) {
      setError(err.message)
    } finally {
      setAddingDomain(null)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={openPanel}
        className="group inline-flex items-center gap-2 rounded-lg border border-brand-500/40 bg-brand-500/5 px-4 py-2 text-sm font-medium text-brand-500 transition-colors hover:border-brand-500 hover:bg-brand-500/10"
      >
        <Sparkles size={15} className="transition-transform duration-200 group-hover:rotate-12 group-hover:scale-110" />
        Sugestões de lojas
      </button>

      {open && (
        <div
          className={`fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-md transition-opacity duration-200 ${
            entered ? 'opacity-100' : 'opacity-0'
          }`}
          onClick={() => setOpen(false)}
        >
          <style>{ANIMATIONS}</style>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Sugestões de lojas"
            onClick={(e) => e.stopPropagation()}
            className={`flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-[28px] border border-[var(--border)] bg-[var(--bg-surface)] shadow-2xl shadow-black/40 transition-all duration-300 ${
              entered ? 'translate-y-0 scale-100' : 'translate-y-4 scale-[0.97]'
            }`}
          >
            <div className="relative overflow-hidden border-b border-[var(--border)] px-7 py-6">
              <div className="pointer-events-none absolute -left-12 -top-20 h-52 w-52 rounded-full bg-brand-500/25 blur-3xl" />
              <div className="pointer-events-none absolute -right-10 -top-16 h-44 w-44 rounded-full bg-brand-400/10 blur-3xl" />
              <div className="relative flex items-center gap-4">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-400 to-brand-600 text-white shadow-lg shadow-brand-600/40 ring-4 ring-brand-500/10">
                  <Sparkles size={22} />
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="text-lg font-semibold tracking-tight text-[var(--text-primary)]">Sugestões de lojas</h3>
                  <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--bg-surface-2)] px-2.5 py-0.5 font-medium text-[var(--text-secondary)]">
                      {flag} {operationLabel(operation)}
                    </span>
                    Escolha uma loja e comece a monitorar com um clique.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Fechar"
                  className="rounded-full p-2 text-[var(--text-muted)] transition-colors hover:bg-[var(--hover-surface)] hover:text-[var(--text-primary)]"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            <div ref={scrollerRef} className="sx-scroll overflow-y-auto px-7 py-6">
              <div className="flex items-start gap-3 rounded-2xl border border-amber-500/25 bg-gradient-to-r from-amber-500/15 to-amber-500/5 px-4 py-3.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-amber-400">
                  <Info size={16} />
                </span>
                <div>
                  <p className="text-sm font-semibold text-amber-400">O ideal é adicionar os seus próprios concorrentes</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-[var(--text-muted)]">
                    Essas sugestões servem de atalho pra você começar, mas muita gente enxerga as mesmas lojas, então o
                    resultado costuma ser melhor com concorrentes que você mesmo pesquisou e escolheu.
                  </p>
                </div>
              </div>

              {disabled && (
                <p className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-400">
                  Sua organização atingiu o limite de concorrentes do plano. Remova um concorrente pra poder adicionar outro.
                </p>
              )}

              {error && (
                <p className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-xs text-red-400">{error}</p>
              )}

              {available.length === 0 ? (
                <div className="py-12 text-center">
                  <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-400">
                    <Check size={22} />
                  </span>
                  <p className="text-sm font-medium text-[var(--text-primary)]">Por enquanto é só</p>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">
                    Assim que novas sugestões desse país estiverem disponíveis, elas aparecem aqui.
                  </p>
                </div>
              ) : (
                <>
                  <div className="mt-5 grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
                    {pageItems.map((s, i) => {
                      const adding = addingDomain === s.domain
                      return (
                        <div
                          key={s.domain}
                          className="sx-card-in group relative overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-surface-2)] p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-brand-500/60 hover:shadow-xl hover:shadow-brand-600/10"
                          style={{ animation: 'sx-card-in 320ms ease-out backwards', animationDelay: `${Math.min(i, 11) * 35}ms` }}
                        >
                          <div className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full bg-gradient-to-br from-brand-500/25 to-transparent opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-100" />
                          <div className="relative flex items-center gap-3">
                            <CompetitorLogo domain={s.domain} name={s.name} />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-semibold text-[var(--text-primary)]">{s.name || s.domain}</p>
                              <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-[var(--text-muted)]">
                                <Globe size={11} className="shrink-0" />
                                <span className="truncate">{s.domain}</span>
                              </p>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleAdd(s)}
                            disabled={disabled || addingDomain !== null}
                            className="relative mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-brand-500/40 bg-transparent py-2 text-xs font-semibold text-brand-500 transition-colors group-hover:border-brand-600 group-hover:bg-brand-600 group-hover:text-white disabled:opacity-50"
                          >
                            <Plus size={14} />
                            {adding ? 'Adicionando…' : 'Adicionar'}
                          </button>
                        </div>
                      )
                    })}
                  </div>

                  {pageCount > 1 && (
                    <div className="mt-6 flex items-center justify-center gap-3">
                      <button
                        type="button"
                        onClick={goPrev}
                        aria-label="Voltar"
                        className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--border)] text-[var(--text-muted)] transition-colors hover:border-brand-500/50 hover:text-brand-500"
                      >
                        <ChevronLeft size={18} />
                      </button>
                      <button type="button" onClick={goNext} className="btn-primary inline-flex items-center gap-1.5">
                        Ver mais lojas
                        <ChevronRight size={16} />
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-[var(--border)] bg-[var(--bg-surface-2)]/40 px-7 py-4">
              <p className={`flex items-center gap-1.5 text-xs ${justAdded ? 'font-medium text-emerald-400' : 'text-[var(--text-faint)]'}`}>
                {justAdded ? (
                  <>
                    <Check size={14} /> Loja adicionada com sucesso
                  </>
                ) : (
                  'Passe o mouse no card e clique em Adicionar.'
                )}
              </p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-full border border-[var(--border)] px-5 py-2 text-xs font-medium text-[var(--text-tertiary)] transition-colors hover:bg-[var(--hover-surface)]"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

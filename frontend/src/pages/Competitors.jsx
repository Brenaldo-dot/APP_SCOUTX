import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../api/client.js'
import EmptyState from '../components/EmptyState.jsx'
import { ClassificationBadge, StatusBadge } from '../components/Badges.jsx'
import { formatDateTime } from '../utils/date.js'
import { operationLabel, useOperation } from '../context/OperationContext.jsx'

// Sem campo de logo no backend — puxa o favicon direto do domínio via
// serviço do Google (sem chave, funciona pra qualquer site). Se falhar
// (loja bloqueia hotlink, favicon não existe etc.), cai pra um avatar com a
// inicial do nome, nunca deixa buraco vazio no card.
function CompetitorLogo({ domain, name }) {
  const [failed, setFailed] = useState(false)
  if (failed || !domain) {
    return (
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-500/15 text-sm font-bold text-brand-500">
        {(name || domain || '?').charAt(0).toUpperCase()}
      </span>
    )
  }
  return (
    <img
      src={`https://www.google.com/s2/favicons?sz=64&domain=${domain}`}
      alt=""
      onError={() => setFailed(true)}
      className="h-9 w-9 shrink-0 rounded-xl border border-[var(--border)] bg-white object-contain p-1"
    />
  )
}

export default function Competitors() {
  const { operation } = useOperation()
  const [searchParams, setSearchParams] = useSearchParams()
  // Só admin consegue popular isso de verdade (link vem da tela de
  // Usuários) — o backend também confere (resolve_target_user em
  // api/deps.py), isto aqui só decide o que MOSTRAR: modo auditoria é
  // somente leitura, não faz sentido admin cadastrar/excluir em nome de
  // outra pessoa.
  const asUserId = searchParams.get('as_user_id')
  const [competitors, setCompetitors] = useState(null)
  const [error, setError] = useState(null)
  const [form, setForm] = useState({ domain: '', name: '', niche: '' })
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState(null)
  const [deletingId, setDeletingId] = useState(null)
  const [rescoringId, setRescoringId] = useState(null)
  const [rescoreMessage, setRescoreMessage] = useState(null)
  const pollRef = useRef(null)

  function load() {
    api
      .listCompetitors({ operation, as_user_id: asUserId || undefined })
      .then((list) => {
        setCompetitors(list)
        // Enquanto tiver concorrente "checking" (verificação + raio-x
        // rodando em background — ver tasks/onboarding.py), continua
        // atualizando a lista sozinho até virar "active"/"not_shopify",
        // sem precisar a pessoa dar F5 pra ver o resultado.
        clearTimeout(pollRef.current)
        if (list.some((c) => c.status === 'checking')) {
          pollRef.current = setTimeout(load, 6000)
        }
      })
      .catch((e) => setError(e.message))
  }

  useEffect(() => {
    load()
    return () => clearTimeout(pollRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [operation, asUserId])

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.domain.trim()) return
    setSubmitting(true)
    setFormError(null)
    try {
      await api.createCompetitor({
        domain: form.domain.trim(),
        name: form.name.trim() || null,
        niche: form.niche.trim() || null,
        tags: [],
        operation,
      })
      setForm({ domain: '', name: '', niche: '' })
      load()
    } catch (err) {
      setFormError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  async function handleRescore(c) {
    setRescoringId(c.id)
    setRescoreMessage(null)
    try {
      await api.rescoreCompetitor(c.id)
      setRescoreMessage(`Recalculando score de "${c.name}" — atualiza em alguns segundos.`)
      setTimeout(load, 8000)
    } catch (err) {
      setRescoreMessage(`Não deu pra recalcular: ${err.message}`)
    } finally {
      setRescoringId(null)
    }
  }

  async function handleDelete(c) {
    if (!window.confirm(`Excluir "${c.name}" (${c.domain})? Isso apaga todo o histórico de produtos, anúncios e alertas dessa loja — não dá pra desfazer.`)) {
      return
    }
    setDeletingId(c.id)
    try {
      await api.deleteCompetitor(c.id)
      load()
    } catch (err) {
      setError(err.message)
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h2 className="text-xl font-semibold">Concorrentes</h2>
        <p className="text-sm text-[var(--text-muted)]">
          Lojas Shopify monitoradas diariamente — operação {operationLabel(operation)}
        </p>
      </div>

      {asUserId && (
        <div className="flex items-center justify-between rounded-2xl border border-amber-500/30 bg-amber-500/5 px-4 py-3">
          <p className="text-sm text-amber-400">
            👁️ Vendo a lista do usuário #{asUserId} (modo auditoria, só leitura).
          </p>
          <button
            onClick={() => setSearchParams({})}
            className="text-xs font-medium text-amber-400 hover:underline"
          >
            Voltar pra minha lista
          </button>
        </div>
      )}

      {!asUserId && (
        <form
          onSubmit={handleSubmit}
          className="flex flex-wrap items-end gap-3 rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-4"
        >
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-[var(--text-muted)]">Domínio *</label>
            <input
              required
              placeholder="lojaexemplo.com"
              value={form.domain}
              onChange={(e) => setForm({ ...form, domain: e.target.value })}
              className="w-56 rounded-lg border border-[var(--border)] bg-[var(--bg-surface-2)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-brand-500 focus:outline-none"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-[var(--text-muted)]">Nome</label>
            <input
              placeholder="Opcional"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-48 rounded-lg border border-[var(--border)] bg-[var(--bg-surface-2)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-brand-500 focus:outline-none"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-[var(--text-muted)]">Nicho</label>
            <input
              placeholder="Opcional"
              value={form.niche}
              onChange={(e) => setForm({ ...form, niche: e.target.value })}
              className="w-40 rounded-lg border border-[var(--border)] bg-[var(--bg-surface-2)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-brand-500 focus:outline-none"
            />
          </div>
          <button type="submit" disabled={submitting} className="btn-primary">
            {submitting ? 'Adicionando…' : '+ Adicionar concorrente'}
          </button>
          {formError && <p className="w-full text-sm text-red-600">{formError}</p>}
        </form>
      )}

      {rescoreMessage && <p className="text-xs text-[var(--text-muted)]">{rescoreMessage}</p>}

      {error && <EmptyState title="Não deu pra carregar os concorrentes" subtitle={error} />}

      {competitors && competitors.length === 0 && (
        <EmptyState
          title="Nenhum concorrente cadastrado"
          subtitle="Adicione um domínio Shopify acima pra começar o monitoramento."
        />
      )}

      {competitors && competitors.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {competitors.map((c) => (
            <div
              key={c.id}
              className="group relative flex flex-col gap-2.5 overflow-hidden rounded-2xl border-2 border-[var(--border)] bg-[var(--bg-surface)] p-3.5 transition-colors hover:border-brand-500/50"
            >
              <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-gradient-to-br from-brand-500/20 to-transparent blur-2xl transition-opacity group-hover:opacity-90" />

              <div className="relative flex items-center gap-2.5">
                <CompetitorLogo domain={c.domain} name={c.name} />
                <div className="min-w-0 flex-1">
                  <Link to={`/concorrentes/${c.id}`} className="block truncate text-sm font-semibold text-[var(--text-primary)] hover:text-brand-500">
                    {c.name}
                  </Link>
                  <p className="truncate text-xs text-[var(--text-muted)]">{c.domain}</p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <StatusBadge status={c.status} />
                <ClassificationBadge classification={c.classification} />
              </div>

              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 rounded-xl bg-[var(--bg-surface-2)] p-2.5 text-xs">
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-[var(--text-faint)]">Produtos</p>
                  <p className="font-semibold text-[var(--text-primary)]">{c.total_products}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-[var(--text-faint)]">🔥 Quentes</p>
                  <p className={`font-semibold ${c.hot_products > 0 ? 'text-orange-400' : 'text-[var(--text-primary)]'}`}>
                    {c.hot_products}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-[var(--text-faint)]">Volume/dia</p>
                  <p className="font-semibold text-[var(--text-primary)]">
                    {c.avg_daily_volume != null ? c.avg_daily_volume : <span className="text-[11px] font-normal text-[var(--text-muted)]">—</span>}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-[var(--text-faint)]">Verificado</p>
                  <p className="text-[11px] text-[var(--text-secondary)]">{formatDateTime(c.last_checked_at)}</p>
                </div>
              </div>

              {!asUserId && (
                <div className="mt-auto flex items-center justify-end gap-2.5 pt-0.5">
                  {c.status !== 'checking' && (
                    <button
                      onClick={() => handleRescore(c)}
                      disabled={rescoringId === c.id || c.status !== 'active'}
                      title="Recalcula o score de todos os produtos agora, sem esperar o snapshot diário (6h)"
                      className="text-[11px] font-medium text-[var(--text-muted)] hover:text-brand-500 disabled:opacity-50"
                    >
                      {rescoringId === c.id ? 'Recalculando…' : '📊 Recalcular'}
                    </button>
                  )}
                  <button
                    onClick={() => handleDelete(c)}
                    disabled={deletingId === c.id}
                    title="Excluir concorrente (apaga produtos, anúncios e alertas dele)"
                    className="text-[11px] font-medium text-[var(--text-muted)] hover:text-red-400 disabled:opacity-50"
                  >
                    {deletingId === c.id ? 'Excluindo…' : '🗑️ Excluir'}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

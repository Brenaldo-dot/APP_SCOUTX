import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../api/client.js'
import EmptyState from '../components/EmptyState.jsx'
import { ClassificationBadge, StatusBadge } from '../components/Badges.jsx'
import { formatDateTime } from '../utils/date.js'
import { operationLabel, useOperation } from '../context/OperationContext.jsx'

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
        <p className="text-sm text-gray-500">
          Lojas Shopify monitoradas diariamente — operação {operationLabel(operation)}
        </p>
      </div>

      {asUserId && (
        <div className="flex items-center justify-between rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3">
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
          className="flex flex-wrap items-end gap-3 rounded-xl border border-[#2d3148] bg-[#1c1f2e] p-4"
        >
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">Domínio *</label>
            <input
              required
              placeholder="lojaexemplo.com"
              value={form.domain}
              onChange={(e) => setForm({ ...form, domain: e.target.value })}
              className="w-56 rounded-lg border border-[#2d3148] bg-[#161824] px-3 py-2 text-sm text-gray-100 placeholder:text-gray-600 focus:border-brand-500 focus:outline-none"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">Nome</label>
            <input
              placeholder="Opcional"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-48 rounded-lg border border-[#2d3148] bg-[#161824] px-3 py-2 text-sm text-gray-100 placeholder:text-gray-600 focus:border-brand-500 focus:outline-none"
            />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-gray-500">Nicho</label>
            <input
              placeholder="Opcional"
              value={form.niche}
              onChange={(e) => setForm({ ...form, niche: e.target.value })}
              className="w-40 rounded-lg border border-[#2d3148] bg-[#161824] px-3 py-2 text-sm text-gray-100 placeholder:text-gray-600 focus:border-brand-500 focus:outline-none"
            />
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {submitting ? 'Adicionando…' : '+ Adicionar concorrente'}
          </button>
          {formError && <p className="w-full text-sm text-red-600">{formError}</p>}
        </form>
      )}

      {rescoreMessage && <p className="text-xs text-gray-500">{rescoreMessage}</p>}

      {error && <EmptyState title="Não deu pra carregar os concorrentes" subtitle={error} />}

      {competitors && competitors.length === 0 && (
        <EmptyState
          title="Nenhum concorrente cadastrado"
          subtitle="Adicione um domínio Shopify acima pra começar o monitoramento."
        />
      )}

      {competitors && competitors.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-[#2d3148] bg-[#1c1f2e]">
          <table className="w-full text-left text-sm">
            <thead className="bg-[#161824] text-xs uppercase text-gray-500">
              <tr>
                <th className="px-4 py-3">Loja</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Classificação</th>
                <th className="px-4 py-3">Produtos</th>
                <th className="px-4 py-3">Volume médio/dia</th>
                <th className="px-4 py-3">Última verificação</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#2d3148]">
              {competitors.map((c) => (
                <tr key={c.id} className="hover:bg-[#161824]">
                  <td className="px-4 py-3">
                    <Link to={`/concorrentes/${c.id}`} className="font-medium text-brand-500 hover:underline">
                      {c.name}
                    </Link>
                    <p className="text-xs text-gray-500">{c.domain}</p>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={c.status} />
                  </td>
                  <td className="px-4 py-3">
                    <ClassificationBadge classification={c.classification} />
                  </td>
                  <td className="px-4 py-3">{c.total_products}</td>
                  <td className="px-4 py-3">
                    {c.avg_daily_volume != null ? (
                      c.avg_daily_volume
                    ) : (
                      <span className="text-xs text-gray-500">aguardando dado</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {formatDateTime(c.last_checked_at)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {!asUserId && (
                      <div className="flex items-center justify-end gap-3">
                        {c.status !== 'checking' && (
                          <button
                            onClick={() => handleRescore(c)}
                            disabled={rescoringId === c.id || c.status !== 'active'}
                            title="Recalcula o score de todos os produtos agora, sem esperar o snapshot diário (6h)"
                            className="text-xs font-medium text-gray-500 hover:text-brand-500 disabled:opacity-50"
                          >
                            {rescoringId === c.id ? 'Recalculando…' : '📊 Recalcular score'}
                          </button>
                        )}
                        <button
                          onClick={() => handleDelete(c)}
                          disabled={deletingId === c.id}
                          title="Excluir concorrente (apaga produtos, anúncios e alertas dele)"
                          className="text-xs font-medium text-gray-500 hover:text-red-400 disabled:opacity-50"
                        >
                          {deletingId === c.id ? 'Excluindo…' : '🗑️ Excluir'}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

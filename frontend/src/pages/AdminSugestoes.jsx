import { useEffect, useMemo, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { rawApi } from '../api/rawClient.js'
import EmptyState from '../components/EmptyState.jsx'
import RefreshButton from '../components/RefreshButton.jsx'
import Select from '../components/Select.jsx'
import CompetitorLogo from '../components/CompetitorLogo.jsx'
import { operationLabel, useOperation } from '../context/OperationContext.jsx'

export default function AdminSugestoes() {
  const { orderedOperations } = useOperation()
  const [all, setAll] = useState(null)
  const [error, setError] = useState(null)
  const [country, setCountry] = useState('mexico')
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState(null)

  function load() {
    return rawApi
      .listAdminSuggestedCompetitors()
      .then(setAll)
      .catch((e) => setError(e.message))
  }

  useEffect(() => {
    load()
  }, [])

  const countryOptions = orderedOperations.map((op) => ({ value: op.value, label: `${op.flag} ${op.label}` }))
  const countByCountry = useMemo(() => {
    const counts = {}
    for (const row of all || []) counts[row.operation] = (counts[row.operation] || 0) + 1
    return counts
  }, [all])
  const current = useMemo(() => (all || []).filter((row) => row.operation === country), [all, country])

  async function handleAdd(e) {
    e.preventDefault()
    if (!text.trim()) return
    setSaving(true)
    setError(null)
    setResult(null)
    try {
      const data = await rawApi.addSuggestedCompetitors(country, text)
      setResult(data)
      setText('')
      await load()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id) {
    await rawApi.deleteSuggestedCompetitor(id)
    load()
  }

  async function handleClear() {
    if (!window.confirm(`Apagar as ${current.length} sugestões de ${operationLabel(country)}?`)) return
    await rawApi.clearSuggestedCompetitors(country)
    setResult(null)
    load()
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Sugestões de concorrentes</h2>
          <p className="text-sm text-[var(--text-muted)]">
            Lojas do painel "Sugestões de lojas" da aba Concorrentes de cada país. Aparecem 15 por página, em ordem
            aleatória que muda a cada vez que o cliente abre, e a loja some da lista dele assim que ele adiciona.
          </p>
        </div>
        <RefreshButton onRefresh={load} />
      </div>

      {error && <EmptyState title="Não deu pra salvar" subtitle={error} />}

      <form onSubmit={handleAdd} className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-5">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-[var(--text-muted)]">País</label>
          <Select className="w-64" value={country} onChange={setCountry} options={countryOptions} />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-[var(--text-muted)]">Lojas (uma por linha)</label>
          <textarea
            rows={8}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={'lojaexemplo.com\nhttps://www.outraloja.com.mx/produtos/x\nNome da Loja | terceiraloja.com'}
            className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface-2)] px-3 py-2 font-mono text-xs text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-brand-500 focus:outline-none"
          />
          <p className="text-xs text-[var(--text-faint)]">
            Aceita só o domínio, o link completo, ou "Nome | domínio". Domínios repetidos são ignorados.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={saving || !text.trim()}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {saving ? 'Salvando…' : `Adicionar em ${operationLabel(country)}`}
          </button>
          {result && (
            <p className="text-sm text-emerald-400">
              {result.added} adicionada(s), {result.skipped} já existia(m).
              {result.invalid?.length > 0 && (
                <span className="text-amber-400"> Linhas ignoradas por não parecerem um domínio: {result.invalid.join(', ')}</span>
              )}
            </p>
          )}
        </div>
      </form>

      <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">
            {operationLabel(country)}: {current.length} sugestão(ões)
          </h3>
          {current.length > 0 && (
            <button onClick={handleClear} className="text-xs font-medium text-[var(--text-muted)] hover:text-red-400">
              Apagar toda a lista de {operationLabel(country)}
            </button>
          )}
        </div>

        <div className="mt-2 flex flex-wrap gap-2 text-xs text-[var(--text-muted)]">
          {orderedOperations
            .filter((op) => countByCountry[op.value])
            .map((op) => (
              <span key={op.value} className="rounded-full bg-[var(--bg-surface-2)] px-2.5 py-1">
                {op.flag} {op.label}: {countByCountry[op.value]}
              </span>
            ))}
        </div>

        {current.length === 0 ? (
          <p className="mt-4 text-sm text-[var(--text-muted)]">Nenhuma sugestão cadastrada pra esse país ainda.</p>
        ) : (
          <ul className="mt-4 divide-y divide-[var(--border)]">
            {current.map((row) => (
              <li key={row.id} className="flex items-center gap-3 py-2">
                <CompetitorLogo domain={row.domain} name={row.name} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-[var(--text-primary)]">{row.name || row.domain}</p>
                  {row.name && <p className="truncate text-xs text-[var(--text-muted)]">{row.domain}</p>}
                </div>
                <button
                  onClick={() => handleDelete(row.id)}
                  title="Remover sugestão"
                  className="rounded p-1.5 text-[var(--text-faint)] hover:text-red-400"
                >
                  <Trash2 size={15} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

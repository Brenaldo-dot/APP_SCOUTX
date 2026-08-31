import { useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { rawApi } from '../api/rawClient.js'
import EmptyState from '../components/EmptyState.jsx'
import RefreshButton from '../components/RefreshButton.jsx'
import { formatDateTime } from '../utils/date.js'

const inputClass =
  'rounded-lg border border-[var(--border)] bg-[var(--bg-surface-2)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-brand-500 focus:outline-none'

const emptyForm = { name: '', caktoEmail: '', pixKey: '', firstSalePercentage: '40', recurringPercentage: '25' }

function money(value) {
  return Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export default function Afiliados() {
  const [affiliates, setAffiliates] = useState(null)
  const [commissions, setCommissions] = useState(null)
  const [error, setError] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [creating, setCreating] = useState(false)
  const [formMsg, setFormMsg] = useState(null)
  const [onlyUnpaid, setOnlyUnpaid] = useState(true)

  function load() {
    return Promise.all([
      rawApi.listAffiliates().then(setAffiliates).catch((e) => setError(e.message)),
      rawApi.listAffiliateCommissions().then(setCommissions).catch((e) => setError(e.message)),
    ])
  }

  useEffect(() => {
    load()
  }, [])

  async function handleCreate(e) {
    e.preventDefault()
    setCreating(true)
    setFormMsg(null)
    try {
      await rawApi.createAffiliate(form)
      setForm(emptyForm)
      load()
    } catch (err) {
      setFormMsg({ type: 'error', text: err.message || 'Erro' })
    } finally {
      setCreating(false)
    }
  }

  async function handleDelete(id) {
    await rawApi.deleteAffiliate(id)
    load()
  }

  async function togglePaid(commission) {
    await rawApi.markAffiliateCommissionPaid(commission.id, !commission.paid)
    load()
  }

  const visibleCommissions = (commissions || []).filter((c) => !onlyUnpaid || !c.paid)
  const totalOwed = (commissions || [])
    .filter((c) => !c.paid)
    .reduce((sum, c) => sum + Number(c.commission_value), 0)

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Afiliados</h2>
          <p className="text-sm text-[var(--text-muted)]">
            Comissão de primeira venda e recorrência calculada pelas nossas próprias taxas — a Cakto só rastreia o
            clique/link, quem calcula o valor a pagar é o ScoutX.
          </p>
        </div>
        <RefreshButton onRefresh={load} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-5">
          <h3 className="mb-3.5 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            Cadastrar afiliado
          </h3>
          <form onSubmit={handleCreate} className="flex flex-col gap-3">
            <input
              required
              placeholder="Nome (ex: Eveline)"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className={inputClass}
            />
            <input
              required
              type="email"
              placeholder="Email dela na Cakto (conta de afiliada)"
              value={form.caktoEmail}
              onChange={(e) => setForm({ ...form, caktoEmail: e.target.value })}
              className={inputClass}
            />
            <input
              placeholder="Chave PIX (opcional, só pra referência na hora de pagar)"
              value={form.pixKey}
              onChange={(e) => setForm({ ...form, pixKey: e.target.value })}
              className={inputClass}
            />
            <div className="flex gap-3">
              <div className="flex flex-1 flex-col gap-1">
                <label className="text-xs font-medium text-[var(--text-muted)]">% primeira venda</label>
                <input
                  required
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={form.firstSalePercentage}
                  onChange={(e) => setForm({ ...form, firstSalePercentage: e.target.value })}
                  className={inputClass}
                />
              </div>
              <div className="flex flex-1 flex-col gap-1">
                <label className="text-xs font-medium text-[var(--text-muted)]">% recorrência</label>
                <input
                  required
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={form.recurringPercentage}
                  onChange={(e) => setForm({ ...form, recurringPercentage: e.target.value })}
                  className={inputClass}
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={creating}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {creating ? 'Cadastrando…' : 'Cadastrar afiliado'}
            </button>
            {formMsg && <p className="text-sm text-red-400">{formMsg.text}</p>}
          </form>
        </div>

        <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-5">
          <h3 className="mb-3.5 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            Afiliados cadastrados
          </h3>
          {affiliates?.length === 0 && <p className="text-sm text-[var(--text-muted)]">Nenhum afiliado ainda.</p>}
          <ul className="space-y-2">
            {affiliates?.map((a) => (
              <li
                key={a.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg-surface-2)] px-3 py-2.5 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-[var(--text-primary)]">{a.name}</p>
                  <p className="truncate text-xs text-[var(--text-muted)]">{a.cakto_email}</p>
                  <p className="text-xs text-[var(--text-faint)]">
                    {Number(a.first_sale_percentage)}% primeira venda · {Number(a.recurring_percentage)}% recorrência
                  </p>
                </div>
                <button
                  onClick={() => handleDelete(a.id)}
                  title="Remover afiliado"
                  className="shrink-0 rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[var(--hover-surface)] hover:text-red-400"
                >
                  <Trash2 size={15} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-5">
        <div className="mb-3.5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Comissões</h3>
            {totalOwed > 0 && (
              <p className="mt-1 text-sm text-[var(--text-secondary)]">
                Total a pagar: <span className="font-semibold text-amber-400">{money(totalOwed)}</span>
              </p>
            )}
          </div>
          <label className="flex items-center gap-2 text-xs text-[var(--text-tertiary)]">
            <input type="checkbox" checked={onlyUnpaid} onChange={(e) => setOnlyUnpaid(e.target.checked)} />
            Só mostrar não pagas
          </label>
        </div>
        {error && <EmptyState title="Não deu pra carregar" subtitle={error} />}
        {visibleCommissions.length === 0 ? (
          <EmptyState
            title="Nenhuma comissão ainda"
            subtitle="Assim que uma venda de um afiliado cadastrado chegar pelo webhook da Cakto, aparece aqui."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-[var(--bg-surface-2)] text-xs uppercase text-[var(--text-muted)]">
                <tr>
                  <th className="px-3 py-2">Afiliado</th>
                  <th className="px-3 py-2">Cliente</th>
                  <th className="px-3 py-2">Tipo</th>
                  <th className="px-3 py-2 text-right">Venda</th>
                  <th className="px-3 py-2 text-right">Comissão</th>
                  <th className="px-3 py-2">Data</th>
                  <th className="px-3 py-2">Pago</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {visibleCommissions.map((c) => (
                  <tr key={c.id} className="hover:bg-[var(--bg-surface-2)]">
                    <td className="px-3 py-2.5 font-medium text-[var(--text-primary)]">{c.affiliate_name}</td>
                    <td className="px-3 py-2.5 text-[var(--text-tertiary)]">{c.customer_name || c.customer_email}</td>
                    <td className="px-3 py-2.5 text-[var(--text-tertiary)]">
                      {c.commission_type === 'first_sale' ? 'Primeira venda' : 'Recorrência'}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-[var(--text-tertiary)]">
                      {money(c.sale_amount)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums font-medium text-[var(--text-primary)]">
                      {money(c.commission_value)}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-[var(--text-muted)]">{formatDateTime(c.created_at)}</td>
                    <td className="px-3 py-2.5">
                      <button
                        onClick={() => togglePaid(c)}
                        className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                          c.paid
                            ? 'bg-emerald-500/15 text-emerald-400'
                            : 'bg-amber-500/15 text-amber-400 hover:bg-amber-500/25'
                        }`}
                      >
                        {c.paid ? 'Pago ✓' : 'Marcar como pago'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

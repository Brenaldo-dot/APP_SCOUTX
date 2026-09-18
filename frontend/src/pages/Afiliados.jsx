import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, Image as ImageIcon, Trash2, Users } from 'lucide-react'
import { rawApi } from '../api/rawClient.js'
import EmptyState from '../components/EmptyState.jsx'
import RefreshButton from '../components/RefreshButton.jsx'
import { formatDateTime } from '../utils/date.js'
import { resizeImageToDataUrl } from '../utils/avatar.js'

const inputClass =
  'rounded-lg border border-[var(--border)] bg-[var(--bg-surface-2)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-brand-500 focus:outline-none'

const emptyForm = { name: '', caktoEmail: '', pixKey: '', firstSalePercentage: '40', recurringPercentage: '25' }

function money(value) {
  return Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

// Agrupa as comissões (lista plana da API) por afiliado, e já soma tudo que
// a tela precisa mostrar de cara: quantos clientes distintos, quanto falta
// pagar, quanto já foi pago. Feito no front porque a lista inteira já vem
// numa chamada só (base pequena, não compensa 1 endpoint por afiliado).
function summarize(affiliates, commissions, communities, trialReferrals) {
  return (affiliates || []).map((a) => {
    const own = (commissions || []).filter((c) => c.affiliate_id === a.id)
    const clientCount = new Set(own.map((c) => c.customer_email)).size
    const pending = own.filter((c) => !c.paid).reduce((sum, c) => sum + Number(c.commission_value), 0)
    const paid = own.filter((c) => c.paid).reduce((sum, c) => sum + Number(c.commission_value), 0)
    const community = (communities || []).find((c) => c.affiliate_id === a.id) || null
    const trials = (trialReferrals || []).filter((t) => t.affiliate_id === a.id)
    const projectedTrialTotal = trials.reduce((sum, t) => sum + Number(t.projected_commission_value), 0)
    return { ...a, commissions: own, clientCount, pending, paid, community, trials, projectedTrialTotal }
  })
}

// Formulário de criar comunidade embutido na própria linha do afiliado
// (pedido do usuário: antes só dava pra criar comunidade numa tela admin
// separada, /admin/comunidades — juntar aqui evita ter que trocar de tela
// no meio do cadastro de um afiliado novo).
function CreateCommunityInline({ affiliateId, onCreated }) {
  const [name, setName] = useState('')
  const [photoUrl, setPhotoUrl] = useState(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState(null)

  async function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      setPhotoUrl(await resizeImageToDataUrl(file, 400, 0.85))
    } catch (err) {
      setError(err.message)
    }
  }

  async function submit(e) {
    e.preventDefault()
    if (!name.trim()) return
    setCreating(true)
    setError(null)
    try {
      await rawApi.createCommunityForAffiliate(affiliateId, name.trim(), photoUrl)
      setName('')
      setPhotoUrl(null)
      onCreated()
    } catch (err) {
      setError(err.message)
    } finally {
      setCreating(false)
    }
  }

  return (
    <form onSubmit={submit} className="mt-3 rounded-xl border border-dashed border-[var(--border)] bg-[var(--bg-surface-2)] p-3">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-[var(--text-muted)]">
        <Users size={13} /> Esse afiliado ainda não tem comunidade
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-lg border border-dashed border-[var(--border)] bg-[var(--bg-surface)] text-[var(--text-faint)] hover:border-brand-500" title="Foto (opcional)">
          {photoUrl ? <img src={photoUrl} alt="" className="h-full w-full object-cover" /> : <ImageIcon size={14} />}
          <input type="file" accept="image/*" onChange={handleFile} className="hidden" />
        </label>
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nome da comunidade"
          className="min-w-[180px] flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-brand-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={creating || !name.trim()}
          className="rounded-lg bg-brand-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {creating ? 'Criando…' : 'Criar comunidade'}
        </button>
      </div>
      {error && <p className="mt-1.5 text-xs text-red-400">{error}</p>}
    </form>
  )
}

export default function Afiliados() {
  const [affiliates, setAffiliates] = useState(null)
  const [commissions, setCommissions] = useState(null)
  const [communities, setCommunities] = useState(null)
  const [trialReferrals, setTrialReferrals] = useState(null)
  const [error, setError] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [creating, setCreating] = useState(false)
  const [formMsg, setFormMsg] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [expandedId, setExpandedId] = useState(null)
  const [backfill, setBackfill] = useState({ id: null, loading: false, text: null })
  const [copiedRef, setCopiedRef] = useState(null)

  function load() {
    return Promise.all([
      rawApi.listAffiliates().then(setAffiliates).catch((e) => setError(e.message)),
      rawApi.listAffiliateCommissions().then(setCommissions).catch((e) => setError(e.message)),
      rawApi.listAdminCommunities().then(setCommunities).catch((e) => setError(e.message)),
      rawApi.listAffiliateTrialReferrals().then(setTrialReferrals).catch((e) => setError(e.message)),
    ])
  }

  useEffect(() => {
    load()
  }, [])

  const summaries = useMemo(
    () => summarize(affiliates, commissions, communities, trialReferrals),
    [affiliates, commissions, communities, trialReferrals]
  )

  async function handleCreate(e) {
    e.preventDefault()
    setCreating(true)
    setFormMsg(null)
    try {
      const created = await rawApi.createAffiliate(form)
      setForm(emptyForm)
      setShowForm(false)
      await load()
      // Abre a linha do afiliado recém-criado já mostrando o formulário de
      // criar comunidade — o pedido era exatamente não ter que sair dessa
      // tela pra fazer isso.
      if (created?.id) setExpandedId(created.id)
    } catch (err) {
      setFormMsg({ type: 'error', text: err.message || 'Erro' })
    } finally {
      setCreating(false)
    }
  }

  async function handleDelete(id) {
    await rawApi.deleteAffiliate(id)
    if (expandedId === id) setExpandedId(null)
    load()
  }

  async function togglePaid(commission) {
    await rawApi.markAffiliateCommissionPaid(commission.id, !commission.paid)
    load()
  }

  async function handleBackfill(id) {
    setBackfill({ id, loading: true, text: null })
    try {
      const { checked, created, corrected } = await rawApi.backfillAffiliate(id)
      const parts = []
      if (created > 0) parts.push(`${created} venda(s) antiga(s) adicionada(s)`)
      if (corrected > 0) parts.push(`${corrected} comissão(ões) corrigida(s) pro valor real`)
      setBackfill({
        id,
        loading: false,
        text: parts.length
          ? `${parts.join(' e ')} (${checked} pedidos conferidos).`
          : `Nada novo pra atualizar (${checked} pedidos conferidos).`,
      })
      load()
    } catch (err) {
      setBackfill({ id, loading: false, text: err.message || 'Erro' })
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Afiliados</h2>
          <p className="text-sm text-[var(--text-muted)]">
            A Cakto só identifica quem clicou no link; o cálculo da comissão usa a taxa configurada aqui embaixo, pra
            cada afiliado. Uma venda entra como "a receber" assim que o pagamento é confirmado, e some sozinha da
            lista se o cliente cancelar ou pedir reembolso depois.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <RefreshButton onRefresh={load} />
          <button
            onClick={() => setShowForm((v) => !v)}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            {showForm ? 'Cancelar' : '+ Novo afiliado'}
          </button>
        </div>
      </div>

      {showForm && (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-5">
          <h3 className="mb-3.5 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
            Cadastrar afiliado
          </h3>
          <form onSubmit={handleCreate} className="flex flex-wrap items-end gap-3">
            <div className="flex flex-1 flex-col gap-1">
              <label className="text-xs font-medium text-[var(--text-muted)]">Nome</label>
              <input
                required
                placeholder="Ex: Eveline"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className={inputClass}
              />
            </div>
            <div className="flex flex-1 flex-col gap-1">
              <label className="text-xs font-medium text-[var(--text-muted)]">Email dela na Cakto</label>
              <input
                required
                type="email"
                placeholder="conta de afiliada"
                value={form.caktoEmail}
                onChange={(e) => setForm({ ...form, caktoEmail: e.target.value })}
                className={inputClass}
              />
            </div>
            <div className="flex flex-1 flex-col gap-1">
              <label className="text-xs font-medium text-[var(--text-muted)]">Chave PIX (opcional)</label>
              <input
                value={form.pixKey}
                onChange={(e) => setForm({ ...form, pixKey: e.target.value })}
                className={inputClass}
              />
            </div>
            <div className="flex w-28 flex-col gap-1">
              <label className="text-xs font-medium text-[var(--text-muted)]">% 1ª venda</label>
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
            <div className="flex w-28 flex-col gap-1">
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
            <button
              type="submit"
              disabled={creating}
              className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {creating ? 'Salvando…' : 'Cadastrar'}
            </button>
          </form>
          {formMsg && <p className="mt-2 text-sm text-red-400">{formMsg.text}</p>}
        </div>
      )}

      {error && <EmptyState title="Não deu pra carregar" subtitle={error} />}

      {summaries.length === 0 && !error && (
        <EmptyState title="Nenhum afiliado cadastrado ainda" subtitle="Clique em '+ Novo afiliado' pra começar." />
      )}

      <div className="space-y-3">
        {summaries.map((a) => {
          const expanded = expandedId === a.id
          return (
            <div key={a.id} className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)]">
              <button
                onClick={() => setExpandedId(expanded ? null : a.id)}
                className="flex w-full flex-wrap items-center justify-between gap-4 px-5 py-4 text-left hover:bg-[var(--hover-surface)]"
              >
                <div className="flex items-center gap-3">
                  {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  <div>
                    <p className="flex flex-wrap items-center gap-2 font-semibold text-[var(--text-primary)]">
                      {a.name}
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                          a.community ? 'bg-emerald-500/15 text-emerald-500' : 'bg-[var(--bg-surface-2)] text-[var(--text-faint)]'
                        }`}
                      >
                        {a.community ? `Comunidade: ${a.community.community_name}` : 'Sem comunidade'}
                      </span>
                    </p>
                    <p className="text-xs text-[var(--text-muted)]">{a.cakto_email}</p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-6">
                  <div className="text-center">
                    <p className="text-xs uppercase text-[var(--text-muted)]">Clientes</p>
                    <p className="font-semibold text-[var(--text-primary)]">{a.clientCount}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs uppercase text-[var(--text-muted)]">A receber</p>
                    <p className="font-semibold text-amber-400">{money(a.pending)}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs uppercase text-[var(--text-muted)]">Já recebido</p>
                    <p className="font-semibold text-emerald-400">{money(a.paid)}</p>
                  </div>
                  <span
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDelete(a.id)
                    }}
                    title="Remover afiliado"
                    className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[var(--hover-surface)] hover:text-red-400"
                  >
                    <Trash2 size={15} />
                  </span>
                </div>
              </button>

              {expanded && (
                <div className="border-t border-[var(--border)] px-5 py-4">
                  <p className="mb-3 text-xs text-[var(--text-muted)]">
                    {Number(a.first_sale_percentage)}% na primeira venda · {Number(a.recurring_percentage)}% nas
                    renovações{a.pix_key ? ` · PIX: ${a.pix_key}` : ''}
                  </p>
                  {a.ref_code && (
                    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-surface-2)] px-3 py-2">
                      <span className="text-xs text-[var(--text-muted)]">Link de teste grátis desse afiliado:</span>
                      <code className="text-xs text-[var(--text-primary)]">{`${window.location.origin}/free-trial?ref=${a.ref_code}`}</code>
                      <button
                        onClick={() => {
                          navigator.clipboard?.writeText(`${window.location.origin}/free-trial?ref=${a.ref_code}`)
                          setCopiedRef(a.id)
                          setTimeout(() => setCopiedRef(null), 2000)
                        }}
                        className="rounded-md border border-[var(--border)] px-2 py-1 text-xs text-[var(--text-secondary)] hover:bg-[var(--hover-surface)]"
                      >
                        {copiedRef === a.id ? 'Copiado!' : 'Copiar link'}
                      </button>
                    </div>
                  )}
                  <div className="mb-3 flex flex-wrap items-center gap-3">
                    <button
                      onClick={() => handleBackfill(a.id)}
                      disabled={backfill.loading && backfill.id === a.id}
                      className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-secondary)] hover:bg-[var(--hover-surface)] disabled:opacity-60"
                    >
                      {backfill.loading && backfill.id === a.id ? 'Buscando…' : 'Buscar vendas antigas'}
                    </button>
                    {backfill.id === a.id && backfill.text && (
                      <span className="text-xs text-[var(--text-muted)]">{backfill.text}</span>
                    )}
                  </div>

                  {a.community ? (
                    <p className="mb-3 flex items-center gap-1.5 text-xs text-emerald-500">
                      <Users size={13} /> Comunidade "{a.community.community_name}" já criada — o próprio embaixador gerencia o resto (banner, canais, posts) logado na conta dele.
                    </p>
                  ) : (
                    <CreateCommunityInline affiliateId={a.id} onCreated={load} />
                  )}
                  {a.commissions.length === 0 ? (
                    <p className="text-sm text-[var(--text-muted)]">Nenhuma venda dela ainda.</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <thead className="bg-[var(--bg-surface-2)] text-xs uppercase text-[var(--text-muted)]">
                          <tr>
                            <th className="px-3 py-2">Cliente</th>
                            <th className="px-3 py-2">Tipo</th>
                            <th className="px-3 py-2 text-right">Venda</th>
                            <th className="px-3 py-2 text-right">Comissão</th>
                            <th className="px-3 py-2">Data</th>
                            <th className="px-3 py-2">Pago</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--border)]">
                          {a.commissions.map((c) => (
                            <tr key={c.id} className="hover:bg-[var(--bg-surface-2)]">
                              <td className="px-3 py-2.5 text-[var(--text-primary)]">
                                {c.customer_name || c.customer_email}
                              </td>
                              <td className="px-3 py-2.5 text-[var(--text-tertiary)]">
                                {c.commission_type === 'first_sale' ? 'Primeira venda' : 'Recorrência'}
                              </td>
                              <td className="px-3 py-2.5 text-right tabular-nums text-[var(--text-tertiary)]">
                                {money(c.sale_amount)}
                              </td>
                              <td className="px-3 py-2.5 text-right tabular-nums font-medium text-[var(--text-primary)]">
                                {money(c.commission_value)}
                              </td>
                              <td className="px-3 py-2.5 text-xs text-[var(--text-muted)]">
                                {formatDateTime(c.created_at)}
                              </td>
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

                  {a.trials.length > 0 && (
                    <div className="mt-4 rounded-xl border border-dashed border-amber-500/30 bg-amber-500/5 p-3">
                      <p className="mb-2 flex items-center justify-between text-xs font-semibold text-amber-500">
                        <span>Em período de teste (ainda não cobrado)</span>
                        <span>Previsto: {money(a.projectedTrialTotal)}</span>
                      </p>
                      <div className="space-y-1.5">
                        {a.trials.map((t) => (
                          <div key={t.id} className="flex items-center justify-between text-xs text-[var(--text-muted)]">
                            <span>{t.customer_name || t.customer_email || 'Cliente sem nome'}</span>
                            <span className="tabular-nums">
                              {money(t.projected_commission_value)}
                              {t.trial_ends_at ? ` · teste até ${formatDateTime(t.trial_ends_at)}` : ''}
                            </span>
                          </div>
                        ))}
                      </div>
                      <p className="mt-2 text-[11px] text-[var(--text-faint)]">
                        Só vira comissão de verdade se o teste converter em cobrança — se cancelar antes, some sozinho
                        daqui.
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

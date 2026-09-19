import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, Image as ImageIcon, Users } from 'lucide-react'
import { rawApi } from '../api/rawClient.js'
import EmptyState from '../components/EmptyState.jsx'
import RefreshButton from '../components/RefreshButton.jsx'
import TierBadge from '../components/TierBadge.jsx'
import { formatDateTime } from '../utils/date.js'
import { resizeImageToDataUrl } from '../utils/avatar.js'

const inputClass =
  'rounded-lg border border-[var(--border)] bg-[var(--bg-surface-2)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-brand-500 focus:outline-none'

function money(value) {
  return Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

// Só pra o admin criar a comunidade em nome de um afiliado sem precisar
// logar como ele (o fluxo normal é o próprio embaixador criar a dele em
// /comunidade, isso aqui é um atalho pra já deixar pronta).
function NewCommunityForm({ affiliates, onCreated }) {
  const [affiliateId, setAffiliateId] = useState('')
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
    if (!affiliateId || !name.trim()) return
    setCreating(true)
    setError(null)
    try {
      await rawApi.createCommunityForAffiliate(Number(affiliateId), name.trim(), photoUrl)
      setAffiliateId('')
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
    <form onSubmit={submit} className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-5">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Criar comunidade pra um afiliado</h3>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-1 flex-col gap-1">
          <label className="text-xs font-medium text-[var(--text-muted)]">Afiliado</label>
          <select required value={affiliateId} onChange={(e) => setAffiliateId(e.target.value)} className={inputClass}>
            <option value="">Selecione…</option>
            {affiliates.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.cakto_email})
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-1 flex-col gap-1">
          <label className="text-xs font-medium text-[var(--text-muted)]">Nome da comunidade</label>
          <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Comunidade Rafael Monteiro" className={inputClass} />
        </div>
        <label className="flex h-[38px] w-[38px] shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-lg border border-dashed border-[var(--border)] bg-[var(--bg-surface-2)] text-[var(--text-faint)] hover:border-brand-500" title="Foto (opcional)">
          {photoUrl ? <img src={photoUrl} alt="" className="h-full w-full object-cover" /> : <ImageIcon size={15} />}
          <input type="file" accept="image/*" onChange={handleFile} className="hidden" />
        </label>
        <button
          type="submit"
          disabled={creating || !affiliateId || !name.trim()}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {creating ? 'Criando…' : 'Criar comunidade'}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </form>
  )
}

function tierForCount(count) {
  if (count <= 15) return 'gold'
  if (count <= 25) return 'platinum'
  return 'diamond'
}

const TIER_PERCENT = { gold: 25, platinum: 30, diamond: 35 }
const PLAN_PRICE = { solo: 127, pro: 187, agencia: 397 }
const PLAN_LABEL = { solo: 'Solo', pro: 'Pro', agencia: 'Agência' }

function sum(rows, paid) {
  return rows.filter((r) => !!r.paid === paid).reduce((s, r) => s + Number(r.commission_value), 0)
}

function formatDate(value) {
  return value ? new Date(value).toLocaleDateString('pt-BR') : '—'
}

function CopyPix({ pix }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(pix)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // sem permissão de clipboard: o admin copia na mão
    }
  }
  return (
    <button onClick={copy} className="rounded-md border border-[var(--border)] px-2 py-0.5 text-[11px] text-[var(--text-muted)] hover:bg-[var(--hover-surface)]">
      {copied ? 'Copiado ✓' : 'Copiar'}
    </button>
  )
}

function PayBox({ title, hint, pending, paid }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface-2)] p-3">
      <p className="text-xs font-semibold text-[var(--text-primary)]">{title}</p>
      <p className="mb-2 text-[11px] text-[var(--text-faint)]">{hint}</p>
      <div className="flex gap-5">
        <div>
          <p className="text-[10px] uppercase text-[var(--text-muted)]">A pagar</p>
          <p className="font-semibold tabular-nums text-amber-400">{money(pending)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase text-[var(--text-muted)]">Já pago</p>
          <p className="font-semibold tabular-nums text-emerald-400">{money(paid)}</p>
        </div>
      </div>
    </div>
  )
}

function PaidButton({ paid, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium ${
        paid ? 'bg-emerald-500/15 text-emerald-400' : 'bg-amber-500/15 text-amber-400 hover:bg-amber-500/25'
      }`}
    >
      {paid ? 'Pago ✓' : 'Marcar como pago'}
    </button>
  )
}

function CommissionTable({ title, rows, columns, onToggle }) {
  if (rows.length === 0) return null
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">{title}</p>
      <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
        <table className="w-full text-left text-sm">
          <thead className="bg-[var(--bg-surface-2)] text-xs uppercase text-[var(--text-muted)]">
            <tr>
              {columns.map((c) => (
                <th key={c.label} className={`px-3 py-2 ${c.right ? 'text-right' : ''}`}>
                  {c.label}
                </th>
              ))}
              <th className="px-3 py-2">Pago</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {rows.map((m) => (
              <tr key={m.rowKey} className="hover:bg-[var(--bg-surface-2)]">
                {columns.map((c) => (
                  <td key={c.label} className={`px-3 py-2.5 ${c.right ? 'text-right tabular-nums' : ''} ${c.strong ? 'font-medium text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]'}`}>
                    {c.render(m)}
                  </td>
                ))}
                <td className="px-3 py-2.5">
                  <PaidButton paid={m.paid} onClick={() => onToggle(m)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function MembersTable({ members, percentage }) {
  if (members.length === 0) return <p className="text-sm text-[var(--text-muted)]">Ninguém na comunidade ainda.</p>
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Membros da comunidade ({members.length})</p>
      <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
        <table className="w-full text-left text-sm">
          <thead className="bg-[var(--bg-surface-2)] text-xs uppercase text-[var(--text-muted)]">
            <tr>
              <th className="px-3 py-2">Membro</th>
              <th className="px-3 py-2">Plano</th>
              <th className="px-3 py-2">Como entrou</th>
              <th className="px-3 py-2">Situação</th>
              <th className="px-3 py-2">Entrou em</th>
              <th className="px-3 py-2">Vence / renova em</th>
              <th className="px-3 py-2 text-right">Comissão por renovação</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {members.map((m) => {
              const referred = m.source === 'affiliate'
              const price = PLAN_PRICE[m.plan] || 0
              return (
                <tr key={m.organization_id} className="hover:bg-[var(--bg-surface-2)]">
                  <td className="px-3 py-2.5">
                    <p className="text-[var(--text-primary)]">{m.user_name || m.organization_name}</p>
                    <p className="text-xs text-[var(--text-faint)]">{m.user_email}</p>
                  </td>
                  <td className="px-3 py-2.5 text-[var(--text-tertiary)]">{PLAN_LABEL[m.plan] || m.plan}</td>
                  <td className="px-3 py-2.5">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${referred ? 'bg-emerald-500/15 text-emerald-400' : 'bg-[var(--bg-surface-2)] text-[var(--text-faint)]'}`}>
                      {referred ? 'Pelo link do embaixador' : 'Pelo diretório'}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-xs">
                    {m.is_trial ? (
                      <span className="text-sky-400">Teste grátis</span>
                    ) : m.active ? (
                      <span className="text-emerald-400">Assinatura ativa</span>
                    ) : (
                      <span className="text-red-400">Vencido</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-xs text-[var(--text-muted)]">{formatDate(m.joined_at)}</td>
                  <td className="px-3 py-2.5 text-xs text-[var(--text-muted)]">{formatDate(m.expires_at)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-[var(--text-primary)]">
                    {referred && price ? (
                      <>
                        ~{money((price * percentage) / 100)}
                        <span className="block text-[10px] text-[var(--text-faint)]">
                          {percentage}% de {money(price)}
                        </span>
                      </>
                    ) : (
                      <span className="text-[var(--text-faint)]">{referred ? '—' : 'não gera'}</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function AdminComunidades() {
  const [communities, setCommunities] = useState(null)
  const [communityCommissions, setCommunityCommissions] = useState([])
  const [affiliateCommissions, setAffiliateCommissions] = useState([])
  const [couponCommissions, setCouponCommissions] = useState([])
  const [affiliates, setAffiliates] = useState([])
  const [error, setError] = useState(null)
  const [expandedId, setExpandedId] = useState(null)
  const [showNewForm, setShowNewForm] = useState(false)

  function load() {
    return Promise.all([
      rawApi.listAdminCommunities().then(setCommunities).catch((e) => setError(e.message)),
      rawApi.listCommunityCommissions().then(setCommunityCommissions).catch((e) => setError(e.message)),
      rawApi.listAffiliateCommissions().then(setAffiliateCommissions).catch(() => {}),
      rawApi.listReferralCommissions().then(setCouponCommissions).catch(() => {}),
      rawApi.listAffiliates().then(setAffiliates).catch(() => {}),
    ])
  }

  useEffect(() => {
    load()
  }, [])

  const summaries = useMemo(
    () =>
      (communities || []).map((c) => {
        const email = String(c.ambassador_email || '').toLowerCase()
        const recurring = communityCommissions.filter((m) => m.community_id === c.id).map((m) => ({ ...m, rowKey: `r${m.id}` }))
        const firstSale = affiliateCommissions.filter((m) => m.affiliate_id === c.affiliate_id).map((m) => ({ ...m, rowKey: `a${m.id}` }))
        const coupon = couponCommissions.filter((m) => String(m.referrer_email || '').toLowerCase() === email).map((m) => ({ ...m, rowKey: `c${m.id}` }))
        const totalPending = sum(recurring, false) + sum(firstSale, false) + sum(coupon, false)
        const totalPaid = sum(recurring, true) + sum(firstSale, true) + sum(coupon, true)
        return { ...c, recurring, firstSale, coupon, totalPending, totalPaid }
      }),
    [communities, communityCommissions, affiliateCommissions, couponCommissions]
  )

  const grandPending = summaries.reduce((s, c) => s + c.totalPending, 0)

  async function toggleRecurring(m) {
    await rawApi.markCommunityCommissionPaid(m.id, !m.paid)
    load()
  }
  async function toggleFirstSale(m) {
    await rawApi.markAffiliateCommissionPaid(m.id, !m.paid)
    load()
  }
  async function toggleCoupon(m) {
    await rawApi.markReferralCommissionPaid(m.id, !m.paid)
    load()
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Comunidades</h2>
          <p className="text-sm text-[var(--text-muted)]">
            O embaixador recebe: (1) a 1ª venda de cada cliente que trouxe, (2) a recorrência de cada renovação de membro
            que veio pelo link dele, pela % do nível da comunidade (Gold até 15 membros 25%, Platinum até 25 membros 30%,
            Diamond acima disso 35%, contando todos os membros ativos), e (3) o cupom de indicação dele, se tiver. Quem
            entrou pelo diretório conta pro nível mas não gera comissão.
          </p>
          {grandPending > 0 && (
            <p className="mt-2 text-sm font-semibold text-amber-400">Total a pagar a todos os embaixadores: {money(grandPending)}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <RefreshButton onRefresh={load} />
          <button
            onClick={() => setShowNewForm((v) => !v)}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            {showNewForm ? 'Cancelar' : '+ Nova comunidade'}
          </button>
        </div>
      </div>

      {showNewForm && (
        <NewCommunityForm
          affiliates={affiliates}
          onCreated={() => {
            setShowNewForm(false)
            load()
          }}
        />
      )}

      {error && <EmptyState title="Não deu pra carregar" subtitle={error} />}

      {summaries.length === 0 && !error && (
        <EmptyState title="Nenhuma comunidade criada ainda" subtitle="Aparece aqui assim que um afiliado criar a comunidade dele." />
      )}

      <div className="space-y-3">
        {summaries.map((c) => {
          const expanded = expandedId === c.id
          const tier = tierForCount(c.active_member_count)
          const percentage = TIER_PERCENT[tier]
          return (
            <div key={c.id} className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)]">
              <button
                onClick={() => setExpandedId(expanded ? null : c.id)}
                className="flex w-full flex-wrap items-center justify-between gap-4 px-5 py-4 text-left hover:bg-[var(--hover-surface)]"
              >
                <div className="flex items-center gap-3">
                  {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  <TierBadge tier={tier} />
                  <div>
                    <p className="font-semibold text-[var(--text-primary)]">{c.community_name}</p>
                    <p className="text-xs text-[var(--text-muted)]">
                      {c.ambassador_name} · {c.ambassador_email}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-6">
                  <div className="text-center">
                    <p className="text-xs uppercase text-[var(--text-muted)]">Membros ativos</p>
                    <p className="flex items-center justify-center gap-1 font-semibold text-[var(--text-primary)]">
                      <Users size={13} /> {c.active_member_count}
                    </p>
                    <p className="text-[10px] text-[var(--text-faint)]">{c.referred_active_member_count} pelo link dele</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs uppercase text-[var(--text-muted)]">Nível</p>
                    <p className="font-semibold text-[var(--text-primary)]">{percentage}%</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs uppercase text-[var(--text-muted)]">A pagar</p>
                    <p className="font-semibold tabular-nums text-amber-400">{money(c.totalPending)}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs uppercase text-[var(--text-muted)]">Já pago</p>
                    <p className="font-semibold tabular-nums text-emerald-400">{money(c.totalPaid)}</p>
                  </div>
                </div>
              </button>

              {expanded && (
                <div className="space-y-5 border-t border-[var(--border)] px-5 py-4">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--text-muted)]">
                    {c.ambassador_pix_key ? (
                      <>
                        <span>
                          PIX: <span className="font-mono text-[var(--text-primary)]">{c.ambassador_pix_key}</span>
                        </span>
                        <CopyPix pix={c.ambassador_pix_key} />
                      </>
                    ) : (
                      <span className="text-amber-400">Sem chave PIX cadastrada pro afiliado (cadastre em Afiliados antes de pagar)</span>
                    )}
                    <span>· 1ª venda dele: {Number(c.first_sale_percentage)}%</span>
                    <span>· Comunidade criada em {formatDate(c.created_at)}</span>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3">
                    <PayBox title="Recorrência da comunidade" hint="Renovação de membro que veio pelo link dele" pending={sum(c.recurring, false)} paid={sum(c.recurring, true)} />
                    <PayBox title="1ª venda (afiliado)" hint="Primeira cobrança de cada cliente trazido" pending={sum(c.firstSale, false)} paid={sum(c.firstSale, true)} />
                    <PayBox title="Cupom de indicação" hint="Compras com o cupom pessoal dele" pending={sum(c.coupon, false)} paid={sum(c.coupon, true)} />
                  </div>

                  <MembersTable members={c.members} percentage={percentage} />

                  <CommissionTable
                    title="Recorrência (renovações)"
                    rows={c.recurring}
                    onToggle={toggleRecurring}
                    columns={[
                      { label: 'Membro', strong: true, render: (m) => m.customer_name || m.customer_email },
                      { label: 'Nível na hora', render: (m) => `${m.tier} · ${Number(m.commission_percentage)}% · ${m.member_count_at_time} membros` },
                      { label: 'Venda', right: true, render: (m) => money(m.sale_amount) },
                      { label: 'Comissão', right: true, strong: true, render: (m) => money(m.commission_value) },
                      { label: 'Data', render: (m) => formatDateTime(m.created_at) },
                    ]}
                  />
                  <CommissionTable
                    title="1ª venda (afiliado)"
                    rows={c.firstSale}
                    onToggle={toggleFirstSale}
                    columns={[
                      { label: 'Cliente', strong: true, render: (m) => m.customer_name || m.customer_email },
                      { label: 'Venda', right: true, render: (m) => money(m.sale_amount) },
                      { label: 'Comissão', right: true, strong: true, render: (m) => money(m.commission_value) },
                      { label: 'Data', render: (m) => formatDateTime(m.created_at) },
                    ]}
                  />
                  <CommissionTable
                    title="Cupom de indicação"
                    rows={c.coupon}
                    onToggle={toggleCoupon}
                    columns={[
                      { label: 'Cliente', strong: true, render: (m) => m.customer_name || m.customer_email },
                      { label: 'Cupom', render: (m) => m.coupon_code },
                      { label: 'Venda', right: true, render: (m) => money(m.sale_amount) },
                      { label: 'Comissão', right: true, strong: true, render: (m) => money(m.commission_value) },
                      { label: 'Data', render: (m) => formatDateTime(m.created_at) },
                    ]}
                  />
                  {c.recurring.length + c.firstSale.length + c.coupon.length === 0 && (
                    <p className="text-sm text-[var(--text-muted)]">Nenhuma comissão gerada ainda pra esse embaixador.</p>
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

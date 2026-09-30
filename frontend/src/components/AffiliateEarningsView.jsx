import { Gift, History, RefreshCw, TrendingUp } from 'lucide-react'
import StatCard from './StatCard.jsx'
import { formatDate } from '../utils/date.js'

function money(value) {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

// "vence hoje" / "vence amanhã" / "vence em N dias" — tanto pro teste grátis
// (vira comissão SE converter) quanto pra renovação de quem já paga (vira
// comissão praticamente certa, só falta a data chegar).
function daysRemainingLabel(dateStr) {
  if (!dateStr) return '—'
  const days = Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000)
  if (days <= 0) return 'vence hoje'
  if (days === 1) return 'vence amanhã'
  return `vence em ${days} dias`
}

// Visual dos números de um afiliado — reaproveitado por MeuPainel.jsx (o
// próprio afiliado vendo os números dele) e AdminAfiliadoPainel.jsx (admin
// espiando o painel de qualquer afiliado, pedido do usuário 2026-09-29:
// "o admin ter um painel e conseguir ver o que cada afiliado tá vendo").
// Só apresentação — quem chama decide de onde vêm os dados.
export default function AffiliateEarningsView({ data }) {
  const { summary, trialSummary, trialReferrals, renewalSummary, upcomingRenewals, recentCommissions, recurringTiers, trialHistory } = data
  const referred = summary.referredCustomers
  // Próximo nível: quantos clientes faltam pra subir de % de recorrência —
  // é o gancho que faz o afiliado querer trazer mais gente (pedido do
  // usuário: "deixar os afiliados com vontade de vender mais").
  const nextTier = (recurringTiers || []).find((t) => referred < t.max && Number.isFinite(t.max))

  return (
    <div className="space-y-8">
      {/* Hero de previsão — o número que faz o olho brilhar: teste grátis a
          caminho de converter + cliente pagante prestes a renovar, tudo
          somado (pedido do usuário: "prever o máximo possível de valores"). */}
      <div className="relative overflow-hidden rounded-3xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 via-[var(--bg-surface)] to-[var(--bg-surface)] p-7">
        <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-emerald-500/20 blur-3xl" />
        <div className="relative flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-400">
              <TrendingUp size={14} /> Previsão a caminho
            </p>
            <p className="mt-2 text-4xl font-bold text-[var(--text-primary)]">{money(data.combinedProjectedTotal)}</p>
            <p className="mt-1.5 text-sm text-[var(--text-muted)]">
              {trialSummary.trialCount > 0 && (
                <>
                  {trialSummary.trialCount} em teste grátis convertendo ({money(trialSummary.projectedTrialTotal)})
                </>
              )}
              {trialSummary.trialCount > 0 && renewalSummary.renewalCount > 0 && ' · '}
              {renewalSummary.renewalCount > 0 && (
                <>
                  {renewalSummary.renewalCount} renovação{renewalSummary.renewalCount === 1 ? '' : 'ões'} chegando (
                  {money(renewalSummary.projectedRenewalTotal)})
                </>
              )}
              {trialSummary.trialCount === 0 && renewalSummary.renewalCount === 0 && 'nada previsto pra agora — hora de trazer gente nova!'}
            </p>
          </div>
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-400">
            <Gift size={26} />
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard icon="💰" label="Já recebido" value={money(summary.totalReceived)} />
        <StatCard icon="⏳" label="A receber" value={money(summary.totalPending)} />
        <StatCard icon="👥" label="Clientes indicados" value={referred} />
        <StatCard
          icon="📈"
          label="Sua % de recorrência"
          value={`${data.recurringPercentage}%`}
          hint={nextTier ? `+${nextTier.max - referred} cliente${nextTier.max - referred === 1 ? '' : 's'} pra ${nextTier.percentage}%` : 'nível máximo 🏆'}
        />
      </div>

      <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-5">
        <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-[var(--text-primary)]">
          <RefreshCw size={14} className="text-brand-500" /> Renovações chegando
        </h3>
        <p className="mb-3.5 text-xs text-[var(--text-muted)]">
          Clientes que já pagam e vão renovar em breve — comissão de recorrência praticamente certa.
        </p>
        {upcomingRenewals.length === 0 ? (
          <p className="py-6 text-center text-sm text-[var(--text-muted)]">Nenhuma renovação prevista nos próximos dias.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-[var(--text-muted)]">
                <tr>
                  <th className="px-3 py-2">Cliente</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Previsão</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {upcomingRenewals.map((r, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2.5 text-[var(--text-primary)]">{r.customerName || r.customerEmail || '—'}</td>
                    <td className="px-3 py-2.5 text-amber-400">{daysRemainingLabel(r.renewsAt)}</td>
                    <td className="px-3 py-2.5 text-right font-semibold text-brand-500">{money(r.projectedCommissionValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-5">
        <h3 className="mb-1 text-sm font-semibold text-[var(--text-primary)]">Em teste grátis agora</h3>
        <p className="mb-3.5 text-xs text-[var(--text-muted)]">
          Previsão de comissão se a pessoa virar cliente pagante ao fim dos 7 dias.
        </p>
        {trialReferrals.length === 0 ? (
          <p className="py-6 text-center text-sm text-[var(--text-muted)]">Ninguém em teste grátis pelo link no momento.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-[var(--text-muted)]">
                <tr>
                  <th className="px-3 py-2">Cliente</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Previsão</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {trialReferrals.map((t, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2.5 text-[var(--text-primary)]">{t.customerName || t.customerEmail || '—'}</td>
                    <td className="px-3 py-2.5 text-amber-400">{daysRemainingLabel(t.trialEndsAt)}</td>
                    <td className="px-3 py-2.5 text-right font-semibold text-brand-500">{money(t.projectedCommissionValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-5">
        <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-[var(--text-primary)]">
          <History size={14} className="text-[var(--text-muted)]" /> Histórico de testes grátis
        </h3>
        <p className="mb-3.5 text-xs text-[var(--text-muted)]">
          Todo mundo que já entrou pelo seu link, e o que aconteceu com cada um no fim dos 7 dias.
        </p>
        {(!trialHistory || trialHistory.length === 0) ? (
          <p className="py-6 text-center text-sm text-[var(--text-muted)]">Ninguém entrou em teste grátis pelo link ainda.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-[var(--text-muted)]">
                <tr>
                  <th className="px-3 py-2">Cliente</th>
                  <th className="px-3 py-2">Entrou em</th>
                  <th className="px-3 py-2 text-right">Resultado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {trialHistory.map((h, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2.5 text-[var(--text-primary)]">{h.customerName || h.customerEmail || '—'}</td>
                    <td className="px-3 py-2.5 text-[var(--text-tertiary)]">{formatDate(h.startedAt)}</td>
                    <td className="px-3 py-2.5 text-right">
                      {h.outcome === 'converted' && (
                        <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-400">
                          ✅ Virou cliente
                        </span>
                      )}
                      {h.outcome === 'expired' && (
                        <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-xs font-semibold text-red-400">
                          ❌ Só testou, expirou
                        </span>
                      )}
                      {h.outcome === 'ongoing' && (
                        <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-400">
                          🎁 Em teste
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-5">
        <h3 className="mb-1 text-sm font-semibold text-[var(--text-primary)]">Histórico de comissões</h3>
        <p className="mb-3.5 text-xs text-[var(--text-muted)]">Últimas {recentCommissions.length} movimentações.</p>
        {recentCommissions.length === 0 ? (
          <p className="py-6 text-center text-sm text-[var(--text-muted)]">Nenhuma comissão registrada ainda.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-[var(--text-muted)]">
                <tr>
                  <th className="px-3 py-2">Data</th>
                  <th className="px-3 py-2">Cliente</th>
                  <th className="px-3 py-2">Tipo</th>
                  <th className="px-3 py-2 text-right">Valor</th>
                  <th className="px-3 py-2 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {recentCommissions.map((c) => (
                  <tr key={c.id}>
                    <td className="px-3 py-2.5 text-[var(--text-tertiary)]">{formatDate(c.createdAt)}</td>
                    <td className="px-3 py-2.5 text-[var(--text-primary)]">{c.customerName || c.customerEmail || '—'}</td>
                    <td className="px-3 py-2.5 text-[var(--text-tertiary)]">
                      {c.commissionType === 'first_sale' ? 'Primeira venda' : 'Recorrência'}
                    </td>
                    <td className="px-3 py-2.5 text-right font-semibold text-brand-500">{money(c.commissionValue)}</td>
                    <td className="px-3 py-2.5 text-right">
                      {c.paid ? (
                        <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-400">Pago</span>
                      ) : (
                        <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-400">Pendente</span>
                      )}
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

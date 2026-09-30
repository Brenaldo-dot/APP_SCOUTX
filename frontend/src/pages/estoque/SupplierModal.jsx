import { useEffect } from 'react'
import { Crown, DollarSign, Package, Percent, Receipt, Store, Tag, TrendingUp, Trophy, X } from 'lucide-react'
import { rawApi } from '../../api/rawClient.js'
import { PlatformLogo, currentCountry, fmt, useCountry, useLatest } from './shared.jsx'
import { CatalogTab } from './Tabs.jsx'

// Painel de um fornecedor: posição no ranking, números gerais e TODOS os
// produtos dele (reaproveita o Catálogo filtrado pelo fornecedor).

function Big({ icon: Icon, label, value, sub, tone }) {
  const tones = {
    emerald: 'from-emerald-500/15 border-emerald-500/25 text-emerald-300',
    amber: 'from-amber-500/15 border-amber-500/25 text-amber-200',
    sky: 'from-sky-500/15 border-sky-500/25 text-sky-200',
    violet: 'from-violet-500/15 border-violet-500/25 text-violet-200',
    brand: 'from-brand-500/15 border-brand-500/25 text-brand-200',
  }
  return (
    <div className={`rounded-2xl border bg-gradient-to-br to-transparent p-3 ${tones[tone]}`}>
      <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">
        <Icon size={12} /> {label}
      </p>
      <p className="mt-1.5 truncate text-xl font-bold leading-none">{value}</p>
      {sub && <p className="mt-1 truncate text-[10px] text-[var(--text-faint)]">{sub}</p>}
    </div>
  )
}

export default function SupplierModal({ supplierId, supplierName, onClose, onAnalyze }) {
  const country = useCountry()
  const { data, error } = useLatest(() => rawApi.radarSupplier(supplierId, country), [supplierId, country])

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const s = data
  const hitRate = s?.products ? Math.round((s.selling / s.products) * 100) : null
  const platformName = ({ mastershop: 'Mastershop', dropi: 'Dropi', dropea: 'Dropea' })[s?.platform] || 'DropLatam'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-3 backdrop-blur-sm" onClick={onClose}>
      <div
        className="sx-scroll max-h-[94vh] w-full max-w-[1440px] overflow-y-auto rounded-3xl border border-[var(--border)] bg-[var(--bg-app,var(--bg-surface))] shadow-2xl shadow-black/60"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--bg-surface)]/95 px-5 py-3.5 backdrop-blur">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-sky-400 text-white shadow-lg shadow-sky-500/30">
              <Store size={20} />
            </span>
            <div>
              <h3 className="font-semibold">Catálogo do fornecedor</h3>
              <p className="text-xs text-[var(--text-muted)]">Todos os produtos e os números desse fornecedor</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-[var(--text-muted)] hover:bg-[var(--hover-surface)]">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4 p-5">
          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="relative overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--bg-surface)] p-5">
            <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-sky-500/15 blur-3xl" />
            <div className="relative flex flex-wrap items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--bg-surface-2)] px-2.5 py-1 text-xs">
                    {currentCountry().flag} <PlatformLogo platform={country} className="h-3.5 w-3.5" /> {platformName}
                  </span>
                  {s?.categories?.map((c) => (
                    <span key={c.name} className="inline-flex items-center gap-1 rounded-full bg-violet-500/10 px-2.5 py-1 text-[11px] font-medium text-violet-300">
                      <Tag size={10} /> {c.name} <span className="text-violet-400/70">{fmt.num(c.n)}</span>
                    </span>
                  ))}
                </div>
                <h4 className="truncate text-2xl font-bold">{s?.name || supplierName || 'Fornecedor'}</h4>
              </div>
              {s?.rank && (
                <div className="flex items-center gap-3 rounded-2xl border border-amber-500/30 bg-gradient-to-br from-amber-500/15 to-transparent px-4 py-3">
                  {s.rank <= 3 ? <Crown size={26} className="fill-amber-300 text-amber-400" /> : <Trophy size={24} className="text-amber-400" />}
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Ranking de vendas (30d)</p>
                    <p className="text-xl font-bold text-amber-200">
                      #{fmt.num(s.rank)} <span className="text-sm font-medium text-[var(--text-muted)]">de {fmt.num(s.ranked)}</span>
                    </p>
                  </div>
                </div>
              )}
            </div>

            {s && (
              <div className="relative mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                <Big icon={Package} label="Produtos" value={fmt.num(s.products)} sub={`${fmt.num(s.inStock)} com estoque`} tone="brand" />
                <Big icon={Percent} label="Taxa de acerto" value={hitRate === null ? '—' : `${hitRate}%`} sub={`${fmt.num(s.selling)} vendendo`} tone="sky" />
                <Big icon={TrendingUp} label="Vendas 7 dias" value={fmt.num(s.sold7d)} sub={`${fmt.num(s.sold1d)} no último dia`} tone="emerald" />
                <Big icon={TrendingUp} label="Vendas 30 dias" value={fmt.num(s.sold30d)} tone="emerald" />
                <Big icon={DollarSign} label="Faturamento 30d" value={fmt.moneyCompact(s.revenue30d)} sub="estimado" tone="amber" />
                <Big icon={Receipt} label="Ticket médio" value={fmt.money(s.ticket)} sub={`preço médio ${fmt.money(s.avgPrice)}`} tone="violet" />
              </div>
            )}
          </div>

          <CatalogTab compact supplierId={supplierId} onAnalyze={onAnalyze} />
        </div>
      </div>
    </div>
  )
}

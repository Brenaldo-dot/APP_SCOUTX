import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Boxes, CalendarDays, Flame, Layers, Users } from 'lucide-react'
import { rawApi } from '../api/rawClient.js'
import RefreshButton from '../components/RefreshButton.jsx'
import { OPERATIONS, useOperation } from '../context/OperationContext.jsx'
import {
  FiltersBar,
  PLATFORMS,
  PlatformContext,
  PlatformLogo,
  PlatformSwitcher,
  SupplierContext,
  currentCountry,
  fmt,
  platformsFor,
  setCurrencyFor,
  useLatest,
} from './estoque/shared.jsx'
import { CatalogTab, DailyTab, HotTab, SuppliersTab } from './estoque/Tabs.jsx'
import ProductHistoryModal from './estoque/ProductHistoryModal.jsx'
import SupplierModal from './estoque/SupplierModal.jsx'

// Radar de Vendas (Colômbia: DropLatam, Dropi e Mastershop; México, Guatemala e
// Equador: DropLatam e Dropi). O país segue a "Operação" da ScoutX. Dados do worker em
// web/dropi-stock/; esta tela só lê (web/dropi-stock/routes.js).
// 4 abas (antes eram 6): Tendências + Novos Vencedores viraram "Em alta" e
// Produtos do Mês virou o período de 30 dias lá dentro.
const TABS = [
  { key: 'dia', label: 'Vendas por Dia', Icon: CalendarDays },
  { key: 'emalta', label: 'Em alta', Icon: Flame },
  { key: 'fornecedores', label: 'Fornecedores', Icon: Users },
  { key: 'catalogo', label: 'Catálogo', Icon: Boxes },
]
// Links antigos (?tab=tendencias etc.) continuam funcionando.
const LEGACY_TABS = { tendencias: 'emalta', mes: 'emalta', vencedores: 'emalta' }

// Só a data da última atualização: nada de "lendo", "varredura" etc. na tela
// (o método de coleta não pode aparecer pro cliente em lugar nenhum).
function UpdatedAt({ overview }) {
  if (!overview?.latestDay) return null
  return (
    <span className="inline-flex items-center gap-2 text-xs text-[var(--text-muted)]">
      <span className="h-2 w-2 rounded-full bg-emerald-400" />
      Atualizado em {fmt.day(overview.latestDay)}
    </span>
  )
}

export default function EstoqueFornecedor() {
  const [searchParams, setSearchParams] = useSearchParams()
  const rawTab = searchParams.get('tab')
  const tab = TABS.some((t) => t.key === rawTab) ? rawTab : LEGACY_TABS[rawTab] || 'dia'
  // País = o da "Operação" escolhida na barra lateral da ScoutX. Um link com
  // ?plataforma= de outro país (ex.: vindo da extensão) manda no país.
  const { operation } = useOperation()
  const opCode = OPERATIONS.find((op) => op.value === operation)?.code || 'co'
  const linked = PLATFORMS.find((p) => p.value === searchParams.get('plataforma'))
  const countryCode = linked ? linked.value.replace(/^[a-z]+-/, '') : opCode
  setCurrencyFor(countryCode)
  const platforms = platformsFor(countryCode)
  const country = platforms.some((p) => p.value === linked?.value) ? linked.value : platforms[0]?.value || null
  const [filters, setFilters] = useState({})
  // ?produto=<id> abre a análise direto (link vindo da extensão do Chrome).
  const [openId, setOpenId] = useState(() => parseInt(searchParams.get('produto'), 10) || null)
  // Painel do fornecedor aberto por cima da página ({ id, name }).
  const [supplier, setSupplier] = useState(null)
  const openSupplier = (id, name) => {
    setOpenId(null)
    setSupplier({ id, name })
  }
  const overview = useLatest(() => (country ? rawApi.radarOverview(country) : Promise.resolve(null)), [country])
  const categories = useLatest(() => (country ? rawApi.radarCategories(country).catch(() => []) : Promise.resolve([])), [country])

  // Trocou o país na barra lateral: a plataforma que estava na URL (de outro
  // país) não pode prender a tela no país antigo.
  const lastOp = useRef(opCode)
  useEffect(() => {
    if (lastOp.current === opCode) return
    lastOp.current = opCode
    setFilters({})
    if (searchParams.get('plataforma')) {
      const next = new URLSearchParams(searchParams)
      next.delete('plataforma')
      setSearchParams(next, { replace: true })
    }
  }, [opCode]) // eslint-disable-line react-hooks/exhaustive-deps

  function setParam(key, value) {
    const next = new URLSearchParams(searchParams)
    next.set(key, value)
    setSearchParams(next, { replace: true })
  }

  function goPlatform(value) {
    // Filtros (categoria, fornecedor) são de uma plataforma só: zera ao trocar.
    setFilters({})
    setParam('plataforma', value)
  }

  const o = overview.data
  const platform = PLATFORMS.find((p) => p.value === country)

  if (!country) {
    const op = OPERATIONS.find((x) => x.value === operation)
    return (
      <div className="space-y-5">
        <h2 className="text-2xl font-bold">Radar de Vendas</h2>
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] px-6 py-16 text-center">
          <span className="text-4xl">{op?.flag || '🌎'}</span>
          <p className="text-lg font-semibold">O Radar de Vendas ainda não está disponível em {op?.label || 'este país'}</p>
          <p className="max-w-md text-sm text-[var(--text-muted)]">
            Estamos preparando os dados deste país. Enquanto isso, escolha Colômbia, México, Guatemala, Equador ou Espanha em Operação, na barra lateral.
          </p>
        </div>
      </div>
    )
  }

  return (
    <PlatformContext.Provider value={country}>
      <SupplierContext.Provider value={openSupplier}>
      <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="text-2xl font-bold">Radar de Vendas</h2>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-medium text-emerald-300">
                {currentCountry().flag} {currentCountry().label} · <PlatformLogo platform={country} className="h-3.5 w-3.5" /> {platform.label}
              </span>
            </div>
            <UpdatedAt overview={o} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="hidden items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-faint)] sm:inline-flex">
              <Layers size={12} className="text-brand-400" /> Plataforma
            </span>
            <PlatformSwitcher value={country} onChange={goPlatform} options={platforms} />
            <RefreshButton onRefresh={() => overview.reload()} />
          </div>
        </div>

        <div className="sx-scroll flex gap-1 overflow-x-auto rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-1.5">
          {TABS.map(({ key, label, Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setParam('tab', key)}
              className={`flex shrink-0 items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${
                tab === key ? 'bg-brand-500 text-white shadow' : 'text-[var(--text-tertiary)] hover:bg-[var(--hover-surface)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Icon size={16} /> {label}
            </button>
          ))}
        </div>

        {tab !== 'fornecedores' && (
          <FiltersBar value={filters} onChange={setFilters} categories={categories.data} showMinSales={tab === 'emalta'} />
        )}

        {/* key={country}: trocar de plataforma remonta a aba (zera página/estado e busca de novo). */}
        <div key={`${country}-${tab}`}>
          {tab === 'dia' && <DailyTab filters={filters} onAnalyze={setOpenId} />}
          {tab === 'emalta' && <HotTab filters={filters} onAnalyze={setOpenId} initialMode={rawTab === 'vencedores' ? 'vencedores' : 'tendencias'} />}
          {tab === 'fornecedores' && <SuppliersTab />}
          {tab === 'catalogo' && <CatalogTab filters={filters} onAnalyze={setOpenId} />}
        </div>

        {supplier && <SupplierModal supplierId={supplier.id} supplierName={supplier.name} onClose={() => setSupplier(null)} onAnalyze={setOpenId} />}

        {/* depois do fornecedor no DOM: a análise do produto abre POR CIMA dele */}
        {openId && (
          <ProductHistoryModal
            onOpenSupplier={openSupplier}
            productId={openId}
            onClose={() => {
              setOpenId(null)
              if (searchParams.get('produto')) {
                const next = new URLSearchParams(searchParams)
                next.delete('produto')
                setSearchParams(next, { replace: true })
              }
            }}
          />
        )}
      </div>
      </SupplierContext.Provider>
    </PlatformContext.Provider>
  )
}

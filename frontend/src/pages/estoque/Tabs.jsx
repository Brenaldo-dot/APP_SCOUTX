import { useEffect, useState } from 'react'
import {
  BarChart3,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Crown,
  DollarSign,
  Flame,
  Rocket,
  Sparkles,
  TrendingDown,
  ArrowDownNarrowWide,
  ArrowUpNarrowWide,
  Boxes,
  LayoutGrid,
  List,
  Package,
  Percent,
  Receipt,
  Search,
  ShoppingCart,
  Store,
  Tag,
  TrendingUp,
  Trophy,
  Users,
} from 'lucide-react'
import { rawApi } from '../../api/rawClient.js'
import ProductThumb from '../../components/ProductThumb.jsx'
import {
  AnalyzeButton,
  Badge,
  CopyId,
  PLATFORMS,
  RankBadge,
  scrollToTop,
  DataTable,
  Kpi,
  NoData,
  Panel,
  Popover,
  Price,
  ProductCell,
  Segmented,
  SortMenu,
  StockValue,
  SupplierLink,
  TableSkeleton,
  activityLevel,
  filterParams,
  fmt,
  useCountry,
  useLatest,
  useOpenSupplier,
  winnerLevel,
  currentCountry,
} from './shared.jsx'

const WAITING = 'Estamos processando os dados deste período. Volte em breve.'
const ACTION_COL = { header: '', width: '110px', align: 'right' }

// Quantos produtos por página (vale pra todas as abas, fica salvo no
// navegador). Padrão 60: página longa, sem chegar rápido no "próxima".
const PAGE_SIZES = [30, 60, 90, 120]
const DEFAULT_PAGE_SIZE = 60
function readPageSize() {
  try {
    const v = Number(localStorage.getItem('radar-page-size'))
    return PAGE_SIZES.includes(v) ? v : DEFAULT_PAGE_SIZE
  } catch {
    return DEFAULT_PAGE_SIZE
  }
}
function usePageSize() {
  const [size, setSize] = useState(readPageSize)
  function change(v) {
    setSize(v)
    try {
      localStorage.setItem('radar-page-size', String(v))
    } catch {
      // sem storage: só não lembra a escolha
    }
  }
  return [size, change]
}

function PageSizePicker({ value, onChange }) {
  return (
    <div className="inline-flex items-center gap-2">
      <span className="text-xs text-[var(--text-muted)]">Por página</span>
      <div className="inline-flex rounded-xl border border-[var(--border)] bg-[var(--bg-surface-2)] p-1">
        {PAGE_SIZES.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onChange(n)}
            className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
              value === n ? 'bg-brand-500 text-white shadow' : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
            }`}
          >
            {n}
          </button>
        ))}
      </div>
    </div>
  )
}

// Páginas numeradas (1 2 3 … 41) com anterior/próxima.
function pageList(page, totalPages) {
  const set = new Set([1, totalPages, page - 1, page, page + 1])
  if (page <= 3) [2, 3, 4].forEach((p) => set.add(p))
  if (page >= totalPages - 2) [totalPages - 1, totalPages - 2, totalPages - 3].forEach((p) => set.add(p))
  const pages = [...set].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b)
  const out = []
  pages.forEach((p, i) => {
    if (i && p - pages[i - 1] > 1) out.push(`gap-${p}`)
    out.push(p)
  })
  return out
}

function PageNav({ page, totalPages, onChange }) {
  const btn = 'flex h-9 min-w-9 items-center justify-center rounded-lg px-2.5 text-sm font-semibold transition-colors'
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        onClick={() => onChange(page - 1)}
        disabled={page <= 1}
        className={`${btn} gap-1 border border-[var(--border)] text-[var(--text-tertiary)] hover:bg-[var(--hover-surface)] disabled:cursor-not-allowed disabled:opacity-40`}
      >
        <ChevronLeft size={15} /> Anterior
      </button>
      {pageList(page, totalPages).map((p) =>
        typeof p === 'string' ? (
          <span key={p} className="px-1 text-[var(--text-faint)]">
            …
          </span>
        ) : (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p)}
            className={`${btn} ${p === page ? 'bg-brand-500 text-white shadow-md shadow-brand-500/30' : 'text-[var(--text-tertiary)] hover:bg-[var(--hover-surface)] hover:text-[var(--text-primary)]'}`}
          >
            {fmt.num(p)}
          </button>
        )
      )}
      <button
        type="button"
        onClick={() => onChange(page + 1)}
        disabled={page >= totalPages}
        className={`${btn} gap-1 border border-brand-500/40 bg-brand-500/10 text-brand-200 hover:bg-brand-500/20 disabled:cursor-not-allowed disabled:opacity-40`}
      >
        Próxima <ChevronRight size={15} />
      </button>
    </div>
  )
}

// Rodapé das listas: "Mostrando 1–60 de 2.445", quantos por página e páginas.
function Paged({ page, total, onPage, size, onSize }) {
  if (!total) return null
  const totalPages = Math.max(1, Math.ceil(total / size))
  const from = (page - 1) * size + 1
  const to = Math.min(total, page * size)
  return (
    <div className="flex flex-col gap-3 border-t border-[var(--border)] px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-wrap items-center gap-4">
        <span className="text-xs text-[var(--text-muted)]">
          Mostrando <b className="text-[var(--text-primary)]">{fmt.num(from)}–{fmt.num(to)}</b> de <b className="text-[var(--text-primary)]">{fmt.num(total)}</b>
        </span>
        {onSize && total > PAGE_SIZES[0] && (
          <PageSizePicker
            value={size}
            onChange={(n) => {
              onSize(n)
              onPage(1)
              scrollToTop()
            }}
          />
        )}
      </div>
      {totalPages > 1 && (
        <PageNav
          page={page}
          totalPages={totalPages}
          onChange={(p) => {
            onPage(p)
            scrollToTop()
          }}
        />
      )}
    </div>
  )
}

function BigNumber({ value, sub, tone = 'text-emerald-400' }) {
  return (
    <div className="text-right">
      <p className={`text-lg font-bold leading-tight ${tone}`}>{fmt.num(value)}</p>
      {sub && <p className="text-[11px] text-[var(--text-faint)]">{sub}</p>}
    </div>
  )
}

// Alterna entre cards (padrão) e lista. A escolha fica salva no navegador.
function useViewMode() {
  const [view, setView] = useState(() => {
    try {
      return localStorage.getItem('radar-view') || 'cards'
    } catch {
      return 'cards'
    }
  })
  function change(v) {
    setView(v)
    try {
      localStorage.setItem('radar-view', v)
    } catch {
      // sem storage: só não lembra a escolha
    }
  }
  return [view, change]
}

function ViewToggle({ value, onChange }) {
  const btn = (v, Icon, label) => (
    <button
      type="button"
      title={label}
      onClick={() => onChange(v)}
      className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
        value === v ? 'bg-brand-500 text-white' : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
      }`}
    >
      <Icon size={15} />
    </button>
  )
  return (
    <div className="inline-flex rounded-xl border border-[var(--border)] bg-[var(--bg-surface-2)] p-1">
      {btn('cards', LayoutGrid, 'Ver em cards')}
      {btn('list', List, 'Ver em lista')}
    </div>
  )
}

// Grade de cards OU tabela, com os mesmos dados.
function Results({ view, items, loading, error, empty, columns, card }) {
  if (view === 'list') {
    return <DataTable columns={columns} rows={items} rowKey={(p) => p.id} loading={loading} error={error} empty={empty} />
  }
  if (loading && !items) return <TableSkeleton />
  if (error) return <NoData title="Não deu pra carregar" subtitle={error} />
  if (items && items.length === 0) return empty
  return <div className="grid grid-cols-[repeat(auto-fill,minmax(380px,1fr))] gap-3 p-3">{items?.map(card)}</div>
}

// ---------- Tendências / Produtos do Mês ----------
const TREND_SORTS = [
  { value: 'sold', label: 'Mais vendas', hint: 'Total vendido no período', icon: TrendingUp, tone: 'emerald' },
  { value: 'activity', label: 'Mais dias vendendo', hint: 'Vende todos os dias, sem parar', icon: CalendarDays, tone: 'sky' },
  { value: 'record', label: 'Maior recorde em 1 dia', hint: 'O melhor dia de vendas', icon: Trophy, tone: 'amber' },
]

export function TrendsTab({ filters, onAnalyze, days: fixedDays, title, subtitle }) {
  const country = useCountry()
  const [view, setView] = useViewMode()
  const [days, setDays] = useState(fixedDays || 7)
  const [sort, setSort] = useState('sold')
  const [page, setPage] = useState(1)
  const [size, setSize] = usePageSize()
  useEffect(() => setPage(1), [days, sort, filters])
  const { data, error, loading } = useLatest(
    () => rawApi.radarTrends({ country, days, sort, page, limit: size, ...filterParams(filters) }),
    [days, sort, page, size, filters]
  )
  const sum = data?.summary
  const rankOf = (i) => (page - 1) * size + i + 1

  const columns = [
    { header: 'Produto', render: (p, i) => <ProductCell p={p} rank={rankOf(i)} /> },
    { header: 'Vendas', width: '110px', align: 'right', render: (p) => <BigNumber value={p.periodSold} sub={`${fmt.num(Math.round(p.periodSold / days))} / dia`} /> },
    {
      header: 'Atividade',
      width: '170px',
      align: 'right',
      render: (p) => {
        const act = activityLevel(p.activeDays, days)
        return (
          <div>
            <p className="text-sm font-semibold">
              {p.activeDays} de {days} dias
            </p>
            <div className="my-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--bg-surface-2)]">
              <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-lime-400" style={{ width: `${act.pct}%` }} />
            </div>
            <div className="flex items-center justify-end gap-1.5 text-[10px] text-[var(--text-faint)]">
              {act.pct}% <Badge tone={act.tone}>{act.label}</Badge>
            </div>
          </div>
        )
      },
    },
    { header: 'Recorde', width: '80px', align: 'right', render: (p) => <BigNumber value={p.record} sub="em 1 dia" tone="text-sky-300" /> },
    { header: 'Preço', width: '120px', align: 'right', render: (p) => <Price value={p.salePrice} suggested={p.suggestedPrice} /> },
    { header: 'Estoque', width: '80px', align: 'right', render: (p) => <StockValue value={p.stock} /> },
    { ...ACTION_COL, render: (p) => <AnalyzeButton onClick={() => onAnalyze(p.id)} /> },
  ]

  const card = (p, i) => {
    const act = activityLevel(p.activeDays, days)
    return (
      <ProductGridCard
        key={p.id}
        p={p}
        rank={rankOf(i)}
        onAnalyze={onAnalyze}
        stats={[
          { icon: TrendingUp, label: `Vendas ${days}d`, value: fmt.num(p.periodSold), tone: 'emerald', big: true },
          { icon: BarChart3, label: 'Por dia', value: fmt.num(Math.round(p.periodSold / days)), tone: 'violet' },
          { icon: DollarSign, label: 'Preço', value: fmt.money(p.salePrice), tone: 'amber' },
        ]}
        footer={
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-[var(--bg-surface-2)]">
              <div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-lime-400" style={{ width: `${act.pct}%` }} />
            </div>
            <span className="shrink-0 text-[10px] font-semibold text-[var(--text-muted)]" title={`Vendeu em ${p.activeDays} de ${days} dias`}>
              {p.activeDays}/{days}
            </span>
            <Badge tone={act.tone}>{act.label}</Badge>
          </div>
        }
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Produtos vendendo" value={data ? fmt.num(data.total) : null} icon={Package} />
        <Kpi label="Vendas da seleção" value={sum ? fmt.num(sum.units) : null} tone="green" icon={ShoppingCart} />
        <Kpi label="Atividade média" value={sum ? `${fmt.num(sum.avgActiveDays)} dias` : null} hint={`de ${days} dias`} icon={BarChart3} />
        <Kpi label="Preço médio" value={sum ? fmt.money(sum.avgPrice) : null} tone="amber" icon={DollarSign} />
      </div>
      <Panel
        title={title || `Produtos em Tendência (${days} dias)`}
        subtitle={subtitle || 'Produtos com vendas constantes no período.'}
        right={
          <>
            <SortMenu value={sort} onChange={setSort} options={TREND_SORTS} />
            {!fixedDays && <Segmented value={days} onChange={setDays} options={[3, 7, 14, 30, 60]} />}
            <ViewToggle value={view} onChange={setView} />
          </>
        }
      >
        <Results
          view={view}
          items={data?.items}
          loading={loading}
          error={error}
          columns={columns}
          card={card}
          empty={<NoData title="Nenhuma venda registrada nesse período ainda" subtitle={WAITING} />}
        />
        {data && <Paged page={page} total={data.total} onPage={setPage} size={size} onSize={setSize} />}
      </Panel>
    </div>
  )
}

// ---------- Novos Vencedores ----------
const WINNER_LABELS = [
  { value: '', label: 'Todos' },
  { value: 'novo', label: 'Novo' },
  { value: 'explosivo', label: 'Explosivo' },
  { value: 'fogo', label: 'Fogo' },
  { value: 'crescendo', label: 'Crescendo' },
]

export function WinnersTab({ filters, onAnalyze }) {
  const country = useCountry()
  const [view, setView] = useViewMode()
  const [days, setDays] = useState(14)
  const [label, setLabel] = useState('')
  const [page, setPage] = useState(1)
  const [size, setSize] = usePageSize()
  useEffect(() => setPage(1), [days, label, filters])
  const { data, error, loading } = useLatest(
    () => rawApi.radarWinners({ country, days, label: label || undefined, page, limit: size, ...filterParams(filters) }),
    [days, label, page, size, filters]
  )
  const sum = data?.summary
  const rankOf = (i) => (page - 1) * size + i + 1

  const columns = [
    { header: 'Produto', render: (p, i) => <ProductCell p={p} rank={rankOf(i)} /> },
    { header: 'Vendas recentes', width: '120px', align: 'right', render: (p) => <BigNumber value={p.recent} sub={`antes: ${fmt.num(p.previous)}`} /> },
    {
      header: 'Crescimento',
      width: '150px',
      align: 'right',
      render: (p) => {
        const w = winnerLevel(p.recent, p.previous)
        return (
          <div>
            <p className="text-base font-bold">{w.growth ? `${fmt.num(Math.round(w.growth * 10) / 10)}×` : 'NOVO'}</p>
            <div className="mt-1">
              <Badge tone={w.tone}>{w.growth ? w.label : 'Sem vendas anteriores'}</Badge>
            </div>
          </div>
        )
      },
    },
    { header: 'Preço', width: '120px', align: 'right', render: (p) => <Price value={p.salePrice} suggested={p.suggestedPrice} /> },
    { header: 'Estoque', width: '80px', align: 'right', render: (p) => <StockValue value={p.stock} /> },
    { ...ACTION_COL, render: (p) => <AnalyzeButton onClick={() => onAnalyze(p.id)} /> },
  ]

  const card = (p, i) => {
    const w = winnerLevel(p.recent, p.previous)
    return (
      <ProductGridCard
        key={p.id}
        p={p}
        rank={rankOf(i)}
        onAnalyze={onAnalyze}
        stats={[
          { icon: TrendingUp, label: `Vendas ${days}d`, value: fmt.num(p.recent), tone: 'emerald', big: true },
          { icon: CalendarDays, label: 'Antes', value: fmt.num(p.previous), tone: 'violet' },
          { icon: DollarSign, label: 'Preço', value: fmt.money(p.salePrice), tone: 'amber' },
        ]}
        footer={
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-[var(--text-primary)]">{w.growth ? `${fmt.num(Math.round(w.growth * 10) / 10)}×` : 'NOVO'}</span>
            <Badge tone={w.tone}>{w.growth ? w.label : 'Sem vendas antes'}</Badge>
          </div>
        }
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Novos vencedores" value={data ? fmt.num(data.total) : null} icon={TrendingUp} />
        <Kpi label="Vendas da seleção" value={sum ? fmt.num(sum.units) : null} tone="green" icon={ShoppingCart} />
        <Kpi label="Sem vendas anteriores" value={sum ? fmt.num(sum.brandNew) : null} hint={`nos ${days} dias anteriores`} tone="sky" icon={Package} />
        <Kpi label="Preço médio" value={sum ? fmt.money(sum.avgPrice) : null} tone="amber" icon={DollarSign} />
      </div>
      <Panel
        title={`Novos Vencedores (${days} dias)`}
        subtitle={`Pelo menos 20 vendas nos últimos ${days} dias e crescimento forte contra os ${days} dias anteriores.`}
        right={
          <>
            <Segmented value={label} onChange={setLabel} options={WINNER_LABELS} />
            <Segmented value={days} onChange={setDays} options={[7, 14, 30, 60]} />
            <ViewToggle value={view} onChange={setView} />
          </>
        }
      >
        <Results
          view={view}
          items={data?.items}
          loading={loading}
          error={error}
          columns={columns}
          card={card}
          empty={<NoData title="Nenhum novo vencedor nesse período ainda" subtitle={WAITING} />}
        />
        {data && <Paged page={page} total={data.total} onPage={setPage} size={size} onSize={setSize} />}
      </Panel>
    </div>
  )
}


// ---------- Em alta (Tendências + Novos Vencedores numa aba só) ----------
// "Produtos do Mês" virou o período de 30 dias dentro de Tendências.
const HOT_MODES = [
  { value: 'tendencias', label: 'Vendas consistentes', hint: 'Vendem bem todos os dias do período', icon: TrendingUp, iconOn: 'bg-emerald-500/20 text-emerald-300' },
  { value: 'vencedores', label: 'Novos em alta', hint: 'Começaram a vender forte agora', icon: Rocket, iconOn: 'bg-violet-500/20 text-violet-300' },
]

export function HotTab({ filters, onAnalyze, initialMode = 'tendencias' }) {
  const [mode, setMode] = useState(initialMode)
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:max-w-3xl">
        {HOT_MODES.map((m) => {
          const on = mode === m.value
          return (
            <button
              key={m.value}
              type="button"
              onClick={() => setMode(m.value)}
              className={`flex items-center gap-3 rounded-2xl border p-3.5 text-left transition-all ${
                on
                  ? 'border-brand-500/60 bg-gradient-to-r from-brand-500/15 to-transparent shadow-lg shadow-brand-500/10'
                  : 'border-[var(--border)] bg-[var(--bg-surface)] hover:border-brand-500/30'
              }`}
            >
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${on ? m.iconOn : 'bg-[var(--bg-surface-2)] text-[var(--text-faint)]'}`}>
                <m.icon size={18} />
              </span>
              <span className="min-w-0">
                <span className={`block text-sm font-semibold ${on ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>{m.label}</span>
                <span className="block text-xs text-[var(--text-faint)]">{m.hint}</span>
              </span>
            </button>
          )
        })}
      </div>
      {mode === 'tendencias' ? <TrendsTab filters={filters} onAnalyze={onAnalyze} /> : <WinnersTab filters={filters} onAnalyze={onAnalyze} />}
    </div>
  )
}

// ---------- Vendas por Dia ----------
// Visual no padrão ScoutX (cards de HotProducts / StatCard): brilho azul no
// canto, bordas arredondadas, dia selecionado em gradiente da marca.

function addDaysIso(iso, delta) {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d + delta)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

// "Hoje" no horário de Brasília (o dia do Radar segue Brasília, ver store.js).
function todayBrasilia() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
}

function shortDate(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' }).replace('.', '')
}

function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86400000) + 1
}

// Resumo do que está selecionado: 1 dia (folhinha de calendário) ou um
// período (de → até), com vendas, produtos e comparação.
function DaySummary({ days, range, summary }) {
  const single = range.from === range.to
  const idx = days.findIndex((d) => d.day === range.from)
  const prev = single && idx >= 0 ? days[idx + 1] : null
  const units = summary?.units ?? (single ? days[idx]?.units : null)
  const products = summary?.products ?? (single ? days[idx]?.products : null)
  const change = single && prev?.units && units !== null ? Math.round(((units - prev.units) / prev.units) * 100) : null
  const [y, m, d] = range.from.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  const weekday = dt.toLocaleDateString('pt-BR', { weekday: 'long' })
  const month = dt.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')
  return (
    <div className="relative flex shrink-0 items-center gap-4 overflow-hidden rounded-2xl border border-brand-500/35 bg-gradient-to-br from-brand-600/25 via-brand-500/5 to-transparent p-3 pr-5">
      <div className="pointer-events-none absolute -left-8 -top-10 h-28 w-28 rounded-full bg-brand-500/25 blur-3xl" />
      {single ? (
        <div className="relative flex h-[68px] w-[60px] shrink-0 flex-col overflow-hidden rounded-xl border border-brand-400/40 bg-[var(--bg-surface)] shadow-lg shadow-brand-500/20">
          <span className="bg-gradient-to-r from-brand-600 to-brand-500 py-0.5 text-center text-[10px] font-bold uppercase tracking-wider text-white">{month}</span>
          <span className="flex flex-1 items-center justify-center text-2xl font-bold leading-none text-[var(--text-primary)]">{String(d).padStart(2, '0')}</span>
        </div>
      ) : (
        <div className="relative flex h-[68px] shrink-0 flex-col justify-center rounded-xl border border-brand-400/40 bg-[var(--bg-surface)] px-3 shadow-lg shadow-brand-500/20">
          <span className="text-[10px] font-bold uppercase tracking-wider text-brand-300">Período</span>
          <span className="whitespace-nowrap text-sm font-bold text-[var(--text-primary)]">
            {shortDate(range.from)} → {shortDate(range.to)}
          </span>
          <span className="text-[10px] text-[var(--text-muted)]">{daysBetween(range.from, range.to)} dias</span>
        </div>
      )}
      <div className="relative min-w-0">
        <p className="text-[11px] font-medium text-brand-200">{single ? weekday.charAt(0).toUpperCase() + weekday.slice(1) : 'Total do período'}</p>
        <p className="mt-0.5 flex items-baseline gap-1.5">
          <span className="text-2xl font-bold leading-none text-emerald-300">{units === null || units === undefined ? '—' : fmt.num(units)}</span>
          <span className="text-xs text-[var(--text-muted)]">vendas</span>
        </p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="rounded-full bg-[var(--bg-surface-2)] px-2 py-0.5 text-[var(--text-tertiary)]">
            <b className="text-[var(--text-primary)]">{fmt.num(products)}</b> produtos
          </span>
          {change !== null && (
            <span className={`rounded-full px-2 py-0.5 font-semibold ${change >= 0 ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/15 text-red-300'}`}>
              {change >= 0 ? '▲' : '▼'} {Math.abs(change)}% vs {fmt.dayShort(prev.day)}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// Mini gráfico de barras dos últimos 14 dias (até hoje): altura = vendas do
// dia, número em cima, data embaixo. Dias do período escolhido ficam em azul.
function DayPicker({ days, range, onPickDay }) {
  const end = [todayBrasilia(), days[0]?.day].filter(Boolean).sort().pop()
  if (!end) return null
  const byDay = new Map(days.map((d) => [d.day, d]))
  const strip = Array.from({ length: 14 }, (_, i) => addDaysIso(end, -(13 - i)))
  const max = Math.max(1, ...strip.map((iso) => byDay.get(iso)?.units || 0))
  return (
    <div className="flex min-w-0 flex-1 items-end gap-1 overflow-x-auto pb-0.5">
      {strip.map((iso) => {
        const d = byDay.get(iso)
        const active = iso >= range.from && iso <= range.to
        const h = d ? Math.max(10, Math.round((d.units / max) * 52)) : 3
        return (
          <button
            key={iso}
            type="button"
            disabled={!d}
            onClick={() => d && onPickDay(iso)}
            title={d ? `${fmt.day(iso)}: ${fmt.num(d.units)} vendas` : `${fmt.day(iso)}: sem dados`}
            className={`group flex min-w-[34px] flex-1 flex-col items-center gap-1 rounded-lg px-0.5 pt-1 transition-colors ${
              d ? 'cursor-pointer hover:bg-[var(--hover-surface)]' : 'cursor-default'
            } ${active ? 'bg-brand-500/10' : ''}`}
          >
            <span className={`h-3 text-[9px] font-bold ${active ? 'text-emerald-300' : d ? 'text-[var(--text-muted)]' : 'text-transparent'}`}>
              {d ? fmt.num(d.units) : '·'}
            </span>
            <span className="flex h-[52px] w-full items-end justify-center">
              <span
                className={`w-full max-w-[22px] rounded-t-md transition-all ${
                  !d
                    ? 'bg-[var(--border)]'
                    : active
                      ? 'bg-gradient-to-t from-brand-600 to-brand-400 shadow-[0_0_12px_rgba(59,130,246,0.55)]'
                      : 'bg-gradient-to-t from-emerald-700/70 to-emerald-400/80 group-hover:from-emerald-600 group-hover:to-emerald-300'
                }`}
                style={{ height: `${h}px` }}
              />
            </span>
            <span className={`text-[9px] font-semibold uppercase ${active ? 'text-brand-200' : 'text-[var(--text-faint)]'}`}>{fmt.weekday(iso)}</span>
            <span className={`-mt-1 text-[10px] font-bold ${active ? 'text-white' : d ? 'text-[var(--text-tertiary)]' : 'text-[var(--text-faint)]'}`}>
              {iso.slice(8)}
            </span>
          </button>
        )
      })}
    </div>
  )
}

// Calendário próprio (o nativo não aceita estilo) que escolhe um PERÍODO:
// 1º clique = início, 2º clique = fim. Dias com vendas têm um pontinho que
// acende conforme o volume. Pode escolher de 60 dias atrás até hoje.
const WEEKDAYS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']

function isoOf(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function CalendarPanel({ days, range, onApply }) {
  const today = todayBrasilia()
  const byDay = new Map(days.map((d) => [d.day, d]))
  const max = Math.max(1, ...days.map((d) => d.units))
  const oldest = days[days.length - 1]?.day || today
  const [start, setStart] = useState(range.from)
  const [end, setEnd] = useState(range.to)
  const [picking, setPicking] = useState(false) // true = já escolheu o início, esperando o fim
  const [hover, setHover] = useState(null)
  const initial = (range.to || today).split('-').map(Number)
  const [view, setView] = useState({ y: initial[0], m: initial[1] - 1 })

  const first = new Date(view.y, view.m, 1)
  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate()
  const cells = [...Array(first.getDay()).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)]
  const rawMonth = first.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
  const monthLabel = rawMonth.charAt(0).toUpperCase() + rawMonth.slice(1)
  const canPrev = oldest < isoOf(view.y, view.m, 1)
  const canNext = today > isoOf(view.y, view.m, daysInMonth)

  function shift(delta) {
    const d = new Date(view.y, view.m + delta, 1)
    setView({ y: d.getFullYear(), m: d.getMonth() })
  }

  function click(iso) {
    if (!picking) {
      setStart(iso)
      setEnd(iso)
      setPicking(true)
    } else {
      const [a, b] = iso < start ? [iso, start] : [start, iso]
      setStart(a)
      setEnd(b)
      setPicking(false)
    }
  }

  const shownEnd = picking && hover ? (hover < start ? start : hover) : end
  const shownStart = picking && hover && hover < start ? hover : start

  const navBtn = (enabled, onClick, Icon) => (
    <button
      type="button"
      disabled={!enabled}
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-tertiary)] transition-colors hover:bg-[var(--hover-surface)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-25"
    >
      <Icon size={16} />
    </button>
  )

  const presets = [
    { label: 'Últimos 7 dias', from: addDaysIso(today, -6) },
    { label: 'Últimos 14 dias', from: addDaysIso(today, -13) },
    { label: 'Últimos 30 dias', from: addDaysIso(today, -29) },
  ]

  return (
    <div className="flex gap-3">
      <div className="flex w-36 shrink-0 flex-col gap-1 border-r border-[var(--border)] pr-3">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Atalhos</p>
        {presets.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => onApply({ from: p.from < oldest ? oldest : p.from, to: today })}
            className="rounded-lg px-2.5 py-1.5 text-left text-xs font-medium text-[var(--text-tertiary)] hover:bg-[var(--hover-surface)] hover:text-[var(--text-primary)]"
          >
            {p.label}
          </button>
        ))}
      </div>
      <div className="w-[280px]">
        <div className="mb-3 flex items-center justify-between">
          {navBtn(canPrev, () => shift(-1), ChevronLeft)}
          <p className="text-sm font-semibold text-[var(--text-primary)]">{monthLabel}</p>
          {navBtn(canNext, () => shift(1), ChevronRight)}
        </div>
        <div className="mb-1 grid grid-cols-7 gap-1">
          {WEEKDAYS.map((w, i) => (
            <span key={i} className="text-center text-[10px] font-semibold uppercase text-[var(--text-faint)]">
              {w}
            </span>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1" onMouseLeave={() => setHover(null)}>
          {cells.map((d, i) => {
            if (!d) return <span key={i} />
            const iso = isoOf(view.y, view.m, d)
            const enabled = iso >= oldest && iso <= today
            if (!enabled) {
              return (
                <span key={i} className="flex h-9 items-center justify-center rounded-lg text-xs text-[var(--text-faint)] opacity-35">
                  {d}
                </span>
              )
            }
            const data = byDay.get(iso)
            const isEdge = iso === shownStart || iso === shownEnd
            const inRange = iso > shownStart && iso < shownEnd
            return (
              <button
                key={i}
                type="button"
                title={data ? `${fmt.num(data.units)} vendas` : 'sem vendas registradas'}
                onClick={() => click(iso)}
                onMouseEnter={() => setHover(iso)}
                className={`relative flex h-9 flex-col items-center justify-center rounded-lg text-xs font-semibold transition-all ${
                  isEdge
                    ? 'bg-gradient-to-br from-brand-500 to-brand-600 text-white shadow-lg shadow-brand-500/30'
                    : inRange
                      ? 'bg-brand-500/20 text-brand-100'
                      : 'bg-[var(--bg-surface-2)] text-[var(--text-primary)] hover:bg-brand-500/20 hover:ring-1 hover:ring-brand-500/50'
                }`}
              >
                {d}
                {data && (
                  <span
                    className={`absolute bottom-1 h-1 w-1 rounded-full ${isEdge ? 'bg-white' : 'bg-emerald-400'}`}
                    style={isEdge ? undefined : { opacity: 0.35 + 0.65 * (data.units / max) }}
                  />
                )}
              </button>
            )
          })}
        </div>
        <div className="mt-3 flex items-center justify-between gap-2 border-t border-[var(--border)] pt-3">
          <span className="text-[11px] text-[var(--text-muted)]">
            {picking ? 'Agora clique no dia final' : `${shortDate(start)} → ${shortDate(end)}`}
          </span>
          <button
            type="button"
            disabled={picking}
            onClick={() => onApply({ from: start, to: end })}
            className="rounded-lg bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-600 disabled:opacity-40"
          >
            Aplicar
          </button>
        </div>
      </div>
    </div>
  )
}

function DateFilter({ days, range, onChange }) {
  const today = todayBrasilia()
  const yesterday = addDaysIso(today, -1)
  const single = range.from === range.to
  const isCustom = !(single && (range.from === today || range.from === yesterday))
  const quick = (label, d) => (
    <button
      type="button"
      onClick={() => onChange({ from: d, to: d })}
      className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
        single && range.from === d ? 'bg-brand-500 text-white' : 'text-[var(--text-tertiary)] hover:bg-[var(--hover-surface)] hover:text-[var(--text-primary)]'
      }`}
    >
      {label}
    </button>
  )
  const label = !isCustom ? 'Personalizado' : single ? fmt.day(range.from) : `${shortDate(range.from)} → ${shortDate(range.to)}`
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex rounded-xl border border-[var(--border)] bg-[var(--bg-surface-2)] p-1">
        {quick('Hoje', today)}
        {quick('Ontem', yesterday)}
      </div>
      <Popover label={label} icon={CalendarDays} active={isCustom} width="w-auto" align="right">
        {(close) => (
          <CalendarPanel
            days={days}
            range={range}
            onApply={(r) => {
              onChange(r)
              close()
            }}
          />
        )}
      </Popover>
    </div>
  )
}

// Mini-card de número dentro do card do produto: fundo e borda na cor do
// dado (verde = vendas, âmbar = preço, azul = estoque, roxo = ritmo).
const MINI_TONES = {
  emerald: { box: 'border-emerald-500/25 bg-gradient-to-br from-emerald-500/15 to-emerald-500/[0.03]', icon: 'bg-emerald-500/20 text-emerald-300', value: 'text-emerald-300' },
  amber: { box: 'border-amber-500/25 bg-gradient-to-br from-amber-500/15 to-amber-500/[0.03]', icon: 'bg-amber-500/20 text-amber-300', value: 'text-amber-200' },
  sky: { box: 'border-sky-500/25 bg-gradient-to-br from-sky-500/15 to-sky-500/[0.03]', icon: 'bg-sky-500/20 text-sky-300', value: 'text-sky-100' },
  violet: { box: 'border-violet-500/25 bg-gradient-to-br from-violet-500/15 to-violet-500/[0.03]', icon: 'bg-violet-500/20 text-violet-300', value: 'text-violet-100' },
}

function MiniStat({ icon: Icon, label, value, tone, big }) {
  const t = MINI_TONES[tone]
  return (
    <div className={`flex min-w-0 flex-col gap-1.5 rounded-xl border px-2.5 py-2 ${t.box}`}>
      <div className="flex items-center gap-1">
        <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded ${t.icon}`}>
          <Icon size={10} strokeWidth={2.5} />
        </span>
        <span className="truncate text-[10px] font-semibold uppercase text-[var(--text-muted)]">{label}</span>
      </div>
      <p className={`truncate font-bold leading-none ${big ? 'text-xl' : 'text-sm'} ${t.value}`}>{value}</p>
    </div>
  )
}

// Card de produto usado em todas as abas (Vendas por Dia, Tendências, Novos
// Vencedores, Produtos do Mês, Catálogo). `stats` = 3 mini-cards; `footer` =
// informação extra da aba (atividade, crescimento...) ao lado do Analisar.
function ProductGridCard({ p, rank, stats, footer, onAnalyze }) {
  const category = p.categories?.split(', ')[0]
  return (
    <div
      onClick={() => onAnalyze(p.id)}
      className="group relative flex cursor-pointer flex-col gap-3.5 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-5 transition-colors hover:border-brand-500/50"
    >
      <div className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-gradient-to-br from-brand-500/20 to-transparent blur-2xl transition-opacity group-hover:opacity-90" />
      <div className="relative flex items-start gap-3">
        <div className="relative shrink-0">
          <ProductThumb src={p.imageUrl} title={p.name} size="h-20 w-20" rounded="rounded-xl" />
          {rank !== undefined && <RankBadge n={rank} size="h-5 w-5 text-[10px] rounded-md" crownSize={12} floating className="-left-1.5 -top-1.5" />}
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="line-clamp-2 text-[15px] font-semibold leading-snug text-[var(--text-primary)]">{p.name}</p>
          <SupplierLink id={p.supplierId} name={p.supplierName} />
          <div className="flex flex-wrap items-center gap-1.5">
            <CopyId id={p.dropiId} />
            {category && <span className="rounded-md bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-medium text-violet-300">{category}</span>}
          </div>
        </div>
      </div>
      <div className="relative grid grid-cols-3 gap-2">
        {stats.map((s) => (
          <MiniStat key={s.label} {...s} />
        ))}
      </div>
      <div className="relative flex items-center justify-between gap-2">
        {footer || <span />}
        <AnalyzeButton onClick={() => onAnalyze(p.id)} />
      </div>
    </div>
  )
}

function longDay(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  const s = new Date(y, m - 1, d).toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// Top 25 dos últimos 14 dias: NÃO segue os filtros da página (é o ranking
// geral da plataforma). Barra = vendas relativas ao 1º colocado.
function Top25({ country, onAnalyze }) {
  const top = useLatest(() => rawApi.radarTrends({ country, days: 14, limit: 25 }), [])
  const max = Math.max(1, ...(top.data?.items || []).map((p) => p.periodSold))
  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <Trophy size={16} className="text-amber-400" /> Top 25 Vendas
        </span>
      }
      subtitle="Os mais vendidos dos últimos 14 dias"
    >
      {top.loading && !top.data && <TableSkeleton rows={5} />}
      <div className="divide-y divide-[var(--border)]">
        {top.data?.items.map((p, i) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onAnalyze(p.id)}
            className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-[var(--hover-surface)]"
          >
            <RankBadge n={i + 1} size="h-6 w-6 text-[11px]" className={i === 0 ? 'mt-2' : ''} />
            <ProductThumb src={p.imageUrl} title={p.name} size="h-11 w-11" rounded="rounded-lg" />
            <span className="min-w-0 flex-1 space-y-1">
              <span className="line-clamp-2 text-[12px] font-semibold leading-snug text-[var(--text-primary)]">{p.name}</span>
              <span className="flex items-center gap-2">
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--bg-surface-2)]">
                  <span
                    className={`block h-full rounded-full ${i < 3 ? 'bg-gradient-to-r from-amber-500 to-amber-300' : 'bg-gradient-to-r from-emerald-600 to-emerald-400'}`}
                    style={{ width: `${Math.max(6, (p.periodSold / max) * 100)}%` }}
                  />
                </span>
                <span className="shrink-0 text-[11px] font-bold text-emerald-400">{fmt.num(p.periodSold)}</span>
              </span>
            </span>
            <span className="shrink-0 rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-semibold text-amber-300">{fmt.moneyCompact(p.salePrice)}</span>
          </button>
        ))}
      </div>
      {top.data && top.data.items.length === 0 && <NoData title="Sem dados ainda" />}
    </Panel>
  )
}

export function DailyTab({ filters, onAnalyze }) {
  const country = useCountry()
  const days = useLatest(() => rawApi.radarDays(country), [])
  // Período escolhido: 1 dia (from === to) ou intervalo. Começa em "Hoje"
  // (Brasília); se hoje ainda não tem vendas, no último dia com dados.
  const [range, setRange] = useState(null)
  const [page, setPage] = useState(1)
  const [size, setSize] = usePageSize()
  useEffect(() => {
    if (range || !days.data) return
    const today = todayBrasilia()
    const start = days.data.some((d) => d.day === today) || !days.data.length ? today : days.data[0].day
    setRange({ from: start, to: start })
  }, [days.data, range])
  useEffect(() => setPage(1), [range, filters])
  const list = useLatest(
    () =>
      range
        ? rawApi.radarDaySales(range.from, { country, to: range.to !== range.from ? range.to : undefined, page, limit: size, ...filterParams(filters) })
        : Promise.resolve(null),
    [range, page, size, filters]
  )
  const sum = list.data?.summary
  const single = range && range.from === range.to

  if (days.data && days.data.length === 0) {
    return (
      <Panel>
        <NoData title="Nenhuma venda registrada ainda" subtitle={WAITING} />
      </Panel>
    )
  }

  const periodLabel = range ? (single ? fmt.day(range.from) : `${shortDate(range.from)} → ${shortDate(range.to)}`) : undefined

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Unidades vendidas" value={sum ? fmt.num(sum.units) : null} tone="green" hint={periodLabel} icon={ShoppingCart} />
        <Kpi label="Faturamento estimado" value={sum ? fmt.moneyCompact(sum.revenue) : null} tone="amber" hint="pelo preço do fornecedor" icon={DollarSign} />
        <Kpi label="Produtos vendendo" value={sum ? fmt.num(sum.products) : null} icon={Package} />
        <Kpi label="Ticket médio" value={sum && sum.units ? fmt.money(Math.round(sum.revenue / sum.units)) : null} tone="sky" icon={Receipt} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          <Panel
            title={
              <span className="flex items-center gap-2">
                <CalendarDays size={16} className="text-brand-400" /> Vendas por Dia
              </span>
            }
            subtitle={
              range ? (
                <span>
                  {single ? longDay(range.from) : `De ${longDay(range.from)} até ${longDay(range.to)}`}{' '}
                  <span className="text-[var(--text-faint)]">·</span> <b className="text-[var(--text-primary)]">{fmt.num(list.data?.total)}</b> produtos vendendo
                </span>
              ) : (
                ''
              )
            }
            right={days.data && range && <DateFilter days={days.data} range={range} onChange={setRange} />}
          >
            {days.data && range && (
              <div className="flex flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center">
                <DaySummary days={days.data} range={range} summary={sum} />
                <DayPicker days={days.data} range={range} onPickDay={(d) => setRange({ from: d, to: d })} />
              </div>
            )}
          </Panel>

          {list.loading && !list.data && <TableSkeleton />}
          {list.error && <NoData title="Não deu pra carregar" subtitle={list.error} />}
          {list.data?.items.length === 0 && (
            <Panel>
              <NoData
                title={single && range.from === todayBrasilia() ? 'Ainda não há vendas registradas hoje' : 'Nenhum produto vendido nesse período'}
                subtitle={single && range.from === todayBrasilia() ? 'Os números de hoje aparecem ao longo do dia. Veja "Ontem" enquanto isso.' : undefined}
              />
            </Panel>
          )}
          {list.data?.items.length > 0 && (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(380px,1fr))] gap-3">
              {list.data.items.map((p, i) => (
                <ProductGridCard
                  key={p.id}
                  p={p}
                  rank={(page - 1) * size + i + 1}
                  onAnalyze={onAnalyze}
                  stats={[
                    { icon: TrendingUp, label: single ? 'Vendas' : 'No período', value: fmt.num(p.daySold), tone: 'emerald', big: true },
                    { icon: DollarSign, label: 'Preço', value: fmt.money(p.salePrice), tone: 'amber' },
                    { icon: Package, label: 'Estoque', value: fmt.num(p.stock), tone: 'sky' },
                  ]}
                />
              ))}
            </div>
          )}
          {list.data?.items.length > 0 && (
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)]">
              <Paged page={page} total={list.data.total} onPage={setPage} size={size} onSize={setSize} />
            </div>
          )}
        </div>

        <Top25 country={country} onAnalyze={onAnalyze} />
      </div>
    </div>
  )
}

// ---------- Top Fornecedores ----------
const SUPPLIER_SORTS = [
  { value: 'sold_desc', label: 'Quem mais vendeu', hint: 'Mais unidades vendidas', icon: TrendingUp, tone: 'emerald', group: 'Vendas' },
  { value: 'sold_asc', label: 'Quem menos vendeu', hint: 'Menos unidades vendidas', icon: TrendingDown, tone: 'rose', group: 'Vendas' },
  { value: 'revenue_desc', label: 'Maior faturamento', hint: 'Vendas × preço do fornecedor', icon: DollarSign, tone: 'amber', group: 'Vendas' },
  { value: 'ticket_desc', label: 'Ticket médio mais alto', hint: 'Produtos mais caros', icon: ArrowUpNarrowWide, tone: 'violet', group: 'Ticket médio' },
  { value: 'ticket_asc', label: 'Ticket médio mais baixo', hint: 'Produtos mais baratos', icon: ArrowDownNarrowWide, tone: 'sky', group: 'Ticket médio' },
  { value: 'products_desc', label: 'Mais produtos vendendo', hint: 'Catálogo com mais itens ativos', icon: Package, tone: 'brand', group: 'Catálogo' },
]
const SUPPLIER_MIN_SALES = [
  { value: 1, label: 'Todos' },
  { value: 50, label: '50+' },
  { value: 200, label: '200+' },
  { value: 1000, label: '1.000+' },
]

// Avatar do fornecedor: a foto da loja na plataforma; sem foto (ou se não
// carregar), as iniciais com uma cor fixa. Top 3 ganham o anel da medalha.
const AVATAR_TONES = [
  'from-sky-400 to-blue-600',
  'from-violet-400 to-purple-600',
  'from-emerald-400 to-teal-600',
  'from-rose-400 to-pink-600',
  'from-amber-400 to-orange-600',
  'from-cyan-400 to-sky-600',
  'from-fuchsia-400 to-violet-600',
  'from-lime-400 to-emerald-600',
]
function initials(name) {
  const words = String(name || '').replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(Boolean)
  if (!words.length) return '?'
  return (words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[1][0]).toUpperCase()
}
export function SupplierAvatar({ id, name, rank, logoUrl, size = 'h-12 w-12 text-base' }) {
  const [broken, setBroken] = useState(false)
  let h = 0
  for (const c of String(id ?? name)) h = (h * 31 + c.charCodeAt(0)) >>> 0
  const ring =
    rank === 1 ? 'ring-2 ring-amber-400 ring-offset-2 ring-offset-[var(--bg-surface)]'
    : rank === 2 ? 'ring-2 ring-slate-300 ring-offset-2 ring-offset-[var(--bg-surface)]'
    : rank === 3 ? 'ring-2 ring-orange-400 ring-offset-2 ring-offset-[var(--bg-surface)]'
    : ''
  return (
    <span className={`relative inline-flex shrink-0 ${rank === 1 ? 'mt-2' : ''}`}>
      {rank === 1 && (
        <Crown size={18} strokeWidth={2.5} className="absolute -top-[15px] left-1/2 -translate-x-1/2 fill-amber-300 text-amber-400 drop-shadow-[0_0_6px_rgba(251,191,36,0.7)]" />
      )}
      {logoUrl && !broken ? (
        <img
          src={logoUrl}
          alt={name || ''}
          loading="lazy"
          onError={() => setBroken(true)}
          className={`${size} rounded-xl bg-white object-cover shadow-md ${ring}`}
        />
      ) : (
        <span className={`flex ${size} items-center justify-center rounded-xl bg-gradient-to-br font-bold text-white shadow-md ${AVATAR_TONES[h % AVATAR_TONES.length]} ${ring}`}>
          {initials(name)}
        </span>
      )}
    </span>
  )
}

function SupplierCard({ s, rank, days, showCrown, onOpen }) {
  const hitRate = s.totalProducts ? Math.round((s.productsSelling / s.totalProducts) * 100) : null
  const best = s.topProducts?.[0]
  return (
    <div className="group relative flex flex-col gap-5 overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-6 transition-colors hover:border-brand-500/50">
      <div className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-gradient-to-br from-sky-500/15 to-transparent blur-2xl" />

      {/* posição + nome + etiquetas de produtos */}
      <div className="relative flex items-start gap-3">
        <SupplierAvatar id={s.id} name={s.name} logoUrl={s.logoUrl} rank={showCrown ? rank : null} size="h-14 w-14 text-lg" />
        <div className="min-w-0 flex-1">
          <button type="button" onClick={() => onOpen(s)} className="block max-w-full truncate text-left text-lg font-bold text-[var(--text-primary)] hover:text-sky-300">
            {s.name || `Fornecedor ${s.id}`}
          </button>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--bg-surface-2)] px-2 py-0.5 text-[11px] text-[var(--text-tertiary)]">
              <Package size={11} className="text-brand-300" /> <b className="text-[var(--text-primary)]">{fmt.num(s.totalProducts)}</b> produtos
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-200">
              <TrendingUp size={11} /> <b>{fmt.num(s.productsSelling)}</b> vendendo
            </span>
          </div>
        </div>
      </div>

      {/* produto mais vendido: uma linha discreta */}
      {best && (
        <div className="relative flex items-center gap-3 border-y border-[var(--border)] py-3">
          <ProductThumb src={best.imageUrl} title={best.name} size="h-11 w-11" rounded="rounded-lg" />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] text-[var(--text-faint)]">Mais vendido</p>
            <p className="truncate text-sm font-medium text-[var(--text-primary)]" title={best.name}>{best.name}</p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-sm font-bold text-emerald-300">{fmt.num(best.sold30d)}</p>
            <p className="text-[10px] text-[var(--text-faint)]">em 30 dias</p>
          </div>
        </div>
      )}

      <div className="relative grid grid-cols-2 gap-2">
        <MiniStat icon={TrendingUp} label={`Vendas ${days}d`} value={fmt.num(s.sold)} tone="emerald" big />
        <MiniStat icon={DollarSign} label="Faturamento" value={fmt.moneyCompact(s.revenue)} tone="amber" big />
        <MiniStat icon={Receipt} label="Ticket médio" value={fmt.money(s.ticket)} tone="violet" />
        <MiniStat icon={Percent} label="Taxa de acerto" value={hitRate === null ? '—' : `${hitRate}%`} tone="sky" />
      </div>

      <button
        type="button"
        onClick={() => onOpen(s)}
        className="relative mt-auto inline-flex items-center justify-center gap-2 rounded-xl border border-brand-400/40 bg-gradient-to-r from-brand-600 to-brand-500 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-brand-500/25 transition-all hover:shadow-lg hover:shadow-brand-500/40 hover:brightness-110"
      >
        <Store size={15} /> Ver catálogo do fornecedor <ChevronRight size={15} />
      </button>
    </div>
  )
}

export function SuppliersTab() {
  const country = useCountry()
  const openSupplier = useOpenSupplier()
  const platformLabel = PLATFORMS.find((p) => p.value === country)?.label
  const [days, setDays] = useState(14)
  const [sort, setSort] = useState('sold_desc')
  const [minSales, setMinSales] = useState(1)
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [page, setPage] = useState(1)
  const [size, setSize] = usePageSize()
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 400)
    return () => clearTimeout(t)
  }, [q])
  useEffect(() => setPage(1), [days, sort, minSales, debouncedQ])
  const { data, error, loading } = useLatest(
    () =>
      rawApi.radarTopSuppliers({ country, days, sort, min_sales: minSales > 1 ? minSales : undefined, q: debouncedQ || undefined, page, limit: size }),
    [days, sort, minSales, debouncedQ, page, size]
  )

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Fornecedores vendendo" value={data ? fmt.num(data.total) : null} icon={Users} />
        <Kpi label={`Vendas totais (${days}d)`} value={data?.summary ? fmt.num(data.summary.units) : null} tone="green" icon={ShoppingCart} />
        <Kpi label="Ticket médio geral" value={data?.summary ? fmt.money(data.summary.ticket) : null} tone="amber" icon={Receipt} />
        <Kpi label="Fornecedor principal" value={data?.summary?.topName || '—'} tone="sky" icon={Crown} />
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-3">
        <div className="relative min-w-[240px] flex-1">
          <span className="pointer-events-none absolute left-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg bg-brand-500/15 text-brand-300">
            <Search size={15} strokeWidth={2.5} />
          </span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar fornecedor…"
            className="h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg-surface-2)] pl-11 pr-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-brand-500 focus:outline-none"
          />
        </div>
        <SortMenu value={sort} onChange={setSort} options={SUPPLIER_SORTS} />
        <span className="ml-1 text-xs text-[var(--text-muted)]">Vendas mínimas</span>
        <Segmented value={minSales} onChange={setMinSales} options={SUPPLIER_MIN_SALES} />
        <Segmented value={days} onChange={setDays} options={[7, 14, 30, 60]} />
      </div>

      <Panel
        title={`${SUPPLIER_SORTS.find((s) => s.value === sort)?.label} (${days} dias)`}
        subtitle={`Ranking dos fornecedores da ${platformLabel} pelas vendas no período.`}
      >
        {loading && !data && <TableSkeleton />}
        {error && <NoData title="Não deu pra carregar" subtitle={error} />}
        {data && data.items.length === 0 && <NoData title="Nenhum fornecedor com vendas nesse período ainda" subtitle={WAITING} />}
        {data?.items.length > 0 && (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(470px,1fr))] gap-5 p-5">
            {data.items.map((s, i) => (
              <SupplierCard
                key={s.id}
                s={s}
                rank={(page - 1) * size + i + 1}
                days={days}
                showCrown={sort === 'sold_desc' || sort === 'revenue_desc'}
                onOpen={(x) => openSupplier?.(x.id, x.name)}
              />
            ))}
          </div>
        )}
        {data && <Paged page={page} total={data.total} onPage={setPage} size={size} onSize={setSize} />}
      </Panel>
    </div>
  )
}

// ---------- Catálogo ----------
const CATALOG_SORTS = [
  { value: 'sold_1d', label: 'Mais vendidos no último dia', icon: Flame, tone: 'rose', group: 'Vendas' },
  { value: 'sold_7d', label: 'Mais vendidos em 7 dias', icon: TrendingUp, tone: 'emerald', group: 'Vendas' },
  { value: 'sold_30d', label: 'Mais vendidos em 30 dias', icon: BarChart3, tone: 'sky', group: 'Vendas' },
  { value: 'newest', label: 'Mais novos', hint: 'Entraram há pouco no catálogo', icon: Sparkles, tone: 'violet', group: 'Catálogo' },
  { value: 'stock', label: 'Maior estoque', icon: Boxes, tone: 'brand', group: 'Catálogo' },
  { value: 'price_asc', label: 'Menor preço', icon: ArrowDownNarrowWide, tone: 'amber', group: 'Preço' },
  { value: 'price_desc', label: 'Maior preço', icon: ArrowUpNarrowWide, tone: 'amber', group: 'Preço' },
]

function SalesCell({ value }) {
  return <p className={`text-right text-sm font-bold ${value > 0 ? 'text-emerald-400' : 'text-[var(--text-faint)]'}`}>{fmt.num(value)}</p>
}

export function CatalogTab({ filters, onAnalyze, supplierId, compact }) {
  const country = useCountry()
  const [view, setView] = useViewMode()
  const platformLabel = PLATFORMS.find((p) => p.value === country)?.label
  const [sort, setSort] = useState('sold_7d')
  const [page, setPage] = useState(1)
  const [size, setSize] = usePageSize()
  useEffect(() => setPage(1), [sort, filters])
  const { data, error, loading } = useLatest(
    () => rawApi.radarCatalog({ country, sort, page, limit: size, ...filterParams(filters || {}), supplier_id: supplierId || filters?.supplier_id }),
    [sort, page, size, filters, supplierId]
  )

  const columns = [
    { header: 'Produto', render: (p) => <ProductCell p={p} /> },
    { header: 'Preço', width: '130px', align: 'right', render: (p) => <Price value={p.salePrice} suggested={p.suggestedPrice} /> },
    { header: 'Estoque', width: '90px', align: 'right', render: (p) => <StockValue value={p.stock} /> },
    { header: '1 dia', width: '70px', align: 'right', render: (p) => <SalesCell value={p.sold1d} /> },
    { header: '7 dias', width: '70px', align: 'right', render: (p) => <SalesCell value={p.sold7d} /> },
    { header: '30 dias', width: '70px', align: 'right', render: (p) => <SalesCell value={p.sold30d} /> },
    { ...ACTION_COL, render: (p) => <AnalyzeButton onClick={() => onAnalyze(p.id)} /> },
  ]

  const card = (p) => (
    <ProductGridCard
      key={p.id}
      p={p}
      onAnalyze={onAnalyze}
      stats={[
        { icon: TrendingUp, label: 'Vendas 7d', value: fmt.num(p.sold7d), tone: 'emerald', big: true },
        { icon: DollarSign, label: 'Preço', value: fmt.money(p.salePrice), tone: 'amber' },
        { icon: Package, label: 'Estoque', value: fmt.num(p.stock), tone: 'sky' },
      ]}
      footer={
        <span className="flex items-center gap-2 text-[10px] text-[var(--text-muted)]">
          <span>
            24h <b className={p.sold1d ? 'text-emerald-400' : 'text-[var(--text-faint)]'}>{fmt.num(p.sold1d)}</b>
          </span>
          <span>
            30d <b className={p.sold30d ? 'text-emerald-400' : 'text-[var(--text-faint)]'}>{fmt.num(p.sold30d)}</b>
          </span>
        </span>
      }
    />
  )

  return (
    <Panel
      title={compact ? `Produtos do fornecedor${data ? ` (${fmt.num(data.total)})` : ''}` : `Catálogo completo${data ? ` (${fmt.num(data.total)})` : ''}`}
      subtitle={compact ? 'Ordene para ver os que mais vendem, os mais novos ou os mais baratos.' : `Todos os produtos da ${platformLabel} ${currentCountry().label}.`}
      right={
        <>
          <SortMenu value={sort} onChange={setSort} options={CATALOG_SORTS} />
          <ViewToggle value={view} onChange={setView} />
        </>
      }
    >
      <Results
        view={view}
        items={data?.items}
        loading={loading}
        error={error}
        columns={columns}
        card={card}
        empty={<NoData title="Nenhum produto encontrado" />}
      />
      {data && <Paged page={page} total={data.total} onPage={setPage} size={size} onSize={setSize} />}
    </Panel>
  )
}

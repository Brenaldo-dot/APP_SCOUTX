import { useEffect, useMemo, useState } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Boxes,
  Calculator,
  CalendarDays,
  CheckCircle2,
  Crown,
  DollarSign,
  ExternalLink,
  Gauge,
  Layers,
  LineChart as LineIcon,
  Minus,
  Package,
  Store,
  Tag,
  TrendingDown,
  TrendingUp,
  Trophy,
  X,
  XCircle,
} from 'lucide-react'
import { rawApi } from '../../api/rawClient.js'
import ProductThumb from '../../components/ProductThumb.jsx'
import { CopyId, PeriodPicker, PlatformLogo, currencyInfo, currentCountry, fmt, useCountry } from './shared.jsx'

// Análise aprofundada de 1 produto: diagnóstico "vale a pena?", números-chave,
// gráficos (vendas por dia, acumulado, dia da semana, preço), calculadora de
// margem, fornecedor, posição na categoria e produtos parecidos de outros
// fornecedores. Nada aqui mostra estoque ao longo do tempo (regra de sigilo).

const PERIODS = [7, 14, 30, 60, 90]
const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

const TREND = {
  subindo: { label: 'Subindo', Icon: TrendingUp, cls: 'text-emerald-400' },
  caindo: { label: 'Caindo', Icon: TrendingDown, cls: 'text-red-400' },
  estavel: { label: 'Estável', Icon: Minus, cls: 'text-amber-300' },
}

const tooltipStyle = { background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 12 }
const axisTick = { fill: 'var(--text-muted)', fontSize: 11 }

// Estoque que acaba em menos de 1 dia no ritmo atual aparece assim, não "0 dias".
function stockDaysLabel(n) {
  if (n === null || n === undefined) return '—'
  if (n < 1) return '< 1 dia'
  return n === 1 ? '1 dia' : `${fmt.num(n)} dias`
}

// "28 de set." pra datas curtas no cabeçalho.
function longDate(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' }).replace('.', '')
}

function weekdayOf(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).getDay()
}

// ---------- diagnóstico ----------
function buildChecks(data) {
  const s = data.stats
  const p = data.product
  const checks = []
  const add = (label, status, detail) => checks.push({ label, status, detail })

  add(
    'Vende com frequência',
    s.frequency >= 70 ? 'good' : s.frequency >= 40 ? 'warn' : 'bad',
    `Vendeu em ${s.activeDays} de ${s.trackedDays} dias (${s.frequency}%).`
  )
  add(
    'Volume de vendas',
    s.dailyAverage >= 10 ? 'good' : s.dailyAverage >= 3 ? 'warn' : 'bad',
    `Média de ${fmt.num(s.dailyAverage)} vendas por dia no período.`
  )
  add(
    'Tendência',
    s.trend === 'subindo' ? 'good' : s.trend === 'estavel' ? 'warn' : 'bad',
    s.trend === 'subindo' ? 'Vendas crescendo no período.' : s.trend === 'estavel' ? 'Vendas estáveis no período.' : 'Vendas caindo no período.'
  )
  if (s.stockDays === null) add('Estoque do fornecedor', 'warn', 'Sem ritmo de vendas suficiente para projetar o estoque.')
  else
    add(
      'Estoque do fornecedor',
      s.stockDays >= 14 ? 'good' : s.stockDays >= 5 ? 'warn' : 'bad',
      `${fmt.num(p.stock)} unidades: dura ${stockDaysLabel(s.stockDays)} no ritmo atual.`
    )
  if (p.suggestedPrice && p.salePrice) {
    const margin = (p.suggestedPrice - p.salePrice) / p.suggestedPrice
    add(
      'Margem sobre o preço sugerido',
      margin >= 0.6 ? 'good' : margin >= 0.4 ? 'warn' : 'bad',
      `Custo ${fmt.money(p.salePrice)} x sugerido ${fmt.money(p.suggestedPrice)} (${Math.round(margin * 100)}% de margem bruta).`
    )
  }
  if (data.supplier?.rank) {
    const top = data.supplier.rank / Math.max(1, data.supplier.ranked)
    add(
      'Força do fornecedor',
      top <= 0.1 ? 'good' : top <= 0.35 ? 'warn' : 'bad',
      `#${fmt.num(data.supplier.rank)} de ${fmt.num(data.supplier.ranked)} fornecedores em vendas (30 dias).`
    )
  }
  const cheaper = (data.similar || []).filter((x) => x.salePrice && p.salePrice && x.salePrice < p.salePrice && x.sold30d > 0)
  add(
    'Concorrência de preço',
    cheaper.length === 0 ? 'good' : cheaper.length <= 2 ? 'warn' : 'bad',
    cheaper.length === 0
      ? 'Nenhum produto parecido vendendo mais barato.'
      : `${cheaper.length} produto(s) parecido(s) vendendo mais barato em outros fornecedores.`
  )
  const points = { good: 1, warn: 0.5, bad: 0 }
  const score = Math.round((checks.reduce((sum, c) => sum + points[c.status], 0) / checks.length) * 100)
  return { checks, score }
}

function ScoreRing({ score }) {
  const r = 34
  const c = 2 * Math.PI * r
  const color = score >= 75 ? '#34d399' : score >= 50 ? '#fbbf24' : '#f87171'
  return (
    <div className="relative h-24 w-24 shrink-0">
      <svg viewBox="0 0 80 80" className="h-24 w-24 -rotate-90">
        <circle cx="40" cy="40" r={r} fill="none" stroke="var(--border)" strokeWidth="7" />
        <circle
          cx="40"
          cy="40"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={`${(score / 100) * c} ${c}`}
          style={{ filter: `drop-shadow(0 0 6px ${color}88)` }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold leading-none" style={{ color }}>
          {score}
        </span>
        <span className="text-[9px] uppercase tracking-wider text-[var(--text-faint)]">de 100</span>
      </div>
    </div>
  )
}

function Diagnosis({ data }) {
  const { checks, score } = useMemo(() => buildChecks(data), [data])
  const verdict =
    score >= 75
      ? { label: 'Forte candidato', cls: 'text-emerald-300', box: 'from-emerald-500/20' }
      : score >= 50
        ? { label: 'Promissor, com atenção', cls: 'text-amber-200', box: 'from-amber-500/20' }
        : { label: 'Arriscado', cls: 'text-red-300', box: 'from-red-500/20' }
  const icon = { good: CheckCircle2, warn: AlertTriangle, bad: XCircle }
  const iconCls = { good: 'text-emerald-400', warn: 'text-amber-300', bad: 'text-red-400' }
  return (
    <Section title="Diagnóstico" subtitle="Vale a pena vender esse produto com esse fornecedor?" icon={Gauge}>
      <div className={`mb-3 flex items-center gap-4 rounded-2xl border border-[var(--border)] bg-gradient-to-br ${verdict.box} to-transparent p-3`}>
        <ScoreRing score={score} />
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-[var(--text-muted)]">Veredito</p>
          <p className={`text-lg font-bold ${verdict.cls}`}>{verdict.label}</p>
          {data.stats.trackedDays < 7 && (
            <p className="mt-1 text-[11px] text-[var(--text-faint)]">Poucos dias de dados: diagnóstico preliminar.</p>
          )}
        </div>
      </div>
      <ul className="space-y-2">
        {checks.map((c) => {
          const Icon = icon[c.status]
          return (
            <li key={c.label} className="flex gap-2.5 rounded-xl bg-[var(--bg-surface-2)] px-3 py-2">
              <Icon size={16} className={`mt-0.5 shrink-0 ${iconCls[c.status]}`} />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[var(--text-primary)]">{c.label}</p>
                <p className="text-[11px] leading-snug text-[var(--text-muted)]">{c.detail}</p>
              </div>
            </li>
          )
        })}
      </ul>
    </Section>
  )
}

// ---------- blocos ----------
function Section({ title, subtitle, icon: Icon, right, children }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          {Icon && (
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500/15 text-brand-300">
              <Icon size={16} />
            </span>
          )}
          <div>
            <p className="text-sm font-semibold text-[var(--text-primary)]">{title}</p>
            {subtitle && <p className="text-[11px] text-[var(--text-muted)]">{subtitle}</p>}
          </div>
        </div>
        {right}
      </div>
      {children}
    </div>
  )
}

function Stat({ icon: Icon, label, value, sub, tone }) {
  const tones = {
    emerald: 'from-emerald-500/15 border-emerald-500/25 text-emerald-300',
    sky: 'from-sky-500/15 border-sky-500/25 text-sky-200',
    amber: 'from-amber-500/15 border-amber-500/25 text-amber-200',
    violet: 'from-violet-500/15 border-violet-500/25 text-violet-200',
    brand: 'from-brand-500/15 border-brand-500/25 text-brand-200',
    rose: 'from-rose-500/15 border-rose-500/25 text-rose-200',
  }
  return (
    <div className={`flex h-full items-start justify-between gap-2 rounded-2xl border bg-gradient-to-br to-transparent p-3.5 ${tones[tone]}`}>
      <div className="min-w-0">
        <p className="truncate text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">{label}</p>
        <p className="mt-2 whitespace-nowrap text-[22px] font-bold leading-none">{value}</p>
        {sub && <p className="mt-1.5 truncate text-[10px] text-[var(--text-faint)]">{sub}</p>}
      </div>
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/5 ring-1 ring-white/10">
        <Icon size={14} />
      </span>
    </div>
  )
}

function EmptyChart({ text = 'Ainda não há dias suficientes para esse gráfico.' }) {
  return <p className="flex h-[180px] items-center justify-center text-center text-sm text-[var(--text-muted)]">{text}</p>
}

// ---------- gráficos ----------
function SalesChart({ series, average }) {
  if (series.length === 0) return <EmptyChart />
  return (
    <ResponsiveContainer width="100%" height={220}>
      <ComposedChart data={series} margin={{ top: 16, right: 8, left: -14, bottom: 0 }}>
        <defs>
          <linearGradient id="barSales" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#34d399" stopOpacity={0.95} />
            <stop offset="100%" stopColor="#059669" stopOpacity={0.35} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="4 4" stroke="var(--border)" />
        <XAxis dataKey="day" tickFormatter={fmt.dayShort} tick={axisTick} />
        <YAxis allowDecimals={false} tick={axisTick} />
        <Tooltip contentStyle={tooltipStyle} labelFormatter={(d) => fmt.day(d)} formatter={(v) => [fmt.num(v), 'Vendas']} cursor={{ fill: 'rgba(59,130,246,0.08)' }} />
        <Bar dataKey="sold" fill="url(#barSales)" radius={[6, 6, 0, 0]} maxBarSize={36} />
        {average > 0 && (
          <ReferenceLine
            y={average}
            stroke="#60a5fa"
            strokeDasharray="5 5"
            label={{ value: `média ${fmt.num(Math.round(average))}`, fill: '#93c5fd', fontSize: 10, position: 'insideTopRight' }}
          />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  )
}

function CumulativeChart({ series }) {
  if (series.length < 2) return <EmptyChart />
  let acc = 0
  const data = series.map((d) => ({ day: d.day, total: (acc += d.sold) }))
  return (
    <ResponsiveContainer width="100%" height={180}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -14, bottom: 0 }}>
        <defs>
          <linearGradient id="cumFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.4} />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="4 4" stroke="var(--border)" />
        <XAxis dataKey="day" tickFormatter={fmt.dayShort} tick={axisTick} />
        <YAxis allowDecimals={false} tick={axisTick} />
        <Tooltip contentStyle={tooltipStyle} labelFormatter={(d) => fmt.day(d)} formatter={(v) => [fmt.num(v), 'Acumulado']} />
        <Area type="monotone" dataKey="total" stroke="#60a5fa" strokeWidth={2.5} fill="url(#cumFill)" />
      </AreaChart>
    </ResponsiveContainer>
  )
}

function WeekdayChart({ series }) {
  if (series.length === 0) return <EmptyChart />
  const sums = Array(7).fill(0)
  const counts = Array(7).fill(0)
  for (const d of series) {
    const w = weekdayOf(d.day)
    sums[w] += d.sold
    counts[w] += 1
  }
  const data = WEEKDAYS.map((label, i) => ({ label, avg: counts[i] ? Math.round(sums[i] / counts[i]) : 0 }))
  const best = Math.max(...data.map((d) => d.avg))
  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -14, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="4 4" stroke="var(--border)" />
        <XAxis dataKey="label" tick={axisTick} />
        <YAxis allowDecimals={false} tick={axisTick} />
        <Tooltip contentStyle={tooltipStyle} formatter={(v) => [fmt.num(v), 'Média de vendas']} cursor={{ fill: 'rgba(139,92,246,0.08)' }} />
        <Bar dataKey="avg" radius={[6, 6, 0, 0]} maxBarSize={32}>
          {data.map((d) => (
            <Cell key={d.label} fill={d.avg === best && best > 0 ? '#a78bfa' : 'rgba(167,139,250,0.35)'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

function PriceChart({ history, product }) {
  if (!history || history.length === 0) return <EmptyChart text="Sem histórico de preço ainda." />
  if (history.length === 1) {
    const h = history[0]
    return (
      <div className="flex h-[180px] flex-col items-center justify-center gap-2 text-center">
        <p className="text-3xl font-bold text-amber-200">{fmt.money(h.salePrice ?? product.salePrice)}</p>
        <p className="text-sm text-[var(--text-muted)]">Preço do fornecedor sem alteração desde {fmt.day(h.at.slice(0, 10))}.</p>
        {h.suggestedPrice ? <p className="text-xs text-[var(--text-faint)]">Sugerido: {fmt.money(h.suggestedPrice)}</p> : null}
      </div>
    )
  }
  const data = [...history, { ...history[history.length - 1], at: new Date().toISOString().slice(0, 16) }]
  return (
    <ResponsiveContainer width="100%" height={180}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 6, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="4 4" stroke="var(--border)" />
        <XAxis dataKey="at" tickFormatter={(v) => fmt.dayShort(v.slice(0, 10))} tick={axisTick} />
        <YAxis tick={axisTick} tickFormatter={(v) => fmt.moneyCompact(v)} width={60} />
        <Tooltip
          contentStyle={tooltipStyle}
          labelFormatter={(v) => fmt.day(v.slice(0, 10))}
          formatter={(v, k) => [fmt.money(v), k === 'salePrice' ? 'Fornecedor' : 'Sugerido']}
        />
        <Line type="stepAfter" dataKey="salePrice" stroke="#fbbf24" strokeWidth={2.5} dot={false} />
        <Line type="stepAfter" dataKey="suggestedPrice" stroke="#a78bfa" strokeWidth={2} strokeDasharray="5 4" dot={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}

// ---------- calculadora ----------
function MoneyInput({ label, value, onChange, hint, readOnly }) {
  return (
    <label className="block">
      <span className="text-[11px] font-medium text-[var(--text-muted)]">{label}</span>
      <div className="relative mt-1">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs text-[var(--text-faint)]">$</span>
        <input
          inputMode="numeric"
          readOnly={readOnly}
          value={value ? fmt.num(value) : ''}
          onChange={(e) => onChange?.(Number(e.target.value.replace(/\D/g, '')) || 0)}
          className={`h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-surface-2)] pl-6 pr-2 text-sm font-semibold text-[var(--text-primary)] focus:border-brand-500 focus:outline-none ${
            readOnly ? 'opacity-70' : ''
          }`}
        />
      </div>
      {hint && <span className="text-[10px] text-[var(--text-faint)]">{hint}</span>}
    </label>
  )
}

// Frete e CPA iniciais da calculadora, na moeda de cada país.
const START_COSTS = { COP: 15000, MXN: 90, GTQ: 35, USD: 4, EUR: 4 }

function MarginCalculator({ product, dailyAverage }) {
  const cost = product.salePrice || 0
  const startCost = START_COSTS[currencyInfo().code] ?? START_COSTS.COP
  const [price, setPrice] = useState(product.suggestedPrice || Math.round(cost * 2.5))
  const [freight, setFreight] = useState(startCost)
  const [cpa, setCpa] = useState(startCost)
  const profit = price - cost - freight - cpa
  const margin = price ? profit / price : 0
  const maxCpa = price - cost - freight
  const good = profit > 0
  const monthlyOrders = Math.max(1, Math.round(dailyAverage * 0.1 * 30))
  return (
    <Section title="Calculadora de margem" subtitle="Simule seu lucro por pedido" icon={Calculator}>
      <div className="grid grid-cols-2 gap-2.5">
        <MoneyInput
          label="Seu preço de venda"
          value={price}
          onChange={setPrice}
          hint={product.suggestedPrice ? `sugerido ${fmt.money(product.suggestedPrice)}` : undefined}
        />
        <MoneyInput label="Custo do produto" value={cost} readOnly hint="preço do fornecedor" />
        <MoneyInput label="Frete" value={freight} onChange={setFreight} />
        <MoneyInput label="CPA (custo por venda)" value={cpa} onChange={setCpa} />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        <div className={`rounded-xl border p-2.5 ${good ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-red-500/30 bg-red-500/10'}`}>
          <p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Lucro/pedido</p>
          <p className={`text-base font-bold ${good ? 'text-emerald-300' : 'text-red-300'}`}>{fmt.money(profit)}</p>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface-2)] p-2.5">
          <p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Margem</p>
          <p className={`text-base font-bold ${good ? 'text-[var(--text-primary)]' : 'text-red-300'}`}>{Math.round(margin * 100)}%</p>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface-2)] p-2.5">
          <p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">CPA máximo</p>
          <p className="text-base font-bold text-sky-200">{fmt.money(Math.max(0, maxCpa))}</p>
        </div>
      </div>
      {dailyAverage > 0 && good && (
        <p className="mt-2.5 rounded-lg bg-brand-500/10 px-3 py-2 text-[11px] text-brand-100">
          Se você fizer <b>10%</b> das vendas desse produto ({fmt.num(monthlyOrders)} pedidos por mês), o lucro seria de cerca de{' '}
          <b>{fmt.money(Math.round(profit * monthlyOrders))}</b> por mês.
        </p>
      )}
    </Section>
  )
}

// ---------- fornecedor / categoria / parecidos ----------
function MiniKV({ label, value, tone = 'text-[var(--text-primary)]', hint }) {
  return (
    <div className="rounded-lg bg-[var(--bg-surface-2)] px-2.5 py-2">
      <p className="text-[10px] text-[var(--text-muted)]">{label}</p>
      <p className={`text-sm font-bold ${tone}`}>{value}</p>
      {hint && <p className="text-[9px] text-[var(--text-faint)]">{hint}</p>}
    </div>
  )
}

function SupplierCard({ supplier, category }) {
  if (!supplier && !category) return null
  return (
    <Section title="Fornecedor e categoria" icon={Store}>
      {supplier && (
        <div className="space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate font-semibold text-sky-200">{supplier.name || `Fornecedor ${supplier.id}`}</p>
            {supplier.rank && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-bold text-amber-200">
                {supplier.rank <= 3 ? <Crown size={11} /> : <Trophy size={11} />} #{fmt.num(supplier.rank)} de {fmt.num(supplier.ranked)}
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <MiniKV label="Produtos no catálogo" value={fmt.num(supplier.products)} />
            <MiniKV label="Produtos vendendo" value={fmt.num(supplier.selling)} />
            <MiniKV label="Vendas 7 dias" value={fmt.num(supplier.sold7d)} tone="text-emerald-300" />
            <MiniKV label="Vendas 30 dias" value={fmt.num(supplier.sold30d)} tone="text-emerald-300" />
            <MiniKV label="Ticket médio" value={fmt.money(supplier.ticket)} tone="text-amber-200" />
            <MiniKV
              label="Taxa de acerto"
              value={supplier.products ? `${Math.round((supplier.selling / supplier.products) * 100)}%` : '—'}
              hint="produtos que vendem"
            />
          </div>
        </div>
      )}
      {category && (
        <div className={`${supplier ? 'mt-3 border-t border-[var(--border)] pt-3' : ''} flex items-center justify-between gap-2`}>
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wide text-[var(--text-muted)]">Posição na categoria</p>
            <p className="truncate text-sm font-semibold text-violet-200">{category.name}</p>
          </div>
          <p className="shrink-0 text-right">
            <span className="text-xl font-bold text-[var(--text-primary)]">#{fmt.num(category.rank)}</span>
            <span className="block text-[10px] text-[var(--text-faint)]">de {fmt.num(category.selling)} vendendo</span>
          </p>
        </div>
      )}
    </Section>
  )
}

function SimilarProducts({ items, product, onOpen }) {
  return (
    <Section title="Produtos parecidos em outros fornecedores" subtitle="Compare preço, vendas e estoque antes de escolher" icon={Layers}>
      {items.length === 0 ? (
        <p className="py-4 text-center text-sm text-[var(--text-muted)]">Nenhum produto parecido encontrado.</p>
      ) : (
        <div className="space-y-2">
          {items.map((x) => {
            const diff = x.salePrice && product.salePrice ? (x.salePrice - product.salePrice) / product.salePrice : null
            return (
              <button
                key={x.id}
                type="button"
                onClick={() => onOpen(x.id)}
                className="flex w-full items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg-surface-2)] p-2.5 text-left transition-colors hover:border-brand-500/50"
              >
                <ProductThumb src={x.imageUrl} title={x.name} size="h-12 w-12" rounded="rounded-lg" />
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-1 text-sm font-semibold text-[var(--text-primary)]">{x.name}</p>
                  <p className="truncate text-[11px] text-sky-300">{x.supplierName || 'Fornecedor'}</p>
                </div>
                <div className="w-28 shrink-0 text-right">
                  <p className="text-sm font-bold text-amber-200">{fmt.money(x.salePrice)}</p>
                  {diff !== null && Math.abs(diff) >= 0.01 && (
                    <p className={`text-[10px] font-semibold ${diff < 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {diff < 0 ? '▼' : '▲'} {Math.abs(Math.round(diff * 100))}% {diff < 0 ? 'mais barato' : 'mais caro'}
                    </p>
                  )}
                </div>
                <div className="w-20 shrink-0 text-right">
                  <p className="text-sm font-bold text-emerald-300">{fmt.num(x.sold30d)}</p>
                  <p className="text-[10px] text-[var(--text-faint)]">vendas 30d</p>
                </div>
                <div className="hidden w-16 shrink-0 text-right sm:block">
                  <p className="text-sm font-semibold text-[var(--text-primary)]">{fmt.num(x.stock)}</p>
                  <p className="text-[10px] text-[var(--text-faint)]">estoque</p>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </Section>
  )
}

// ---------- detalhes por dia ----------
function DailyBreakdown({ series }) {
  const rows = [...series].reverse()
  const max = Math.max(1, ...series.map((d) => d.sold))
  return (
    <Section title="Detalhes por dia" subtitle="Vendas de cada dia do período" icon={CalendarDays}>
      {rows.length === 0 ? (
        <p className="py-4 text-center text-sm text-[var(--text-muted)]">Sem dias registrados ainda.</p>
      ) : (
        <div className="space-y-1.5">
          {rows.map((d, i) => {
            const prev = rows[i + 1]
            const change = prev && prev.sold ? Math.round(((d.sold - prev.sold) / prev.sold) * 100) : null
            const best = d.sold === max && d.sold > 0
            return (
              <div key={d.day} className="grid grid-cols-[96px_minmax(0,1fr)_70px_64px] items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-[var(--bg-surface-2)]">
                <div className="flex items-center gap-2">
                  <span className="w-9 rounded-md bg-[var(--bg-surface-2)] py-0.5 text-center text-[10px] font-semibold uppercase text-[var(--text-muted)]">
                    {fmt.weekday(d.day)}
                  </span>
                  <span className="text-xs font-medium text-[var(--text-primary)]">{fmt.dayShort(d.day)}</span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-[var(--bg-surface-2)]">
                  <div
                    className={`h-full rounded-full ${best ? 'bg-gradient-to-r from-amber-400 to-amber-300' : 'bg-gradient-to-r from-emerald-600 to-emerald-400'}`}
                    style={{ width: `${d.sold ? Math.max(4, (d.sold / max) * 100) : 0}%` }}
                  />
                </div>
                <p className={`text-right text-sm font-bold ${d.sold ? (best ? 'text-amber-200' : 'text-emerald-300') : 'text-[var(--text-faint)]'}`}>
                  {best && <Trophy size={11} className="mr-1 inline" />}
                  {fmt.num(d.sold)}
                </p>
                <p
                  className={`text-right text-[11px] font-semibold ${
                    change === null ? 'text-[var(--text-faint)]' : change >= 0 ? 'text-emerald-400' : 'text-red-400'
                  }`}
                >
                  {change === null ? '—' : `${change >= 0 ? '▲' : '▼'} ${Math.abs(change)}%`}
                </p>
              </div>
            )
          })}
        </div>
      )}
    </Section>
  )
}

function PriceChip({ icon: Icon, label, value, tone }) {
  const tones = {
    amber: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
    violet: 'border-violet-500/30 bg-violet-500/10 text-violet-200',
    emerald: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
    rose: 'border-rose-500/30 bg-rose-500/10 text-rose-200',
    sky: 'border-sky-500/30 bg-sky-500/10 text-sky-200',
  }
  return (
    <div className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 ${tones[tone]}`}>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/5 ring-1 ring-white/10">
        <Icon size={15} />
      </span>
      <div className="min-w-0">
        <p className="truncate text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">{label}</p>
        <p className="truncate text-lg font-bold leading-tight">{value}</p>
      </div>
    </div>
  )
}

// ---------- modal ----------
export default function ProductHistoryModal({ productId, onClose, onOpenSupplier }) {
  const [currentId, setCurrentId] = useState(productId)
  const [days, setDays] = useState(30)
  const [view, setView] = useState('resumo')
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const country = useCountry()

  useEffect(() => {
    setError(null)
    rawApi
      .radarProduct(currentId, days, country)
      .then(setData)
      .catch((e) => setError(e.message))
  }, [currentId, days, country])

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const p = data?.product
  const s = data?.stats
  const trend = s ? TREND[s.trend] : null
  const platformName = ({ mastershop: 'Mastershop', dropi: 'Dropi', dropea: 'Dropea' })[p?.platform] || 'DropLatam'
  const margin = p?.suggestedPrice && p?.salePrice ? Math.round(((p.suggestedPrice - p.salePrice) / p.suggestedPrice) * 100) : null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-3 backdrop-blur-sm" onClick={onClose}>
      <div
        className="sx-scroll max-h-[94vh] w-full max-w-[1400px] overflow-y-auto rounded-3xl border border-[var(--border)] bg-[var(--bg-app,var(--bg-surface))] shadow-2xl shadow-black/60"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] bg-[var(--bg-surface)]/95 px-5 py-3.5 backdrop-blur">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-400 text-white shadow-lg shadow-brand-500/30">
              <LineIcon size={20} />
            </span>
            <div>
              <h3 className="font-semibold">Análise completa do produto</h3>
              <p className="text-xs text-[var(--text-muted)]">Vendas, fornecedor, preço e concorrência</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <PeriodPicker value={days} onChange={setDays} options={PERIODS} />
            <button type="button" onClick={onClose} className="rounded-lg p-2 text-[var(--text-muted)] hover:bg-[var(--hover-surface)]">
              <X size={18} />
            </button>
          </div>
        </div>

        {error && <p className="p-6 text-sm text-red-400">{error}</p>}
        {!data && !error && <p className="py-24 text-center text-sm text-[var(--text-muted)]">Carregando análise…</p>}

        {p && (
          <div className="space-y-4 p-5">
            <div className="relative overflow-hidden rounded-3xl border border-[var(--border)] bg-[var(--bg-surface)] p-5">
              <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-brand-500/15 blur-3xl" />
              <div className="relative flex flex-col gap-5 md:flex-row">
                <div className="shrink-0">
                  <ProductThumb src={p.imageUrl} title={p.name} size="h-36 w-36" rounded="rounded-2xl" />
                </div>
                <div className="min-w-0 flex-1">
                  {/* etiquetas */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--bg-surface-2)] px-2.5 py-1 text-[11px] font-medium">
                      {currentCountry().flag} <PlatformLogo platform={p.platform} className="h-3.5 w-3.5" /> {platformName}
                    </span>
                    <CopyId id={p.dropiId} className="!py-1 !text-[11px]" />
                    {p.categories?.split(', ').slice(0, 2).map((c) => (
                      <span key={c} className="inline-flex items-center gap-1 rounded-full bg-violet-500/10 px-2.5 py-1 text-[11px] font-medium text-violet-300">
                        <Tag size={10} /> {c}
                      </span>
                    ))}
                  </div>

                  {/* nome + fornecedor */}
                  <h4 className="mt-2.5 text-2xl font-bold leading-tight">{p.name}</h4>
                  {p.supplierName && (
                    <button
                      type="button"
                      onClick={() => onOpenSupplier?.(p.supplierId, p.supplierName)}
                      className="group mt-2 inline-flex items-center gap-2 rounded-full border border-sky-500/30 bg-sky-500/10 py-1 pl-1 pr-3 text-sm font-semibold text-sky-200 transition-colors hover:border-sky-400/60 hover:bg-sky-500/20"
                    >
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-sky-500/25">
                        <Store size={13} />
                      </span>
                      {p.supplierName}
                      <span className="text-[11px] font-medium text-sky-300/80 group-hover:text-sky-200">Ver catálogo do fornecedor →</span>
                    </button>
                  )}

                  {/* preços e estoque, em 4 colunas iguais */}
                  <div className="mt-3.5 grid grid-cols-2 gap-2 lg:grid-cols-4">
                    <PriceChip icon={DollarSign} label="Preço fornecedor" value={fmt.money(p.salePrice)} tone="amber" />
                    <PriceChip icon={Tag} label="Preço sugerido" value={p.suggestedPrice ? fmt.money(p.suggestedPrice) : '—'} tone="violet" />
                    <PriceChip
                      icon={TrendingUp}
                      label="Margem bruta"
                      value={margin !== null ? `${margin}%` : '—'}
                      tone={margin === null ? 'violet' : margin >= 50 ? 'emerald' : 'rose'}
                    />
                    <PriceChip icon={Package} label="Estoque" value={fmt.num(p.stock)} tone="sky" />
                  </div>

                  {/* tendência, recorde e link */}
                  <div className="mt-3.5 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      {trend && (
                        <span className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--border)] bg-[var(--bg-surface-2)] px-3 py-1.5 text-xs">
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Tendência</span>
                          <trend.Icon size={14} className={trend.cls} />
                          <b className={trend.cls}>{trend.label}</b>
                        </span>
                      )}
                      {s.record && (
                        <span className="inline-flex items-center gap-1.5 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-1.5 text-xs">
                          <Trophy size={14} className="text-amber-400" />
                          <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--text-muted)]">Recorde</span>
                          <b className="text-amber-200">{fmt.num(s.record.sold)} un.</b>
                          <span className="text-[var(--text-faint)]">em {longDate(s.record.day)}</span>
                        </span>
                      )}
                    </div>
                    {p.productUrl && (
                      <a
                        href={p.productUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-emerald-500/25 hover:brightness-110"
                      >
                        <PlatformLogo platform={p.platform} className="h-4 w-4" /> Ver na {platformName} <ExternalLink size={14} />
                      </a>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* 3 abas pra não mostrar tudo de uma vez: abre sempre no Resumo */}
            <div className="flex flex-wrap gap-1 rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-1.5">
              {[
                { key: 'resumo', label: 'Resumo', Icon: Gauge, hint: 'veredito e vendas' },
                { key: 'detalhes', label: 'Detalhes', Icon: BarChart3, hint: 'gráficos, preço e dia a dia' },
                { key: 'concorrencia', label: 'Concorrência', Icon: Layers, hint: 'fornecedor, parecidos e margem' },
              ].map(({ key, label, Icon, hint }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setView(key)}
                  className={`flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors ${
                    view === key ? 'bg-brand-500 text-white shadow' : 'text-[var(--text-tertiary)] hover:bg-[var(--hover-surface)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  <Icon size={16} /> {label}
                  <span className={`hidden text-[11px] font-normal md:inline ${view === key ? 'text-brand-100' : 'text-[var(--text-faint)]'}`}>· {hint}</span>
                </button>
              ))}
            </div>

            {view === 'resumo' && (
              <>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                  <Stat icon={BarChart3} label="Vendas" value={fmt.num(s.total)} sub={`últimos ${days} dias`} tone="emerald" />
                  <Stat icon={Activity} label="Média diária" value={fmt.num(s.dailyAverage)} sub="vendas por dia" tone="brand" />
                  <Stat icon={Trophy} label="Máximo diário" value={fmt.num(s.maxDaily)} sub="no período" tone="amber" />
                  <Stat icon={CalendarDays} label="Frequência" value={`${s.frequency}%`} sub={`${s.activeDays} de ${s.trackedDays} dias`} tone="violet" />
                  <Stat icon={Boxes} label="Estoque dura" value={stockDaysLabel(s.stockDays)} sub="no ritmo atual" tone="sky" />
                  <Stat icon={DollarSign} label="Faturamento" value={fmt.moneyCompact(s.revenue)} sub="estimado no período" tone="rose" />
                </div>
                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
                  <Section title="Vendas por dia" subtitle={`Últimos ${days} dias, com a média do período`} icon={BarChart3}>
                    <SalesChart series={data.series} average={s.dailyAverage} />
                  </Section>
                  <Diagnosis data={data} />
                </div>
              </>
            )}

            {view === 'detalhes' && (
              <>
                <div className="grid gap-4 md:grid-cols-2">
                  <Section title="Vendas acumuladas" icon={TrendingUp}>
                    <CumulativeChart series={data.series} />
                  </Section>
                  <Section title="Melhor dia da semana" subtitle="Média de vendas por dia da semana" icon={CalendarDays}>
                    <WeekdayChart series={data.series} />
                  </Section>
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  <Section title="Histórico de preço" subtitle="Preço do fornecedor (linha cheia) e sugerido (tracejada)" icon={DollarSign}>
                    <PriceChart history={data.priceHistory} product={p} />
                  </Section>
                  <DailyBreakdown series={data.series} />
                </div>
              </>
            )}

            {view === 'concorrencia' && (
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
                <SimilarProducts items={data.similar} product={p} onOpen={(id) => { setCurrentId(id); setView('resumo') }} />
                <div className="space-y-4">
                  <SupplierCard supplier={data.supplier} category={data.category} />
                  <MarginCalculator key={p.id} product={p} dailyAverage={s.dailyAverage} />
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

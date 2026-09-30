import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { ArrowUpDown, BarChart3, Boxes, Check, ChevronDown, ChevronRight, Copy, Crown, DollarSign, Search, SlidersHorizontal, Store, Tag, TrendingUp, X } from 'lucide-react'
import { rawApi } from '../../api/rawClient.js'
import ProductThumb from '../../components/ProductThumb.jsx'
import droplatamLogo from '../../assets/platform-droplatam.png'
import dropiLogo from '../../assets/platform-dropi.png'
import dropeaLogo from '../../assets/platform-dropea.png'
import mastershopLogo from '../../assets/platform-mastershop.png'

// Plataforma selecionada no topo do Radar ('co' = DropLatam, 'dp-co' = Dropi,
// mesmos dados da DropLatam com link da Dropi; 'ms-co' = Mastershop).
// As abas são remontadas (key) quando ela muda, então cada busca usa a atual.
export const PlatformContext = createContext('co')
export function useCountry() {
  return useContext(PlatformContext)
}

// Abre o painel de um fornecedor (id, nome) de qualquer lugar do Radar.
export const SupplierContext = createContext(null)
export function useOpenSupplier() {
  return useContext(SupplierContext)
}

// Nome do fornecedor clicável: abre o catálogo dele.
export function SupplierLink({ id, name, className = '' }) {
  const open = useOpenSupplier()
  if (!name) return null
  const clickable = Boolean(open && id)
  return (
    <button
      type="button"
      disabled={!clickable}
      title={clickable ? `Ver todos os produtos de ${name}` : undefined}
      onClick={(e) => {
        e.stopPropagation()
        if (clickable) open(id, name)
      }}
      className={`inline-flex max-w-full items-center gap-1 truncate text-[11px] font-medium text-sky-300 ${
        clickable ? 'hover:text-sky-200 hover:underline' : ''
      } ${className}`}
    >
      <Store size={11} className="shrink-0" />
      <span className="truncate">{name}</span>
    </button>
  )
}
// Plataformas de cada país (código da Operação da ScoutX). DropLatam e Dropi
// usam os mesmos dados no país; a Dropi ('dp-<país>') só troca link e logo.
const PLATFORMS_BY_COUNTRY = {
  co: [
    { value: 'co', label: 'DropLatam', logo: droplatamLogo, kind: 'droplatam' },
    { value: 'dp-co', label: 'Dropi', logo: dropiLogo, kind: 'dropi' },
    { value: 'ms-co', label: 'Mastershop', logo: mastershopLogo, kind: 'mastershop' },
  ],
  mx: [
    { value: 'mx', label: 'DropLatam', logo: droplatamLogo, kind: 'droplatam' },
    { value: 'dp-mx', label: 'Dropi', logo: dropiLogo, kind: 'dropi' },
  ],
  gt: [
    { value: 'gt', label: 'DropLatam', logo: droplatamLogo, kind: 'droplatam' },
    { value: 'dp-gt', label: 'Dropi', logo: dropiLogo, kind: 'dropi' },
  ],
  ec: [
    { value: 'ec', label: 'DropLatam', logo: droplatamLogo, kind: 'droplatam' },
    { value: 'dp-ec', label: 'Dropi', logo: dropiLogo, kind: 'dropi' },
  ],
  // Espanha: a DropLatam de lá é outro sistema (não a Dropi) e a Dropea também.
  es: [
    { value: 'dl-es', label: 'DropLatam', logo: droplatamLogo, kind: 'droplatam' },
    { value: 'de-es', label: 'Dropea', logo: dropeaLogo, kind: 'dropea' },
  ],
}
export function platformsFor(countryCode) {
  return PLATFORMS_BY_COUNTRY[countryCode] || []
}
// Todas (pra achar logo/nome por valor em qualquer lugar).
export const PLATFORMS = Object.values(PLATFORMS_BY_COUNTRY).flat()

// Moeda de cada país. O Radar mostra um país por vez, então a página troca a
// moeda ao mudar de país (setCurrencyFor) e todo fmt.money acompanha.
const CURRENCIES = {
  co: { code: 'COP', locale: 'es-CO', digits: 0, symbol: '$' },
  mx: { code: 'MXN', locale: 'es-MX', digits: 0, symbol: '$' },
  gt: { code: 'GTQ', locale: 'es-GT', digits: 0, symbol: 'Q' },
  ec: { code: 'USD', locale: 'es-EC', digits: 2, symbol: 'US$' },
  es: { code: 'EUR', locale: 'es-ES', digits: 2, symbol: '€' },
}
function moneyFormatter(cc) {
  const c = CURRENCIES[cc] || CURRENCIES.co
  return { ...c, nf: new Intl.NumberFormat(c.locale, { style: 'currency', currency: c.code, maximumFractionDigits: c.digits }) }
}
let currency = moneyFormatter('co')
const COUNTRY_NAMES = {
  co: { flag: '🇨🇴', label: 'Colômbia' },
  mx: { flag: '🇲🇽', label: 'México' },
  gt: { flag: '🇬🇹', label: 'Guatemala' },
  ec: { flag: '🇪🇨', label: 'Equador' },
  es: { flag: '🇪🇸', label: 'Espanha' },
}
let country = COUNTRY_NAMES.co
export function setCurrencyFor(countryCode) {
  country = COUNTRY_NAMES[countryCode] || COUNTRY_NAMES.co
  if (currency.code !== (CURRENCIES[countryCode] || CURRENCIES.co).code) currency = moneyFormatter(countryCode)
}
// Bandeira e nome do país aberto no Radar.
export function currentCountry() {
  return country
}
export function currencyInfo() {
  return currency
}
const num = new Intl.NumberFormat('pt-BR')
const compact = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 })

export const fmt = {
  money: (v) => (v === null || v === undefined ? '—' : currency.nf.format(v)),
  moneyCompact: (v) => (v === null || v === undefined ? '—' : `${currency.symbol} ${compact.format(v)}`),
  num: (v) => (v === null || v === undefined ? '—' : num.format(v)),
  day: (iso) => {
    if (!iso) return '—'
    const [y, m, d] = iso.split('-')
    return `${d}/${m}/${y.slice(2)}`
  },
  dayShort: (iso) => {
    const [, m, d] = iso.split('-')
    return `${d}/${m}`
  },
  month: (iso) => {
    const [y, m, d] = iso.split('-').map(Number)
    return new Date(y, m - 1, d).toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')
  },
  weekday: (iso) => {
    const [y, m, d] = iso.split('-').map(Number)
    return new Date(y, m - 1, d).toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '')
  },
}

// Chama o fetcher sempre que `deps` mudam; só a resposta mais recente vale
// (mesma trava de HotProducts.jsx contra resposta antiga sobrescrever a nova).
export function useLatest(fetcher, deps) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const idRef = useRef(0)
  function run() {
    const id = ++idRef.current
    setLoading(true)
    return fetcher()
      .then((d) => {
        if (id !== idRef.current) return
        setData(d)
        setError(null)
      })
      .catch((e) => id === idRef.current && setError(e.message))
      .finally(() => id === idRef.current && setLoading(false))
  }
  useEffect(() => {
    run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return { data, error, loading, reload: run }
}

function useClickOutside(ref, onOutside) {
  useEffect(() => {
    function onDown(e) {
      if (ref.current && !ref.current.contains(e.target)) onOutside()
    }
    function onKey(e) {
      if (e.key === 'Escape') onOutside()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [ref, onOutside])
}

// ---------- controles ----------

export function Segmented({ value, onChange, options }) {
  return (
    <div className="inline-flex rounded-xl border border-[var(--border)] bg-[var(--bg-surface-2)] p-1">
      {options.map((o) => {
        const opt = typeof o === 'object' ? o : { value: o, label: `${o}D` }
        const active = value === opt.value
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              active ? 'bg-brand-500 text-white shadow' : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
            }`}
          >
            {opt.logo && <img src={opt.logo} alt="" className="h-4 w-4 rounded" />}
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

export const PeriodPicker = Segmented

// Seletor de plataforma do cabeçalho: brilho atrás do bloco e o botão ativo
// aceso na cor da plataforma.
const PLATFORM_GLOW = {
  droplatam: {
    on: 'from-indigo-500 to-blue-500 shadow-[0_0_22px_rgba(79,110,255,0.65)] ring-1 ring-indigo-300/50',
    dot: 'bg-sky-300',
    box: 'border-indigo-400/50 shadow-[0_0_28px_rgba(79,110,255,0.45),inset_0_0_18px_rgba(79,110,255,0.12)]',
  },
  dropi: {
    on: 'from-orange-500 to-amber-500 shadow-[0_0_22px_rgba(249,115,22,0.6)] ring-1 ring-orange-300/50',
    dot: 'bg-amber-200',
    box: 'border-orange-400/50 shadow-[0_0_28px_rgba(249,115,22,0.4),inset_0_0_18px_rgba(249,115,22,0.12)]',
  },
  dropea: {
    on: 'from-fuchsia-600 to-violet-600 shadow-[0_0_22px_rgba(192,38,211,0.6)] ring-1 ring-fuchsia-300/50',
    dot: 'bg-fuchsia-200',
    box: 'border-fuchsia-400/50 shadow-[0_0_28px_rgba(192,38,211,0.4),inset_0_0_18px_rgba(192,38,211,0.12)]',
  },
  mastershop: {
    on: 'from-emerald-500 to-green-500 shadow-[0_0_22px_rgba(16,185,129,0.6)] ring-1 ring-emerald-300/50',
    dot: 'bg-emerald-200',
    box: 'border-emerald-400/50 shadow-[0_0_28px_rgba(16,185,129,0.4),inset_0_0_18px_rgba(16,185,129,0.12)]',
  },
}
export function PlatformSwitcher({ value, onChange, options }) {
  const current = options.find((o) => o.value === value)
  const glow = PLATFORM_GLOW[current?.kind] || PLATFORM_GLOW.droplatam
  return (
    <div className="relative">
      <div className={`relative inline-flex gap-1 rounded-2xl border bg-[var(--bg-surface)] p-1.5 transition-all duration-500 ${glow.box}`}>
        {options.map((o) => {
          const active = value === o.value
          const g = PLATFORM_GLOW[o.kind] || PLATFORM_GLOW.droplatam
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => onChange(o.value)}
              className={`relative inline-flex items-center gap-2 whitespace-nowrap rounded-xl px-4 py-2 text-sm font-semibold transition-all duration-300 ${
                active ? `bg-gradient-to-r ${g.on} text-white` : 'text-[var(--text-tertiary)] hover:bg-white/5 hover:text-[var(--text-primary)]'
              }`}
            >
              {o.logo && <img src={o.logo} alt="" className={`h-5 w-5 rounded-md ${active ? 'bg-white p-0.5 ring-2 ring-white/80 shadow-md shadow-black/30' : 'opacity-80'}`} />}
              {o.label}
              {active && (
                <span className="relative ml-0.5 flex h-2 w-2">
                  <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${g.dot} opacity-75`} />
                  <span className={`relative inline-flex h-2 w-2 rounded-full ${g.dot}`} />
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function PlatformLogo({ platform, className = 'h-4 w-4' }) {
  const p = PLATFORMS.find((x) => x.value === platform || x.label.toLowerCase() === String(platform).toLowerCase())
  return p ? <img src={p.logo} alt={p.label} className={`${className} rounded`} /> : null
}

// Botão que abre um painel flutuante (base dos filtros).
export function Popover({ label, icon: Icon, active, children, width = 'w-72', align = 'left' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useClickOutside(ref, () => setOpen(false))
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`inline-flex h-11 items-center gap-2 rounded-xl border px-3.5 text-sm font-medium transition-colors ${
          active
            ? 'border-brand-500/60 bg-brand-500/15 text-[var(--text-primary)]'
            : 'border-[var(--border)] bg-[var(--bg-surface-2)] text-[var(--text-tertiary)] hover:border-brand-500/40 hover:text-[var(--text-primary)]'
        }`}
      >
        {Icon && <Icon size={15} className={active ? 'text-brand-400' : ''} />}
        <span className="max-w-[180px] truncate">{label}</span>
        <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div
          className={`absolute z-40 mt-2 ${width} ${align === 'right' ? 'right-0' : 'left-0'} rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-3 shadow-2xl shadow-black/50`}
        >
          {typeof children === 'function' ? children(() => setOpen(false)) : children}
        </div>
      )}
    </div>
  )
}

function OptionButton({ selected, onClick, children, hint }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
        selected ? 'bg-brand-500/15 text-[var(--text-primary)]' : 'text-[var(--text-tertiary)] hover:bg-[var(--hover-surface)] hover:text-[var(--text-primary)]'
      }`}
    >
      <span className="truncate">{children}</span>
      <span className="flex shrink-0 items-center gap-2">
        {hint && <span className="text-[11px] text-[var(--text-faint)]">{hint}</span>}
        {selected && <Check size={14} className="text-brand-400" />}
      </span>
    </button>
  )
}

// Seletor de ordenação. Cada opção pode ter ícone (icon), explicação (hint),
// cor do ícone (tone) e grupo (group), que vira um título pequeno no menu.
const SORT_TONES = {
  emerald: 'bg-emerald-500/15 text-emerald-300',
  rose: 'bg-rose-500/15 text-rose-300',
  amber: 'bg-amber-500/15 text-amber-300',
  violet: 'bg-violet-500/15 text-violet-300',
  sky: 'bg-sky-500/15 text-sky-300',
  brand: 'bg-brand-500/15 text-brand-300',
}
export function SortMenu({ value, onChange, options }) {
  const current = options.find((o) => o.value === value) || options[0]
  const CurrentIcon = current.icon || ArrowUpDown
  return (
    <Popover label={current.label} icon={CurrentIcon} width="w-80" align="right">
      {(close) => (
        <div>
          <p className="px-2 pb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">Ordenar por</p>
          <div className="space-y-0.5">
            {options.map((o, i) => {
              const Icon = o.icon || ArrowUpDown
              const selected = o.value === current.value
              const newGroup = o.group && o.group !== options[i - 1]?.group
              return (
                <div key={o.value}>
                  {newGroup && i > 0 && <div className="my-1.5 border-t border-[var(--border)]" />}
                  {newGroup && <p className="px-2 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--text-faint)]">{o.group}</p>}
                  <button
                    type="button"
                    onClick={() => {
                      onChange(o.value)
                      close()
                    }}
                    className={`flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors ${
                      selected ? 'bg-brand-500/15 ring-1 ring-brand-500/40' : 'hover:bg-[var(--hover-surface)]'
                    }`}
                  >
                    <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${SORT_TONES[o.tone] || SORT_TONES.brand}`}>
                      <Icon size={15} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-sm font-medium ${selected ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>{o.label}</span>
                      {o.hint && <span className="block truncate text-[11px] text-[var(--text-faint)]">{o.hint}</span>}
                    </span>
                    {selected && <Check size={15} className="shrink-0 text-brand-400" />}
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </Popover>
  )
}

const inputCls =
  'w-full rounded-lg border border-[var(--border)] bg-[var(--bg-surface-2)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-brand-500 focus:outline-none'

// Faixas de preço de cada moeda (preço do fornecedor).
const PRICE_STEPS = { COP: [20000, 50000, 100000], MXN: [100, 250, 500], GTQ: [50, 150, 300], USD: [5, 15, 30], EUR: [5, 15, 30] }
function pricePresets() {
  const [a, b, c] = PRICE_STEPS[currencyInfo().code] || PRICE_STEPS.COP
  const m = (v) => fmt.moneyCompact(v)
  return [
    { label: `Até ${m(a)}`, min: undefined, max: a },
    { label: `${m(a)} a ${m(b)}`, min: a, max: b },
    { label: `${m(b)} a ${m(c)}`, min: b, max: c },
    { label: `Acima de ${m(c)}`, min: c, max: undefined },
  ]
}
const STOCK_PRESETS = [1, 50, 100, 500, 1000]
const SALES_PRESETS = [10, 50, 100, 500, 1000]

function PriceFilter({ value, onChange }) {
  const [min, setMin] = useState(value.min_price || '')
  const [max, setMax] = useState(value.max_price || '')
  useEffect(() => {
    setMin(value.min_price || '')
    setMax(value.max_price || '')
  }, [value.min_price, value.max_price])
  const active = value.min_price || value.max_price
  const label = active
    ? `${value.min_price ? fmt.moneyCompact(value.min_price) : fmt.moneyCompact(0)} a ${value.max_price ? fmt.moneyCompact(value.max_price) : 'sem limite'}`
    : 'Preço'
  return (
    <Popover label={label} icon={DollarSign} active={active}>
      {(close) => (
        <div className="space-y-3">
          <div className="space-y-0.5">
            {pricePresets().map((p) => (
              <OptionButton
                key={p.label}
                selected={value.min_price === p.min && value.max_price === p.max}
                onClick={() => {
                  onChange({ ...value, min_price: p.min, max_price: p.max })
                  close()
                }}
              >
                {p.label}
              </OptionButton>
            ))}
          </div>
          <div className="border-t border-[var(--border)] pt-3">
            <p className="mb-2 text-xs text-[var(--text-muted)]">Faixa personalizada ({currencyInfo().code})</p>
            <div className="flex items-center gap-2">
              <input className={inputCls} inputMode="numeric" placeholder="Mín." value={min} onChange={(e) => setMin(e.target.value.replace(/\D/g, ''))} />
              <span className="text-[var(--text-faint)]">a</span>
              <input className={inputCls} inputMode="numeric" placeholder="Máx." value={max} onChange={(e) => setMax(e.target.value.replace(/\D/g, ''))} />
            </div>
            <button
              type="button"
              onClick={() => {
                onChange({ ...value, min_price: min ? Number(min) : undefined, max_price: max ? Number(max) : undefined })
                close()
              }}
              className="mt-2 w-full rounded-lg bg-brand-500 py-2 text-sm font-semibold text-white hover:bg-brand-600"
            >
              Aplicar
            </button>
          </div>
        </div>
      )}
    </Popover>
  )
}

function PresetFilter({ label, icon, field, presets, suffix, value, onChange }) {
  const current = value[field]
  return (
    <Popover label={current ? `${label}: ${fmt.num(current)}+` : label} icon={icon} active={Boolean(current)} width="w-56">
      {(close) => (
        <div className="space-y-0.5">
          <OptionButton
            selected={!current}
            onClick={() => {
              onChange({ ...value, [field]: undefined })
              close()
            }}
          >
            Qualquer
          </OptionButton>
          {presets.map((n) => (
            <OptionButton
              key={n}
              selected={current === n}
              onClick={() => {
                onChange({ ...value, [field]: n })
                close()
              }}
            >
              {fmt.num(n)}+ {suffix}
            </OptionButton>
          ))}
        </div>
      )}
    </Popover>
  )
}

function CategoryFilter({ categories, value, onChange }) {
  const [q, setQ] = useState('')
  const list = (categories || []).filter((c) => c.name.toLowerCase().includes(q.toLowerCase()))
  return (
    <Popover label={value.category || 'Categoria'} icon={Tag} active={Boolean(value.category)}>
      {(close) => (
        <div className="space-y-2">
          <input className={inputCls} placeholder="Buscar categoria…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          <div className="sx-scroll max-h-64 space-y-0.5 overflow-auto">
            <OptionButton
              selected={!value.category}
              onClick={() => {
                onChange({ ...value, category: undefined })
                close()
              }}
            >
              Todas as categorias
            </OptionButton>
            {list.map((c) => (
              <OptionButton
                key={c.name}
                selected={value.category === c.name}
                hint={fmt.num(c.n)}
                onClick={() => {
                  onChange({ ...value, category: c.name })
                  close()
                }}
              >
                {c.name}
              </OptionButton>
            ))}
          </div>
        </div>
      )}
    </Popover>
  )
}

function SupplierFilter({ value, onChange }) {
  const country = useCountry()
  const [q, setQ] = useState('')
  const [options, setOptions] = useState([])
  useEffect(() => {
    if (q.trim().length < 2) return setOptions([])
    const t = setTimeout(() => rawApi.radarSearchSuppliers(country, q.trim()).then(setOptions).catch(() => {}), 300)
    return () => clearTimeout(t)
  }, [q])
  return (
    <Popover label={value.supplier_name || 'Fornecedor'} icon={Store} active={Boolean(value.supplier_id)}>
      {(close) => (
        <div className="space-y-2">
          <input className={inputCls} placeholder="Digite o nome do fornecedor…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
          <div className="sx-scroll max-h-64 space-y-0.5 overflow-auto">
            {value.supplier_id && (
              <OptionButton
                selected={false}
                onClick={() => {
                  onChange({ ...value, supplier_id: undefined, supplier_name: undefined })
                  close()
                }}
              >
                Todos os fornecedores
              </OptionButton>
            )}
            {q.trim().length < 2 && <p className="px-3 py-2 text-xs text-[var(--text-faint)]">Digite pelo menos 2 letras.</p>}
            {options.map((s) => (
              <OptionButton
                key={s.id}
                selected={value.supplier_id === s.id}
                hint={`${fmt.num(s.products)} prod.`}
                onClick={() => {
                  onChange({ ...value, supplier_id: s.id, supplier_name: s.name })
                  close()
                }}
              >
                {s.name}
              </OptionButton>
            ))}
          </div>
        </div>
      )}
    </Popover>
  )
}

// Barra de filtros comum às abas de produto. `value` é o objeto de filtros e
// `onChange` recebe o objeto inteiro já atualizado. `showMinSales` liga o
// filtro de vendas mínimas (só nas abas que têm período de vendas).
export function FiltersBar({ value, onChange, categories, showMinSales }) {
  const [q, setQ] = useState(value.q || '')
  // Filtros ficam escondidos atrás do botão "Filtros" (menos coisa na tela).
  const [open, setOpen] = useState(false)
  useEffect(() => setQ(value.q || ''), [value.q])
  useEffect(() => {
    const t = setTimeout(() => {
      if ((value.q || '') !== q.trim()) onChange({ ...value, q: q.trim() || undefined })
    }, 400)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q])

  const chips = []
  if (value.category) chips.push({ key: 'category', label: value.category, clear: { category: undefined } })
  if (value.supplier_id) chips.push({ key: 'supplier', label: value.supplier_name || 'Fornecedor', clear: { supplier_id: undefined, supplier_name: undefined } })
  if (value.min_price || value.max_price)
    chips.push({
      key: 'price',
      label: `Preço ${value.min_price ? fmt.moneyCompact(value.min_price) : fmt.moneyCompact(0)} a ${value.max_price ? fmt.moneyCompact(value.max_price) : 'sem limite'}`,
      clear: { min_price: undefined, max_price: undefined },
    })
  if (value.min_stock) chips.push({ key: 'stock', label: `Estoque ${fmt.num(value.min_stock)}+`, clear: { min_stock: undefined } })
  if (showMinSales && value.min_sales) chips.push({ key: 'sales', label: `Vendas ${fmt.num(value.min_sales)}+`, clear: { min_sales: undefined } })

  return (
    <div className="relative overflow-visible rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-3 shadow-sm">
      <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl">
        <div className="absolute -left-10 -top-16 h-32 w-64 rounded-full bg-brand-500/10 blur-3xl" />
      </div>
      <div className="relative flex flex-wrap items-center gap-2">
        <div className="relative min-w-[260px] flex-1">
          <span className="pointer-events-none absolute left-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg bg-brand-500/15 text-brand-300">
            <Search size={15} strokeWidth={2.5} />
          </span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar produto, fornecedor ou ID…"
            className="h-11 w-full rounded-xl border border-[var(--border)] bg-[var(--bg-surface-2)] pl-11 pr-9 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] transition-shadow focus:border-brand-500 focus:shadow-[0_0_0_3px_rgba(59,130,246,0.18)] focus:outline-none"
          />
          {q && (
            <button type="button" onClick={() => setQ('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)] hover:text-[var(--text-primary)]">
              <X size={14} />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className={`inline-flex h-11 items-center gap-2 rounded-xl border px-4 text-sm font-semibold transition-colors ${
            open || chips.length
              ? 'border-brand-500/60 bg-brand-500/15 text-[var(--text-primary)]'
              : 'border-[var(--border)] bg-[var(--bg-surface-2)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
          }`}
        >
          <SlidersHorizontal size={15} className="text-brand-400" /> Filtros
          {chips.length > 0 && <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-500 px-1.5 text-[11px] text-white">{chips.length}</span>}
          <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>
      {open && (
        <div className="relative mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-3">
          <CategoryFilter categories={categories} value={value} onChange={onChange} />
          <SupplierFilter value={value} onChange={onChange} />
          <PriceFilter value={value} onChange={onChange} />
          <PresetFilter label="Estoque" icon={Boxes} field="min_stock" presets={STOCK_PRESETS} suffix="unidades" value={value} onChange={onChange} />
          {showMinSales && (
            <PresetFilter label="Vendas" icon={TrendingUp} field="min_sales" presets={SALES_PRESETS} suffix="vendas no período" value={value} onChange={onChange} />
          )}
        </div>
      )}
      {chips.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-3">
          {chips.map((c) => (
            <span key={c.key} className="inline-flex items-center gap-1.5 rounded-full border border-brand-500/40 bg-brand-500/10 py-1 pl-3 pr-1.5 text-xs text-[var(--text-primary)]">
              {c.label}
              <button type="button" onClick={() => onChange({ ...value, ...c.clear })} className="rounded-full p-0.5 hover:bg-brand-500/30">
                <X size={12} />
              </button>
            </span>
          ))}
          <button type="button" onClick={() => onChange({})} className="text-xs font-medium text-[var(--text-muted)] underline-offset-2 hover:text-[var(--text-primary)] hover:underline">
            Limpar tudo
          </button>
        </div>
      )}
    </div>
  )
}

// Converte o objeto de filtros da barra nos parâmetros da API.
export function filterParams(f) {
  return {
    q: f.q,
    category: f.category,
    supplier_id: f.supplier_id,
    min_price: f.min_price,
    max_price: f.max_price,
    min_stock: f.min_stock,
    min_sales: f.min_sales,
  }
}

// ---------- produto ----------

export function CopyId({ id, className = '' }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        navigator.clipboard?.writeText(id).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        })
      }}
      title="Copiar ID"
      className={`inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--bg-surface-2)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--text-tertiary)] transition-colors hover:border-brand-500/50 hover:text-brand-300 ${className}`}
    >
      #{id}
      {copied ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
    </button>
  )
}

// Medalha de posição (ouro/prata/bronze). O 1º lugar ganha uma coroa em cima.
export function RankBadge({ n, size = 'h-8 w-8 text-sm', className = '', floating = false, crownSize = 16 }) {
  const medal =
    n === 1
      ? 'bg-gradient-to-br from-amber-300 to-amber-500 text-amber-950 shadow-lg shadow-amber-500/30'
      : n === 2
        ? 'bg-gradient-to-br from-slate-200 to-slate-400 text-slate-900'
        : n === 3
          ? 'bg-gradient-to-br from-orange-300 to-orange-500 text-orange-950'
          : 'bg-[var(--bg-surface-2)] text-[var(--text-muted)] ring-1 ring-[var(--border)]'
  return (
    // floating: a medalha fica por cima de outro elemento (canto da foto).
    <span className={`${floating ? 'absolute z-10' : 'relative'} inline-flex shrink-0 ${className}`}>
      {n === 1 && (
        <Crown
          size={crownSize}
          strokeWidth={2.5}
          className="absolute -top-[0.7em] left-1/2 -translate-x-1/2 fill-amber-300 text-amber-400 drop-shadow-[0_0_6px_rgba(251,191,36,0.7)]"
        />
      )}
      <span className={`flex ${size} items-center justify-center rounded-lg font-bold ${medal}`}>{n}</span>
    </span>
  )
}

function Rank({ n }) {
  return <RankBadge n={n} className="mt-2" />
}

export function ProductCell({ p, rank }) {
  const category = p.categories?.split(', ')[0]
  return (
    <div className="flex min-w-0 items-center gap-3">
      {rank !== undefined && <Rank n={rank} />}
      <ProductThumb src={p.imageUrl} title={p.name} size="h-16 w-16" rounded="rounded-xl" />
      <div className="min-w-0 space-y-1">
        <p className="line-clamp-2 text-sm font-semibold leading-snug text-[var(--text-primary)]">{p.name}</p>
        <div className="flex flex-wrap items-center gap-1.5">
          <CopyId id={p.dropiId} />
          <SupplierLink id={p.supplierId} name={p.supplierName} className="max-w-[200px]" />
          {category && <span className="rounded-md bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-medium text-violet-300">{category}</span>}
        </div>
      </div>
    </div>
  )
}

export function Price({ value, suggested }) {
  return (
    <div className="text-right">
      <p className="text-sm font-bold text-amber-300">{fmt.money(value)}</p>
      {suggested ? <p className="text-[10px] text-[var(--text-faint)]">sugerido {fmt.money(suggested)}</p> : null}
    </div>
  )
}

export function StockValue({ value }) {
  return (
    <p className={`text-right text-sm font-semibold ${value ? 'text-[var(--text-primary)]' : 'text-[var(--text-faint)]'}`}>{fmt.num(value)}</p>
  )
}

export function AnalyzeButton({ onClick }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className="group/analyze inline-flex items-center gap-1.5 rounded-xl border border-brand-400/40 bg-gradient-to-r from-brand-600 to-brand-500 px-3.5 py-1.5 text-xs font-semibold text-white shadow-md shadow-brand-500/25 transition-all hover:shadow-lg hover:shadow-brand-500/40 hover:brightness-110"
    >
      <BarChart3 size={13} strokeWidth={2.5} />
      Analisar
      <ChevronRight size={14} className="transition-transform group-hover/analyze:translate-x-0.5" />
    </button>
  )
}

// Ao trocar de página, volta pro começo da lista (o conteúdo rola dentro do
// <main> do Layout, não só na janela).
export function scrollToTop() {
  window.scrollTo({ top: 0, behavior: 'smooth' })
  document.querySelector('main')?.scrollTo?.({ top: 0, behavior: 'smooth' })
}

// ---------- tabela ----------
// Cabeçalho e linhas usam O MESMO grid-template (inclusive a coluna do botão
// com largura fixa), senão os números saem desalinhados das colunas.
export function DataTable({ columns, rows, rowKey, onRowClick, loading, error, empty }) {
  const template = columns.map((c) => c.width || 'minmax(0,1fr)').join(' ')
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[860px]">
        <div
          className="grid items-center gap-4 border-b border-[var(--border)] bg-[var(--bg-surface-2)]/60 px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)]"
          style={{ gridTemplateColumns: template }}
        >
          {columns.map((c, i) => (
            <span key={i} className={c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : ''}>
              {c.header}
            </span>
          ))}
        </div>
        {loading && !rows && <TableSkeleton />}
        {error && <NoData title="Não deu pra carregar" subtitle={error} />}
        {rows && rows.length === 0 && empty}
        {rows?.map((r, idx) => (
          <div
            key={rowKey(r)}
            onClick={onRowClick ? () => onRowClick(r) : undefined}
            className={`grid items-center gap-4 border-b border-[var(--border)] px-4 py-3 transition-colors last:border-b-0 ${
              onRowClick ? 'cursor-pointer hover:bg-[var(--hover-surface)]' : ''
            }`}
            style={{ gridTemplateColumns: template }}
          >
            {columns.map((c, i) => (
              <div key={i} className={c.align === 'right' ? 'text-right' : c.align === 'center' ? 'text-center' : 'min-w-0'}>
                {c.render(r, idx)}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

const KPI_TONES = {
  default: { value: 'text-[var(--text-primary)]', icon: 'from-brand-500 to-brand-400 shadow-brand-500/40', glow: 'from-brand-500/25', bar: 'from-brand-500/80' },
  green: { value: 'text-emerald-300', icon: 'from-emerald-500 to-emerald-400 shadow-emerald-500/40', glow: 'from-emerald-500/25', bar: 'from-emerald-500/80' },
  amber: { value: 'text-amber-200', icon: 'from-amber-500 to-amber-400 shadow-amber-500/40', glow: 'from-amber-500/25', bar: 'from-amber-500/80' },
  sky: { value: 'text-sky-200', icon: 'from-sky-500 to-sky-400 shadow-sky-500/40', glow: 'from-sky-500/25', bar: 'from-sky-500/80' },
}

export function Kpi({ label, value, hint, tone = 'default', icon: Icon }) {
  const t = KPI_TONES[tone] || KPI_TONES.default
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-4 transition-colors hover:border-brand-500/40">
      {/* filete colorido no topo + brilho no canto, na cor do dado */}
      <div className={`pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r ${t.bar} to-transparent`} />
      <div className={`pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-gradient-to-br ${t.glow} to-transparent blur-2xl`} />
      <div className="relative flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-[var(--text-muted)]">{label}</p>
          <p className={`mt-1.5 truncate text-[26px] font-bold leading-none ${t.value}`}>{value ?? '—'}</p>
          {hint && <p className="mt-1.5 truncate text-[11px] text-[var(--text-faint)]">{hint}</p>}
        </div>
        {Icon && (
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-lg ${t.icon}`}>
            <Icon size={18} strokeWidth={2.25} />
          </span>
        )}
      </div>
    </div>
  )
}

export function Panel({ title, subtitle, right, children }) {
  return (
    <div className="overflow-visible rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)]">
      {(title || right) && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3.5">
          <div>
            {title && <h3 className="font-semibold">{title}</h3>}
            {subtitle && <p className="text-xs text-[var(--text-muted)]">{subtitle}</p>}
          </div>
          {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
        </div>
      )}
      {children}
    </div>
  )
}

export function Badge({ tone, children }) {
  const tones = {
    viral: 'bg-fuchsia-500/15 text-fuchsia-300 border-fuchsia-500/30',
    quente: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
    morno: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    frio: 'bg-sky-500/10 text-sky-300 border-sky-500/30',
    novo: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    explosivo: 'bg-red-500/15 text-red-300 border-red-500/30',
    fogo: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
    crescendo: 'bg-lime-500/15 text-lime-300 border-lime-500/30',
    neutral: 'bg-[var(--bg-surface-2)] text-[var(--text-tertiary)] border-[var(--border)]',
  }
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${tones[tone] || tones.neutral}`}>
      {children}
    </span>
  )
}

export function activityLevel(activeDays, days) {
  const pct = days ? Math.round((activeDays / days) * 100) : 0
  if (pct >= 80) return { pct, tone: 'viral', label: 'Viral' }
  if (pct >= 60) return { pct, tone: 'quente', label: 'Quente' }
  if (pct >= 40) return { pct, tone: 'morno', label: 'Morno' }
  return { pct, tone: 'frio', label: 'Frio' }
}

export function winnerLevel(recent, previous) {
  if (!previous) return { tone: 'novo', label: 'Novo', growth: null }
  const growth = recent / previous
  if (growth >= 10) return { tone: 'explosivo', label: 'Explosivo', growth }
  if (growth >= 3) return { tone: 'fogo', label: 'Fogo', growth }
  return { tone: 'crescendo', label: 'Crescendo', growth }
}

export function TableSkeleton({ rows = 6 }) {
  return (
    <div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3">
          <div className="h-16 w-16 animate-pulse rounded-xl bg-[var(--bg-surface-2)]" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-2/3 animate-pulse rounded bg-[var(--bg-surface-2)]" />
            <div className="h-3 w-1/3 animate-pulse rounded bg-[var(--bg-surface-2)]" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function NoData({ title, subtitle }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <p className="text-sm font-medium text-[var(--text-tertiary)]">{title}</p>
      {subtitle && <p className="mt-1 max-w-md text-sm text-[var(--text-muted)]">{subtitle}</p>}
    </div>
  )
}

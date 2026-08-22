import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import {
  Bell,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eye,
  Flame,
  History,
  LayoutDashboard,
  LogOut,
  Megaphone,
  Moon,
  Package,
  Radar,
  ScanBarcode,
  Store,
  Sun,
  UserCog,
  Users,
} from 'lucide-react'
import { OPERATIONS, useOperation } from '../context/OperationContext.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { useTheme } from '../context/ThemeContext.jsx'
import { useLanguage } from '../context/LanguageContext.jsx'
import Select from './Select.jsx'
import scoutxLogo from '../assets/scoutx-logo.png'

const ADD_CUSTOM_VALUE = '__add_custom__'
const COLLAPSE_KEY = 'scoutx-sidebar-collapsed'

// Grupos com cabeçalho + ícone de linha (não emoji) — cada item vira um LED
// azul: ícone monocromático dentro de uma pastilha com brilho, igual em
// todo item (ativo ou não), pra bater o olho sem parecer sticker de emoji.
// labelKey aponta pro dicionário de i18n/translations.js (Layout é uma das
// poucas telas totalmente traduzidas — ver comentário no topo do dicionário).
const NAV_GROUPS = [
  {
    labelKey: 'nav.principal',
    items: [
      { to: '/', labelKey: 'nav.dashboard', Icon: LayoutDashboard, end: true },
      { to: '/concorrentes', labelKey: 'nav.concorrentes', Icon: Store },
      { to: '/produtos', labelKey: 'nav.produtos', Icon: Package },
    ],
  },
  {
    labelKey: 'nav.inteligencia',
    items: [
      { to: '/produtos-quentes', labelKey: 'nav.produtosQuentes', Icon: Flame },
      { to: '/anuncios', labelKey: 'nav.anuncios', Icon: Megaphone },
      { to: '/alertas', labelKey: 'nav.alertas', Icon: Bell },
    ],
  },
]

// "Ferramentas": Buscar Barcode e Espionar Loja sempre visíveis (nunca
// tiveram permissão própria, herdado do antigo "Buscar Barcode Shopify").
// Minerador de Anúncios entra condicionalmente logo abaixo — ele bate no
// mesmo /api/minerador/* protegido por canAccessMinerador no backend.
const TOOL_ITEMS = [
  { to: '/ferramentas/buscar-barcode', labelKey: 'nav.buscarFornecedor', Icon: ScanBarcode },
  { to: '/ferramentas/espionar-loja', labelKey: 'nav.espionarLoja', Icon: Eye },
]

function navLinkClass({ isActive }, collapsed) {
  return `flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
    collapsed ? 'justify-center px-0' : ''
  } ${
    isActive
      ? 'nav-active'
      : 'text-[var(--text-tertiary)] hover:bg-[var(--hover-surface)] hover:text-[var(--text-primary)]'
  }`
}

// A "pastilha LED" — ícone azul dentro de um quadrado com brilho suave;
// no item ativo o brilho fica mais forte, como uma luz acesa.
function NavIcon({ Icon, active }) {
  return (
    <span
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-all ${
        active ? 'nav-icon-active' : 'bg-brand-500/10 text-brand-500'
      }`}
    >
      <Icon size={15} strokeWidth={2.25} className={active ? '' : 'text-brand-500'} />
    </span>
  )
}

// Quando a sidebar tá recolhida (só ícone), o cabeçalho do grupo some e os
// itens ficam sempre visíveis — não faz sentido "recolher" uma seção que já
// não tem rótulo pra clicar.
function NavGroup({ label, collapsed, children }) {
  const [open, setOpen] = useState(true)
  if (collapsed) return <div className="space-y-1">{children}</div>
  return (
    <div className="mb-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-faint)]"
      >
        {label}
        <ChevronDown size={13} className={`transition-transform ${open ? '' : '-rotate-90'}`} />
      </button>
      {open && <div className="space-y-1">{children}</div>}
    </div>
  )
}

export default function Layout() {
  const { operation, setOperation, customOperations, addCustomOperation } = useOperation()
  const { me } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const { t } = useLanguage()
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === 'true')

  useEffect(() => {
    localStorage.setItem(COLLAPSE_KEY, String(collapsed))
  }, [collapsed])

  function handleOperationChange(value) {
    if (value !== ADD_CUSTOM_VALUE) {
      setOperation(value)
      return
    }
    const name = window.prompt('Nome do país/operação (ex: Chile, Peru…):')
    if (name && name.trim()) addCustomOperation(name)
  }

  const hasAccess = me?.isAdmin || me?.canAccessMinerador

  return (
    <div className="flex min-h-screen bg-[var(--bg-page)] text-[var(--text-primary)]">
      <aside
        className={`sidebar-edge relative flex shrink-0 flex-col bg-[var(--bg-surface)] p-4 transition-[width] duration-200 ${
          collapsed ? 'w-[68px] px-2' : 'w-60'
        }`}
      >
        {/* "Bolinha" de recolher — some com os rótulos pra quem quer a tela
            livre pra fazer análise ao lado, deixando só os ícones. */}
        <button
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? t('nav.expandirMenu') : t('nav.recolherMenu')}
          className="absolute -right-3 top-16 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-brand-500/40 bg-[var(--bg-surface-2)] text-brand-500 shadow-md transition-colors hover:bg-brand-500/15"
        >
          {collapsed ? <ChevronRight size={13} /> : <ChevronLeft size={13} />}
        </button>

        <div className="relative mb-4 flex items-center justify-center px-2 pt-1">
          <img
            src={scoutxLogo}
            alt="ScoutX"
            className={`rounded-2xl object-cover shadow-lg transition-all ${collapsed ? 'h-9 w-9' : 'h-20 w-20'}`}
          />
          {!collapsed && (
            <button
              onClick={toggleTheme}
              title={theme === 'dark' ? 'Mudar pro tema claro' : 'Mudar pro tema escuro'}
              className="absolute right-1 top-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--bg-surface-2)] text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)]"
            >
              {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
            </button>
          )}
        </div>

        <div className={`mb-2 px-2 ${hasAccess && !collapsed ? '' : 'hidden'}`}>
          <label className="mb-1 block text-xs font-medium text-[var(--text-muted)]">{t('nav.operacao')}</label>
          <Select
            value={operation}
            onChange={handleOperationChange}
            options={[...OPERATIONS, ...customOperations].map((op) => ({ value: op.value, label: op.label, icon: op.flag }))}
            extraOption={{ value: ADD_CUSTOM_VALUE, label: t('nav.adicionarPais') }}
          />
        </div>

        <nav className="flex-1 overflow-y-auto">
          {hasAccess &&
            NAV_GROUPS.map((group) => (
              <NavGroup key={group.labelKey} label={t(group.labelKey)} collapsed={collapsed}>
                {group.items.map(({ to, labelKey, Icon, end }) => (
                  <NavLink key={to} to={to} end={end} title={collapsed ? t(labelKey) : undefined} className={(state) => navLinkClass(state, collapsed)}>
                    {({ isActive }) => (
                      <>
                        <NavIcon Icon={Icon} active={isActive} />
                        {!collapsed && t(labelKey)}
                      </>
                    )}
                  </NavLink>
                ))}
              </NavGroup>
            ))}

          {!collapsed && (
            <p className="px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-faint)]">{t('nav.ferramentas')}</p>
          )}
          <div className={`space-y-1 ${collapsed ? 'mt-2' : ''}`}>
            {hasAccess && (
              <NavLink to="/minerador-de-anuncios" title={collapsed ? t('nav.mineradorAnuncios') : undefined} className={(state) => navLinkClass(state, collapsed)}>
                {({ isActive }) => (
                  <>
                    <NavIcon Icon={Radar} active={isActive} />
                    {!collapsed && t('nav.mineradorAnuncios')}
                  </>
                )}
              </NavLink>
            )}
            {TOOL_ITEMS.map(({ to, labelKey, Icon }) => (
              <NavLink key={to} to={to} title={collapsed ? t(labelKey) : undefined} className={(state) => navLinkClass(state, collapsed)}>
                {({ isActive }) => (
                  <>
                    <NavIcon Icon={Icon} active={isActive} />
                    {!collapsed && t(labelKey)}
                  </>
                )}
              </NavLink>
            ))}

            {me?.canViewHistory && (
              <NavLink to="/ferramentas/historico" title={collapsed ? t('nav.historico') : undefined} className={(state) => navLinkClass(state, collapsed)}>
                {({ isActive }) => (
                  <>
                    <NavIcon Icon={History} active={isActive} />
                    {!collapsed && t('nav.historico')}
                  </>
                )}
              </NavLink>
            )}

            {me?.isAdmin && (
              <NavLink to="/usuarios" title={collapsed ? t('nav.usuarios') : undefined} className={(state) => navLinkClass(state, collapsed)}>
                {({ isActive }) => (
                  <>
                    <NavIcon Icon={Users} active={isActive} />
                    {!collapsed && t('nav.usuarios')}
                  </>
                )}
              </NavLink>
            )}

            {me && (
              <NavLink to="/conta" title={collapsed ? t('nav.minhaConta') : undefined} className={(state) => navLinkClass(state, collapsed)}>
                {({ isActive }) => (
                  <>
                    <NavIcon Icon={UserCog} active={isActive} />
                    {!collapsed && t('nav.minhaConta')}
                  </>
                )}
              </NavLink>
            )}
          </div>
        </nav>

        {me && (
          <div className={`mt-4 border-t border-[var(--border)] pt-3 ${collapsed ? 'flex flex-col items-center gap-2' : 'px-2'}`}>
            {!collapsed && <p className="truncate text-xs text-[var(--text-muted)]">{me.name}</p>}
            <a
              href="/logout"
              title={t('nav.sair')}
              className={
                collapsed
                  ? 'flex h-7 w-7 items-center justify-center rounded-lg text-[var(--text-muted)] hover:bg-[var(--hover-surface)] hover:text-red-400'
                  : 'text-xs font-medium text-[var(--text-muted)] hover:text-red-400'
              }
            >
              {collapsed ? <LogOut size={14} /> : t('nav.sair')}
            </a>
          </div>
        )}
      </aside>
      <main className="flex-1 overflow-y-auto p-8">
        <Outlet />
      </main>
    </div>
  )
}

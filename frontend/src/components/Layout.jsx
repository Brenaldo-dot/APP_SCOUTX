import { NavLink, Outlet } from 'react-router-dom'
import { OPERATIONS, useOperation } from '../context/OperationContext.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import scoutxLogo from '../assets/scoutx-logo.png'

const ADD_CUSTOM_VALUE = '__add_custom__'

// Itens do ScoutX em si — sempre visíveis pra quem já está logado (o gate
// de acesso ao produto como um todo acontece no login, não aqui).
const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', icon: '📊' },
  { to: '/concorrentes', label: 'Concorrentes', icon: '🏬' },
  { to: '/produtos', label: 'Produtos', icon: '📦' },
  { to: '/produtos-quentes', label: 'Produtos Quentes', icon: '🔥' },
  { to: '/anuncios', label: 'Anúncios', icon: '📣' },
  { to: '/alertas', label: 'Alertas', icon: '🔔' },
]

// "Ferramentas": Buscar Barcode e Espionar Loja sempre visíveis (nunca
// tiveram permissão própria, herdado do antigo "Buscar Barcode Shopify").
// Minerador de Anúncios entra condicionalmente logo abaixo — ele bate no
// mesmo /api/minerador/* protegido por canAccessMinerador no backend.
const TOOL_ITEMS = [
  { to: '/ferramentas/buscar-barcode', label: 'Buscar Barcode', icon: '🔎' },
  { to: '/ferramentas/espionar-loja', label: 'Espionar Loja', icon: '🕶️' },
]

function navLinkClass({ isActive }) {
  return `flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
    isActive ? 'bg-brand-600 text-white' : 'text-gray-400 hover:bg-[#222538] hover:text-gray-200'
  }`
}

export default function Layout() {
  const { operation, setOperation, customOperations, addCustomOperation } = useOperation()
  const { me } = useAuth()

  function handleOperationChange(value) {
    if (value !== ADD_CUSTOM_VALUE) {
      setOperation(value)
      return
    }
    const name = window.prompt('Nome do país/operação (ex: Chile, Peru…):')
    if (name && name.trim()) addCustomOperation(name)
  }

  return (
    <div className="flex min-h-screen bg-[#0f1117] text-gray-100">
      <aside className="flex w-60 shrink-0 flex-col border-r border-[#2d3148] bg-[#1c1f2e] p-4">
        <div className="mb-4 flex items-center gap-2 px-2">
          <img src={scoutxLogo} alt="ScoutX" className="h-8 w-8 shrink-0 rounded-md object-cover" />
          <div>
            <h1 className="text-lg font-bold leading-tight">ScoutX</h1>
            <p className="text-xs text-gray-500">Inteligência COD</p>
          </div>
        </div>
        <div className={`mb-6 px-2 ${me?.isAdmin || me?.canAccessMinerador ? '' : 'hidden'}`}>
          <label className="mb-1 block text-xs font-medium text-gray-500">Operação</label>
          <select
            value={operation}
            onChange={(e) => handleOperationChange(e.target.value)}
            title="Só mostra os concorrentes cadastrados nessa operação — cada uma é isolada da outra"
            className="w-full rounded-lg border border-[#2d3148] bg-[#161824] px-3 py-2 text-sm font-medium text-gray-100 focus:border-brand-500 focus:outline-none"
          >
            {[...OPERATIONS, ...customOperations].map((op) => (
              <option key={op.value} value={op.value}>
                {op.flag} {op.label}
              </option>
            ))}
            <option value={ADD_CUSTOM_VALUE}>+ Adicionar outro país…</option>
          </select>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto">
          {(me?.isAdmin || me?.canAccessMinerador) &&
            NAV_ITEMS.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.to === '/'} className={navLinkClass}>
                <span>{item.icon}</span>
                {item.label}
              </NavLink>
            ))}

          <p className="px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wide text-gray-600">Ferramentas</p>
          {(me?.isAdmin || me?.canAccessMinerador) && (
            <NavLink to="/minerador-de-anuncios" className={navLinkClass}>
              <span>🕵️</span>
              Minerador de Anúncios
            </NavLink>
          )}
          {TOOL_ITEMS.map((item) => (
            <NavLink key={item.to} to={item.to} className={navLinkClass}>
              <span>{item.icon}</span>
              {item.label}
            </NavLink>
          ))}

          {me?.canViewHistory && (
            <NavLink to="/ferramentas/historico" className={navLinkClass}>
              <span>🕓</span>
              Histórico
            </NavLink>
          )}

          {me?.isAdmin && (
            <NavLink to="/usuarios" className={navLinkClass}>
              <span>👤</span>
              Usuários
            </NavLink>
          )}
        </nav>

        {me && (
          <div className="mt-4 border-t border-[#2d3148] px-2 pt-3">
            <p className="truncate text-xs text-gray-500">{me.name}</p>
            <a href="/logout" className="text-xs font-medium text-gray-500 hover:text-red-400">
              Sair
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

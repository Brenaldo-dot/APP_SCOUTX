import { createContext, useContext, useEffect, useState } from 'react'

const STORAGE_KEY = 'mega-minerador-operation'
const CUSTOM_STORAGE_KEY = 'mega-minerador-custom-operations'

// Países com suporte "de verdade" (rotina de busca de anúncio por país em
// services/competitor_service.py:country_for_operation) — adicionar um novo
// é só acrescentar aqui E lá no backend. "Outro" não é uma operação de
// verdade, é a ação de cadastrar uma nova (ver addCustomOperation) — quem
// escolhe um país fora dessa lista fixa cai no CUSTOM_STORAGE_KEY abaixo.
export const OPERATIONS = [
  { value: 'colombia', label: 'Colômbia', flag: '🇨🇴' },
  { value: 'mexico', label: 'México', flag: '🇲🇽' },
  { value: 'equador', label: 'Equador', flag: '🇪🇨' },
  { value: 'guatemala', label: 'Guatemala', flag: '🇬🇹' },
]

function slugify(text) {
  return text
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function loadCustomOperations() {
  try {
    return JSON.parse(localStorage.getItem(CUSTOM_STORAGE_KEY) || '[]')
  } catch {
    return []
  }
}

const OperationContext = createContext(null)

export function OperationProvider({ children }) {
  const [operation, setOperation] = useState(() => localStorage.getItem(STORAGE_KEY) || 'colombia')
  const [customOperations, setCustomOperations] = useState(loadCustomOperations)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, operation)
  }, [operation])

  useEffect(() => {
    localStorage.setItem(CUSTOM_STORAGE_KEY, JSON.stringify(customOperations))
  }, [customOperations])

  // Sem mapeamento de país fixo no backend, um país "outro" cai no default
  // (CO) só pra rotina de busca de anúncio — o resto do app (dashboard,
  // concorrentes, produtos) funciona normal, filtrando por esse valor igual
  // aos países fixos.
  function addCustomOperation(countryName) {
    const label = countryName.trim()
    if (!label) return null
    const value = slugify(label) || `outro-${Date.now()}`
    const existing = [...OPERATIONS, ...customOperations].find((o) => o.value === value)
    if (existing) {
      setOperation(existing.value)
      return existing.value
    }
    const next = { value, label, flag: '🌎' }
    setCustomOperations((prev) => [...prev, next])
    setOperation(value)
    return value
  }

  return (
    <OperationContext.Provider value={{ operation, setOperation, customOperations, addCustomOperation }}>
      {children}
    </OperationContext.Provider>
  )
}

export function useOperation() {
  const ctx = useContext(OperationContext)
  if (!ctx) throw new Error('useOperation precisa estar dentro de <OperationProvider>')
  return ctx
}

export function operationLabel(value) {
  return [...OPERATIONS, ...loadCustomOperations()].find((o) => o.value === value)?.label || value
}

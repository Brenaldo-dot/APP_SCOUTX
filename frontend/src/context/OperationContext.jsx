import { createContext, useContext, useEffect, useState } from 'react'
import { api } from '../api/client.js'

const STORAGE_KEY = 'mega-minerador-operation'
const CUSTOM_STORAGE_KEY = 'mega-minerador-custom-operations'
const LABEL_OVERRIDES_KEY = 'mega-minerador-operation-label-overrides'

// Escada de planos por VAGA de país — não é só "próximo plano geral": quem
// tá no Standard (1 vaga) vê o 2º e o 3º país cabendo no Pro, mas o 4º só
// cabe no Enterprise. Rotular todo mundo travado como "Requer plano Pro"
// seria mentira pro 4º em diante (upar pra Pro não destravaria ele). Espelha
// PLAN_LIMITS do backend Node (db.js) — são só 3 planos fixos, duplicar essa
// escada pequena aqui é mais simples que expor plano/label por uma rota nova.
const PLAN_TIERS = [
  { label: 'Pro', maxOperations: 3 },
  { label: 'Enterprise', maxOperations: Infinity },
]

export function requiredPlanForSlot(slot) {
  const tier = PLAN_TIERS.find((t) => slot <= t.maxOperations)
  return tier ? tier.label : null
}

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

function loadLabelOverrides() {
  try {
    return JSON.parse(localStorage.getItem(LABEL_OVERRIDES_KEY) || '{}')
  } catch {
    return {}
  }
}

const OperationContext = createContext(null)

export function OperationProvider({ children }) {
  const [operation, setOperation] = useState(() => localStorage.getItem(STORAGE_KEY) || 'colombia')
  const [customOperations, setCustomOperations] = useState(loadCustomOperations)
  const [labelOverrides, setLabelOverrides] = useState(loadLabelOverrides)
  // null = ainda carregando/sem organização (admin) — não trava nada até
  // saber de verdade, pra não piscar país bloqueado por engano.
  const [planLimit, setPlanLimit] = useState(null)

  useEffect(() => {
    api.getMyOperationsLimit().then(setPlanLimit).catch(() => {})
  }, [])

  // Revisão: achado ao vivo — conta Standard (1 país) conseguia trocar
  // LIVREMENTE entre os 4 países fixos no seletor, mesmo sem nunca ter
  // cadastrado concorrente em nenhum, porque `usedOperations` (vindo do
  // backend) só conta país que já tem CONCORRENTE DE VERDADE — um Standard
  // recém-criado, com 0 concorrentes, tinha `usedOperations = []`,
  // `0 >= 1` é falso, então nada travava ainda. O cadastro em si sempre foi
  // protegido (_assert_operation_allowed no backend), mas o SELETOR ficava
  // livre até a primeira loja — dava pra "passear" pelos 4 países vendo a
  // tela (vazia) de cada um, o que não bate com "Standard = 1 país" prometido
  // na venda. Corrigido contando o país ATUALMENTE selecionado como já
  // "usado" também, mesmo sem concorrente nenhum ainda — trava a partir do
  // primeiro país visto, não só do primeiro cadastro.
  const touchedOperations = new Set([...(planLimit?.usedOperations || []), operation])

  function isOperationLocked(value) {
    if (!planLimit || planLimit.maxOperations === null) return false
    if (touchedOperations.has(value)) return false
    return touchedOperations.size >= planLimit.maxOperations
  }

  // Criar um país NOVO (fora dos que a org já usa) também consome vaga —
  // mesma trava, só que antes de tentar (evita cadastrar um nome que nunca
  // vai conseguir usar).
  const atOperationCap =
    !!planLimit && planLimit.maxOperations !== null && touchedOperations.size >= planLimit.maxOperations

  // Mesma ideia, pro teto de concorrentes cadastrados do plano (Standard até
  // 50, Pro até 250, Enterprise ilimitado) — sem a escada de "qual plano libera a
  // Nª vaga" dos países porque aqui não tem opção fixa pra travar uma por
  // uma, é só "cheio ou não".
  const atCompetitorCap =
    !!planLimit && planLimit.maxCompetitors !== null && planLimit.usedCompetitors >= planLimit.maxCompetitors

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, operation)
  }, [operation])

  useEffect(() => {
    localStorage.setItem(CUSTOM_STORAGE_KEY, JSON.stringify(customOperations))
  }, [customOperations])

  useEffect(() => {
    localStorage.setItem(LABEL_OVERRIDES_KEY, JSON.stringify(labelOverrides))
  }, [labelOverrides])

  // Renomear vale pra qualquer país (fixo ou customizado) — usuário que só
  // opera no México não devia ficar vendo "Colômbia" na lista só porque é o
  // primeiro item padrão. Fica salvo por navegador (mesmo esquema de
  // customOperations), não por organização — cada admin/colaborador pode
  // ver um nome diferente pro mesmo `value`, o que é aceitável já que é só
  // rótulo de exibição, o valor real (`operation`) continua igual pra todo
  // mundo por baixo.
  function renameOperation(value, newLabel) {
    const label = newLabel.trim()
    if (!label) return
    setLabelOverrides((prev) => ({ ...prev, [value]: label }))
  }

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
    <OperationContext.Provider
      value={{
        operation,
        setOperation,
        customOperations,
        addCustomOperation,
        labelOverrides,
        renameOperation,
        planLimit,
        isOperationLocked,
        atOperationCap,
        atCompetitorCap,
      }}
    >
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
  const overrides = loadLabelOverrides()
  if (overrides[value]) return overrides[value]
  return [...OPERATIONS, ...loadCustomOperations()].find((o) => o.value === value)?.label || value
}

import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { api } from '../api/client.js'
import { rawApi } from '../api/rawClient.js'
import { useAuth } from './AuthContext.jsx'

const STORAGE_KEY = 'mega-minerador-operation'
const CUSTOM_STORAGE_KEY = 'mega-minerador-custom-operations'
const LABEL_OVERRIDES_KEY = 'mega-minerador-operation-label-overrides'
const TOUCHED_HISTORY_KEY = 'mega-minerador-operation-touched'

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
  { value: 'espanha', label: 'Espanha', flag: '🇪🇸' },
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

// BUG corrigido (achado ao vivo, 2026-08-25): a chave de storage era global
// pro NAVEGADOR, não por CONTA — quem testasse uma conta nova no mesmo
// navegador que já tinha usado o ScoutX antes (como admin ou outra conta)
// herdava o país que já estava salvo ali, e o país "certo" da conta nova
// nunca virava a seleção ativa (o checkmark ficava preso no valor antigo,
// consumindo vaga de plano à toa). Escopar por email da conta logada
// resolve: cada conta tem sua própria chave, sem depender do navegador
// estar "limpo".
function operationKeyFor(email) {
  return email ? `${STORAGE_KEY}:${email}` : STORAGE_KEY
}

function touchedHistoryKeyFor(email) {
  return `${TOUCHED_HISTORY_KEY}:${email}`
}

function loadTouchedHistory(email) {
  try {
    return JSON.parse(localStorage.getItem(touchedHistoryKeyFor(email)) || '[]')
  } catch {
    return []
  }
}

export function OperationProvider({ children }) {
  const { me } = useAuth()
  const email = me?.email || null
  const defaultOperation = me?.defaultOperation || null

  // `operation` continua com um valor válido desde o primeiro render (nunca
  // fica null) — o resto do app (dashboard, concorrentes, etc.) não precisa
  // saber que ninguém escolheu nada ainda, continua funcionando igual. No
  // instante inicial ainda não sabemos o email da conta (useAuth carrega
  // /api/me de forma assíncrona), então parte do valor "solto" antigo só
  // como placeholder — o efeito abaixo corrige pro valor DA CONTA assim
  // que o email chega, antes de qualquer interação real ser possível.
  // `needsCountryPick` é só um aviso pra UI: true quando ESSA CONTA nunca
  // escolheu um país de verdade — o Layout usa isso pra mostrar o seletor
  // inicial de país, em vez de deixar a conta presa em "Colômbia" sem
  // avisar (era o comportamento antigo).
  const [operation, setOperationRaw] = useState(() => localStorage.getItem(STORAGE_KEY) || 'colombia')
  const [needsCountryPick, setNeedsCountryPick] = useState(() => localStorage.getItem(STORAGE_KEY) === null)
  // BUG corrigido (achado ao vivo, 2026-08-25): só guardávamos o país ATUAL,
  // então trocar de país pra só dar uma olhada "esquecia" o anterior — ele
  // caía pro fim da lista (perdia o lugar reservado) e podia até aparecer
  // travado, mesmo já tendo sido escolhido antes. Esse histórico guarda TODO
  // país que a conta já selecionou alguma vez (não só o que está na tela
  // agora), pra nenhum deles perder a vaga só por não ser o que está sendo
  // visto no momento.
  const [touchedHistory, setTouchedHistory] = useState(() => loadTouchedHistory(null))
  const initializedForEmail = useRef(null)

  useEffect(() => {
    if (!email || initializedForEmail.current === email) return
    initializedForEmail.current = email
    setTouchedHistory(loadTouchedHistory(email))

    // BUG corrigido (achado ao vivo, 2026-08-25): até aqui essa decisão só
    // vivia no localStorage do NAVEGADOR — trocar de dispositivo, abrir
    // numa aba anônima nova, ou só limpar os dados do site fazia perguntar
    // de novo pra sempre, mesmo a conta já tendo escolhido antes. Agora o
    // servidor é a fonte de verdade (organizations.default_operation, ver
    // db.js e GET /api/me): se ele já tem valor, usa e não pergunta nunca
    // mais, em qualquer navegador. Só cai pro localStorage como plano B pra
    // quem escolheu ANTES dessa coluna existir (o servidor ainda não sabe
    // desse valor) — e nesse caso já aproveita pra mandar pro servidor,
    // pra próxima vez nem precisar do plano B.
    if (defaultOperation) {
      setOperationRaw(defaultOperation)
      setNeedsCountryPick(false)
      localStorage.setItem(operationKeyFor(email), defaultOperation)
      return
    }

    const scoped = localStorage.getItem(operationKeyFor(email))
    if (scoped) {
      setOperationRaw(scoped)
      setNeedsCountryPick(false)
      rawApi.setDefaultOperation(scoped).catch(() => {})
      return
    }
    // Migração pontual: cliente de verdade que já usava o app ANTES dessa
    // trava por conta existir tinha o país salvo na chave antiga (global do
    // navegador) — aproveita esse valor uma única vez em vez de obrigar
    // escolher de novo, e CONSOME a chave antiga na sequência (removeItem)
    // pra ela não vazar pra uma segunda conta testada no mesmo navegador
    // depois (era exatamente o bug relatado).
    const legacy = localStorage.getItem(STORAGE_KEY)
    if (legacy) {
      setOperationRaw(legacy)
      setNeedsCountryPick(false)
      localStorage.setItem(operationKeyFor(email), legacy)
      localStorage.removeItem(STORAGE_KEY)
      rawApi.setDefaultOperation(legacy).catch(() => {})
      return
    }
    // Nem servidor, nem chave escopada, nem chave antiga: essa conta é
    // tratada como se fosse realmente a primeira vez, ponto final.
    setNeedsCountryPick(true)
  }, [email, defaultOperation])

  function setOperation(value) {
    // A primeira escolha de verdade (needsCountryPick ainda true nesse
    // instante) é a que vale pra sempre pro servidor — próximas trocas só
    // mudam o que está sendo VISTO agora, não mexem no default salvo (ver
    // setOrgDefaultOperationIfUnset no backend, que também já ignora
    // chamadas repetidas por segurança, essa checagem aqui é só pra não
    // fazer requisição à toa).
    if (needsCountryPick) {
      rawApi.setDefaultOperation(value).catch(() => {})
    }
    setNeedsCountryPick(false)
    setOperationRaw(value)
    setTouchedHistory((prev) => (prev.includes(value) ? prev : [...prev, value]))
  }
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
  // na venda. Corrigido contando TODO país já visto (touchedHistory) como
  // "usado" também, mesmo sem concorrente nenhum ainda — trava a partir do
  // primeiro país visto, não só do primeiro cadastro, e sem esquecer os
  // países vistos antes só porque não é o que está na tela agora.
  const touchedOperations = new Set([...(planLimit?.usedOperations || []), ...touchedHistory, operation])

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
    // Enquanto needsCountryPick for true, esse valor ainda é só o default
    // interno ('colombia'), não uma escolha de verdade — gravar ele agora
    // faria o aviso de "escolher país" sumir sozinho no próximo carregamento,
    // sem a pessoa ter escolhido nada. Só grava depois que setOperation()
    // (via clique num país ou "adicionar país") passar por aqui de propósito.
    // Sem email ainda (carregando /api/me) também não grava — evitaria
    // gravar na chave global antiga por engano antes de saber de quem é.
    if (needsCountryPick || !email) return
    localStorage.setItem(operationKeyFor(email), operation)
  }, [operation, needsCountryPick, email])

  useEffect(() => {
    if (!email) return
    localStorage.setItem(touchedHistoryKeyFor(email), JSON.stringify(touchedHistory))
  }, [touchedHistory, email])

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
        needsCountryPick,
        customOperations,
        addCustomOperation,
        labelOverrides,
        renameOperation,
        planLimit,
        isOperationLocked,
        atOperationCap,
        atCompetitorCap,
        touchedOperations,
        touchedHistory,
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

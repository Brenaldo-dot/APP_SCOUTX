import { useState } from 'react'

// Sem campo de logo no backend, puxa o favicon direto do domínio via serviço
// do Google (sem chave, funciona pra qualquer site). Se falhar (loja bloqueia
// hotlink, favicon não existe etc.), cai pra um avatar com a inicial do nome,
// nunca deixa buraco vazio no card.
export default function CompetitorLogo({ domain, name }) {
  const [failed, setFailed] = useState(false)
  if (failed || !domain) {
    return (
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-500/15 text-sm font-bold text-brand-500">
        {(name || domain || '?').charAt(0).toUpperCase()}
      </span>
    )
  }
  return (
    <img
      src={`https://www.google.com/s2/favicons?sz=64&domain=${domain}`}
      alt=""
      onError={() => setFailed(true)}
      className="h-9 w-9 shrink-0 rounded-xl border border-[var(--border)] bg-white object-contain p-1"
    />
  )
}

import { useState } from 'react'
import { RotateCw } from 'lucide-react'

// Botão pequeno "Atualizar" pra recarregar os dados da tela sem precisar
// dar F5 na página inteira — pedido explícito do usuário (2026-08-27).
// `onRefresh` pode devolver uma Promise (aguarda pra parar de girar o
// ícone) ou nada (girada rápida e fixa, cobre chamadas síncronas/estado).
export default function RefreshButton({ onRefresh, className = '' }) {
  const [spinning, setSpinning] = useState(false)

  async function handleClick() {
    setSpinning(true)
    try {
      await onRefresh()
    } finally {
      // Giro mínimo de meio-segundo mesmo se a resposta vier instantânea —
      // sem isso, numa rede rápida o ícone só "pisca", sem dar a sensação
      // de que algo realmente aconteceu.
      setTimeout(() => setSpinning(false), 500)
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={spinning}
      title="Atualizar"
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-surface-2)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-tertiary)] transition-colors hover:border-brand-500/50 hover:text-brand-500 disabled:opacity-60 ${className}`}
    >
      <RotateCw size={13} className={spinning ? 'animate-spin' : ''} />
      Atualizar
    </button>
  )
}

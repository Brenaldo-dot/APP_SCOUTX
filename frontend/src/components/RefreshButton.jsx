import { useState } from 'react'
import { Check, RotateCw } from 'lucide-react'

// Botão pequeno "Atualizar" pra recarregar os dados da tela sem precisar
// dar F5 na página inteira — pedido explícito do usuário (2026-08-27).
// `onRefresh` pode devolver uma Promise (aguarda pra parar de girar o
// ícone) ou nada (girada rápida e fixa, cobre chamadas síncronas/estado).
//
// Revisão (achado ao vivo, 2026-08-27): só o ícone girando não bastava —
// numa tela que já estava com o dado certo (nada mudou de verdade), a
// pessoa não tinha como saber se o clique realmente disparou algo ou não.
// Duas provas concretas agora: (1) um "✓ Atualizado!" verde por 1.5s logo
// depois do giro, (2) a hora exata da última atualização bem-sucedida,
// sempre visível ao lado do botão — a prova definitiva, porque muda a
// cada clique de verdade, mesmo quando os dados em si não mudam nada.
export default function RefreshButton({ onRefresh, className = '' }) {
  const [status, setStatus] = useState('idle') // idle | spinning | done
  const [lastUpdated, setLastUpdated] = useState(null)

  async function handleClick() {
    setStatus('spinning')
    try {
      await onRefresh()
    } finally {
      // Giro mínimo de meio-segundo mesmo se a resposta vier instantânea —
      // sem isso, numa rede rápida o ícone só "pisca", sem dar a sensação
      // de que algo realmente aconteceu.
      setTimeout(() => {
        setLastUpdated(new Date())
        setStatus('done')
        setTimeout(() => setStatus('idle'), 1500)
      }, 500)
    }
  }

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <button
        type="button"
        onClick={handleClick}
        disabled={status === 'spinning'}
        title="Atualizar"
        className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-60 ${
          status === 'done'
            ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500'
            : 'border-[var(--border)] bg-[var(--bg-surface-2)] text-[var(--text-tertiary)] hover:border-brand-500/50 hover:text-brand-500'
        }`}
      >
        {status === 'done' ? <Check size={13} /> : <RotateCw size={13} className={status === 'spinning' ? 'animate-spin' : ''} />}
        {status === 'done' ? 'Atualizado!' : 'Atualizar'}
      </button>
      {lastUpdated && status !== 'spinning' && (
        <span className="whitespace-nowrap text-[10.5px] text-[var(--text-faint)]">
          às {lastUpdated.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </span>
      )}
    </div>
  )
}

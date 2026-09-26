import { Loader2 } from 'lucide-react'

// Substitui o "Carregando…" cru (texto sozinho numa tela em branco) por algo
// que já lembra o formato real da página — barras pulsando no lugar de cada
// bloco, no mesmo estilo visual do resto do app (cantos arredondados, borda,
// bg-surface). Pedido do usuário: a tela de carregamento ficava "feia".

function Bar({ className = '' }) {
  return <div className={`animate-pulse rounded-md bg-[var(--bg-surface-2)] ${className}`} />
}

function Card({ className = '', children }) {
  return <div className={`rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-4 ${className}`}>{children}</div>
}

// Esqueleto específico do Dashboard: replica a forma real da tela (banner de
// saudação, 4 cartões de estatística, 3 colunas de destaques) pra não dar
// aquele "salto" feio quando os dados de verdade chegam.
export function DashboardSkeleton() {
  return (
    <div className="space-y-8">
      <div className="relative overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-6">
        <div className="pointer-events-none absolute left-1/2 top-1/2 h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-500/15 blur-3xl" />
        <div className="relative flex flex-col items-center text-center">
          <div className="nav-icon-active mb-3 flex h-12 w-12 items-center justify-center rounded-2xl">
            <Loader2 size={22} strokeWidth={2.25} className="animate-spin" />
          </div>
          <p className="text-sm font-medium text-[var(--text-secondary)]">Carregando seu painel…</p>
          <p className="mt-1 text-xs text-[var(--text-faint)]">Só um instante</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i} className="space-y-3">
            <Bar className="h-8 w-8 rounded-lg" />
            <Bar className="h-5 w-14" />
            <Bar className="h-3 w-20" />
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Card key={i} className="space-y-3">
            <Bar className="h-4 w-32" />
            {[0, 1, 2].map((j) => (
              <div key={j} className="flex items-center gap-2.5">
                <Bar className="h-9 w-9 shrink-0 rounded-lg" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Bar className="h-3 w-full" />
                  <Bar className="h-2.5 w-2/3" />
                </div>
              </div>
            ))}
          </Card>
        ))}
      </div>
    </div>
  )
}

// Versão genérica (spinner centralizado + legenda), pras telas mais simples
// que hoje só mostram "Carregando…" sozinho — mesma cara, menos elaborada.
export default function PageSkeleton({ label = 'Carregando…' }) {
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-center">
      <div className="nav-icon-active flex h-11 w-11 items-center justify-center rounded-2xl">
        <Loader2 size={20} strokeWidth={2.25} className="animate-spin" />
      </div>
      <p className="text-sm text-[var(--text-muted)]">{label}</p>
    </div>
  )
}

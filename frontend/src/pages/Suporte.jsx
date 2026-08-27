import { MessageCircle } from 'lucide-react'

// Número do WhatsApp do suporte — PLACEHOLDER, precisa trocar pelo número
// real (formato: código do país + DDD + número, só dígitos, sem espaço/
// traço/parênteses, ex: "5511987654321" pro Brasil). Sem isso o botão abre
// o WhatsApp Web/app mas não acha nenhuma conversa de verdade.
const SUPPORT_WHATSAPP_NUMBER = '5500000000000'

// Mensagem já preenchida quando a pessoa clica — só precisa apertar
// enviar. Identifica que veio do app (o atendente já sabe o contexto) sem
// ser longa demais pra ler no celular.
const SUPPORT_MESSAGE = 'Olá! Sou cliente do ScoutX e preciso de ajuda 🙂'

function whatsappUrl(number, message) {
  return `https://wa.me/${number}?text=${encodeURIComponent(message)}`
}

export default function Suporte() {
  return (
    <div className="max-w-xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Suporte</h2>
        <p className="text-sm text-[var(--text-muted)]">Precisa de ajuda? Fale direto com a gente.</p>
      </div>

      <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-6 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-500">
          <MessageCircle size={26} strokeWidth={2.25} />
        </div>
        <h3 className="mt-4 text-base font-semibold text-[var(--text-primary)]">Fale com o suporte no WhatsApp</h3>
        <p className="mt-1.5 text-sm text-[var(--text-muted)]">
          Dúvida, problema ou sugestão — manda mensagem que a gente responde por lá.
        </p>
        <a
          href={whatsappUrl(SUPPORT_WHATSAPP_NUMBER, SUPPORT_MESSAGE)}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-5 inline-flex items-center gap-2 rounded-full bg-emerald-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-emerald-600/25 transition-colors hover:bg-emerald-700"
        >
          <MessageCircle size={16} />
          Abrir WhatsApp
        </a>
      </div>
    </div>
  )
}

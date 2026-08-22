import { useEffect, useState } from 'react'
import { rawApi } from '../api/rawClient.js'
import { api } from '../api/client.js'
import { useLanguage } from '../context/LanguageContext.jsx'
import { LANGUAGES } from '../i18n/translations.js'
import Select from '../components/Select.jsx'

function Section({ title, description, children }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-5">
      <h3 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h3>
      {description && <p className="mt-1 text-sm text-[var(--text-muted)]">{description}</p>}
      <div className="mt-4">{children}</div>
    </div>
  )
}

function Feedback({ msg }) {
  if (!msg) return null
  return <p className={`mt-3 text-sm ${msg.type === 'error' ? 'text-red-400' : 'text-emerald-400'}`}>{msg.text}</p>
}

function PasswordCard() {
  const { t } = useLanguage()
  const [form, setForm] = useState({ current: '', next: '', confirm: '' })
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    setMsg(null)
    if (!form.current || !form.next || !form.confirm) {
      setMsg({ type: 'error', text: t('conta.senha.erroCampos') })
      return
    }
    if (form.next.length < 8) {
      setMsg({ type: 'error', text: t('conta.senha.erroTamanho') })
      return
    }
    if (form.next !== form.confirm) {
      setMsg({ type: 'error', text: t('conta.senha.erroConfirmar') })
      return
    }
    setSaving(true)
    try {
      await rawApi.changeMyPassword(form.current, form.next)
      setMsg({ type: 'success', text: t('conta.senha.sucesso') })
      setForm({ current: '', next: '', confirm: '' })
    } catch (err) {
      setMsg({ type: 'error', text: err.message || 'Erro' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Section title={t('conta.senha.titulo')} description={t('conta.senha.desc')}>
      <form onSubmit={handleSubmit} className="flex max-w-sm flex-col gap-2.5">
        <input
          type="password"
          placeholder={t('conta.senha.atual')}
          value={form.current}
          onChange={(e) => setForm({ ...form, current: e.target.value })}
          autoComplete="current-password"
          className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface-2)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-brand-500 focus:outline-none"
        />
        <input
          type="password"
          placeholder={t('conta.senha.nova')}
          value={form.next}
          onChange={(e) => setForm({ ...form, next: e.target.value })}
          autoComplete="new-password"
          className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface-2)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-brand-500 focus:outline-none"
        />
        <input
          type="password"
          placeholder={t('conta.senha.confirmar')}
          value={form.confirm}
          onChange={(e) => setForm({ ...form, confirm: e.target.value })}
          autoComplete="new-password"
          className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface-2)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-brand-500 focus:outline-none"
        />
        <button type="submit" disabled={saving} className="btn-primary mt-1 self-start px-5 py-2">
          {saving ? t('conta.senha.salvando') : t('conta.senha.botao')}
        </button>
      </form>
      <Feedback msg={msg} />
    </Section>
  )
}

const DISCORD_STEPS = ['passo1', 'passo2', 'passo3', 'passo4', 'passo5']

function DiscordCard() {
  const { t } = useLanguage()
  const [webhookUrl, setWebhookUrl] = useState(null)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [msg, setMsg] = useState(null)
  const [showSteps, setShowSteps] = useState(false)

  useEffect(() => {
    api
      .getDiscordWebhook()
      .then((r) => {
        setWebhookUrl(r.discord_webhook_url)
        setInput(r.discord_webhook_url || '')
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  async function handleSave() {
    setMsg(null)
    if (!input.trim()) {
      setMsg({ type: 'error', text: t('conta.discord.erroUrl') })
      return
    }
    setSaving(true)
    try {
      const r = await api.setDiscordWebhook(input.trim())
      setWebhookUrl(r.discord_webhook_url)
      setMsg({ type: 'success', text: t('conta.discord.sucessoSalvar') })
    } catch (err) {
      setMsg({ type: 'error', text: err.message || 'Erro' })
    } finally {
      setSaving(false)
    }
  }

  async function handleTest() {
    setMsg(null)
    setTesting(true)
    try {
      await api.testDiscordWebhook()
      setMsg({ type: 'success', text: t('conta.discord.sucessoTeste') })
    } catch (err) {
      setMsg({ type: 'error', text: err.message || 'Erro' })
    } finally {
      setTesting(false)
    }
  }

  async function handleRemove() {
    setMsg(null)
    try {
      await api.removeDiscordWebhook()
      setWebhookUrl(null)
      setInput('')
      setMsg({ type: 'success', text: t('conta.discord.sucessoRemover') })
    } catch (err) {
      setMsg({ type: 'error', text: err.message || 'Erro' })
    }
  }

  return (
    <Section title={t('conta.discord.titulo')} description={t('conta.discord.desc')}>
      {!loading && (
        <span
          className={`mb-3 inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
            webhookUrl ? 'bg-emerald-500/15 text-emerald-400' : 'bg-[var(--hover-surface)] text-[var(--text-tertiary)]'
          }`}
        >
          {webhookUrl ? t('conta.discord.statusConectado') : t('conta.discord.statusDesconectado')}
        </span>
      )}

      <div className="flex max-w-lg flex-col gap-1">
        <label className="text-xs font-medium text-[var(--text-muted)]">{t('conta.discord.label')}</label>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t('conta.discord.placeholder')}
          className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface-2)] px-3 py-2 font-mono text-xs text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-brand-500 focus:outline-none"
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2.5">
        <button onClick={handleSave} disabled={saving} className="btn-primary px-4 py-2 text-xs">
          {saving ? t('conta.discord.salvando') : t('conta.discord.salvar')}
        </button>
        {webhookUrl && (
          <>
            <button
              onClick={handleTest}
              disabled={testing}
              className="rounded-full border border-[var(--border)] px-3.5 py-2 text-xs font-medium text-[var(--text-tertiary)] hover:bg-[var(--hover-surface)] disabled:opacity-50"
            >
              {testing ? t('conta.discord.testando') : t('conta.discord.testar')}
            </button>
            <button onClick={handleRemove} className="text-xs font-medium text-[var(--text-muted)] hover:text-red-400">
              {t('conta.discord.remover')}
            </button>
          </>
        )}
      </div>

      <Feedback msg={msg} />

      <div className="mt-5 border-t border-[var(--border)] pt-4">
        <button
          onClick={() => setShowSteps((s) => !s)}
          className="flex items-center gap-1.5 text-sm font-medium text-brand-500 hover:underline"
        >
          {showSteps ? '▾' : '▸'} {t('conta.discord.comoConfigurar')}
        </button>
        {showSteps && (
          <ol className="mt-3 space-y-3">
            {DISCORD_STEPS.map((step, i) => (
              <li key={step} className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-500/15 text-xs font-bold text-brand-500">
                  {i + 1}
                </span>
                <div>
                  <p className="text-sm font-medium text-[var(--text-primary)]">{t(`conta.discord.${step}Titulo`)}</p>
                  <p className="text-sm text-[var(--text-tertiary)]">{t(`conta.discord.${step}`)}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </Section>
  )
}

function LanguageCard() {
  const { language, changeLanguage, t } = useLanguage()
  return (
    <Section title={t('conta.idioma.titulo')} description={t('conta.idioma.desc')}>
      <Select
        className="w-56"
        value={language}
        onChange={changeLanguage}
        options={LANGUAGES.map((l) => ({ value: l.value, label: l.label, icon: l.flag }))}
      />
    </Section>
  )
}

export default function Conta() {
  const { t } = useLanguage()
  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold">{t('conta.titulo')}</h2>
        <p className="text-sm text-[var(--text-muted)]">{t('conta.subtitulo')}</p>
      </div>

      <LanguageCard />
      <PasswordCard />
      <DiscordCard />
    </div>
  )
}

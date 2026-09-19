import { useEffect, useRef, useState } from 'react'
import {
  Activity,
  BadgeCheck,
  BarChart3,
  Bell,
  Bookmark,
  BookOpen,
  Calendar,
  CalendarClock,
  Camera,
  ChevronDown,
  FileText,
  Globe,
  GraduationCap,
  Heart,
  Hash,
  Home,
  Award,
  Crown,
  Gem,
  Image as ImageIcon,
  Link2,
  Medal,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Pin,
  Play,
  Plus,
  Search,
  Send,
  Share2,
  Trash2,
  PlayCircle,
  Shield,
  Sprout,
  Star,
  Trophy,
  UserX,
  Users,
  VolumeX,
  Volume2,
  Wallet,
  X,
} from 'lucide-react'
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { rawApi } from '../api/rawClient.js'
import EmptyState from '../components/EmptyState.jsx'
import TierBadge from '../components/TierBadge.jsx'
import { formatDate, formatDateTime, formatRelativeTime } from '../utils/date.js'
import { resizeImageToDataUrl } from '../utils/avatar.js'

// Identidade visual por comunidade (pedido do usuário, referência tipo
// Skool/Circle: cada embaixador escolhe uma cor). Lista FECHADA de propósito
// — Tailwind só inclui no CSS final classes que aparecem por extenso em
// algum arquivo (JIT scan), então "bg-" + variável não funcionaria; precisa
// de todas as classes escritas por extenso aqui, uma vez por cor.
const ACCENT_COLORS = {
  blue: { grad: 'from-blue-600 via-blue-500 to-indigo-500', text: 'text-blue-500', bg15: 'bg-blue-500/15', dot: 'bg-blue-500', solid: 'bg-blue-500', hex: '#3b82f6', label: 'Azul' },
  violet: { grad: 'from-violet-600 via-violet-500 to-purple-500', text: 'text-violet-500', bg15: 'bg-violet-500/15', dot: 'bg-violet-500', solid: 'bg-violet-500', hex: '#8b5cf6', label: 'Roxo' },
  rose: { grad: 'from-red-600 via-red-500 to-rose-500', text: 'text-red-500', bg15: 'bg-red-500/15', dot: 'bg-red-500', solid: 'bg-red-500', hex: '#ef4444', label: 'Vermelho' },
  orange: { grad: 'from-orange-600 via-orange-500 to-amber-500', text: 'text-orange-500', bg15: 'bg-orange-500/15', dot: 'bg-orange-500', solid: 'bg-orange-500', hex: '#f97316', label: 'Laranja' },
  green: { grad: 'from-emerald-600 via-emerald-500 to-teal-500', text: 'text-emerald-500', bg15: 'bg-emerald-500/15', dot: 'bg-emerald-500', solid: 'bg-emerald-500', hex: '#10b981', label: 'Verde' },
  slate: { grad: 'from-slate-800 via-slate-700 to-slate-600', text: 'text-slate-400', bg15: 'bg-slate-500/15', dot: 'bg-slate-500', solid: 'bg-slate-500', hex: '#475569', label: 'Escuro' },
}

function getAccent(key) {
  return ACCENT_COLORS[key] || ACCENT_COLORS.blue
}

// Selo de antiguidade do MEMBRO na comunidade (pedido do usuário, 2026-09-14):
// sobe de nível conforme o tempo desde que a organização dele entrou
// (joined_at de community_members), não tem relação nenhuma com o
// Gold/Platinum/Diamond do EMBAIXADOR (esse é sobre quantos membros ativos
// ele tem, ver communityTiers.js no backend). `maxMonth` é o último mês
// (inclusive) daquele nível — o "mês 1" é o primeiro mês inteiro de
// comunidade, por isso getMemberLevel soma +1 ao número de meses completos.
const MEMBER_LEVELS = [
  { maxMonth: 3, label: 'Novato', Icon: Sprout, text: 'text-slate-400', solid: 'bg-slate-500', bg15: 'bg-slate-500/15' },
  { maxMonth: 6, label: 'Bronze', Icon: Star, text: 'text-orange-400', solid: 'bg-orange-500', bg15: 'bg-orange-500/15' },
  { maxMonth: 12, label: 'Prata', Icon: Shield, text: 'text-slate-300', solid: 'bg-slate-400', bg15: 'bg-slate-400/15' },
  { maxMonth: 18, label: 'Ouro', Icon: Award, text: 'text-amber-400', solid: 'bg-amber-500', bg15: 'bg-amber-500/15' },
  { maxMonth: 24, label: 'Platina', Icon: Medal, text: 'text-cyan-400', solid: 'bg-cyan-500', bg15: 'bg-cyan-500/15' },
  { maxMonth: 36, label: 'Rubi', Icon: Gem, text: 'text-rose-400', solid: 'bg-rose-500', bg15: 'bg-rose-500/15' },
  { maxMonth: 48, label: 'Safira', Icon: Gem, text: 'text-blue-400', solid: 'bg-blue-500', bg15: 'bg-blue-500/15' },
  { maxMonth: 60, label: 'Esmeralda', Icon: Gem, text: 'text-emerald-400', solid: 'bg-emerald-500', bg15: 'bg-emerald-500/15' },
  { maxMonth: Infinity, label: 'Lenda', Icon: Crown, text: 'text-yellow-300', solid: 'bg-gradient-to-br from-yellow-400 to-amber-600', bg15: 'bg-yellow-500/15' },
]

function monthsSince(dateStr) {
  const joined = new Date(dateStr)
  const now = new Date()
  let months = (now.getFullYear() - joined.getFullYear()) * 12 + (now.getMonth() - joined.getMonth())
  if (now.getDate() < joined.getDate()) months -= 1
  return Math.max(0, months)
}

function getMemberLevel(joinedAt) {
  const monthNumber = monthsSince(joinedAt) + 1
  const idx = MEMBER_LEVELS.findIndex((l) => monthNumber <= l.maxMonth)
  const levelIndex = idx === -1 ? MEMBER_LEVELS.length - 1 : idx
  const level = MEMBER_LEVELS[levelIndex]
  const next = MEMBER_LEVELS[levelIndex + 1]
  const prevMax = levelIndex === 0 ? 0 : MEMBER_LEVELS[levelIndex - 1].maxMonth
  const monthsToNext = next ? level.maxMonth + 1 - monthNumber : null
  const progressPct = next ? Math.min(100, Math.max(0, ((monthNumber - prevMax) / (level.maxMonth - prevMax)) * 100)) : 100
  return { level, next, monthNumber, monthsToNext, progressPct }
}

// Nível por XP (seção 15 do briefing, "Criar níveis... Nível 1 a 5") —
// SEPARADO do selo de antiguidade acima (aquele é por tempo de casa, este
// é por participação real: comentar, votar, concluir conteúdo).
const XP_LEVELS = [
  { max: 99, label: 'Nível 1' },
  { max: 299, label: 'Nível 2' },
  { max: 599, label: 'Nível 3' },
  { max: 999, label: 'Nível 4' },
  { max: Infinity, label: 'Nível 5' },
]

function getXpLevel(xp) {
  return XP_LEVELS.find((l) => xp <= l.max) || XP_LEVELS[XP_LEVELS.length - 1]
}

function MemberLevelBadge({ joinedAt, size = 'sm' }) {
  if (!joinedAt) return null
  const { level } = getMemberLevel(joinedAt)
  const { Icon } = level
  const px = size === 'sm' ? 10 : 12
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${level.bg15} ${level.text}`} title={`${level.label} · membro desde ${formatDate(joinedAt)}`}>
      <Icon size={px} strokeWidth={2.5} />
      {level.label}
    </span>
  )
}

// lucide-react v1.x removeu ícones de marca (Instagram, YouTube, etc. são
// logos registradas) — sem isso o "cantinho de link do Instagram" pedido
// pelo usuário ficava com um ícone genérico (@) que ninguém reconhece de
// cara. SVG minimalista igual ao glifo oficial (quadrado arredondado +
// lente + ponto), sem depender de nenhuma lib nova.
function InstagramIcon({ size = 15, className }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.2" cy="6.8" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  )
}

function Avatar({ src, name, size = 9 }) {
  const px = size * 4
  if (src) {
    return <img src={src} alt="" className="shrink-0 rounded-full object-cover" style={{ width: px, height: px }} />
  }
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-400 to-brand-600 font-semibold text-white"
      style={{ width: px, height: px, fontSize: px * 0.4 }}
    >
      {name?.[0]?.toUpperCase() || '?'}
    </div>
  )
}

function Comment({ comment, ambassadorTier }) {
  return (
    <div className="flex gap-2.5 py-2">
      <div
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
          comment.is_ambassador ? 'bg-brand-500 text-white' : 'bg-[var(--bg-surface-2)] text-[var(--text-muted)]'
        }`}
      >
        {comment.author_name?.[0]?.toUpperCase() || '?'}
      </div>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-[var(--text-primary)]">
          {comment.author_name}
          {comment.is_ambassador ? (
            <BadgeCheck size={13} className="text-brand-500" strokeWidth={2.5} />
          ) : (
            <MemberLevelBadge joinedAt={comment.author_member_since} />
          )}
        </p>
        <p className="mt-0.5 text-sm text-[var(--text-muted)]">{comment.body}</p>
      </div>
    </div>
  )
}

function LikeButton({ post, onToggle }) {
  const [pending, setPending] = useState(false)
  async function handleClick() {
    setPending(true)
    try {
      await onToggle(post.id)
    } finally {
      setPending(false)
    }
  }
  return (
    <button
      onClick={handleClick}
      disabled={pending}
      className={`inline-flex items-center gap-1.5 rounded-lg py-1 text-xs font-semibold transition-colors ${
        post.liked_by_me ? 'text-rose-500' : 'text-[var(--text-muted)] hover:text-rose-500'
      }`}
    >
      <Heart size={15} fill={post.liked_by_me ? 'currentColor' : 'none'} />
      {post.like_count > 0 ? post.like_count : 'Curtir'}
    </button>
  )
}

function SaveButton({ post, onToggle, accent }) {
  const [pending, setPending] = useState(false)
  async function handleClick() {
    setPending(true)
    try {
      await onToggle(post.id)
    } finally {
      setPending(false)
    }
  }
  return (
    <button
      onClick={handleClick}
      disabled={pending}
      title={post.saved_by_me ? 'Remover dos salvos' : 'Salvar post'}
      className={`ml-auto inline-flex items-center rounded-lg py-1 transition-colors ${post.saved_by_me ? accent.text : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'}`}
    >
      <Bookmark size={16} fill={post.saved_by_me ? 'currentColor' : 'none'} />
    </button>
  )
}

function ShareButton({ postId }) {
  const [copied, setCopied] = useState(false)
  const [manualUrl, setManualUrl] = useState(null)

  async function handleClick() {
    const url = `${window.location.origin}${window.location.pathname}#post-${postId}`
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setManualUrl(url)
    }
  }

  return (
    <>
      <button
        onClick={handleClick}
        title="Copiar link do post"
        className="inline-flex items-center gap-1.5 rounded-lg py-1 text-xs font-semibold text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
      >
        <Share2 size={15} />
        {copied && <span>Link copiado!</span>}
      </button>
      {manualUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setManualUrl(null)}>
          <div className="w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <p className="text-sm font-semibold text-[var(--text-primary)]">Copie o link do post</p>
            <p className="mt-1 text-xs text-[var(--text-muted)]">Não deu pra copiar automaticamente — selecione o link abaixo.</p>
            <input
              readOnly
              value={manualUrl}
              onFocus={(e) => e.target.select()}
              className="mt-3 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-surface-2)] px-3 py-2 text-sm text-[var(--text-primary)]"
            />
            <div className="mt-4 flex justify-end">
              <button onClick={() => setManualUrl(null)} className="rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-brand-700">
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function PostMenu({ post, onEdit, onDelete, onTogglePin }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)} className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[var(--hover-surface)]">
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-20 mt-1 w-40 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] shadow-xl">
            <button
              onClick={() => {
                setOpen(false)
                onTogglePin(post.id)
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-[var(--text-primary)] hover:bg-[var(--hover-surface)]"
            >
              <Pin size={13} /> {post.pinned ? 'Desafixar' : 'Fixar no topo'}
            </button>
            <button
              onClick={() => {
                setOpen(false)
                onEdit(post)
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-[var(--text-primary)] hover:bg-[var(--hover-surface)]"
            >
              <Pencil size={13} /> Editar
            </button>
            <button
              onClick={() => {
                setOpen(false)
                onDelete(post.id)
              }}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-red-400 hover:bg-red-500/10"
            >
              <Trash2 size={13} /> Apagar
            </button>
          </div>
        </>
      )}
    </div>
  )
}

function PostEditForm({ post, onSave, onCancel }) {
  const [body, setBody] = useState(post.body)
  const [imageUrl, setImageUrl] = useState(post.image_url)
  const [saving, setSaving] = useState(false)
  const fileRef = useRef(null)

  async function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setImageUrl(await resizeImageToDataUrl(file, 1200, 0.85))
  }

  async function submit(e) {
    e.preventDefault()
    setSaving(true)
    try {
      await onSave(post.id, body.trim(), imageUrl)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        className="w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--bg-surface-2)] px-3 py-2 text-sm text-[var(--text-primary)] focus:border-brand-500 focus:outline-none"
      />
      {imageUrl && <img src={imageUrl} alt="" className="max-h-48 rounded-lg" />}
      <div className="flex items-center gap-2">
        <button type="submit" disabled={saving} className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-60">
          {saving ? 'Salvando…' : 'Salvar'}
        </button>
        <label className="cursor-pointer rounded-lg px-3 py-1.5 text-xs text-[var(--text-muted)] hover:bg-[var(--hover-surface)]">
          Trocar imagem
          <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} className="hidden" />
        </label>
        <button type="button" onClick={onCancel} className="rounded-lg px-3 py-1.5 text-xs text-[var(--text-muted)] hover:bg-[var(--hover-surface)]">
          Cancelar
        </button>
      </div>
    </form>
  )
}

function PollDisplay({ post, onVote }) {
  const [voting, setVoting] = useState(false)
  const { poll } = post
  if (!poll) return null

  async function handleVote(optionId) {
    if (voting) return
    setVoting(true)
    try {
      await onVote(post.id, optionId)
    } finally {
      setVoting(false)
    }
  }

  return (
    <div className="mt-3 space-y-2">
      {poll.options.map((o) => {
        const pct = poll.totalVotes > 0 ? Math.round((o.voteCount / poll.totalVotes) * 100) : 0
        const isMine = poll.myOptionId === o.id
        const showResults = poll.myOptionId !== null
        return (
          <button
            key={o.id}
            type="button"
            disabled={voting}
            onClick={() => handleVote(o.id)}
            className={`relative block w-full overflow-hidden rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
              isMine ? 'border-brand-500' : 'border-[var(--border)] hover:border-brand-500/40'
            }`}
          >
            {showResults && <div className="absolute inset-y-0 left-0 bg-brand-500/15" style={{ width: `${pct}%` }} />}
            <div className="relative flex items-center justify-between gap-2">
              <span className={isMine ? 'font-semibold text-brand-500' : 'text-[var(--text-primary)]'}>{o.label}</span>
              {showResults && <span className="shrink-0 text-xs text-[var(--text-faint)]">{pct}%</span>}
            </div>
          </button>
        )
      })}
      <p className="text-xs text-[var(--text-faint)]">
        {poll.totalVotes} voto{poll.totalVotes === 1 ? '' : 's'}
        {poll.myOptionId === null && ' · toque numa opção pra votar'}
      </p>
    </div>
  )
}

function PostCard({ post, community, ambassadorTier, isOwner, onComment, onToggleLike, onToggleSave, onVotePoll, onEdit, onDelete, onTogglePin }) {
  const [commentText, setCommentText] = useState('')
  const [sending, setSending] = useState(false)
  const [editing, setEditing] = useState(false)
  const [showComments, setShowComments] = useState(post.comments.length > 0)

  async function submitComment(e) {
    e.preventDefault()
    if (!commentText.trim()) return
    setSending(true)
    try {
      await onComment(post.id, commentText.trim())
      setCommentText('')
      setShowComments(true)
    } finally {
      setSending(false)
    }
  }

  async function handleSaveEdit(postId, body, imageUrl) {
    await onEdit(postId, body, imageUrl)
    setEditing(false)
  }

  const accent = getAccent(community.accent_color)

  return (
    <div
      className={`rounded-2xl border bg-[var(--bg-surface)] p-5 shadow-sm transition-shadow hover:shadow-md ${
        post.pinned ? 'border-brand-500/40 ring-1 ring-brand-500/20' : 'border-[var(--border)]'
      }`}
    >
      {post.pinned && (
        <div className="mb-3 flex items-center gap-1.5 text-xs font-semibold text-brand-500">
          <Pin size={12} fill="currentColor" /> Fixado
        </div>
      )}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="relative shrink-0">
            <Avatar src={community.photo_url} name={community.name} size={14} />
            <span className={`absolute bottom-0 right-0 flex h-5 w-5 items-center justify-center rounded-full text-white ring-2 ring-[var(--bg-surface)] ${accent.solid}`}>
              <BadgeCheck size={13} strokeWidth={2.5} />
            </span>
          </div>
          <div>
            <p className="flex flex-wrap items-center gap-1.5 text-base font-semibold text-[var(--text-primary)]">{community.name}</p>
            <p className={`text-xs font-medium ${accent.text}`}>Embaixador</p>
            <p className="text-xs text-[var(--text-faint)]">{formatDateTime(post.created_at)}</p>
          </div>
        </div>
        {isOwner && !editing && <PostMenu post={post} onEdit={() => setEditing(true)} onDelete={onDelete} onTogglePin={onTogglePin} />}
      </div>

      <div className="mt-3">
        {editing ? (
          <PostEditForm post={post} onSave={handleSaveEdit} onCancel={() => setEditing(false)} />
        ) : (
          <>
            <p className="whitespace-pre-wrap text-sm text-[var(--text-primary)]">{post.body}</p>
            {post.image_url && <img src={post.image_url} alt="" className="mt-3 max-h-96 w-full rounded-xl object-cover" />}
            <PollDisplay post={post} onVote={onVotePoll} />
          </>
        )}
      </div>

      {!editing && (
        <>
          <div className="mt-4 flex items-center gap-5 border-t border-[var(--border)] pt-3">
            <LikeButton post={post} onToggle={onToggleLike} />
            <button
              onClick={() => setShowComments((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-lg py-1 text-xs font-semibold text-[var(--text-muted)] transition-colors hover:text-brand-500"
            >
              <MessageCircle size={15} />
              {post.comments.length > 0 ? post.comments.length : 'Comentar'}
            </button>
            <ShareButton postId={post.id} />
            <SaveButton post={post} onToggle={onToggleSave} accent={accent} />
          </div>

          {showComments && (
            <>
              <div className="mt-1 divide-y divide-[var(--border)]">
                {post.comments.map((c) => (
                  <Comment key={c.id} comment={c} ambassadorTier={ambassadorTier} />
                ))}
              </div>
              <form onSubmit={submitComment} className="mt-3 flex items-center gap-2">
                <Avatar name={community.name} size={7} />
                <input
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  placeholder="Escreva um comentário…"
                  className="flex-1 rounded-full border border-[var(--border)] bg-[var(--bg-surface-2)] px-4 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-brand-500 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={sending || !commentText.trim()}
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-white shadow-sm hover:brightness-110 disabled:opacity-40 ${accent.grad}`}
                >
                  <Send size={15} />
                </button>
              </form>
            </>
          )}
        </>
      )}
    </div>
  )
}

function Composer({ communityId, channelId, onPosted, onCollapse }) {
  const [body, setBody] = useState('')
  const [imageUrl, setImageUrl] = useState(null)
  const [pollEnabled, setPollEnabled] = useState(false)
  const [pollOptions, setPollOptions] = useState(['', ''])
  const [scheduleEnabled, setScheduleEnabled] = useState(false)
  const [scheduleDate, setScheduleDate] = useState('')
  const [scheduleTime, setScheduleTime] = useState('')
  const [posting, setPosting] = useState(false)
  const [error, setError] = useState(null)
  const fileRef = useRef(null)

  async function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      setImageUrl(await resizeImageToDataUrl(file, 1200, 0.85))
    } catch (err) {
      setError(err.message)
    }
  }

  function updatePollOption(i, value) {
    setPollOptions((opts) => opts.map((o, idx) => (idx === i ? value : o)))
  }

  function addPollOption() {
    setPollOptions((opts) => (opts.length < 6 ? [...opts, ''] : opts))
  }

  function removePollOption(i) {
    setPollOptions((opts) => (opts.length > 2 ? opts.filter((_, idx) => idx !== i) : opts))
  }

  async function submit(e) {
    e.preventDefault()
    if (!body.trim()) return
    const validPollOptions = pollEnabled ? pollOptions.map((o) => o.trim()).filter(Boolean) : null
    if (pollEnabled && validPollOptions.length < 2) {
      setError('A enquete precisa de pelo menos 2 opções preenchidas.')
      return
    }
    let scheduledAt
    if (scheduleEnabled) {
      if (!scheduleDate || !scheduleTime) {
        setError('Escolha data e horário pra agendar.')
        return
      }
      scheduledAt = new Date(`${scheduleDate}T${scheduleTime}`).toISOString()
    }
    setPosting(true)
    setError(null)
    try {
      await rawApi.createCommunityPost(communityId, channelId, body.trim(), imageUrl, { scheduledAt, pollOptions: validPollOptions })
      setBody('')
      setImageUrl(null)
      setPollEnabled(false)
      setPollOptions(['', ''])
      setScheduleEnabled(false)
      setScheduleDate('')
      setScheduleTime('')
      if (fileRef.current) fileRef.current.value = ''
      onPosted()
      onCollapse()
    } catch (err) {
      setError(err.message)
    } finally {
      setPosting(false)
    }
  }

  return (
    <form onSubmit={submit} className="rounded-2xl border border-brand-500/30 bg-[var(--bg-surface)] p-5">
      <textarea
        autoFocus
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={pollEnabled ? 'Pergunta da enquete…' : 'Compartilhe uma campanha que vendeu, um teste de produto, uma dica…'}
        rows={3}
        className="w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--bg-surface-2)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-brand-500 focus:outline-none"
      />
      {imageUrl && (
        <div className="relative mt-2 inline-block">
          <img src={imageUrl} alt="" className="max-h-48 rounded-lg" />
          <button
            type="button"
            onClick={() => {
              setImageUrl(null)
              if (fileRef.current) fileRef.current.value = ''
            }}
            className="absolute right-1.5 top-1.5 rounded-full bg-black/60 p-1 text-white hover:bg-black/80"
          >
            <X size={13} />
          </button>
        </div>
      )}

      {pollEnabled && (
        <div className="mt-3 space-y-2 rounded-lg border border-[var(--border)] bg-[var(--bg-surface-2)] p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-[var(--text-muted)]">Opções da enquete</p>
            <button type="button" onClick={() => setPollEnabled(false)} className="text-[var(--text-faint)] hover:text-red-400">
              <X size={14} />
            </button>
          </div>
          {pollOptions.map((opt, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <input
                value={opt}
                onChange={(e) => updatePollOption(i, e.target.value)}
                placeholder={`Opção ${i + 1}`}
                className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-brand-500 focus:outline-none"
              />
              {pollOptions.length > 2 && (
                <button type="button" onClick={() => removePollOption(i)} className="rounded-lg p-1.5 text-[var(--text-faint)] hover:text-red-400">
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          ))}
          {pollOptions.length < 6 && (
            <button type="button" onClick={addPollOption} className="inline-flex items-center gap-1 text-xs font-medium text-brand-500 hover:underline">
              <Plus size={12} /> Adicionar opção
            </button>
          )}
        </div>
      )}

      {scheduleEnabled && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-surface-2)] p-3">
          <CalendarClock size={15} className="shrink-0 text-[var(--text-faint)]" />
          <input
            type="date"
            value={scheduleDate}
            onChange={(e) => setScheduleDate(e.target.value)}
            className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-sm text-[var(--text-primary)] focus:border-brand-500 focus:outline-none"
          />
          <input
            type="time"
            value={scheduleTime}
            onChange={(e) => setScheduleTime(e.target.value)}
            className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-2.5 py-1.5 text-sm text-[var(--text-primary)] focus:border-brand-500 focus:outline-none"
          />
          <button type="button" onClick={() => setScheduleEnabled(false)} className="ml-auto text-[var(--text-faint)] hover:text-red-400">
            <X size={14} />
          </button>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <label className="inline-flex cursor-pointer items-center gap-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)]">
            <ImageIcon size={16} />
            Imagem
            <input ref={fileRef} type="file" accept="image/*" onChange={handleFile} className="hidden" />
          </label>
          {!pollEnabled && (
            <button type="button" onClick={() => setPollEnabled(true)} className="inline-flex items-center gap-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)]">
              <BarChart3 size={16} /> Enquete
            </button>
          )}
          {!scheduleEnabled && (
            <button type="button" onClick={() => setScheduleEnabled(true)} className="inline-flex items-center gap-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)]">
              <CalendarClock size={16} /> Agendar
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onCollapse} className="rounded-lg px-3 py-2 text-sm text-[var(--text-muted)] hover:bg-[var(--hover-surface)]">
            Cancelar
          </button>
          <button
            type="submit"
            disabled={posting || !body.trim()}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {posting ? 'Publicando…' : scheduleEnabled ? 'Agendar' : 'Publicar'}
          </button>
        </div>
      </div>
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </form>
  )
}

function AmbassadorSetup({ onCreated }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [photoUrl, setPhotoUrl] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  async function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      setPhotoUrl(await resizeImageToDataUrl(file, 400, 0.85))
    } catch (err) {
      setError(err.message)
    }
  }

  async function submit(e) {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    setError(null)
    try {
      await rawApi.setupCommunity(name.trim(), photoUrl)
      if (description.trim()) {
        // setup não aceita descrição direto (endpoint de criação só pede nome
        // pra ficar rápido) — grava em seguida com o PATCH normal, já que a
        // comunidade acabou de ser criada.
        const status = await rawApi.getCommunityStatus()
        if (status.ambassadorCommunity) {
          await rawApi.updateCommunity(status.ambassadorCommunity.id, { name: name.trim(), description: description.trim(), photoUrl })
        }
      }
      onCreated()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-2xl border border-brand-500/25 bg-[var(--bg-surface)] p-6">
      <h3 className="text-sm font-semibold text-[var(--text-primary)]">Criar sua comunidade</h3>
      <p className="mt-1 text-sm text-[var(--text-muted)]">
        Você é embaixador. Dê um nome pra sua comunidade pra começar a postar conteúdo pros seus membros.
      </p>
      <form onSubmit={submit} className="mt-4 space-y-3">
        <div className="flex items-center gap-3">
          <label className="flex h-14 w-14 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-2xl border border-dashed border-[var(--border)] bg-[var(--bg-surface-2)] text-[var(--text-faint)] hover:border-brand-500">
            {photoUrl ? <img src={photoUrl} alt="" className="h-full w-full object-cover" /> : <ImageIcon size={18} />}
            <input type="file" accept="image/*" onChange={handleFile} className="hidden" />
          </label>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ex: Comunidade Rafael Monteiro"
            className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg-surface-2)] px-3 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-brand-500 focus:outline-none"
          />
        </div>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Descrição da comunidade (opcional)"
          rows={2}
          className="w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--bg-surface-2)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-brand-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {saving ? 'Criando…' : 'Criar comunidade'}
        </button>
        {error && <p className="text-xs text-red-400">{error}</p>}
      </form>
    </div>
  )
}

function Directory({ onJoined }) {
  const [communities, setCommunities] = useState(null)
  const [joiningId, setJoiningId] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    rawApi.listCommunityDirectory().then(setCommunities).catch((e) => setError(e.message))
  }, [])

  async function handleJoin(id) {
    setJoiningId(id)
    setError(null)
    try {
      await rawApi.joinCommunity(id)
      onJoined()
    } catch (err) {
      setError(err.message)
    } finally {
      setJoiningId(null)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Comunidade</h2>
        <p className="text-sm text-[var(--text-muted)]">
          Participe da comunidade de um embaixador pra acompanhar conteúdo exclusivo. Depois de entrar não dá pra
          trocar de comunidade, escolha com calma.
        </p>
      </div>
      {error && <EmptyState title="Não deu pra carregar" subtitle={error} />}
      {communities?.length === 0 && <EmptyState title="Nenhuma comunidade disponível ainda" subtitle="Volte mais tarde." />}
      <div className="grid gap-3 sm:grid-cols-2">
        {(communities || []).map((c) => (
          <div key={c.id} className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-5">
            <div className="flex items-center gap-3">
              <Avatar src={c.photo_url} name={c.community_name} size={12} />
              <div>
                <p className="font-semibold text-[var(--text-primary)]">{c.community_name}</p>
                <p className="text-xs text-[var(--text-muted)]">
                  por {c.ambassador_name} · {c.active_member_count} membro{c.active_member_count === 1 ? '' : 's'}
                </p>
                {c.description && <p className="mt-0.5 text-xs text-[var(--text-faint)]">{c.description}</p>}
              </div>
            </div>
            <button
              onClick={() => handleJoin(c.id)}
              disabled={joiningId === c.id}
              className="shrink-0 rounded-lg bg-brand-600 px-3.5 py-2 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {joiningId === c.id ? 'Entrando…' : 'Participar'}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

function TierProgress({ stats, tiers }) {
  const currentIndex = tiers.findIndex((t) => t.name === stats.tier)
  const current = tiers[currentIndex]
  const next = tiers[currentIndex + 1]
  const remaining = next ? Math.max(0, current.max + 1 - stats.activeMemberCount) : 0
  const prevMax = currentIndex <= 0 ? 0 : tiers[currentIndex - 1].max + 1
  const levelSpan = next ? current.max - prevMax + 1 : 1
  const progressPct = next ? Math.min(100, Math.max(0, ((stats.activeMemberCount - prevMax) / levelSpan) * 100)) : 100
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-5">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <TierBadge tier={stats.tier} size="lg" />
          <div>
            <p className="text-lg font-semibold text-[var(--text-primary)]">Nível {current?.label}</p>
            <p className="text-sm text-[var(--text-muted)]">
              {stats.activeMemberCount} membro{stats.activeMemberCount === 1 ? '' : 's'} ativo{stats.activeMemberCount === 1 ? '' : 's'} na
              comunidade · o nível {stats.tierPercentage}% só é pago sobre a recorrência de quem você trouxe
            </p>
          </div>
        </div>
        {next && (
          <p className="max-w-[180px] text-right text-xs text-[var(--text-muted)]">
            Faltam {remaining} pra chegar em {next.label} ({next.percentage}%)
          </p>
        )}
      </div>
      {next ? (
        <div className="mt-4">
          <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--bg-surface-2)]">
            <div className="h-full rounded-full bg-gradient-to-r from-amber-400 to-amber-600 transition-all" style={{ width: `${progressPct}%` }} />
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-[var(--text-faint)]">
            <span>{current?.label}</span>
            <span>{next.label}</span>
          </div>
        </div>
      ) : (
        <p className="mt-4 text-xs font-medium text-amber-500">Nível máximo atingido 🎉</p>
      )}
      <p className="mt-3 text-[11px] text-[var(--text-faint)]">
        O nível cresce com o tamanho total da comunidade (todo mundo, mesmo quem achou o ScoutX sozinho e entrou
        pelo diretório) — mas você só RECEBE essa % sobre a recorrência de quem entrou pelo seu link de afiliado.
      </p>
    </div>
  )
}

// Caminho completo dos níveis do embaixador — pedido do usuário: antes só
// dava pra ver "falta X pro próximo", sem enxergar TODOS os degraus e a
// vantagem (% de comissão) de cada um de uma vez.
function TierRoadmap({ stats, tiers }) {
  const currentIndex = tiers.findIndex((t) => t.name === stats.tier)
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-5">
      <p className="mb-4 text-sm font-semibold text-[var(--text-primary)]">Caminho de níveis</p>
      <div className="grid gap-3 sm:grid-cols-3">
        {tiers.map((t, i) => {
          const reached = i <= currentIndex
          const isCurrent = i === currentIndex
          const rangeLabel =
            i === 0
              ? `Até ${t.max} membros ativos`
              : t.max === null
                ? `Acima de ${tiers[i - 1].max} membros ativos`
                : `${tiers[i - 1].max + 1}–${t.max} membros ativos`
          return (
            <div
              key={t.name}
              className={`relative rounded-xl border p-4 ${
                isCurrent ? 'border-amber-500/50 bg-amber-500/5' : reached ? 'border-[var(--border)] bg-[var(--bg-surface-2)]' : 'border-dashed border-[var(--border)] opacity-60'
              }`}
            >
              {isCurrent && (
                <span className="absolute -top-2 right-3 rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-bold text-white">VOCÊ ESTÁ AQUI</span>
              )}
              <div className="flex items-center gap-2.5">
                <TierBadge tier={t.name} size="sm" />
                <div>
                  <p className="text-sm font-semibold text-[var(--text-primary)]">{t.label}</p>
                  <p className="text-xs text-[var(--text-faint)]">{rangeLabel}</p>
                </div>
              </div>
              <p className="mt-2 text-xs text-[var(--text-muted)]">
                Ganha <span className="font-semibold text-[var(--text-primary)]">{t.percentage}%</span> da recorrência de todo membro ativo
              </p>
              {reached && !isCurrent && <p className="mt-1 text-[10px] font-medium text-emerald-500">✓ Já alcançado</p>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function CommunityEditPanel({ community, onSaved, onClose }) {
  const [name, setName] = useState(community.name)
  const [description, setDescription] = useState(community.description || '')
  const [photoUrl, setPhotoUrl] = useState(community.photo_url)
  const [bannerUrl, setBannerUrl] = useState(community.banner_url)
  const [accentColor, setAccentColor] = useState(community.accent_color || 'blue')
  const [instagramUrl, setInstagramUrl] = useState(community.instagram_url || '')
  const [youtubeUrl, setYoutubeUrl] = useState(community.youtube_url || '')
  const [websiteUrl, setWebsiteUrl] = useState(community.website_url || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  async function handlePhotoFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      setPhotoUrl(await resizeImageToDataUrl(file, 400, 0.85))
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleBannerFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    try {
      setBannerUrl(await resizeImageToDataUrl(file, 1600, 0.85))
    } catch (err) {
      setError(err.message)
    }
  }

  async function submit(e) {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await rawApi.updateCommunity(community.id, {
        name: name.trim(),
        description,
        photoUrl,
        bannerUrl,
        accentColor,
        instagramUrl: instagramUrl.trim(),
        youtubeUrl: youtubeUrl.trim(),
        websiteUrl: websiteUrl.trim(),
      })
      onSaved()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-5">
      <div>
        <p className="mb-1.5 text-xs font-semibold text-[var(--text-muted)]">Banner</p>
        <label className="relative flex h-32 w-full cursor-pointer items-center justify-center overflow-hidden rounded-xl border border-dashed border-[var(--border)] bg-[var(--bg-surface-2)] text-[var(--text-faint)] hover:border-brand-500">
          {bannerUrl ? (
            <img src={bannerUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="flex flex-col items-center gap-1 text-xs">
              <ImageIcon size={20} /> Escolher banner (recomendado 1600×400)
            </span>
          )}
          <input type="file" accept="image/*" onChange={handleBannerFile} className="hidden" />
        </label>
      </div>
      <div className="flex items-center gap-3">
        <label className="flex h-14 w-14 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-2xl border border-dashed border-[var(--border)] bg-[var(--bg-surface-2)] text-[var(--text-faint)] hover:border-brand-500">
          {photoUrl ? <img src={photoUrl} alt="" className="h-full w-full object-cover" /> : <ImageIcon size={16} />}
          <input type="file" accept="image/*" onChange={handlePhotoFile} className="hidden" />
        </label>
        <input
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg-surface-2)] px-2.5 py-2 text-sm text-[var(--text-primary)] focus:border-brand-500 focus:outline-none"
        />
      </div>
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Descrição da comunidade (opcional)"
        rows={2}
        className="w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--bg-surface-2)] px-2.5 py-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-brand-500 focus:outline-none"
      />
      <div className="grid gap-2 sm:grid-cols-3">
        <input
          value={instagramUrl}
          onChange={(e) => setInstagramUrl(e.target.value)}
          placeholder="Link do Instagram"
          className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface-2)] px-2.5 py-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-brand-500 focus:outline-none"
        />
        <input
          value={youtubeUrl}
          onChange={(e) => setYoutubeUrl(e.target.value)}
          placeholder="Link do YouTube"
          className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface-2)] px-2.5 py-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-brand-500 focus:outline-none"
        />
        <input
          value={websiteUrl}
          onChange={(e) => setWebsiteUrl(e.target.value)}
          placeholder="Link do site"
          className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface-2)] px-2.5 py-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-brand-500 focus:outline-none"
        />
      </div>
      <div>
        <p className="mb-1.5 text-xs font-semibold text-[var(--text-muted)]">Cor da comunidade</p>
        <div className="flex flex-wrap gap-2">
          {Object.entries(ACCENT_COLORS).map(([key, c]) => (
            <button
              key={key}
              type="button"
              onClick={() => setAccentColor(key)}
              title={c.label}
              className={`h-8 w-8 rounded-full bg-gradient-to-br ${c.grad} transition-transform ${
                accentColor === key ? 'ring-2 ring-offset-2 ring-offset-[var(--bg-surface)] ring-[var(--text-primary)] scale-105' : 'hover:scale-105'
              }`}
            />
          ))}
        </div>
      </div>

      <div>
        <p className="mb-1.5 text-xs font-semibold text-[var(--text-muted)]">Preview (como os membros vão ver)</p>
        <div className="overflow-hidden rounded-2xl border border-[var(--border)]">
          <div className={`relative h-16 w-full bg-gradient-to-br ${ACCENT_COLORS[accentColor].grad}`}>
            {bannerUrl && <img src={bannerUrl} alt="" className="h-full w-full object-cover" />}
          </div>
          <div className="flex items-center gap-2.5 bg-[var(--bg-surface-2)] px-3 py-2.5">
            <Avatar src={photoUrl} name={name || community.name} size={9} />
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold text-[var(--text-primary)]">{name || community.name}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-60"
        >
          {saving ? 'Salvando…' : 'Salvar'}
        </button>
        <button type="button" onClick={onClose} className="rounded-lg px-3 py-1.5 text-xs text-[var(--text-muted)] hover:bg-[var(--hover-surface)]">
          Cancelar
        </button>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </form>
  )
}

const STAT_COLORS = {
  blue: { bg: 'bg-sky-500/15', text: 'text-sky-500' },
  violet: { bg: 'bg-violet-500/15', text: 'text-violet-500' },
  rose: { bg: 'bg-rose-500/15', text: 'text-rose-500' },
  amber: { bg: 'bg-amber-500/15', text: 'text-amber-500' },
}

function StatPill({ icon: Icon, value, label, color = 'blue' }) {
  const c = STAT_COLORS[color] || STAT_COLORS.blue
  return (
    <div className="flex flex-1 items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] px-4 py-3 shadow-sm transition-shadow hover:shadow-md sm:flex-none sm:min-w-[150px]">
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${c.bg} ${c.text}`}>
        <Icon size={18} strokeWidth={2.25} />
      </div>
      <div className="leading-tight">
        <p className="text-lg font-bold text-[var(--text-primary)]">{value}</p>
        <p className="text-[11px] font-medium text-[var(--text-faint)]">{label}</p>
      </div>
    </div>
  )
}

// Banner estilo canal do YouTube: imagem larga no topo com o avatar da
// comunidade sobreposto na borda inferior. Substitui o antigo bloco de
// identidade que ficava dentro da ChannelSidebar (community.photo_url +
// nome) — agora é o cabeçalho único de toda a área de Comunidade, dono ou
// membro, com os totais (posts/curtidas/comentários) que antes não
// apareciam em lugar nenhum.
function CommunityHeader({ community, isOwner, activeMemberCount, contentStats, ambassadorTier, onUpdated }) {
  const [editing, setEditing] = useState(false)

  if (editing) {
    return (
      <CommunityEditPanel
        community={community}
        onClose={() => setEditing(false)}
        onSaved={() => {
          setEditing(false)
          onUpdated()
        }}
      />
    )
  }

  const accent = getAccent(community.accent_color)

  return (
    <div className="rounded-3xl border border-[var(--border)] bg-[var(--bg-surface)] shadow-sm">
      <div className={`relative h-40 w-full overflow-hidden rounded-t-3xl bg-gradient-to-br sm:h-56 ${accent.grad}`}>
        {community.banner_url ? (
          <img src={community.banner_url} alt="" className="h-full w-full object-cover" />
        ) : (
          <div
            className="absolute inset-0 opacity-40"
            style={{
              backgroundImage: 'radial-gradient(rgba(255,255,255,0.35) 1.5px, transparent 1.5px)',
              backgroundSize: '18px 18px',
            }}
          />
        )}
        {/* Escurece a base do banner pra garantir contraste do nome/avatar
            por cima, não importa a cor/foto que o embaixador escolher —
            sem isso um banner claro ou muito "cheio" (foto de produto,
            texto grande) fazia o nome da comunidade sumir por cima dele. */}
        <div className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/75 via-black/20 to-transparent" />
        {isOwner && (
          <button
            onClick={() => setEditing(true)}
            className="absolute right-3 top-3 z-20 inline-flex items-center gap-1.5 rounded-full bg-black/50 px-3.5 py-2 text-xs font-semibold text-white shadow-lg backdrop-blur transition-colors hover:bg-black/70"
          >
            <Camera size={13} /> Editar comunidade
          </button>
        )}
      </div>
      <div className="relative px-6 pb-6">
        <div className="relative z-10 -mt-14 flex items-end gap-4 sm:-mt-20">
          <div className="relative shrink-0">
            <div className="rounded-full ring-[6px] ring-[var(--bg-surface)]">
              <Avatar src={community.photo_url} name={community.name} size={32} />
            </div>
            <span
              className={`absolute bottom-1 right-1 flex h-8 w-8 items-center justify-center rounded-full text-white ring-4 ring-[var(--bg-surface)] ${accent.solid}`}
            >
              <BadgeCheck size={18} strokeWidth={2.5} />
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2 pb-2">
            <p className="text-2xl font-bold text-[var(--text-primary)] [text-shadow:0_1px_6px_rgba(0,0,0,0.85)]">
              {community.name}
            </p>
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold text-white shadow-sm ${accent.solid}`}
            >
              <BadgeCheck size={12} strokeWidth={2.5} /> Embaixador
            </span>
          </div>
        </div>

        {/* Descrição/redes fora da linha do avatar de propósito — dividir
            com o avatar (que é estreito e alto) espremia o texto numa coluna
            fina e quebrava feio; em largura cheia fica organizado mesmo com
            nome+descrição longos. */}
        <div className="relative z-10 mt-3 max-w-2xl space-y-2">
          {community.description && (
            <p className="text-sm leading-relaxed text-[var(--text-muted)]">{community.description}</p>
          )}
          {(community.instagram_url || community.youtube_url || community.website_url) && (
            <div className="flex flex-wrap items-center gap-3 pt-0.5">
              {community.instagram_url && (
                <a
                  href={community.instagram_url}
                  target="_blank"
                  rel="noreferrer"
                  title="Instagram"
                  className="transition-opacity hover:opacity-75"
                  style={{ color: '#dd2a7b' }}
                >
                  <InstagramIcon size={17} />
                </a>
              )}
              {community.youtube_url && (
                <a
                  href={community.youtube_url}
                  target="_blank"
                  rel="noreferrer"
                  title="YouTube"
                  className="text-red-600 transition-opacity hover:opacity-75"
                >
                  <PlayCircle size={17} />
                </a>
              )}
              {community.website_url && (
                <a
                  href={community.website_url}
                  target="_blank"
                  rel="noreferrer"
                  title="Site"
                  className="text-sky-600 transition-opacity hover:opacity-75"
                >
                  <Globe size={17} />
                </a>
              )}
            </div>
          )}
        </div>

        <div className="mt-5 flex flex-wrap gap-2.5">
          <StatPill icon={Users} value={activeMemberCount} label={activeMemberCount === 1 ? 'Membro' : 'Membros'} color="blue" />
          <StatPill icon={Hash} value={contentStats.postCount} label={contentStats.postCount === 1 ? 'Post' : 'Posts na comunidade'} color="violet" />
          <StatPill icon={Heart} value={contentStats.likeCount} label="Curtidas" color="rose" />
          <StatPill icon={MessageCircle} value={contentStats.commentCount} label="Comentários" color="amber" />
        </div>
      </div>
    </div>
  )
}

function NewChannelForm({ communityId, onCreated }) {
  const [name, setName] = useState('')
  const [groupName, setGroupName] = useState('')
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)

  async function submit(e) {
    e.preventDefault()
    if (!name.trim()) return
    setCreating(true)
    try {
      const channel = await rawApi.createCommunityChannel(communityId, name.trim(), groupName.trim())
      setName('')
      setGroupName('')
      setOpen(false)
      onCreated(channel.id)
    } finally {
      setCreating(false)
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-left text-xs text-[var(--text-muted)] hover:bg-[var(--hover-surface)]"
      >
        <Plus size={13} /> Novo canal
      </button>
    )
  }

  return (
    <form onSubmit={submit} className="space-y-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-surface-2)] p-2">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Nome do canal"
        className="w-full rounded-md border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-1.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-brand-500 focus:outline-none"
      />
      <input
        value={groupName}
        onChange={(e) => setGroupName(e.target.value)}
        placeholder="Categoria (opcional)"
        className="w-full rounded-md border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-1.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-brand-500 focus:outline-none"
      />
      <div className="flex items-center gap-1.5">
        <button
          type="submit"
          disabled={creating || !name.trim()}
          className="flex-1 rounded-md bg-brand-600 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          Criar
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded-md px-2 py-1.5 text-xs text-[var(--text-muted)] hover:bg-[var(--hover-surface)]">
          Cancelar
        </button>
      </div>
    </form>
  )
}

// Substitui window.confirm/window.alert (popup feio do navegador, fora do
// tema do app) por um modal com a mesma cara do resto da Comunidade.
function ConfirmDialog({ title, message, confirmLabel = 'Confirmar', danger = false, onConfirm, onCancel }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onCancel}>
      <div className="w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <p className="text-sm font-semibold text-[var(--text-primary)]">{title}</p>
        {message && <p className="mt-1.5 text-sm text-[var(--text-muted)]">{message}</p>}
        <div className="mt-4 flex justify-end gap-2">
          {onCancel && (
            <button onClick={onCancel} className="rounded-lg px-3.5 py-2 text-sm font-medium text-[var(--text-muted)] hover:bg-[var(--hover-surface)]">
              Cancelar
            </button>
          )}
          <button
            onClick={onConfirm}
            className={`rounded-lg px-3.5 py-2 text-sm font-semibold text-white ${danger ? 'bg-red-600 hover:bg-red-700' : 'bg-brand-600 hover:bg-brand-700'}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

function ChannelSidebar({ community, channels, activeChannelId, isOwner, onSelectChannel, onChannelsChanged }) {
  const [channelToDelete, setChannelToDelete] = useState(null)
  const [deleteError, setDeleteError] = useState(null)

  async function confirmDeleteChannel() {
    const channelId = channelToDelete
    setChannelToDelete(null)
    try {
      await rawApi.deleteCommunityChannel(channelId)
      onChannelsChanged()
    } catch (err) {
      setDeleteError(err.message)
    }
  }

  function handleDeleteChannel(channelId) {
    setChannelToDelete(channelId)
  }

  // Agrupa por group_name (canais sem categoria caem num grupo "Canais"
  // genérico, sempre por último) — pedido do usuário pra parecer mais com
  // um fórum de verdade, com seções tipo "TOP Fornecedores" na referência.
  const groups = new Map()
  for (const c of channels) {
    const key = c.group_name || 'Canais'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(c)
  }
  const orderedGroups = [...groups.entries()].sort((a, b) => (a[0] === 'Canais' ? 1 : b[0] === 'Canais' ? -1 : 0))

  return (
    <>
    <aside className="w-64 shrink-0 rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)]">
      <p className="border-b border-[var(--border)] px-4 py-3 text-xs font-semibold uppercase tracking-wide text-[var(--text-faint)]">Canais</p>

      <nav className="max-h-[60vh] space-y-3 overflow-y-auto p-3">
        {orderedGroups.map(([groupName, groupChannels]) => (
          <div key={groupName}>
            <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-faint)]">{groupName}</p>
            <div className="space-y-0.5">
              {groupChannels.map((c) => (
                <div key={c.id} className="group flex items-center">
                  <button
                    onClick={() => onSelectChannel(c.id)}
                    className={`flex flex-1 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-left text-sm ${
                      c.id === activeChannelId ? 'bg-brand-500/15 font-medium text-brand-500' : 'text-[var(--text-muted)] hover:bg-[var(--hover-surface)]'
                    }`}
                  >
                    <Hash size={13} />
                    {c.name}
                  </button>
                  {isOwner && channels.length > 1 && (
                    <button
                      onClick={() => handleDeleteChannel(c.id)}
                      className="hidden shrink-0 rounded-lg p-1.5 text-[var(--text-faint)] hover:bg-[var(--hover-surface)] hover:text-red-400 group-hover:block"
                      title="Apagar canal"
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </nav>

      {isOwner && (
        <div className="border-t border-[var(--border)] p-2">
          <NewChannelForm communityId={community.id} onCreated={(channelId) => onChannelsChanged(channelId)} />
        </div>
      )}
    </aside>
    {channelToDelete && (
      <ConfirmDialog
        title="Apagar esse canal?"
        message="Os posts dele somem junto. Essa ação não pode ser desfeita."
        confirmLabel="Apagar"
        danger
        onConfirm={confirmDeleteChannel}
        onCancel={() => setChannelToDelete(null)}
      />
    )}
    {deleteError && <ConfirmDialog title="Não deu pra apagar" message={deleteError} confirmLabel="OK" onConfirm={() => setDeleteError(null)} />}
    </>
  )
}

function SortDropdown({ sort, onChange }) {
  const [open, setOpen] = useState(false)
  const label = sort === 'likes' ? 'Mais curtidos' : 'Mais recente'
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-xs text-[var(--text-muted)] hover:bg-[var(--hover-surface)]"
      >
        {label} <ChevronDown size={13} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-20 mt-1 w-36 overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] shadow-xl">
            {[
              { value: 'recent', label: 'Mais recente' },
              { value: 'likes', label: 'Mais curtidos' },
            ].map((opt) => (
              <button
                key={opt.value}
                onClick={() => {
                  setOpen(false)
                  onChange(opt.value)
                }}
                className={`block w-full px-3 py-2 text-left text-xs hover:bg-[var(--hover-surface)] ${
                  sort === opt.value ? 'text-brand-500' : 'text-[var(--text-primary)]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

const RESOURCE_KIND_META = {
  video: { Icon: Play, label: 'Vídeo', bg: 'bg-rose-500/15', text: 'text-rose-500' },
  article: { Icon: FileText, label: 'Artigo', bg: 'bg-sky-500/15', text: 'text-sky-500' },
  course: { Icon: GraduationCap, label: 'Aula', bg: 'bg-violet-500/15', text: 'text-violet-500' },
  link: { Icon: Link2, label: 'Link', bg: 'bg-emerald-500/15', text: 'text-emerald-500' },
}

const MAX_VIDEO_MINUTES = 40

function parseLeadingMinutes(label) {
  const match = /^(\d+)/.exec((label || '').trim())
  return match ? match[1] : ''
}

function isYoutubeUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\.|^m\./, '')
    return host === 'youtube.com' || host === 'youtu.be'
  } catch {
    return false
  }
}

function ResourceForm({ initial, onSave, onCancel }) {
  const [title, setTitle] = useState(initial?.title || '')
  const [videoMinutes, setVideoMinutes] = useState(parseLeadingMinutes(initial?.duration_label))
  const [url, setUrl] = useState(initial?.url || '')
  const [body, setBody] = useState(initial?.body || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const minutesNum = Number(videoMinutes)
  const overLimit = videoMinutes !== '' && minutesNum > MAX_VIDEO_MINUTES

  async function submit(e) {
    e.preventDefault()
    if (!title.trim() || !url.trim()) return
    if (!isYoutubeUrl(url.trim())) {
      setError('Cole um link de vídeo do YouTube (ex: https://www.youtube.com/watch?v=... ou https://youtu.be/...).')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const finalDurationLabel = videoMinutes ? `${videoMinutes} min` : ''
      await onSave({ kind: 'video', title: title.trim(), durationLabel: finalDurationLabel, url: url.trim(), body: body.trim() })
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-2xl border border-brand-500/30 bg-[var(--bg-surface)] p-5">
      <input
        required
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Título da aula"
        className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg-surface-2)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-brand-500 focus:outline-none"
      />
      <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
        <input
          required
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Link do vídeo no YouTube (ex: https://www.youtube.com/watch?v=...)"
          className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface-2)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-brand-500 focus:outline-none"
        />
        <input
          type="number"
          min={1}
          value={videoMinutes}
          onChange={(e) => setVideoMinutes(e.target.value)}
          placeholder="Duração (min)"
          className={`rounded-lg border bg-[var(--bg-surface-2)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:outline-none ${
            overLimit ? 'border-amber-500 focus:border-amber-500' : 'border-[var(--border)] focus:border-brand-500'
          }`}
        />
      </div>
      {overLimit && (
        <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-500">
          Esse vídeo passa de {MAX_VIDEO_MINUTES} minutos. Pra manter o engajamento e o carregamento leve, corte em partes menores e suba como
          "{title || 'Aula'} (Parte 1)", "{title || 'Aula'} (Parte 2)" etc.
        </p>
      )}
      <p className="text-xs text-[var(--text-faint)]">
        Dica: suba como "Não listado" no YouTube pra só quem tem o link assistir — ele toca direto aqui dentro, sem sair do app.
      </p>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Descrição ou conteúdo (opcional, dá pra deixar só o link acima)"
        rows={2}
        className="w-full resize-none rounded-lg border border-[var(--border)] bg-[var(--bg-surface-2)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-brand-500 focus:outline-none"
      />
      <div className="flex items-center gap-2">
        <button type="submit" disabled={saving || !title.trim() || !url.trim()} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60">
          {saving ? 'Salvando…' : 'Salvar'}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg px-3 py-2 text-sm text-[var(--text-muted)] hover:bg-[var(--hover-surface)]">
          Cancelar
        </button>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </form>
  )
}

// Converte um link de YouTube/Vimeo/arquivo direto num player que toca
// DENTRO do card, sem levar o assinante pra outra aba — sem isso "assistir
// a aula" era só um link de "Abrir" que nem sempre a pessoa clicava.
// Link sem match nenhum (ex: página comum) cai no fallback de link normal.
// Só YouTube (ver isYoutubeUrl acima, único link aceito na criação) —
// resources antigos com outro tipo de link, se algum dia existirem, caem
// no fallback de link normal em vez de tentar tocar embutido.
function getVideoEmbed(url) {
  if (!url) return null
  let u
  try {
    u = new URL(url)
  } catch {
    return null
  }
  const host = u.hostname.replace(/^www\.|^m\./, '')
  if (host !== 'youtube.com' && host !== 'youtu.be') return null
  let id = host === 'youtu.be' ? u.pathname.slice(1) : u.searchParams.get('v')
  if (!id && u.pathname.startsWith('/embed/')) id = u.pathname.split('/embed/')[1]
  if (!id && u.pathname.startsWith('/shorts/')) id = u.pathname.split('/shorts/')[1]
  return id ? { type: 'iframe', src: `https://www.youtube.com/embed/${id}` } : null
}

function CertificateModal({ communityName, resourceTitle, completedAt, onClose }) {
  const [userName, setUserName] = useState('')

  useEffect(() => {
    rawApi.me().then((me) => setUserName(me.name)).catch(() => {})
  }, [])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="rounded-2xl border-4 border-amber-500/40 bg-[var(--bg-surface)] p-8 text-center shadow-2xl">
          <Award size={40} className="mx-auto text-amber-500" />
          <p className="mt-3 text-xs font-semibold uppercase tracking-widest text-[var(--text-faint)]">Certificado de conclusão</p>
          <p className="mt-4 text-sm text-[var(--text-muted)]">Certificamos que</p>
          <p className="mt-1 text-2xl font-bold text-[var(--text-primary)]">{userName || '—'}</p>
          <p className="mt-3 text-sm text-[var(--text-muted)]">concluiu com sucesso</p>
          <p className="mt-1 text-lg font-semibold text-[var(--text-primary)]">"{resourceTitle}"</p>
          <p className="mt-3 text-xs text-[var(--text-faint)]">
            {communityName} · {formatDate(completedAt)}
          </p>
        </div>
        <div className="mt-3 flex justify-center gap-2">
          <button onClick={() => window.print()} className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
            Imprimir / Salvar PDF
          </button>
          <button
            onClick={onClose}
            className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--hover-surface)]"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  )
}

function ResourceCard({ resource, isOwner, communityName, onSave, onDelete, onToggleProgress }) {
  const [editing, setEditing] = useState(false)
  const [pending, setPending] = useState(false)
  const [showCertificate, setShowCertificate] = useState(false)
  const meta = RESOURCE_KIND_META[resource.kind] || RESOURCE_KIND_META.article
  const { Icon } = meta
  const completed = !!resource.completed_at
  const embed = resource.kind === 'video' ? getVideoEmbed(resource.url) : null

  async function handleToggleProgress() {
    setPending(true)
    try {
      await onToggleProgress(resource.id, !completed)
    } finally {
      setPending(false)
    }
  }

  if (editing) {
    return (
      <ResourceForm
        initial={resource}
        onCancel={() => setEditing(false)}
        onSave={async (data) => {
          await onSave(resource.id, data)
          setEditing(false)
        }}
      />
    )
  }

  return (
    <div className={`flex items-start gap-3 rounded-2xl border bg-[var(--bg-surface)] p-4 shadow-sm transition-shadow hover:shadow-md ${completed ? 'border-emerald-500/30' : 'border-[var(--border)]'}`}>
      <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${meta.bg} ${meta.text}`}>
        <Icon size={19} strokeWidth={2.25} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
          {resource.title}
          <span className="rounded-full bg-[var(--bg-surface-2)] px-2 py-0.5 text-[10px] font-medium text-[var(--text-faint)]">{meta.label}</span>
          {resource.duration_label && <span className="text-xs font-normal text-[var(--text-faint)]">· {resource.duration_label}</span>}
          {completed && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-500">
              <BadgeCheck size={11} /> Concluído
            </span>
          )}
        </p>
        {resource.body && <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--text-muted)]">{resource.body}</p>}
        {embed && (
          <div className="mt-2 aspect-video w-full overflow-hidden rounded-xl bg-black">
            <iframe
              src={embed.src}
              title={resource.title}
              className="h-full w-full"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        )}
        <div className="mt-1.5 flex items-center gap-3">
          {resource.url && !embed && (
            <a href={resource.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-brand-500 hover:underline">
              <Link2 size={12} /> Abrir
            </a>
          )}
          <button
            onClick={handleToggleProgress}
            disabled={pending}
            className={`inline-flex items-center gap-1 text-xs font-medium hover:underline ${completed ? 'text-[var(--text-faint)]' : 'text-emerald-500'}`}
          >
            {completed ? 'Desmarcar conclusão' : 'Marcar como concluído'}
          </button>
          {completed && (
            <button onClick={() => setShowCertificate(true)} className="inline-flex items-center gap-1 text-xs font-medium text-brand-500 hover:underline">
              <Award size={12} /> Ver certificado
            </button>
          )}
        </div>
      </div>
      {isOwner && (
        <div className="flex shrink-0 items-center gap-1">
          <button onClick={() => setEditing(true)} className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[var(--hover-surface)]" title="Editar">
            <Pencil size={14} />
          </button>
          <button onClick={() => onDelete(resource.id)} className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-red-500/10 hover:text-red-400" title="Apagar">
            <Trash2 size={14} />
          </button>
        </div>
      )}
      {showCertificate && (
        <CertificateModal communityName={communityName} resourceTitle={resource.title} completedAt={resource.completed_at} onClose={() => setShowCertificate(false)} />
      )}
    </div>
  )
}

function ResourcesPanel({ communityId, isOwner, communityName }) {
  const [resources, setResources] = useState(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState(null)
  const [resourceToDelete, setResourceToDelete] = useState(null)

  function load() {
    return rawApi.listCommunityResources(communityId).then(setResources).catch((e) => setError(e.message))
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [communityId])

  async function handleCreate(data) {
    await rawApi.createCommunityResource(communityId, data)
    setCreating(false)
    await load()
  }

  async function handleSave(resourceId, data) {
    await rawApi.updateCommunityResource(resourceId, data)
    await load()
  }

  function handleDelete(resourceId) {
    setResourceToDelete(resourceId)
  }

  async function confirmDelete() {
    const resourceId = resourceToDelete
    setResourceToDelete(null)
    await rawApi.deleteCommunityResource(resourceId)
    await load()
  }

  async function handleToggleProgress(resourceId, completed) {
    await rawApi.setResourceProgress(resourceId, completed)
    await load()
  }

  if (error) return <EmptyState title="Não deu pra carregar" subtitle={error} />
  if (!resources) return null

  return (
    <div className="space-y-3">
      {isOwner &&
        (creating ? (
          <ResourceForm onCancel={() => setCreating(false)} onSave={handleCreate} />
        ) : (
          <button
            onClick={() => setCreating(true)}
            className="flex w-full items-center gap-2 rounded-2xl border border-dashed border-[var(--border)] bg-[var(--bg-surface)] px-5 py-3.5 text-sm font-medium text-[var(--text-muted)] hover:border-brand-500/40 hover:text-brand-500"
          >
            <Plus size={16} /> Adicionar vídeo
          </button>
        ))}

      {resources.length === 0 ? (
        <EmptyState
          title="Nenhum vídeo ainda"
          subtitle={isOwner ? 'Adicione um vídeo do YouTube pros membros.' : 'O embaixador ainda não adicionou nenhum vídeo.'}
        />
      ) : (
        resources.map((r) => (
          <ResourceCard key={r.id} resource={r} isOwner={isOwner} communityName={communityName} onSave={handleSave} onDelete={handleDelete} onToggleProgress={handleToggleProgress} />
        ))
      )}

      {resourceToDelete && (
        <ConfirmDialog
          title="Apagar esse vídeo?"
          message="Essa ação não pode ser desfeita."
          confirmLabel="Apagar"
          danger
          onConfirm={confirmDelete}
          onCancel={() => setResourceToDelete(null)}
        />
      )}
    </div>
  )
}

function greetingForHour(hour) {
  if (hour < 12) return 'Bom dia'
  if (hour < 18) return 'Boa tarde'
  return 'Boa noite'
}

function MemberLevelCard({ joinedAt }) {
  const { level, next, monthsToNext, progressPct } = getMemberLevel(joinedAt)
  const { Icon } = level
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-5">
      <div className="flex items-center gap-3">
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white ${level.solid}`}>
          <Icon size={20} strokeWidth={2.5} />
        </span>
        <div>
          <p className="text-base font-semibold text-[var(--text-primary)]">Seu nível: {level.label}</p>
          <p className="text-xs text-[var(--text-faint)]">Membro desde {formatDate(joinedAt)}</p>
        </div>
      </div>
      {next ? (
        <div className="mt-3">
          <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--bg-surface-2)]">
            <div className={`h-full rounded-full transition-all ${level.solid}`} style={{ width: `${progressPct}%` }} />
          </div>
          <p className="mt-1.5 text-xs text-[var(--text-faint)]">
            Faltam {monthsToNext} mês{monthsToNext === 1 ? '' : 'es'} pra virar <span className={next.text}>{next.label}</span>
          </p>
        </div>
      ) : (
        <p className="mt-3 text-xs font-medium text-yellow-400">Nível máximo de antiguidade 🎉</p>
      )}
    </div>
  )
}

function HomePanel({ communityId, onNavigate, accent }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    rawApi.getCommunityHome(communityId).then(setData).catch((e) => setError(e.message))
  }, [communityId])

  if (error) return <EmptyState title="Não deu pra carregar" subtitle={error} />
  if (!data) return null

  const hour = new Date().getHours()
  const firstName = data.userName?.split(' ')[0] || ''

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-5">
        <h2 className="text-xl font-bold text-[var(--text-primary)]">
          {greetingForHour(hour)}, {firstName} 👋
        </h2>
        <p className="text-sm text-[var(--text-muted)]">Confira o que está acontecendo na sua comunidade.</p>
      </div>

      {data.memberSince && <MemberLevelCard joinedAt={data.memberSince} />}

      {data.announcements.length > 0 && (
        <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5">
          <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-amber-500">
            <Pin size={14} fill="currentColor" /> Avisos importantes
          </p>
          <div className="space-y-2">
            {data.announcements.map((a) => (
              <button
                key={a.id}
                onClick={() => onNavigate('posts')}
                className="block w-full rounded-xl bg-[var(--bg-surface)] px-4 py-3 text-left text-sm text-[var(--text-primary)] hover:bg-[var(--hover-surface)]"
              >
                {a.body.length > 140 ? `${a.body.slice(0, 140)}…` : a.body}
              </button>
            ))}
          </div>
        </div>
      )}

      {data.inProgress.length > 0 && (
        <SidebarWidget title="Continue de onde parou" icon={BookOpen} glow="violet">
          <div className="space-y-3">
            {data.inProgress.map((r) => {
              const meta = RESOURCE_KIND_META[r.kind] || RESOURCE_KIND_META.article
              const { Icon } = meta
              return (
                <div key={r.id} className="flex items-center gap-3 rounded-xl bg-[var(--bg-surface-2)] p-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-black/20 text-[var(--text-faint)]">
                    <Icon size={17} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-[var(--text-primary)]">{r.title}</p>
                    <p className="text-xs text-[var(--text-faint)]">Em andamento</p>
                  </div>
                  <button
                    onClick={() => onNavigate('conteudo')}
                    className={`shrink-0 rounded-lg bg-gradient-to-br px-3 py-1.5 text-xs font-medium text-white ${accent.grad}`}
                  >
                    Continuar
                  </button>
                </div>
              )
            })}
          </div>
        </SidebarWidget>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <SidebarWidget title="Novos conteúdos" icon={GraduationCap} glow="blue" onSeeAll={() => onNavigate('conteudo')}>
          {data.notStarted.length === 0 ? (
            <p className="text-xs text-[var(--text-faint)]">Você já viu tudo por aqui.</p>
          ) : (
            <div className="space-y-3">
              {data.notStarted.map((r) => {
                const meta = RESOURCE_KIND_META[r.kind] || RESOURCE_KIND_META.article
                const { Icon } = meta
                return (
                  <div key={r.id} className="flex items-center gap-2.5">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--bg-surface-2)] text-[var(--text-faint)]">
                      <Icon size={14} />
                    </div>
                    <p className="truncate text-xs font-medium text-[var(--text-primary)]">{r.title}</p>
                  </div>
                )
              })}
            </div>
          )}
        </SidebarWidget>

        <SidebarWidget title="Últimas publicações" icon={Hash} glow="emerald" onSeeAll={() => onNavigate('posts')}>
          {data.recentPosts.length === 0 ? (
            <p className="text-xs text-[var(--text-faint)]">Nenhum post ainda.</p>
          ) : (
            <div className="space-y-3">
              {data.recentPosts.map((p) => (
                <div key={p.id} className="text-xs">
                  <p className="line-clamp-2 text-[var(--text-primary)]">{p.body}</p>
                  <p className="mt-0.5 text-[var(--text-faint)]">
                    {formatRelativeTime(p.created_at)} · {p.like_count} curtida{p.like_count === 1 ? '' : 's'}
                  </p>
                </div>
              ))}
            </div>
          )}
        </SidebarWidget>
      </div>
    </div>
  )
}

const NOTIFICATION_ICON = { new_post: Hash, new_resource: BookOpen, new_comment: MessageCircle, announcement: Pin }

function NotificationsPanel({ communityId }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  function load() {
    return rawApi.getCommunityNotifications(communityId).then(setData).catch((e) => setError(e.message))
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [communityId])

  async function handleRead(id) {
    await rawApi.markNotificationRead(id)
    load()
  }

  async function handleReadAll() {
    await rawApi.markAllNotificationsRead(communityId)
    load()
  }

  if (error) return <EmptyState title="Não deu pra carregar" subtitle={error} />
  if (!data) return null

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)]">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3.5">
        <p className="text-sm font-semibold text-[var(--text-primary)]">
          Notificações {data.unreadCount > 0 && <span className="text-brand-500">({data.unreadCount} não lida{data.unreadCount === 1 ? '' : 's'})</span>}
        </p>
        {data.unreadCount > 0 && (
          <button onClick={handleReadAll} className="text-xs font-medium text-brand-500 hover:underline">
            Marcar todas como lidas
          </button>
        )}
      </div>
      {data.notifications.length === 0 ? (
        <EmptyState title="Nenhuma notificação ainda" subtitle="Você é avisado quando o embaixador publicar algo novo." />
      ) : (
        <div className="divide-y divide-[var(--border)]">
          {data.notifications.map((n) => {
            const Icon = NOTIFICATION_ICON[n.type] || Activity
            return (
              <button
                key={n.id}
                onClick={() => !n.read_at && handleRead(n.id)}
                className={`flex w-full items-start gap-3 px-5 py-3.5 text-left hover:bg-[var(--hover-surface)] ${!n.read_at ? 'bg-brand-500/5' : ''}`}
              >
                <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${!n.read_at ? 'bg-brand-500/15 text-brand-500' : 'bg-[var(--bg-surface-2)] text-[var(--text-faint)]'}`}>
                  <Icon size={14} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-[var(--text-primary)]">{n.message}</p>
                  <p className="mt-0.5 text-xs text-[var(--text-faint)]">{formatRelativeTime(n.created_at)}</p>
                </div>
                {!n.read_at && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-500" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function formatBRL(value) {
  return Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

function EarningsSummary({ earnings }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-5">
      <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
        <Wallet size={16} className="text-emerald-500" /> Ganhos pela comunidade (recorrência de quem você trouxe)
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <p className="text-lg font-bold text-[var(--text-primary)]">{formatBRL(earnings.totalReceived)}</p>
          <p className="text-[11px] text-[var(--text-faint)]">Já recebido</p>
        </div>
        <div>
          <p className="text-lg font-bold text-[var(--text-primary)]">{formatBRL(earnings.totalPending)}</p>
          <p className="text-[11px] text-[var(--text-faint)]">A receber (pendente)</p>
        </div>
        <div>
          <p className="text-lg font-bold text-[var(--text-primary)]">
            {earnings.projectedNextCycle === null ? '—' : formatBRL(earnings.projectedNextCycle)}
          </p>
          <p className="text-[11px] text-[var(--text-faint)]">Estimativa se todos os {earnings.activeMemberCount} membros trazidos por você renovarem</p>
        </div>
      </div>
      {earnings.projectedNextCycle === null ? (
        <p className="mt-3 text-xs text-[var(--text-faint)]">
          Ainda não há histórico de comissões dessa comunidade pra estimar um valor por ciclo.
        </p>
      ) : (
        <p className="mt-3 text-xs text-[var(--text-faint)]">
          Estimativa baseada na média histórica de comissão por renovação dessa comunidade ({formatBRL(earnings.avgCommissionValue)} por membro) — não é garantido, depende de quem realmente renovar.
        </p>
      )}
    </div>
  )
}

// Ganhos como AFILIADO (venda individual atribuída pelo rastreio da Cakto)
// — sistema PARALELO ao EarningsSummary acima (que é % sobre membros
// ativos da comunidade). Antes só o admin via isso (tela /afiliados);
// primeira vez que o próprio embaixador enxerga os próprios números.
function AffiliateEarningsCard({ communityId }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [copiedTrialLink, setCopiedTrialLink] = useState(false)

  useEffect(() => {
    rawApi.getCommunityAffiliateEarnings(communityId).then(setData).catch((e) => setError(e.message))
  }, [communityId])

  if (error) return null
  if (!data) return null

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-5">
      <p className="mb-1 flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
        <Wallet size={16} className="text-brand-500" /> Ganhos como afiliado (assinantes trazidos por você)
      </p>
      <p className="mb-3 text-xs text-[var(--text-faint)]">
        A Cakto só identifica quem clicou no seu link; o valor usa a taxa combinada com a equipe. A comissão entra
        como "a receber" assim que o pagamento é confirmado, e sai da lista automaticamente se o cliente cancelar ou
        pedir reembolso depois. A recorrência de quem já é membro da sua comunidade entra pelo card de ganhos da
        comunidade acima, não por aqui.
      </p>
      <div className="grid gap-3 sm:grid-cols-4">
        <div>
          <p className="text-lg font-bold text-[var(--text-primary)]">{formatBRL(data.totalReceived)}</p>
          <p className="text-[11px] text-[var(--text-faint)]">Já recebido</p>
        </div>
        <div>
          <p className="text-lg font-bold text-[var(--text-primary)]">{formatBRL(data.totalPending)}</p>
          <p className="text-[11px] text-[var(--text-faint)]">A receber (pendente)</p>
        </div>
        <div>
          <p className="text-lg font-bold text-[var(--text-primary)]">{data.referredCustomers}</p>
          <p className="text-[11px] text-[var(--text-faint)]">Clientes trazidos</p>
        </div>
        <div>
          <p className="text-lg font-bold text-[var(--text-primary)]">
            {data.firstSalePercentage}% <span className="text-xs font-normal text-[var(--text-faint)]">na 1ª venda</span>
          </p>
          <p className="text-[11px] text-[var(--text-faint)]">recorrência vem pela comunidade</p>
        </div>
      </div>
      {data.recentCommissions.length > 0 && (
        <div className="mt-4 space-y-2 border-t border-[var(--border)] pt-3">
          {data.recentCommissions.slice(0, 5).map((c) => (
            <div key={c.id} className="flex items-center justify-between text-xs">
              <span className="text-[var(--text-muted)]">
                {c.customer_name || c.customer_email} · {c.commission_type === 'first_sale' ? '1ª venda' : 'recorrência'}
              </span>
              <span className={`font-medium ${c.paid ? 'text-emerald-500' : 'text-amber-500'}`}>
                {formatBRL(c.commission_value)} {c.paid ? '· pago' : '· pendente'}
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="mt-4 rounded-xl border border-dashed border-amber-500/30 bg-amber-500/10 p-3">
        <p className="mb-2 flex items-center justify-between text-xs font-semibold text-amber-500">
          <span>
            Em teste grátis agora ({data.trialCount ?? 0} {data.trialCount === 1 ? 'pessoa' : 'pessoas'})
          </span>
          <span>Previsto a receber: {formatBRL(data.projectedTrialTotal ?? 0)}</span>
        </p>
        {data.refCode && (
          <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg bg-[var(--bg-surface)] px-2.5 py-2">
            <span className="text-[11px] text-[var(--text-muted)]">Seu link de teste grátis:</span>
            <code className="break-all text-[11px] text-[var(--text-primary)]">{`${window.location.origin}/free-trial?ref=${data.refCode}`}</code>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard?.writeText(`${window.location.origin}/free-trial?ref=${data.refCode}`)
                setCopiedTrialLink(true)
                setTimeout(() => setCopiedTrialLink(false), 2000)
              }}
              className="rounded-md border border-[var(--border)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--hover-surface)]"
            >
              {copiedTrialLink ? 'Copiado!' : 'Copiar'}
            </button>
          </div>
        )}
        {!(data.trialReferrals?.length > 0) ? (
          <p className="text-[11px] text-[var(--text-faint)]">
            Ninguém trazido por você está em teste grátis no momento. Quem entrar pelo seu link de teste grátis
            aparece aqui com o valor previsto.
          </p>
        ) : (
          <div className="space-y-1.5">
            {data.trialReferrals.map((t) => (
              <div key={t.id} className="flex items-center justify-between text-xs text-[var(--text-faint)]">
                <span>{t.customer_name || t.customer_email || 'Cliente sem nome'}</span>
                <span className="tabular-nums">
                  {formatBRL(t.projected_commission_value)}
                  {t.trial_ends_at ? ` · teste até ${formatDateTime(t.trial_ends_at)}` : ''}
                </span>
              </div>
            ))}
          </div>
        )}
        <p className="mt-2 text-[11px] text-[var(--text-faint)]">
          Ainda não foi cobrado nada. O valor previsto usa a sua % de 1ª venda sobre o preço do plano e só vira "a
          receber" de verdade se a pessoa continuar assinante quando o teste acabar (o valor final pode variar um
          pouco por taxas). Se cancelar antes, some sozinho daqui.
        </p>
      </div>
      <p className="mt-3 text-[11px] text-[var(--text-faint)]">
        % configurada pelo admin no cadastro do afiliado. Pra mudar, peça pra equipe ajustar.
      </p>
    </div>
  )
}

function MembersPanel({ communityId, isOwner }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [memberToRemove, setMemberToRemove] = useState(null)
  const [actionError, setActionError] = useState(null)

  function load() {
    return rawApi.getCommunityMembers(communityId).then(setData).catch((e) => setError(e.message))
  }

  useEffect(() => {
    load()
  }, [communityId])

  async function toggleMute(member) {
    setActionError(null)
    try {
      await rawApi.muteCommunityMember(communityId, member.organization_id, !member.muted)
      await load()
    } catch (err) {
      setActionError(err.message)
    }
  }

  async function confirmRemove() {
    const member = memberToRemove
    setMemberToRemove(null)
    setActionError(null)
    try {
      await rawApi.removeCommunityMember(communityId, member.organization_id)
      await load()
    } catch (err) {
      setActionError(err.message)
    }
  }

  if (error) return <EmptyState title="Não deu pra carregar" subtitle={error} />
  if (!data) return null

  return (
    <div className="space-y-4">
      {isOwner && data.earnings && <EarningsSummary earnings={data.earnings} />}
      {isOwner && <AffiliateEarningsCard communityId={communityId} />}

      {data.xpLeaderboard.length > 0 && (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-5">
          <p className="mb-1 flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
            <Trophy size={16} className="text-amber-500" /> Ranking da comunidade
          </p>
          <p className="mb-3 text-xs text-[var(--text-faint)]">+10 XP comentar · +20 XP votar numa enquete · +50 XP concluir um vídeo</p>
          <div className="space-y-2">
            {data.xpLeaderboard.map((c, i) => {
              const level = getXpLevel(c.xp)
              return (
                <div key={c.user_id} className="flex items-center gap-3 rounded-xl bg-[var(--bg-surface-2)] px-3 py-2">
                  <span className="w-5 shrink-0 text-center text-xs font-semibold text-[var(--text-faint)]">{i + 1}</span>
                  <Avatar name={c.user_name} size={7} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-[var(--text-primary)]">{c.user_name}</p>
                    <p className="text-[11px] text-[var(--text-faint)]">{level.label}</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-500">{c.xp} XP</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)]">
        <p className="border-b border-[var(--border)] px-5 py-3 text-sm font-semibold text-[var(--text-primary)]">
          {data.members.length} membro{data.members.length === 1 ? '' : 's'}
        </p>
        {actionError && <p className="border-b border-[var(--border)] px-5 py-2 text-xs text-red-400">{actionError}</p>}
        {data.members.length === 0 ? (
          <EmptyState title="Nenhum membro ainda" subtitle="Assim que alguém entrar na comunidade, aparece aqui." />
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {data.members.map((m) => (
              <div key={m.user_id} className="flex items-center gap-3 px-5 py-3">
                <Avatar name={m.user_name} size={8} />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5 truncate text-sm font-medium text-[var(--text-primary)]">
                    {m.user_name}
                    <MemberLevelBadge joinedAt={m.joined_at} />
                    {isOwner && m.muted && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-[var(--bg-surface-2)] px-2 py-0.5 text-[10px] font-semibold text-[var(--text-faint)]">
                        <VolumeX size={10} /> Silenciado
                      </span>
                    )}
                  </p>
                  <p className="truncate text-xs text-[var(--text-faint)]">{m.user_email}</p>
                </div>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    m.active ? 'bg-emerald-500/15 text-emerald-500' : 'bg-[var(--bg-surface-2)] text-[var(--text-faint)]'
                  }`}
                >
                  {m.active ? 'Ativo' : 'Inativo'}
                </span>
                <span className="hidden shrink-0 text-xs text-[var(--text-faint)] sm:inline">desde {formatDateTime(m.joined_at)}</span>
                {isOwner && (
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      onClick={() => toggleMute(m)}
                      title={m.muted ? 'Dessilenciar' : 'Silenciar (não pode comentar/curtir/votar)'}
                      className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[var(--hover-surface)] hover:text-amber-500"
                    >
                      {m.muted ? <Volume2 size={15} /> : <VolumeX size={15} />}
                    </button>
                    <button
                      onClick={() => setMemberToRemove(m)}
                      title="Expulsar da comunidade"
                      className="rounded-lg p-1.5 text-[var(--text-muted)] hover:bg-[var(--hover-surface)] hover:text-red-400"
                    >
                      <UserX size={15} />
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {memberToRemove && (
        <ConfirmDialog
          title={`Expulsar ${memberToRemove.user_name}?`}
          message="A pessoa perde o acesso a essa comunidade na hora, sem nenhum aviso — ela só percebe que saiu e pode escolher outra comunidade pra entrar pelo diretório. Não cancela a assinatura dela do ScoutX."
          confirmLabel="Expulsar"
          danger
          onConfirm={confirmRemove}
          onCancel={() => setMemberToRemove(null)}
        />
      )}
    </div>
  )
}

// Agrupa membros por mês de entrada e acumula, pra virar um gráfico de
// "crescimento" com dado 100% real (join dates que já existem em
// community_members) — sem inventar métrica de sessão/pageview que o app
// não rastreia.
function buildGrowthSeries(members) {
  const counts = new Map()
  for (const m of members) {
    const d = new Date(m.joined_at)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  let cumulative = 0
  return [...counts.keys()].sort().map((key) => {
    cumulative += counts.get(key)
    return { month: key, total: cumulative }
  })
}

function StatsPanel({ communityId, ambassadorStats, tiers, contentStats, accent }) {
  const [members, setMembers] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    rawApi
      .getCommunityMembers(communityId)
      .then((d) => setMembers(d.members))
      .catch((e) => setError(e.message))
  }, [communityId])

  if (error) return <EmptyState title="Não deu pra carregar" subtitle={error} />
  if (!members) return null

  const growth = buildGrowthSeries(members)

  return (
    <div className="space-y-4">
      {ambassadorStats && <TierProgress stats={ambassadorStats} tiers={tiers} />}
      {ambassadorStats && <TierRoadmap stats={ambassadorStats} tiers={tiers} />}

      <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-5">
        <p className="mb-3 text-sm font-semibold text-[var(--text-primary)]">Crescimento de membros</p>
        {growth.length === 0 ? (
          <EmptyState title="Ainda sem membros" subtitle="O gráfico aparece assim que alguém entrar na comunidade." />
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={growth} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <defs>
                <linearGradient id="communityGrowthFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={accent.hex} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={accent.hex} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis dataKey="month" tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={{ stroke: 'var(--border)' }} tickLine={false} />
              <YAxis allowDecimals={false} tick={{ fill: 'var(--text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} width={28} />
              <Tooltip
                content={({ active, payload, label }) =>
                  active && payload?.length ? (
                    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-xs shadow-lg">
                      <p className="text-[var(--text-muted)]">{label}</p>
                      <p className="font-semibold text-[var(--text-primary)]">{payload[0].value} membros</p>
                    </div>
                  ) : null
                }
              />
              <Area type="monotone" dataKey="total" stroke={accent.hex} strokeWidth={2} fill="url(#communityGrowthFill)" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2.5">
        <StatPill icon={Hash} value={contentStats.postCount} label={contentStats.postCount === 1 ? 'Post' : 'Posts'} color="violet" />
        <StatPill icon={Heart} value={contentStats.likeCount} label="Curtidas" color="rose" />
        <StatPill icon={MessageCircle} value={contentStats.commentCount} label="Comentários" color="amber" />
      </div>

      <AnalyticsSection communityId={communityId} />
    </div>
  )
}

function AnalyticsSection({ communityId }) {
  const [data, setData] = useState(null)

  useEffect(() => {
    rawApi.getCommunityAnalytics(communityId).then(setData).catch(() => setData(null))
  }, [communityId])

  if (!data) return null

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-5">
        <p className="mb-1 text-sm font-semibold text-[var(--text-primary)]">Taxa de engajamento</p>
        <p className="text-2xl font-bold text-[var(--text-primary)]">{data.engagementRate === null ? '—' : `${data.engagementRate}%`}</p>
        <p className="mt-1 text-xs text-[var(--text-faint)]">
          {data.engagementRate === null
            ? 'Ainda sem posts ou membros ativos suficientes pra calcular.'
            : 'Curtidas + comentários, em relação ao total possível (membros ativos × posts).'}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-5">
          <p className="mb-3 text-sm font-semibold text-[var(--text-primary)]">Posts mais engajados</p>
          {data.topPosts.length === 0 ? (
            <p className="text-xs text-[var(--text-faint)]">Nenhum post ainda.</p>
          ) : (
            <div className="space-y-2.5">
              {data.topPosts.map((p, i) => (
                <div key={p.id} className="flex items-start gap-2.5">
                  <span className="mt-0.5 w-4 shrink-0 text-center text-xs font-semibold text-[var(--text-faint)]">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-1 text-xs text-[var(--text-primary)]">{p.body}</p>
                    <p className="text-[11px] text-[var(--text-faint)]">
                      {p.like_count} curtida{p.like_count === 1 ? '' : 's'} · {p.comment_count} comentário{p.comment_count === 1 ? '' : 's'}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-5">
          <p className="mb-3 text-sm font-semibold text-[var(--text-primary)]">Conteúdos mais concluídos</p>
          {data.topResources.length === 0 || data.topResources.every((r) => r.completed_count === 0) ? (
            <p className="text-xs text-[var(--text-faint)]">Ninguém concluiu nenhum conteúdo ainda.</p>
          ) : (
            <div className="space-y-2.5">
              {data.topResources
                .filter((r) => r.completed_count > 0)
                .map((r, i) => (
                  <div key={r.id} className="flex items-center gap-2.5">
                    <span className="w-4 shrink-0 text-center text-xs font-semibold text-[var(--text-faint)]">{i + 1}</span>
                    <p className="line-clamp-1 flex-1 text-xs text-[var(--text-primary)]">{r.title}</p>
                    <span className="shrink-0 text-[11px] text-[var(--text-faint)]">
                      {r.completed_count} conclusão{r.completed_count === 1 ? '' : 'ões'}
                    </span>
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Brilho "LED" por trás do ícone do título de cada widget — uma cor
// diferente por widget (pedido do usuário) em vez de azul em todos, pra
// ajudar a distinguir cada seção rapidinho.
const WIDGET_GLOW = {
  blue: { bg: 'bg-blue-500/20', text: 'text-blue-400', shadow: 'shadow-[0_0_10px_2px_rgba(59,130,246,0.45)]' },
  amber: { bg: 'bg-amber-500/20', text: 'text-amber-400', shadow: 'shadow-[0_0_10px_2px_rgba(245,158,11,0.45)]' },
  violet: { bg: 'bg-violet-500/20', text: 'text-violet-400', shadow: 'shadow-[0_0_10px_2px_rgba(139,92,246,0.45)]' },
  emerald: { bg: 'bg-emerald-500/20', text: 'text-emerald-400', shadow: 'shadow-[0_0_10px_2px_rgba(16,185,129,0.45)]' },
}

function SidebarWidget({ title, icon: Icon, glow = 'blue', onSeeAll, children }) {
  const g = WIDGET_GLOW[glow] || WIDGET_GLOW.blue
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="flex items-center gap-2.5 text-sm font-semibold text-[var(--text-primary)]">
          {Icon && (
            <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${g.bg} ${g.text} ${g.shadow}`}>
              <Icon size={14} />
            </span>
          )}
          {title}
        </p>
        {onSeeAll && (
          <button onClick={onSeeAll} className="text-xs font-medium text-brand-500 hover:underline">
            Ver todos
          </button>
        )}
      </div>
      {children}
    </div>
  )
}

function ContentSidebarWidget({ communityId, onSeeAll }) {
  const [resources, setResources] = useState(null)

  useEffect(() => {
    rawApi.listCommunityResources(communityId).then((r) => setResources(r.slice(0, 4))).catch(() => setResources([]))
  }, [communityId])

  if (!resources) return null

  return (
    <SidebarWidget title="Conteúdo Educacional" icon={BookOpen} glow="blue" onSeeAll={resources.length > 0 ? onSeeAll : undefined}>
      {resources.length === 0 ? (
        <p className="text-xs text-[var(--text-faint)]">Nenhum conteúdo ainda.</p>
      ) : (
        <div className="space-y-3">
          {resources.map((r) => {
            const meta = RESOURCE_KIND_META[r.kind] || RESOURCE_KIND_META.article
            const { Icon } = meta
            return (
              <div key={r.id} className="flex items-start gap-2.5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--bg-surface-2)] text-[var(--text-faint)]">
                  <Icon size={14} />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-[var(--text-primary)]">{r.title}</p>
                  <p className="text-[11px] text-[var(--text-faint)]">
                    {meta.label}
                    {r.duration_label ? ` · ${r.duration_label}` : ''}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </SidebarWidget>
  )
}

function TopContributorsSidebarWidget({ communityId, onSeeAll }) {
  const [top, setTop] = useState(null)

  useEffect(() => {
    rawApi.getCommunityMembers(communityId).then((d) => setTop(d.topContributors.slice(0, 3))).catch(() => setTop([]))
  }, [communityId])

  if (!top) return null

  return (
    <SidebarWidget title="Membros mais ativos" icon={Trophy} glow="amber" onSeeAll={top.length > 0 ? onSeeAll : undefined}>
      {top.length === 0 ? (
        <p className="text-xs text-[var(--text-faint)]">Ninguém comentou ou curtiu ainda.</p>
      ) : (
        <div className="space-y-2.5">
          {top.map((c, i) => (
            <div key={c.user_id} className="flex items-center gap-2.5">
              <span className="w-4 shrink-0 text-center text-xs font-semibold text-[var(--text-faint)]">{i + 1}</span>
              <Avatar name={c.user_name} size={7} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-[var(--text-primary)]">{c.user_name}</p>
                <p className="text-[11px] text-[var(--text-faint)]">{c.comment_count + c.like_count} interações</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </SidebarWidget>
  )
}

const ACTIVITY_LABEL = {
  comment: 'comentou no feed',
  like: 'curtiu um post',
  join: 'entrou na comunidade',
}

function RecentActivitySidebarWidget({ communityId }) {
  const [activity, setActivity] = useState(null)

  useEffect(() => {
    rawApi.getCommunityActivity(communityId).then(setActivity).catch(() => setActivity([]))
  }, [communityId])

  if (!activity) return null

  return (
    <SidebarWidget title="Atividade recente" icon={Activity} glow="violet">
      {activity.length === 0 ? (
        <p className="text-xs text-[var(--text-faint)]">Sem atividade ainda.</p>
      ) : (
        <div className="space-y-3">
          {activity.map((a, i) => (
            <div key={i} className="flex items-start gap-2.5">
              <Avatar name={a.actor_name} size={7} />
              <div className="min-w-0">
                <p className="text-xs text-[var(--text-primary)]">
                  <span className="font-medium">{a.actor_name}</span> {ACTIVITY_LABEL[a.type] || a.type}
                </p>
                <p className="text-[11px] text-[var(--text-faint)]">{formatRelativeTime(a.created_at)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </SidebarWidget>
  )
}

function CommunityTabs({ tab, onChange, accent, showStats }) {
  const tabs = [
    { value: 'inicio', label: 'Início', Icon: Home },
    { value: 'posts', label: 'Posts', Icon: Hash },
    { value: 'conteudo', label: 'Conteúdo', Icon: BookOpen },
    { value: 'membros', label: 'Membros', Icon: Users },
    { value: 'notificacoes', label: 'Notificações', Icon: Bell },
    ...(showStats ? [{ value: 'estatisticas', label: 'Estatísticas', Icon: Trophy }] : []),
  ]
  return (
    <div className="flex gap-1.5 rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-1.5 shadow-sm">
      {tabs.map(({ value, label, Icon }) => (
        <button
          key={value}
          onClick={() => onChange(value)}
          className={`inline-flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all ${
            tab === value ? `bg-gradient-to-br text-white shadow-md ${accent.grad}` : 'text-[var(--text-muted)] hover:bg-[var(--hover-surface)]'
          }`}
        >
          <Icon size={15} /> {label}
        </button>
      ))}
    </div>
  )
}

function ScheduledPostRow({ post, onPublishNow, onReschedule, onDelete }) {
  const [editingSchedule, setEditingSchedule] = useState(false)
  const initial = new Date(post.scheduled_at)
  const [date, setDate] = useState(initial.toISOString().slice(0, 10))
  const [time, setTime] = useState(initial.toISOString().slice(11, 16))
  const [saving, setSaving] = useState(false)

  async function handleSaveSchedule() {
    setSaving(true)
    try {
      await onReschedule(post.id, new Date(`${date}T${time}`).toISOString())
      setEditingSchedule(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface-2)] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm text-[var(--text-primary)]">{post.body}</p>
          <p className="mt-1 text-xs text-[var(--text-faint)]">
            #{post.channel_name} · agendado pra {formatDateTime(post.scheduled_at)}
          </p>
        </div>
        <button onClick={() => onDelete(post.id)} className="shrink-0 rounded-lg p-1.5 text-[var(--text-faint)] hover:bg-red-500/10 hover:text-red-400" title="Apagar">
          <Trash2 size={14} />
        </button>
      </div>
      {editingSchedule ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-1 text-xs text-[var(--text-primary)] focus:border-brand-500 focus:outline-none"
          />
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-1 text-xs text-[var(--text-primary)] focus:border-brand-500 focus:outline-none"
          />
          <button onClick={handleSaveSchedule} disabled={saving} className="rounded-lg bg-brand-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-700">
            Salvar
          </button>
          <button onClick={() => setEditingSchedule(false)} className="text-xs text-[var(--text-muted)] hover:underline">
            Cancelar
          </button>
        </div>
      ) : (
        <div className="mt-2 flex items-center gap-3">
          <button onClick={() => setEditingSchedule(true)} className="text-xs font-medium text-brand-500 hover:underline">
            Alterar horário
          </button>
          <button onClick={() => onPublishNow(post.id)} className="text-xs font-medium text-emerald-500 hover:underline">
            Publicar agora
          </button>
        </div>
      )}
    </div>
  )
}

function ScheduledPostsPanel({ communityId, refreshKey, onChanged }) {
  const [posts, setPosts] = useState(null)
  const [postToDelete, setPostToDelete] = useState(null)

  function load() {
    return rawApi.getScheduledCommunityPosts(communityId).then(setPosts).catch(() => setPosts([]))
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [communityId, refreshKey])

  async function handlePublishNow(postId) {
    await rawApi.publishCommunityPostNow(postId)
    await load()
    onChanged()
  }

  async function handleReschedule(postId, scheduledAt) {
    const post = posts.find((p) => p.id === postId)
    await rawApi.updateCommunityPost(postId, post.body, post.image_url, scheduledAt)
    await load()
  }

  async function confirmDelete() {
    const postId = postToDelete
    setPostToDelete(null)
    await rawApi.deleteCommunityPost(postId)
    await load()
  }

  if (!posts || posts.length === 0) return null

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-4">
      <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)]">
        <Calendar size={15} className="text-[var(--text-faint)]" /> Publicações agendadas ({posts.length})
      </p>
      <div className="space-y-2">
        {posts.map((p) => (
          <ScheduledPostRow key={p.id} post={p} onPublishNow={handlePublishNow} onReschedule={handleReschedule} onDelete={setPostToDelete} />
        ))}
      </div>
      {postToDelete && (
        <ConfirmDialog
          title="Apagar essa publicação agendada?"
          message="Essa ação não pode ser desfeita."
          confirmLabel="Apagar"
          danger
          onConfirm={confirmDelete}
          onCancel={() => setPostToDelete(null)}
        />
      )}
    </div>
  )
}

function CommunityFeed({ communityId, isOwner, ambassadorStats, tiers, onCommunityRenamed }) {
  const [tab, setTab] = useState('inicio')
  const [data, setData] = useState(null)
  const [activeChannelId, setActiveChannelId] = useState(null)
  const [sort, setSort] = useState('recent')
  const [composerOpen, setComposerOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [error, setError] = useState(null)
  const [postToDelete, setPostToDelete] = useState(null)
  const [scheduleRefresh, setScheduleRefresh] = useState(0)

  function load(channelId, sortOverride) {
    return rawApi
      .getCommunity(communityId, { channelId, sort: sortOverride || sort })
      .then((d) => {
        setData(d)
        setActiveChannelId(d.activeChannelId)
      })
      .catch((e) => setError(e.message))
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [communityId])

  async function handleComment(postId, body) {
    await rawApi.createCommunityComment(postId, body)
    await load(activeChannelId)
  }

  async function handleToggleLike(postId) {
    await rawApi.toggleCommunityPostLike(postId)
    await load(activeChannelId)
  }

  async function handleToggleSave(postId) {
    await rawApi.toggleCommunityPostSave(postId)
    await load(activeChannelId)
  }

  async function handleVotePoll(postId, optionId) {
    await rawApi.voteOnCommunityPoll(postId, optionId)
    await load(activeChannelId)
  }

  async function handleEditPost(postId, body, imageUrl) {
    await rawApi.updateCommunityPost(postId, body, imageUrl)
    await load(activeChannelId)
  }

  function handleDeletePost(postId) {
    setPostToDelete(postId)
  }

  async function confirmDeletePost() {
    const postId = postToDelete
    setPostToDelete(null)
    await rawApi.deleteCommunityPost(postId)
    await load(activeChannelId)
  }

  async function handleTogglePin(postId) {
    await rawApi.toggleCommunityPostPin(postId)
    await load(activeChannelId)
  }

  function handleSelectChannel(channelId) {
    setActiveChannelId(channelId)
    setComposerOpen(false)
    load(channelId)
  }

  function handleSortChange(newSort) {
    setSort(newSort)
    load(activeChannelId, newSort)
  }

  if (error) return <EmptyState title="Não deu pra carregar" subtitle={error} />
  if (!data) return null

  const activeChannel = data.channels.find((c) => c.id === activeChannelId)
  const visiblePosts = search.trim()
    ? data.posts.filter((p) => p.body.toLowerCase().includes(search.trim().toLowerCase()))
    : data.posts

  return (
    <div className="space-y-4">
      <CommunityHeader
        community={data.community}
        isOwner={isOwner}
        activeMemberCount={data.activeMemberCount}
        contentStats={data.contentStats}
        ambassadorTier={data.ambassadorTier}
        onUpdated={() => {
          load(activeChannelId)
          onCommunityRenamed?.()
        }}
      />

      <CommunityTabs tab={tab} onChange={setTab} accent={getAccent(data.community.accent_color)} showStats={isOwner} />

      {tab === 'inicio' && <HomePanel communityId={communityId} onNavigate={setTab} accent={getAccent(data.community.accent_color)} />}
      {tab === 'conteudo' && <ResourcesPanel communityId={communityId} isOwner={isOwner} communityName={data.community.name} />}
      {tab === 'membros' && <MembersPanel communityId={communityId} isOwner={isOwner} />}
      {tab === 'notificacoes' && <NotificationsPanel communityId={communityId} />}
      {tab === 'estatisticas' && isOwner && (
        <StatsPanel communityId={communityId} ambassadorStats={ambassadorStats} tiers={tiers} contentStats={data.contentStats} accent={getAccent(data.community.accent_color)} />
      )}

      {tab === 'posts' && (
        <div className="flex items-start gap-4">
          <ChannelSidebar
            community={data.community}
            channels={data.channels}
            activeChannelId={activeChannelId}
            isOwner={isOwner}
            onSelectChannel={handleSelectChannel}
            onChannelsChanged={(newChannelId) => load(newChannelId || activeChannelId)}
          />

          <div className="min-w-0 flex-1 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] px-5 py-3.5">
              <div className="flex items-center gap-2">
                <Hash size={16} className="text-[var(--text-faint)]" />
                <h2 className="text-base font-semibold text-[var(--text-primary)]">{activeChannel?.name}</h2>
              </div>
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
                  <Users size={13} /> {data.activeMemberCount} membro{data.activeMemberCount === 1 ? '' : 's'}
                </span>
                <SortDropdown sort={sort} onChange={handleSortChange} />
              </div>
            </div>

            <div className="relative">
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-faint)]" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar nos posts desse canal…"
                className="w-full rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] py-2.5 pl-9 pr-3 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-brand-500 focus:outline-none"
              />
            </div>

            {isOwner && <ScheduledPostsPanel communityId={communityId} refreshKey={scheduleRefresh} onChanged={() => load(activeChannelId)} />}

            {isOwner &&
              (composerOpen ? (
                <Composer
                  communityId={communityId}
                  channelId={activeChannelId}
                  onPosted={() => {
                    load(activeChannelId)
                    setScheduleRefresh((n) => n + 1)
                  }}
                  onCollapse={() => setComposerOpen(false)}
                />
              ) : (
                <button
                  onClick={() => setComposerOpen(true)}
                  className="flex w-full items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-3 text-left shadow-sm transition-shadow hover:shadow-md"
                >
                  <Avatar src={data.community.photo_url} name={data.community.name} size={9} />
                  <span className="flex-1 rounded-full bg-[var(--bg-surface-2)] px-4 py-2.5 text-sm text-[var(--text-faint)]">Criar uma publicação</span>
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-white shadow-sm ${getAccent(data.community.accent_color).grad}`}>
                    <Plus size={16} />
                  </span>
                </button>
              ))}

            {visiblePosts.length === 0 ? (
              <EmptyState
                title={search.trim() ? 'Nenhum post bate com essa busca' : 'Nenhum post ainda nesse canal'}
                subtitle={search.trim() ? 'Tente outro termo.' : isOwner ? 'Publique o primeiro post por aqui.' : 'O embaixador ainda não postou nada por aqui.'}
              />
            ) : (
              <div className="space-y-3">
                {visiblePosts.map((p) => (
                  <PostCard
                    key={p.id}
                    post={p}
                    community={data.community}
                    ambassadorTier={data.ambassadorTier}
                    isOwner={isOwner}
                    onComment={handleComment}
                    onToggleLike={handleToggleLike}
                    onToggleSave={handleToggleSave}
                    onVotePoll={handleVotePoll}
                    onEdit={handleEditPost}
                    onDelete={handleDeletePost}
                    onTogglePin={handleTogglePin}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="hidden w-72 shrink-0 space-y-4 lg:block">
            <ContentSidebarWidget communityId={communityId} onSeeAll={() => setTab('conteudo')} />
            <TopContributorsSidebarWidget communityId={communityId} onSeeAll={() => setTab('membros')} />
            <RecentActivitySidebarWidget communityId={communityId} />
          </div>
        </div>
      )}

      {postToDelete && (
        <ConfirmDialog
          title="Apagar esse post?"
          message="Os comentários dele somem junto. Essa ação não pode ser desfeita."
          confirmLabel="Apagar"
          danger
          onConfirm={confirmDeletePost}
          onCancel={() => setPostToDelete(null)}
        />
      )}
    </div>
  )
}

export default function Comunidade() {
  const [status, setStatus] = useState(null)
  const [error, setError] = useState(null)

  function load() {
    return rawApi.getCommunityStatus().then(setStatus).catch((e) => setError(e.message))
  }

  useEffect(() => {
    load()
  }, [])

  if (error) return <EmptyState title="Não deu pra carregar" subtitle={error} />
  if (!status) return null

  if (status.isAmbassador && !status.ambassadorCommunity) {
    return (
      <div className="max-w-2xl space-y-6">
        <div>
          <h2 className="text-xl font-semibold">Comunidade</h2>
          <p className="text-sm text-[var(--text-muted)]">Espaço fechado só pra você e quem está na sua comunidade.</p>
        </div>
        <AmbassadorSetup onCreated={load} />
      </div>
    )
  }

  if (status.isAmbassador && status.ambassadorCommunity) {
    return (
      <CommunityFeed
        communityId={status.ambassadorCommunity.id}
        isOwner
        ambassadorStats={status.ambassadorStats}
        tiers={status.tiers}
        onCommunityRenamed={load}
      />
    )
  }

  if (status.memberCommunityId) {
    return <CommunityFeed communityId={status.memberCommunityId} isOwner={false} tiers={status.tiers} />
  }

  return (
    <div className="max-w-2xl">
      <Directory onJoined={load} />
    </div>
  )
}

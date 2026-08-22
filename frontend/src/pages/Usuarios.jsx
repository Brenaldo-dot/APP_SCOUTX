import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { rawApi } from '../api/rawClient.js'
import { api } from '../api/client.js'
import { operationLabel } from '../context/OperationContext.jsx'
import { formatDateTime } from '../utils/date.js'

const emptyForm = { name: '', email: '', password: '', admin: false }

export default function Usuarios() {
  const [users, setUsers] = useState(null)
  const [error, setError] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [formMsg, setFormMsg] = useState(null)
  const [creating, setCreating] = useState(false)
  const [ipDetail, setIpDetail] = useState(null)
  const [passwordEdit, setPasswordEdit] = useState(null)
  const [competitorSummary, setCompetitorSummary] = useState(null)
  const [claiming, setClaiming] = useState(false)
  const [claimMsg, setClaimMsg] = useState(null)

  async function handleClaimOrphaned() {
    setClaiming(true)
    setClaimMsg(null)
    try {
      const result = await api.claimOrphanedCompetitors()
      setClaimMsg({
        type: 'success',
        text: result.claimed > 0
          ? `${result.claimed} concorrente(s) órfão(s) passaram a ser seus.`
          : 'Não tinha nenhum concorrente órfão pra reivindicar.',
      })
      load()
    } catch (err) {
      setClaimMsg({ type: 'error', text: err.message || 'Não foi possível reivindicar.' })
    } finally {
      setClaiming(false)
    }
  }

  function load() {
    rawApi
      .listUsers()
      .then(setUsers)
      .catch((e) => setError(e.message))
    api
      .getCompetitorSummaryByUser()
      .then(setCompetitorSummary)
      .catch(() => setCompetitorSummary([]))
  }

  useEffect(load, [])

  async function handleCreate() {
    setFormMsg(null)
    if (!form.name.trim() || !form.email.trim() || form.password.length < 8) {
      setFormMsg({ type: 'error', text: 'Preencha nome, email e uma senha com pelo menos 8 caracteres.' })
      return
    }
    setCreating(true)
    try {
      await rawApi.createUser({
        name: form.name.trim(),
        email: form.email.trim(),
        password: form.password,
        role: form.admin ? 'admin' : 'collaborator',
      })
      setFormMsg({ type: 'success', text: 'Usuário criado! Envie o email e a senha combinada pra essa pessoa.' })
      setForm(emptyForm)
      load()
    } catch (err) {
      setFormMsg({ type: 'error', text: err.message || 'Não foi possível criar o usuário.' })
    } finally {
      setCreating(false)
    }
  }

  async function togglePermission(user, field, value) {
    const prev = users
    setUsers(users.map((u) => (u.id === user.id ? { ...u, [field]: value } : u)))
    try {
      const body = field === 'role' ? { role: value ? 'admin' : 'collaborator' } : { [field]: value }
      await rawApi.updateUser(user.id, body)
    } catch {
      setUsers(prev)
      alert('Não foi possível salvar a alteração.')
    }
  }

  async function handleDelete(user) {
    if (!confirm(`Remover "${user.name}"?`)) return
    try {
      await rawApi.deleteUser(user.id)
      load()
    } catch (err) {
      alert(err.message || 'Não foi possível remover o usuário.')
    }
  }

  function viewIps(user) {
    setIpDetail({ user, rows: null })
    rawApi.getUserIps(user.id).then((rows) => setIpDetail({ user, rows }))
  }

  function openPasswordEdit(user) {
    setPasswordEdit({ user, value: '', saving: false, error: null })
  }

  async function submitPasswordEdit() {
    if (!passwordEdit) return
    if (passwordEdit.value.length < 8) {
      setPasswordEdit({ ...passwordEdit, error: 'A senha precisa ter no mínimo 8 caracteres.' })
      return
    }
    setPasswordEdit({ ...passwordEdit, saving: true, error: null })
    try {
      await rawApi.updateUser(passwordEdit.user.id, { password: passwordEdit.value })
      setPasswordEdit(null)
    } catch (err) {
      setPasswordEdit({ ...passwordEdit, saving: false, error: err.message || 'Não foi possível trocar a senha.' })
    }
  }

  return (
    <div className="max-w-6xl space-y-8">
      <div>
        <h2 className="text-xl font-semibold">Usuários</h2>
        <p className="text-sm text-[var(--text-muted)]">Quem tem acesso ao ScoutX e o que cada um pode fazer.</p>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-5">
        <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-amber-500">Concorrentes órfãos</h3>
        <p className="mb-3.5 text-sm text-[var(--text-tertiary)]">
          Concorrente sem NENHUM usuário rastreando (ex: cadastrados antes de cada um ter sua própria lista) fica
          invisível pra todo mundo. Clique abaixo pra atribuir todos eles à SUA conta.
        </p>
        <button
          onClick={handleClaimOrphaned}
          disabled={claiming}
          className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-60"
        >
          {claiming ? 'Reivindicando…' : 'Reivindicar concorrentes órfãos'}
        </button>
        {claimMsg && (
          <p className={`mt-3 text-sm ${claimMsg.type === 'error' ? 'text-red-400' : 'text-emerald-400'}`}>
            {claimMsg.text}
          </p>
        )}
      </div>

      <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-5">
        <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Concorrentes por usuário</h3>
        <p className="mb-3.5 text-sm text-[var(--text-tertiary)]">
          Cada usuário só vê os próprios concorrentes — isto aqui é a visão de auditoria, só pra admin. Um mesmo
          domínio cadastrado por duas pessoas conta pra cada uma (compartilham o dado raspado, mas cada uma tem sua
          própria lista).
        </p>
        <div className="overflow-hidden rounded-lg border border-[var(--border)]">
          <table className="w-full text-left text-sm">
            <thead className="bg-[var(--bg-surface-2)] text-xs uppercase text-[var(--text-muted)]">
              <tr>
                <th className="px-3 py-2.5">Usuário</th>
                <th className="px-3 py-2.5">Por operação</th>
                <th className="px-3 py-2.5">Total</th>
                <th className="px-3 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {competitorSummary?.map((row) => {
                const user = users?.find((u) => u.id === row.user_id)
                return (
                  <tr key={row.user_id}>
                    <td className="px-3 py-2.5 text-[var(--text-primary)]">{user?.name || `Usuário #${row.user_id}`}</td>
                    <td className="px-3 py-2.5 text-[var(--text-tertiary)]">
                      {Object.entries(row.by_operation)
                        .map(([op, count]) => `${operationLabel(op)}: ${count}`)
                        .join(' · ')}
                    </td>
                    <td className="px-3 py-2.5 text-[var(--text-primary)]">{row.total}</td>
                    <td className="px-3 py-2.5 text-right">
                      <Link
                        to={`/concorrentes?as_user_id=${row.user_id}`}
                        className="text-xs font-medium text-brand-500 hover:underline"
                      >
                        Ver concorrentes ↗
                      </Link>
                    </td>
                  </tr>
                )
              })}
              {competitorSummary?.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-3 py-4 text-center text-[var(--text-muted)]">
                    Ninguém cadastrou nenhum concorrente ainda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)] p-5">
        <h3 className="mb-3.5 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">Criar novo usuário</h3>
        <div className="flex max-w-sm flex-col gap-2.5">
          <input
            type="text"
            placeholder="Nome"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface-2)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-brand-500 focus:outline-none"
          />
          <input
            type="email"
            placeholder="Email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface-2)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-brand-500 focus:outline-none"
          />
          <input
            type="password"
            placeholder="Senha (mín. 8 caracteres)"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            autoComplete="new-password"
            className="rounded-lg border border-[var(--border)] bg-[var(--bg-surface-2)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-brand-500 focus:outline-none"
          />
          <label className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
            <input type="checkbox" checked={form.admin} onChange={(e) => setForm({ ...form, admin: e.target.checked })} />
            Já criar como admin
          </label>
          <button onClick={handleCreate} disabled={creating} className="btn-primary mt-1">
            {creating ? 'Criando…' : 'Criar usuário'}
          </button>
        </div>
        {formMsg && (
          <p className={`mt-3 text-sm ${formMsg.type === 'error' ? 'text-red-400' : 'text-emerald-400'}`}>{formMsg.text}</p>
        )}
      </div>

      <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-surface)]">
        <div className="border-b border-[var(--border)] px-5 py-4">
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">🔒 Controle de acesso e segurança</h3>
          <p className="mt-1 text-sm text-[var(--text-tertiary)]">
            Só administradores veem esta tabela. IP repetido em várias contas ou uma conta logando de muitos IPs
            diferentes pode indicar senha compartilhada ou acesso indevido — vale checar.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-[var(--bg-surface-2)] text-xs uppercase text-[var(--text-muted)]">
              <tr>
                <th className="px-4 py-3">Nome</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Criado em</th>
                <th className="px-4 py-3">Admin</th>
                <th className="px-4 py-3">Vê histórico</th>
                <th className="px-4 py-3">ScoutX</th>
                <th className="px-4 py-3">Buscas</th>
                <th className="px-4 py-3">Último login</th>
                <th className="px-4 py-3">IPs usados</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {users?.map((u) => {
                const extraIps = Math.max(0, (u.allIps?.length || 0) - 3)
                const risky = u.ipCount > 1
                return (
                  <tr key={u.id} className="hover:bg-[var(--bg-surface-2)]">
                    <td className="px-4 py-3.5 font-medium text-[var(--text-primary)]">
                      <div className="flex items-center gap-2">
                        {u.name}
                        {u.lockedUntil && (
                          <span
                            className="rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold text-red-400"
                            title={u.lockedPermanently ? undefined : `Bloqueado até ${formatDateTime(u.lockedUntil)}`}
                          >
                            {u.lockedPermanently ? '🔒 Precisa de reset' : '🔒 Bloqueado'}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-[var(--text-tertiary)]">{u.email}</td>
                    <td className="px-4 py-3.5 text-xs text-[var(--text-muted)]">{formatDateTime(u.createdAt)}</td>
                    <td className="px-4 py-3.5">
                      <input type="checkbox" checked={u.role === 'admin'} onChange={(e) => togglePermission(u, 'role', e.target.checked)} />
                    </td>
                    <td className="px-4 py-3.5">
                      <input
                        type="checkbox"
                        checked={u.canViewHistory}
                        onChange={(e) => togglePermission(u, 'canViewHistory', e.target.checked)}
                      />
                    </td>
                    <td className="px-4 py-3.5">
                      <input
                        type="checkbox"
                        checked={u.canAccessMinerador}
                        onChange={(e) => togglePermission(u, 'canAccessMinerador', e.target.checked)}
                      />
                    </td>
                    <td className="px-4 py-3.5 text-[var(--text-tertiary)]">{u.searchCount}</td>
                    <td className="px-4 py-3.5 text-xs text-[var(--text-muted)]">{formatDateTime(u.lastLoginAt)}</td>
                    <td className="px-4 py-3.5">
                      {u.allIps?.length > 0 ? (
                        <button
                          onClick={() => viewIps(u)}
                          title="Clique para ver histórico completo (data de cada login)"
                          className={`flex flex-wrap items-center gap-1 rounded-lg px-1.5 py-1 text-left ${
                            risky ? 'bg-red-500/10 ring-1 ring-red-500/30' : 'hover:bg-[var(--hover-surface)]'
                          }`}
                        >
                          {risky && <span title="Mais de um IP nessa conta">⚠️</span>}
                          {u.allIps.slice(0, 3).map((ip) => (
                            <span
                              key={ip}
                              className={`rounded px-1.5 py-0.5 font-mono text-[11px] ${
                                risky ? 'bg-red-500/15 text-red-400' : 'bg-[var(--hover-surface)] text-[var(--text-tertiary)]'
                              }`}
                            >
                              {ip}
                            </span>
                          ))}
                          {extraIps > 0 && <span className="text-[11px] text-[var(--text-muted)]">+{extraIps}</span>}
                        </button>
                      ) : (
                        <span className="text-xs text-[var(--text-muted)]">Nunca logou</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-right">
                      <div className="flex items-center justify-end gap-3">
                        <button onClick={() => openPasswordEdit(u)} className="text-xs font-medium text-[var(--text-muted)] hover:text-brand-500">
                          🔑 Senha
                        </button>
                        <button onClick={() => handleDelete(u)} className="text-xs font-medium text-[var(--text-muted)] hover:text-red-400">
                          🗑️ Remover
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {ipDetail && (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">IPs usados por {ipDetail.user.name}</h3>
          <div className="overflow-hidden rounded-lg border border-[var(--border)]">
            <table className="w-full text-left text-sm">
              <thead className="bg-[var(--bg-surface-2)] text-xs uppercase text-[var(--text-muted)]">
                <tr>
                  <th className="px-3 py-2.5">IP</th>
                  <th className="px-3 py-2.5">Logins</th>
                  <th className="px-3 py-2.5">Primeira vez</th>
                  <th className="px-3 py-2.5">Última vez</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {ipDetail.rows === null && (
                  <tr>
                    <td colSpan={4} className="px-3 py-4 text-center text-[var(--text-muted)]">
                      Carregando…
                    </td>
                  </tr>
                )}
                {ipDetail.rows?.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-4 text-center text-[var(--text-muted)]">
                      Nenhum login registrado ainda.
                    </td>
                  </tr>
                )}
                {ipDetail.rows?.map((row, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2.5 text-[var(--text-secondary)]">{row.ip}</td>
                    <td className="px-3 py-2.5 text-[var(--text-secondary)]">{row.count}</td>
                    <td className="px-3 py-2.5 text-xs text-[var(--text-muted)]">{formatDateTime(row.firstAt)}</td>
                    <td className="px-3 py-2.5 text-xs text-[var(--text-muted)]">{formatDateTime(row.lastAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {passwordEdit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setPasswordEdit(null)}>
          <div
            className="w-full max-w-sm rounded-2xl bg-[var(--bg-surface)] p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">Trocar senha de {passwordEdit.user.name}</h3>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              A pessoa passa a usar essa senha nova pro próximo login — avise ela diretamente.
            </p>
            <input
              type="password"
              autoFocus
              placeholder="Nova senha (mín. 8 caracteres)"
              value={passwordEdit.value}
              onChange={(e) => setPasswordEdit({ ...passwordEdit, value: e.target.value, error: null })}
              onKeyDown={(e) => e.key === 'Enter' && submitPasswordEdit()}
              autoComplete="new-password"
              className="mt-3 w-full rounded-lg border border-[var(--border)] bg-[var(--bg-surface-2)] px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-brand-500 focus:outline-none"
            />
            {passwordEdit.error && <p className="mt-2 text-xs text-red-400">{passwordEdit.error}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setPasswordEdit(null)}
                className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-medium text-[var(--text-tertiary)] hover:bg-[var(--hover-surface)]"
              >
                Cancelar
              </button>
              <button onClick={submitPasswordEdit} disabled={passwordEdit.saving} className="btn-primary px-4 py-2 text-xs">
                {passwordEdit.saving ? 'Salvando…' : 'Salvar nova senha'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

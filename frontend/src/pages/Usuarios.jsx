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

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h2 className="text-xl font-semibold">Usuários</h2>
        <p className="text-sm text-gray-500">Quem tem acesso ao ScoutX e o que cada um pode fazer.</p>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5">
        <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-amber-500">Concorrentes órfãos</h3>
        <p className="mb-3.5 text-sm text-gray-400">
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

      <div className="rounded-xl border border-[#2d3148] bg-[#1c1f2e] p-5">
        <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500">Concorrentes por usuário</h3>
        <p className="mb-3.5 text-sm text-gray-400">
          Cada usuário só vê os próprios concorrentes — isto aqui é a visão de auditoria, só pra admin. Um mesmo
          domínio cadastrado por duas pessoas conta pra cada uma (compartilham o dado raspado, mas cada uma tem sua
          própria lista).
        </p>
        <div className="overflow-hidden rounded-lg border border-[#2d3148]">
          <table className="w-full text-left text-sm">
            <thead className="bg-[#161824] text-xs uppercase text-gray-500">
              <tr>
                <th className="px-3 py-2.5">Usuário</th>
                <th className="px-3 py-2.5">Por operação</th>
                <th className="px-3 py-2.5">Total</th>
                <th className="px-3 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#2d3148]">
              {competitorSummary?.map((row) => {
                const user = users?.find((u) => u.id === row.user_id)
                return (
                  <tr key={row.user_id}>
                    <td className="px-3 py-2.5 text-gray-200">{user?.name || `Usuário #${row.user_id}`}</td>
                    <td className="px-3 py-2.5 text-gray-400">
                      {Object.entries(row.by_operation)
                        .map(([op, count]) => `${operationLabel(op)}: ${count}`)
                        .join(' · ')}
                    </td>
                    <td className="px-3 py-2.5 text-gray-200">{row.total}</td>
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
                  <td colSpan={4} className="px-3 py-4 text-center text-gray-500">
                    Ninguém cadastrou nenhum concorrente ainda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-xl border border-[#2d3148] bg-[#1c1f2e] p-5">
        <h3 className="mb-3.5 text-xs font-semibold uppercase tracking-wide text-gray-500">Criar novo usuário</h3>
        <div className="flex flex-col gap-2.5">
          <input
            type="text"
            placeholder="Nome"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="rounded-lg border border-[#2d3148] bg-[#161824] px-3 py-2 text-sm text-gray-100 placeholder:text-gray-600 focus:border-brand-500 focus:outline-none"
          />
          <input
            type="email"
            placeholder="Email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            className="rounded-lg border border-[#2d3148] bg-[#161824] px-3 py-2 text-sm text-gray-100 placeholder:text-gray-600 focus:border-brand-500 focus:outline-none"
          />
          <input
            type="password"
            placeholder="Senha (mín. 8 caracteres)"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            autoComplete="new-password"
            className="rounded-lg border border-[#2d3148] bg-[#161824] px-3 py-2 text-sm text-gray-100 placeholder:text-gray-600 focus:border-brand-500 focus:outline-none"
          />
          <label className="flex items-center gap-2 text-sm text-gray-300">
            <input type="checkbox" checked={form.admin} onChange={(e) => setForm({ ...form, admin: e.target.checked })} />
            Já criar como admin
          </label>
          <button
            onClick={handleCreate}
            disabled={creating}
            className="mt-1 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {creating ? 'Criando…' : 'Criar usuário'}
          </button>
        </div>
        {formMsg && (
          <p className={`mt-3 text-sm ${formMsg.type === 'error' ? 'text-red-400' : 'text-emerald-400'}`}>{formMsg.text}</p>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border border-[#2d3148] bg-[#1c1f2e]">
        <table className="w-full text-left text-sm">
          <thead className="bg-[#161824] text-xs uppercase text-gray-500">
            <tr>
              <th className="px-3 py-2.5">Nome</th>
              <th className="px-3 py-2.5">Email</th>
              <th className="px-3 py-2.5">Admin</th>
              <th className="px-3 py-2.5">Vê histórico</th>
              <th className="px-3 py-2.5">ScoutX</th>
              <th className="px-3 py-2.5">Buscas</th>
              <th className="px-3 py-2.5">Último IP</th>
              <th className="px-3 py-2.5">IPs</th>
              <th className="px-3 py-2.5"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#2d3148]">
            {users?.map((u) => (
              <tr key={u.id} className="hover:bg-[#161824]">
                <td className="px-3 py-2.5 text-gray-200">{u.name}</td>
                <td className="px-3 py-2.5 text-gray-400">{u.email}</td>
                <td className="px-3 py-2.5">
                  <input type="checkbox" checked={u.role === 'admin'} onChange={(e) => togglePermission(u, 'role', e.target.checked)} />
                </td>
                <td className="px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={u.canViewHistory}
                    onChange={(e) => togglePermission(u, 'canViewHistory', e.target.checked)}
                  />
                </td>
                <td className="px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={u.canAccessMinerador}
                    onChange={(e) => togglePermission(u, 'canAccessMinerador', e.target.checked)}
                  />
                </td>
                <td className="px-3 py-2.5 text-gray-400">{u.searchCount}</td>
                <td className="px-3 py-2.5 text-gray-400">{u.lastIp || '—'}</td>
                <td className="px-3 py-2.5">
                  <button
                    onClick={() => viewIps(u)}
                    title="Clique para ver os IPs"
                    className={u.ipCount > 1 ? 'rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-[10.5px] font-medium text-red-400' : 'text-gray-500'}
                  >
                    {u.ipCount > 1 ? `⚠️ ${u.ipCount} IPs` : u.ipCount}
                  </button>
                </td>
                <td className="px-3 py-2.5 text-right">
                  <button onClick={() => handleDelete(u)} className="text-xs font-medium text-gray-500 hover:text-red-400">
                    🗑️ Remover
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {ipDetail && (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">IPs usados por {ipDetail.user.name}</h3>
          <div className="overflow-hidden rounded-lg border border-[#2d3148]">
            <table className="w-full text-left text-sm">
              <thead className="bg-[#161824] text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-3 py-2.5">IP</th>
                  <th className="px-3 py-2.5">Logins</th>
                  <th className="px-3 py-2.5">Primeira vez</th>
                  <th className="px-3 py-2.5">Última vez</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2d3148]">
                {ipDetail.rows === null && (
                  <tr>
                    <td colSpan={4} className="px-3 py-4 text-center text-gray-500">
                      Carregando…
                    </td>
                  </tr>
                )}
                {ipDetail.rows?.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-4 text-center text-gray-500">
                      Nenhum login registrado ainda.
                    </td>
                  </tr>
                )}
                {ipDetail.rows?.map((row, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2.5 text-gray-300">{row.ip}</td>
                    <td className="px-3 py-2.5 text-gray-300">{row.count}</td>
                    <td className="px-3 py-2.5 text-xs text-gray-500">{formatDateTime(row.firstAt)}</td>
                    <td className="px-3 py-2.5 text-xs text-gray-500">{formatDateTime(row.lastAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

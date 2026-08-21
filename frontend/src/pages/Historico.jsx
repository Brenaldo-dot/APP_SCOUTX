import { useEffect, useState } from 'react'
import { rawApi } from '../api/rawClient.js'
import { formatDateTime } from '../utils/date.js'

export default function Historico() {
  const [users, setUsers] = useState(null)
  const [error, setError] = useState(null)
  const [selected, setSelected] = useState(null)
  const [rows, setRows] = useState(null)

  useEffect(() => {
    rawApi
      .listHistoryUsers()
      .then(setUsers)
      .catch((e) => setError(e.message))
  }, [])

  function selectUser(u) {
    setSelected(u)
    setRows(null)
    rawApi.getHistoryDetail(u.id).then(setRows)
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Histórico de buscas</h2>
        <p className="text-sm text-gray-500">Quem buscou o quê nas ferramentas de Barcode e Espionar Loja.</p>
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex gap-6">
        <div className="w-72 shrink-0 space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Usuários</h3>
          {users === null && <p className="text-sm text-gray-500">Carregando…</p>}
          {users?.length === 0 && <p className="text-sm text-gray-500">Nenhuma busca registrada ainda.</p>}
          {users?.map((u) => (
            <button
              key={u.id}
              onClick={() => selectUser(u)}
              className={`flex w-full items-center justify-between gap-2 rounded-lg border px-3.5 py-2.5 text-left text-sm transition-colors ${
                selected?.id === u.id
                  ? 'border-brand-500 bg-brand-600/10'
                  : 'border-[#2d3148] bg-[#1c1f2e] hover:bg-[#222538]'
              }`}
            >
              <span className="text-gray-200">{u.name}</span>
              <span className="rounded-full border border-pink-500/35 bg-pink-500/10 px-2 py-0.5 text-[10.5px] font-medium text-pink-400">
                {u.searchCount} buscas
              </span>
            </button>
          ))}
        </div>

        <div className="flex-1">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            {selected ? `Buscas de ${selected.name}` : 'Selecione um usuário'}
          </h3>
          <div className="overflow-hidden rounded-lg border border-[#2d3148]">
            <table className="w-full text-left text-sm">
              <thead className="bg-[#161824] text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-3 py-2.5">Domínio</th>
                  <th className="px-3 py-2.5">Ferramenta</th>
                  <th className="px-3 py-2.5">Vezes</th>
                  <th className="px-3 py-2.5">Última busca</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2d3148]">
                {rows?.map((row, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2.5 text-gray-300">{row.domain}</td>
                    <td className="px-3 py-2.5 text-gray-300">{row.tool === 'spy' ? 'Espionar Loja' : 'Buscar Barcode'}</td>
                    <td className="px-3 py-2.5 text-gray-300">{row.count}</td>
                    <td className="px-3 py-2.5 text-xs text-gray-500">{formatDateTime(row.lastAt)}</td>
                  </tr>
                ))}
                {rows?.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-4 text-center text-gray-500">
                      Sem buscas registradas.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}

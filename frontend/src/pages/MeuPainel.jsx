import { useEffect, useState } from 'react'
import { rawApi } from '../api/rawClient.js'
import RefreshButton from '../components/RefreshButton.jsx'
import AffiliateEarningsView from '../components/AffiliateEarningsView.jsx'

export default function MeuPainel() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  function load() {
    return rawApi
      .getMyAffiliateEarnings()
      .then(setData)
      .catch((e) => setError(e.message || 'Não foi possível carregar seus números.'))
  }

  useEffect(() => {
    load()
  }, [])

  if (error) return <p className="text-sm text-red-400">{error}</p>
  if (!data) return <p className="text-sm text-[var(--text-muted)]">Carregando…</p>

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">Olá, {data.affiliateName} 👋</h2>
          <p className="text-sm text-[var(--text-muted)]">
            {Number(data.firstSalePercentage)}% na primeira venda · {Number(data.recurringPercentage)}% nas renovações.
          </p>
        </div>
        <RefreshButton onRefresh={load} />
      </div>
      <AffiliateEarningsView data={data} />
    </div>
  )
}

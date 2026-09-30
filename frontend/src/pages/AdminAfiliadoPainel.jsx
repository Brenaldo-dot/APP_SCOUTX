import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { rawApi } from '../api/rawClient.js'
import RefreshButton from '../components/RefreshButton.jsx'
import AffiliateEarningsView from '../components/AffiliateEarningsView.jsx'

// Admin "espiando" o painel de um afiliado específico (pedido do usuário,
// 2026-09-29: "o admin ter um painel e conseguir ver o que cada afiliado
// tá vendo") — mesmo visual de MeuPainel.jsx (o afiliado vendo os próprios
// números), só que puxando por :id em vez de pela sessão logada.
export default function AdminAfiliadoPainel() {
  const { id } = useParams()
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  function load() {
    setData(null)
    setError(null)
    return rawApi
      .getAffiliateEarnings(id)
      .then(setData)
      .catch((e) => setError(e.message || 'Não foi possível carregar os números desse afiliado.'))
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/afiliados" className="mb-1 flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-brand-500">
            <ArrowLeft size={13} /> Voltar pra Afiliados
          </Link>
          <h2 className="text-xl font-semibold">{data ? `Painel de ${data.affiliateName}` : 'Painel do afiliado'}</h2>
          <p className="text-sm text-[var(--text-muted)]">Exatamente o que ele vê quando entra na conta dele.</p>
        </div>
        <RefreshButton onRefresh={load} />
      </div>

      {error && <p className="text-sm text-red-400">{error}</p>}
      {!error && !data && <p className="text-sm text-[var(--text-muted)]">Carregando…</p>}
      {data && <AffiliateEarningsView data={data} />}
    </div>
  )
}

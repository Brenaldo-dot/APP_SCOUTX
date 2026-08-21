import { useEffect, useState } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api } from '../api/client.js'
import { SCORE_LABEL_HEX } from './Badges.jsx'

function ChartTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const { label, count } = payload[0].payload
  return (
    <div className="rounded-lg border border-[#2d3148] bg-[#1c1f2e] px-3 py-2 text-xs shadow-sm">
      <p className="text-gray-500">{label}</p>
      <p className="font-semibold text-gray-200">
        {count} produto{count === 1 ? '' : 's'}
      </p>
    </div>
  )
}

// Não é série temporal — é raio-x do momento (quantos produtos em cada
// faixa de score AGORA), por isso sem filtro de período, só de loja.
export default function ScoreDistributionChart({ competitorId, operation }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    api
      .getScoreDistribution({ competitor_id: competitorId || undefined, operation })
      .then(setData)
      .catch((e) => setError(e.message))
  }, [competitorId, operation])

  if (error) return <p className="py-8 text-center text-sm text-gray-500">Não deu pra carregar o gráfico.</p>
  if (!data) return <p className="py-8 text-center text-sm text-gray-500">Carregando…</p>

  const total = data.reduce((sum, d) => sum + d.count, 0)

  return (
    <div>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="#2d3148" />
          <XAxis dataKey="label" tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={{ stroke: '#2d3148' }} tickLine={false} />
          <YAxis allowDecimals={false} tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} width={28} />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: '#222538' }} />
          <Bar dataKey="count" maxBarSize={64} radius={[4, 4, 0, 0]}>
            {data.map((d) => (
              <Cell key={d.label} fill={SCORE_LABEL_HEX[d.label]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      {total === 0 && <p className="mt-1 text-center text-xs text-gray-500">Nenhum produto com score calculado ainda.</p>}
    </div>
  )
}

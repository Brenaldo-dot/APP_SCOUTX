import { useState } from 'react'
import { rawApi } from '../api/rawClient.js'

function fmtPrice(min, max) {
  if (min === null || min === undefined) return '—'
  if (max === null || max === undefined || max === min) return `R$ ${min.toFixed(2)}`
  return `R$ ${min.toFixed(2)} – R$ ${max.toFixed(2)}`
}

function Badges({ p }) {
  const badges = []
  if (p.duplicatePageCount >= 2) {
    const titles = (p.duplicatePages || []).map((d) => d.title).join(' | ')
    badges.push(
      <span key="dup" title={titles} className="rounded-full border border-red-500/40 bg-red-500/10 px-2 py-0.5 text-[10.5px] font-medium text-red-400">
        🔁 {p.duplicatePageCount} páginas
      </span>,
    )
  }
  if (p.ageDays !== null && p.ageDays <= 45) {
    badges.push(
      <span key="new" className="rounded-full border border-blue-500/40 bg-blue-500/10 px-2 py-0.5 text-[10.5px] font-medium text-blue-300">
        🆕 {p.ageDays}d
      </span>,
    )
  }
  if (p.inBestsellerCollection) {
    badges.push(
      <span key="best" className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10.5px] font-medium text-emerald-400">
        📈 {p.inBestsellerCollection} #{p.bestsellerPosition}
      </span>,
    )
  }
  if (p.variantCount >= 4) {
    badges.push(
      <span key="var" className="rounded-full border border-amber-500/35 bg-amber-500/10 px-2 py-0.5 text-[10.5px] font-medium text-amber-400">
        🎨 {p.variantCount} variantes
      </span>,
    )
  }
  return <div className="flex flex-wrap justify-end gap-1.5">{badges}</div>
}

function csvEscape(value) {
  const s = String(value ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function exportCsv(data) {
  const headers = [
    'titulo', 'url', 'vendor', 'id_fornecedor', 'tipo', 'tags', 'preco_min', 'preco_max',
    'variantes', 'imagens', 'criado_em', 'dias_desde_criacao', 'colecao_destaque', 'posicao_na_colecao',
    'paginas_duplicadas', 'urls_paginas_duplicadas', 'score',
  ]
  const rows = data.products.map((p) => [
    p.title, p.url, p.vendor, p.supplierId, p.productType, p.tags, p.priceMin, p.priceMax,
    p.variantCount, p.imageCount, p.createdAt, p.ageDays, p.inBestsellerCollection || '', p.bestsellerPosition || '',
    p.duplicatePageCount, (p.duplicatePages || []).map((d) => d.url).join(' | '), p.score,
  ])
  const csv = [headers, ...rows].map((row) => row.map(csvEscape).join(',')).join('\r\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `espionagem-${new URL(data.baseUrl).hostname}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

const STATS = [
  { key: 'totalProducts', label: 'Produtos públicos' },
  { key: 'totalCollections', label: 'Coleções encontradas' },
  { key: 'bestsellerCollectionsUsed', label: 'Coleções de "mais vendidos" usadas', fn: (d) => d.bestsellerCollectionsUsed.length },
  { key: 'new', label: 'Produtos criados nos últimos 45 dias', fn: (d) => d.products.filter((p) => p.ageDays !== null && p.ageDays <= 45).length },
  { key: 'totalVendors', label: 'Fornecedores distintos' },
  { key: 'totalDuplicatedListings', label: 'Produtos com páginas duplicadas' },
]

export default function EspionarLoja() {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [data, setData] = useState(null)

  async function analisar() {
    const trimmed = url.trim()
    if (!trimmed) {
      setError('Cole a URL da loja antes de analisar')
      return
    }
    setLoading(true)
    setError(null)
    setData(null)
    try {
      const result = await rawApi.espionarLoja(trimmed)
      setData(result)
    } catch (err) {
      setError(err.message || 'Não foi possível analisar esta loja')
    } finally {
      setLoading(false)
    }
  }

  const top = data ? data.products.filter((p) => p.score > 0).slice(0, 15) : []

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Espionar Loja</h2>
        <p className="text-sm text-gray-500">Analisa o catálogo público de uma loja concorrente inteira.</p>
      </div>

      <div className="rounded-xl border border-[#2d3148] bg-[#1c1f2e] p-5">
        <label className="mb-2 block text-sm text-gray-300">Cole a URL da loja ou de um produto do concorrente:</label>
        <div className="flex items-end gap-3">
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && analisar()}
            placeholder="https://loja-concorrente.com"
            autoComplete="off"
            className="flex-1 rounded-lg border border-[#2d3148] bg-[#161824] px-3 py-2.5 text-sm text-gray-100 placeholder:text-gray-600 focus:border-brand-500 focus:outline-none"
          />
          <button
            onClick={analisar}
            disabled={loading}
            className="shrink-0 whitespace-nowrap rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {loading ? 'Analisando… (pode levar até 1-2 min em lojas grandes)' : 'Analisar Loja'}
          </button>
        </div>
        <p className="mt-3 text-xs text-gray-500">
          Só usa dados públicos da loja (catálogo, coleções, datas). Não existe forma pública de saber vendas/faturamento
          reais. Pra pegar o ID Fornecedor certo, a ferramenta busca a página de cada produto individualmente, então
          lojas grandes demoram mais. Quando o produto realmente não tem barcode/SKU cadastrado, o campo fica em "—".
        </p>
        {error && (
          <div className="mt-4 rounded-lg border border-red-900 bg-red-950/40 px-3 py-2.5 text-sm text-red-400">{error}</div>
        )}
      </div>

      {data && (
        <>
          <div className="flex flex-wrap gap-3">
            {STATS.map((s) => (
              <div key={s.key} className="min-w-[140px] rounded-lg border border-[#2d3148] bg-[#1c1f2e] px-4 py-3">
                <div className="text-xl font-semibold text-gray-100">{s.fn ? s.fn(data) : data[s.key]}</div>
                <div className="mt-0.5 text-[11px] text-gray-500">{s.label}</div>
              </div>
            ))}
          </div>

          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
              🔥 Maior sinal de destaque (provável escalando)
            </h3>
            {top.length === 0 ? (
              <p className="text-sm text-gray-500">
                Nenhum sinal forte encontrado — a loja não expõe coleções de mais-vendidos ou datas recentes publicamente.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {top.map((p, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between gap-3 rounded-lg border border-[#2d3148] bg-[#1c1f2e] px-3.5 py-2.5"
                  >
                    <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-brand-400 hover:underline">
                      {p.title}
                    </a>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Badges p={p} />
                      <span className="rounded-full border border-pink-500/35 bg-pink-500/10 px-2 py-0.5 text-[10.5px] font-medium text-pink-400">
                        score {p.score}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Catálogo completo</h3>
              <button
                onClick={() => exportCsv(data)}
                className="rounded-md bg-[#2d3148] px-3 py-1.5 text-xs font-medium text-gray-100 hover:bg-[#374151]"
              >
                Exportar CSV
              </button>
            </div>
            <div className="max-h-[420px] overflow-auto rounded-lg border border-[#2d3148]">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-[#161824] text-gray-500">
                  <tr>
                    {['Produto', 'Fornecedor', 'ID Fornecedor', 'Preço', 'Variantes', 'Imagens', 'Criado há', 'Coleção destaque', 'Páginas duplicadas', 'Score'].map((h) => (
                      <th key={h} className="whitespace-nowrap border-b border-[#2d3148] px-2.5 py-2 font-medium">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.products.map((p, i) => (
                    <tr key={i} className="border-b border-[#22263a] hover:bg-[#1c1f2e]">
                      <td className="max-w-[260px] whitespace-normal px-2.5 py-1.5">
                        <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-brand-400 hover:underline">
                          {p.title}
                        </a>
                      </td>
                      <td className="whitespace-nowrap px-2.5 py-1.5 text-gray-300">{p.vendor || '—'}</td>
                      <td className="whitespace-nowrap px-2.5 py-1.5 text-gray-300">{p.supplierId || '—'}</td>
                      <td className="whitespace-nowrap px-2.5 py-1.5 text-gray-300">{fmtPrice(p.priceMin, p.priceMax)}</td>
                      <td className="whitespace-nowrap px-2.5 py-1.5 text-gray-300">{p.variantCount}</td>
                      <td className="whitespace-nowrap px-2.5 py-1.5 text-gray-300">{p.imageCount}</td>
                      <td className="whitespace-nowrap px-2.5 py-1.5 text-gray-300">{p.ageDays !== null ? `${p.ageDays}d` : '—'}</td>
                      <td className="whitespace-nowrap px-2.5 py-1.5 text-gray-300">
                        {p.inBestsellerCollection ? `${p.inBestsellerCollection} (#${p.bestsellerPosition})` : '—'}
                      </td>
                      <td className="whitespace-nowrap px-2.5 py-1.5 text-gray-300">{p.duplicatePageCount >= 2 ? `🔁 ${p.duplicatePageCount}` : '—'}</td>
                      <td className="whitespace-nowrap px-2.5 py-1.5 text-gray-300">{p.score}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {data.vendorsBreakdown?.length > 0 && (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Fornecedores (vendor) e quantidade de produtos</h3>
              <ul className="flex flex-wrap gap-1.5">
                {data.vendorsBreakdown.map((v, i) => (
                  <li key={i} className="rounded-full border border-[#2d3148] bg-[#1c1f2e] px-2.5 py-1 text-[11.5px] text-gray-400">
                    {v.vendor} ({v.count})
                  </li>
                ))}
              </ul>
            </div>
          )}

          {data.collections?.length > 0 && (
            <div>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Coleções públicas da loja</h3>
              <ul className="flex flex-wrap gap-1.5">
                {data.collections.map((c, i) => (
                  <li key={i} className="rounded-full border border-[#2d3148] bg-[#1c1f2e] px-2.5 py-1 text-[11.5px] text-gray-400">
                    {c.title}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  )
}

import { useState } from 'react'

// Bandeiras embutidas no próprio app (pasta src/assets/flags, ~4 KB no total),
// sem depender de serviço externo: o emoji de bandeira não aparece no Windows
// (vira só as letras "CO", "MX"...). País cadastrado à mão, sem código, cai pro
// emoji ou pra um selo com o código.
const FLAGS = import.meta.glob('../assets/flags/*.png', { eager: true, query: '?url', import: 'default' })

function flagUrl(code) {
  return FLAGS[`../assets/flags/${code}.png`] || null
}

export default function CountryFlag({ op, size = 40 }) {
  const [failed, setFailed] = useState(false)
  const code = op?.code
  const url = code ? flagUrl(code) : null
  if (!url || failed) {
    return (
      <span
        className="flex items-center justify-center rounded-lg bg-brand-500/15 text-sm font-bold text-brand-400"
        style={{ width: size, height: Math.round(size * 0.7) }}
      >
        {code ? code.toUpperCase() : op?.flag || '🌎'}
      </span>
    )
  }
  return (
    <img
      src={url}
      alt=""
      width={size}
      height={Math.round(size * 0.7)}
      onError={() => setFailed(true)}
      className="rounded-md object-cover shadow-md shadow-black/40 ring-1 ring-white/10"
      style={{ width: size, height: Math.round(size * 0.7) }}
    />
  )
}

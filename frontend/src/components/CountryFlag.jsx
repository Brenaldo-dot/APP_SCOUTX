import { useState } from 'react'

// Bandeira do país como imagem (o emoji de bandeira não aparece no Windows: vira
// só as letras "CO", "MX"...). Usa o serviço público flagcdn.com; se a imagem
// não carregar (ou o país for um cadastrado à mão, sem código), cai pro emoji
// ou pra um selo com o código do país.
export default function CountryFlag({ op, size = 40 }) {
  const [failed, setFailed] = useState(false)
  const code = op?.code
  if (!code || failed) {
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
      src={`https://flagcdn.com/w80/${code}.png`}
      alt=""
      width={size}
      height={Math.round(size * 0.7)}
      loading="lazy"
      onError={() => setFailed(true)}
      className="rounded-md object-cover shadow-md shadow-black/40 ring-1 ring-white/10"
      style={{ width: size, height: Math.round(size * 0.7) }}
    />
  )
}

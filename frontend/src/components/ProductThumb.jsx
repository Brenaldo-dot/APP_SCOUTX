import { useState } from 'react'
import { Package } from 'lucide-react'

// Miniatura de produto reutilizada em Produtos, Produtos Quentes e Anúncios
// (Product.main_image_url já vem raspado do Shopify — ver scrapers/shopify.py).
// Cai num ícone neutro se não tiver imagem ou o load falhar, nunca deixa
// buraco vazio no card/linha.
export default function ProductThumb({ src, title, size = 'h-10 w-10', rounded = 'rounded-lg' }) {
  const [failed, setFailed] = useState(false)
  if (!src || failed) {
    return (
      <span className={`flex ${size} shrink-0 items-center justify-center ${rounded} border border-[var(--border)] bg-[var(--hover-surface)] text-[var(--text-faint)]`}>
        <Package size={16} />
      </span>
    )
  }
  return (
    <img
      src={src}
      alt={title || ''}
      onError={() => setFailed(true)}
      className={`${size} shrink-0 ${rounded} border border-[var(--border)] bg-white object-cover`}
    />
  )
}

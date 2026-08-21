export default function Pagination({ page, totalPages, total, onChange }) {
  if (totalPages <= 1) return null

  return (
    <div className="flex items-center justify-between gap-4 px-1 py-2 text-sm text-gray-400">
      <span>
        Página {page} de {totalPages} · {total} no total
      </span>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onChange(page - 1)}
          disabled={page <= 1}
          className="rounded-lg border border-[#2d3148] px-3 py-1.5 font-medium hover:bg-[#222538] disabled:cursor-not-allowed disabled:opacity-40"
        >
          ← Anterior
        </button>
        <button
          type="button"
          onClick={() => onChange(page + 1)}
          disabled={page >= totalPages}
          className="rounded-lg border border-[#2d3148] px-3 py-1.5 font-medium hover:bg-[#222538] disabled:cursor-not-allowed disabled:opacity-40"
        >
          Próxima →
        </button>
      </div>
    </div>
  )
}

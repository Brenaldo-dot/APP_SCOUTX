export default function StatCard({ label, value, hint }) {
  return (
    <div className="rounded-xl border border-[#2d3148] bg-[#1c1f2e] p-5 shadow-sm">
      <p className="text-sm text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-gray-100">{value ?? '—'}</p>
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
    </div>
  )
}

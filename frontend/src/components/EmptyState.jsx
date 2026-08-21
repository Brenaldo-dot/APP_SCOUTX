export default function EmptyState({ title, subtitle }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[#2d3148] bg-[#1c1f2e] py-16 text-center">
      <p className="text-sm font-medium text-gray-400">{title}</p>
      {subtitle && <p className="mt-1 max-w-sm text-sm text-gray-500">{subtitle}</p>}
    </div>
  )
}

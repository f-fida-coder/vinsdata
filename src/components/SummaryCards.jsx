const COLOR_CLASSES = {
  blue:    'bg-blue-50 text-blue-700 border-zinc-200',
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  amber:   'bg-amber-50 text-amber-700 border-amber-100',
  red:     'bg-red-50 text-red-700 border-red-100',
  violet:  'bg-violet-50 text-violet-700 border-violet-100',
  gray:    'bg-gray-50 text-gray-700 border-gray-200',
};

/**
 * Compact row of summary cards. Each card: { label, value, color?, hint? }.
 * Skips cards with null/undefined value. Useful for reports summaries.
 */
export default function SummaryCards({ cards }) {
  const visible = cards.filter((c) => c.value !== null && c.value !== undefined);
  if (visible.length === 0) return null;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 sm:gap-3 mb-4">
      {visible.map((c) => (
        <div
          key={c.label}
          className={`rounded-xl p-3 sm:p-4 border ${COLOR_CLASSES[c.color || 'gray']}`}
        >
          <p className="text-[10px] font-semibold uppercase tracking-wider opacity-75">{c.label}</p>
          <p className="text-2xl font-bold mt-1">{typeof c.value === 'number' ? c.value.toLocaleString() : c.value}</p>
          {c.hint && <p className="text-[11px] opacity-70 mt-1">{c.hint}</p>}
        </div>
      ))}
    </div>
  );
}

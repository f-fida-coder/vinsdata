import { KPI } from './ui';

const DOT_BY_COLOR = {
  blue: 'var(--cold)',
  emerald: 'var(--success)',
  amber: 'var(--warm)',
  red: 'var(--hot)',
  violet: 'var(--info)',
  gray: 'var(--text-2)',
};

/**
 * Compact row of summary cards. Each card: { label, value, color?, hint? }.
 * Skips cards with null/undefined value.
 */
export default function SummaryCards({ cards }) {
  const visible = cards.filter((c) => c.value !== null && c.value !== undefined);
  if (visible.length === 0) return null;
  return (
    <div
      className="kpi-row"
      style={{ gridTemplateColumns: `repeat(${Math.min(visible.length, 5)}, 1fr)` }}
    >
      {visible.map((c) => (
        <KPI
          key={c.label}
          label={c.label}
          value={typeof c.value === 'number' ? c.value.toLocaleString() : c.value}
          dot={DOT_BY_COLOR[c.color || 'gray']}
          hint={c.hint}
        />
      ))}
    </div>
  );
}

import { useState } from 'react';
import { formatPhone } from '../lib/crm';
import { PHONE_FIELD_KEYS } from '../lib/normalizedFields';

/**
 * Renders the available phone numbers for a lead. If there's only one,
 * it shows as plain formatted text. If there are multiple, it shows a
 * dropdown defaulting to the primary; the operator can switch to view
 * any of the others without leaving the row.
 *
 * Click events stop-propagation so picking a phone in a row doesn't
 * also open the lead's detail drawer.
 */
export default function PhonesDropdown({ payload, size = 'sm' }) {
  // Pull all four phone slots in fallback order. Filter out blanks.
  const phones = PHONE_FIELD_KEYS
    .map((k) => payload?.[k])
    .map((p) => (p == null ? '' : String(p).trim()))
    .filter(Boolean);

  const [idx, setIdx] = useState(0);

  if (phones.length === 0) return <span className="text-gray-400">—</span>;

  if (phones.length === 1) {
    return <span className="tabular-nums">{formatPhone(phones[0])}</span>;
  }

  const cls = size === 'xs'
    ? 'text-[10px] px-1 py-0.5 tabular-nums'
    : 'text-[11px] px-1.5 py-0.5 tabular-nums';

  return (
    <select
      value={idx}
      onChange={(e) => setIdx(Number(e.target.value))}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      title={`${phones.length} phone numbers — pick one to view`}
      className={`bg-transparent border-0 outline-none cursor-pointer focus:ring-1 focus:ring-[var(--vv-bg-dark)] rounded ${cls}`}
      style={{ color: 'var(--vv-text-muted)' }}
    >
      {phones.map((p, i) => (
        <option key={i} value={i}>
          {formatPhone(p)}{i === 0 ? '  •  primary' : ''}
        </option>
      ))}
    </select>
  );
}

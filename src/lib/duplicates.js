// Mirror of DUPLICATE_MATCH_TYPES / statuses from api/pipeline.php.

export const MATCH_TYPES = [
  { key: 'vin',               label: 'VIN',                  bg: 'bg-indigo-50',  text: 'text-indigo-700' },
  { key: 'email',             label: 'Email',                bg: 'bg-sky-50',     text: 'text-sky-700' },
  { key: 'phone',             label: 'Phone',                bg: 'bg-emerald-50', text: 'text-emerald-700' },
  { key: 'name_phone',        label: 'Name + phone',         bg: 'bg-amber-50',   text: 'text-amber-700' },
  { key: 'address_last_name', label: 'Address + last name',  bg: 'bg-violet-50',  text: 'text-violet-700' },
];
export const MATCH_TYPE_BY_KEY = Object.fromEntries(MATCH_TYPES.map((m) => [m.key, m]));

export const REVIEW_STATUSES = [
  { key: 'pending',             label: 'Pending review',   bg: 'bg-gray-100',   text: 'text-gray-700',    dot: 'bg-gray-400' },
  { key: 'confirmed_duplicate', label: 'Confirmed duplicate', bg: 'bg-red-50',  text: 'text-red-700',     dot: 'bg-red-500' },
  { key: 'not_duplicate',       label: 'Not a duplicate',  bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  { key: 'ignored',             label: 'Ignored',          bg: 'bg-gray-50',    text: 'text-gray-500',    dot: 'bg-gray-300' },
];
export const REVIEW_STATUS_BY_KEY = Object.fromEntries(REVIEW_STATUSES.map((s) => [s.key, s]));

export function confidenceLabel(c) {
  if (c >= 0.9)  return 'Very high';
  if (c >= 0.8)  return 'High';
  if (c >= 0.65) return 'Medium';
  return 'Low';
}

export function confidenceStyle(c) {
  if (c >= 0.9)  return 'bg-emerald-50 text-emerald-700';
  if (c >= 0.8)  return 'bg-blue-50 text-blue-700';
  if (c >= 0.65) return 'bg-amber-50 text-amber-700';
  return 'bg-gray-50 text-gray-600';
}

/**
 * Turn the stored canonical match_key into a human-friendly preview,
 * expanding composite keys into their named parts.
 */
export function formatMatchKey(type, key) {
  if (!key) return '—';
  if (type === 'address_last_name') {
    const [addr, last] = String(key).split('||');
    return `${addr || '—'} · ${last || '—'}`;
  }
  if (type === 'name_phone') {
    const [first, last, phone] = String(key).split('||');
    return `${first || ''} ${last || ''} · ${phone || ''}`.trim();
  }
  return String(key);
}

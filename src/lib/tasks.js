// Mirror of LEAD_TASK_TYPES / LEAD_TASK_STATUSES / CONTACT_CHANNELS / CONTACT_OUTCOMES
// from api/pipeline.php.

export const TASK_TYPES = [
  { key: 'callback',        label: 'Callback',        icon: 'phone-arrow' },
  { key: 'follow_up',       label: 'Follow-up',       icon: 'arrow-right' },
  { key: 'review',          label: 'Review',          icon: 'eye' },
  { key: 'verify_contact',  label: 'Verify contact',  icon: 'check' },
  { key: 'custom',          label: 'Custom',          icon: 'dot' },
];
export const TASK_TYPE_BY_KEY = Object.fromEntries(TASK_TYPES.map((t) => [t.key, t]));

export const TASK_STATUSES = [
  { key: 'open',      label: 'Open',      bg: 'bg-blue-50',    text: 'text-blue-700',    dot: 'bg-blue-500' },
  { key: 'completed', label: 'Completed', bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  { key: 'cancelled', label: 'Cancelled', bg: 'bg-gray-100',   text: 'text-gray-600',    dot: 'bg-gray-400' },
];
export const TASK_STATUS_BY_KEY = Object.fromEntries(TASK_STATUSES.map((s) => [s.key, s]));

export const CONTACT_CHANNELS = [
  { key: 'phone',    label: 'Phone',    emoji: '📞' },
  { key: 'email',    label: 'Email',    emoji: '✉️' },
  { key: 'sms',      label: 'SMS',      emoji: '💬' },
  { key: 'whatsapp', label: 'WhatsApp', emoji: '💚' },
  { key: 'other',    label: 'Other',    emoji: '•' },
];
export const CHANNEL_BY_KEY = Object.fromEntries(CONTACT_CHANNELS.map((c) => [c.key, c]));

export const CONTACT_OUTCOMES = [
  { key: 'attempted',        label: 'Attempted',         bg: 'bg-gray-100',   text: 'text-gray-700',    dot: 'bg-gray-400' },
  { key: 'connected',        label: 'Connected',         bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  { key: 'no_answer',        label: 'No answer',         bg: 'bg-slate-50',   text: 'text-slate-700',   dot: 'bg-slate-400' },
  { key: 'voicemail',        label: 'Voicemail',         bg: 'bg-indigo-50',  text: 'text-indigo-700',  dot: 'bg-indigo-500' },
  { key: 'wrong_number',     label: 'Wrong number',      bg: 'bg-rose-50',    text: 'text-rose-700',    dot: 'bg-rose-400' },
  { key: 'follow_up_needed', label: 'Follow-up needed',  bg: 'bg-amber-50',   text: 'text-amber-700',   dot: 'bg-amber-500' },
  { key: 'completed',        label: 'Completed',         bg: 'bg-green-100',  text: 'text-green-800',   dot: 'bg-green-600' },
  { key: 'other',            label: 'Other',             bg: 'bg-gray-50',    text: 'text-gray-600',    dot: 'bg-gray-300' },
];
export const OUTCOME_BY_KEY = Object.fromEntries(CONTACT_OUTCOMES.map((o) => [o.key, o]));

/** Convert a datetime string (or Date) into a short relative label (e.g. "3h ago", "in 2d", "today"). */
export function relativeDue(when, { compareNow = new Date() } = {}) {
  if (!when) return null;
  const d = typeof when === 'string' ? new Date(when.replace(' ', 'T')) : when;
  if (Number.isNaN(d.getTime())) return null;
  const diffMs  = d.getTime() - compareNow.getTime();
  const absMin  = Math.round(Math.abs(diffMs) / 60000);
  const future  = diffMs >= 0;
  if (absMin < 2)                 return 'now';
  if (absMin < 60)                return future ? `in ${absMin}m` : `${absMin}m ago`;
  const absHr = Math.round(absMin / 60);
  if (absHr < 24)                 return future ? `in ${absHr}h` : `${absHr}h ago`;
  const absDay = Math.round(absHr / 24);
  if (absDay < 7)                 return future ? `in ${absDay}d` : `${absDay}d ago`;
  const absWk = Math.round(absDay / 7);
  return future ? `in ${absWk}w` : `${absWk}w ago`;
}

/** Boolean: is the provided due_at already in the past? */
export function isOverdue(when) {
  if (!when) return false;
  const d = typeof when === 'string' ? new Date(when.replace(' ', 'T')) : when;
  if (Number.isNaN(d.getTime())) return false;
  return d.getTime() < Date.now();
}

/** Boolean: is the provided due_at within today (local time)? */
export function isDueToday(when) {
  if (!when) return false;
  const d = typeof when === 'string' ? new Date(when.replace(' ', 'T')) : when;
  if (Number.isNaN(d.getTime())) return false;
  const now = new Date();
  return d.getFullYear() === now.getFullYear()
    && d.getMonth() === now.getMonth()
    && d.getDate() === now.getDate();
}

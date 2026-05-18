// Notification types mirror NOTIFICATION_TYPES in api/pipeline.php.

export const NOTIFICATION_META = {
  task_overdue:   { label: 'Overdue',   accent: 'bg-red-500',     tone: 'red' },
  task_due_today: { label: 'Due today', accent: 'bg-amber-500',   tone: 'amber' },
  task_due_soon:  { label: 'Due soon',  accent: 'bg-amber-400',   tone: 'amber' },
  task_assigned:  { label: 'Assigned',  accent: 'bg-blue-500',    tone: 'blue' },
  task_reopened:  { label: 'Reopened',  accent: 'bg-indigo-500',  tone: 'indigo' },
};

export function relativeFrom(when) {
  if (!when) return '';
  const d = typeof when === 'string' ? new Date(when.replace(' ', 'T')) : when;
  if (Number.isNaN(d.getTime())) return '';
  const diffMs = Date.now() - d.getTime();
  const absMin = Math.round(Math.abs(diffMs) / 60000);
  const past = diffMs >= 0;
  if (absMin < 1)  return 'just now';
  if (absMin < 60) return past ? `${absMin}m ago` : `in ${absMin}m`;
  const h = Math.round(absMin / 60);
  if (h < 24)      return past ? `${h}h ago` : `in ${h}h`;
  const d2 = Math.round(h / 24);
  if (d2 < 7)      return past ? `${d2}d ago` : `in ${d2}d`;
  const w = Math.round(d2 / 7);
  return past ? `${w}w ago` : `in ${w}w`;
}

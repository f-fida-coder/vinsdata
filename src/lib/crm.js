// Mirror of LEAD_STATUSES / LEAD_PRIORITIES / LEAD_ACTIVITY_TYPES from api/pipeline.php.

export const LEAD_STATUSES = [
  { key: 'new',             label: 'New',             bg: 'bg-blue-50',    text: 'text-blue-700',    dot: 'bg-blue-500' },
  { key: 'contacted',       label: 'Contacted',       bg: 'bg-sky-50',     text: 'text-sky-700',     dot: 'bg-sky-500' },
  { key: 'callback',        label: 'Callback',        bg: 'bg-amber-50',   text: 'text-amber-700',   dot: 'bg-amber-500' },
  { key: 'interested',      label: 'Interested',      bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  { key: 'not_interested',  label: 'Not interested',  bg: 'bg-gray-100',   text: 'text-gray-700',    dot: 'bg-gray-500' },
  { key: 'wrong_number',    label: 'Wrong number',    bg: 'bg-rose-50',    text: 'text-rose-700',    dot: 'bg-rose-400' },
  { key: 'no_answer',       label: 'No answer',       bg: 'bg-slate-50',   text: 'text-slate-700',   dot: 'bg-slate-400' },
  { key: 'voicemail_left',  label: 'Voicemail left',  bg: 'bg-indigo-50',  text: 'text-indigo-700',  dot: 'bg-indigo-500' },
  { key: 'deal_closed',     label: 'Deal closed',     bg: 'bg-green-100',  text: 'text-green-800',   dot: 'bg-green-600' },
  { key: 'nurture',         label: 'Nurture',         bg: 'bg-violet-50',  text: 'text-violet-700',  dot: 'bg-violet-500' },
  { key: 'disqualified',    label: 'Disqualified',    bg: 'bg-gray-100',   text: 'text-gray-600',    dot: 'bg-gray-400' },
  { key: 'do_not_call',     label: 'Do not call',     bg: 'bg-red-50',     text: 'text-red-700',     dot: 'bg-red-500' },
];

export const STATUS_BY_KEY = Object.fromEntries(LEAD_STATUSES.map((s) => [s.key, s]));

export const LEAD_PRIORITIES = [
  { key: 'low',    label: 'Low',    bg: 'bg-gray-50',   text: 'text-gray-600',   dot: 'bg-gray-400' },
  { key: 'medium', label: 'Medium', bg: 'bg-blue-50',   text: 'text-blue-700',   dot: 'bg-blue-500' },
  { key: 'high',   label: 'High',   bg: 'bg-amber-50',  text: 'text-amber-700',  dot: 'bg-amber-500' },
  { key: 'hot',    label: 'Hot',    bg: 'bg-red-50',    text: 'text-red-700',    dot: 'bg-red-500' },
];

export const PRIORITY_BY_KEY = Object.fromEntries(LEAD_PRIORITIES.map((p) => [p.key, p]));

export const LEAD_TEMPERATURES = [
  { key: 'cold',   label: 'Cold',   bg: 'bg-sky-50',     text: 'text-sky-700',     dot: 'bg-sky-500' },
  { key: 'warm',   label: 'Warm',   bg: 'bg-amber-50',   text: 'text-amber-700',   dot: 'bg-amber-500' },
  { key: 'hot',    label: 'Hot',    bg: 'bg-red-50',     text: 'text-red-700',     dot: 'bg-red-500' },
  { key: 'closed', label: 'Closed', bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },
];

export const TEMPERATURE_BY_KEY = Object.fromEntries(LEAD_TEMPERATURES.map((t) => [t.key, t]));

export const DEFAULT_LEAD_STATE = {
  status: 'new', priority: 'medium',
  lead_temperature: null, price_wanted: null, price_offered: null,
  assigned_user_id: null, assigned_user_name: null,
};

export function formatPrice(value) {
  if (value === null || value === undefined || value === '') return '—';
  const n = typeof value === 'number' ? value : Number(value);
  if (Number.isNaN(n)) return String(value);
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export const ACTIVITY_META = {
  status_changed:         { label: 'Status changed',     dot: 'bg-blue-500' },
  priority_changed:       { label: 'Priority changed',   dot: 'bg-amber-500' },
  temperature_changed:    { label: 'Temperature changed',dot: 'bg-rose-500' },
  price_wanted_changed:   { label: 'Price wanted',       dot: 'bg-emerald-400' },
  price_offered_changed:  { label: 'Price offered',      dot: 'bg-emerald-500' },
  assigned:               { label: 'Assigned',           dot: 'bg-emerald-500' },
  unassigned:             { label: 'Unassigned',         dot: 'bg-gray-400' },
  label_added:            { label: 'Label added',        dot: 'bg-violet-500' },
  label_removed:          { label: 'Label removed',      dot: 'bg-violet-300' },
  note_added:             { label: 'Note added',         dot: 'bg-sky-500' },
  note_edited:            { label: 'Note edited',        dot: 'bg-sky-400' },
  note_deleted:           { label: 'Note deleted',       dot: 'bg-rose-400' },
  task_created:           { label: 'Task created',       dot: 'bg-blue-400' },
  task_updated:           { label: 'Task updated',       dot: 'bg-blue-300' },
  task_completed:         { label: 'Task completed',     dot: 'bg-emerald-500' },
  task_cancelled:         { label: 'Task cancelled',     dot: 'bg-gray-400' },
  task_reopened:          { label: 'Task reopened',      dot: 'bg-blue-500' },
  contact_logged:         { label: 'Contact logged',     dot: 'bg-indigo-500' },
  merge_prep_updated:     { label: 'Merge prep updated', dot: 'bg-violet-500' },
};

/** Text rendering of an activity row, for the timeline. */
export function describeActivity(evt) {
  const actor = evt.user_name || 'Someone';
  switch (evt.activity_type) {
    case 'status_changed': {
      const o = evt.old_value ? (STATUS_BY_KEY[evt.old_value]?.label ?? evt.old_value) : '—';
      const n = evt.new_value ? (STATUS_BY_KEY[evt.new_value]?.label ?? evt.new_value) : '—';
      return `${actor} changed status from “${o}” to “${n}”`;
    }
    case 'priority_changed': {
      const o = evt.old_value ? (PRIORITY_BY_KEY[evt.old_value]?.label ?? evt.old_value) : '—';
      const n = evt.new_value ? (PRIORITY_BY_KEY[evt.new_value]?.label ?? evt.new_value) : '—';
      return `${actor} changed priority from “${o}” to “${n}”`;
    }
    case 'temperature_changed': {
      const o = evt.old_value ? (TEMPERATURE_BY_KEY[evt.old_value]?.label ?? evt.old_value) : '—';
      const n = evt.new_value ? (TEMPERATURE_BY_KEY[evt.new_value]?.label ?? evt.new_value) : '—';
      return `${actor} changed temperature from “${o}” to “${n}”`;
    }
    case 'price_wanted_changed':
      return `${actor} set price wanted to ${formatPrice(evt.new_value)}${evt.old_value != null ? ` (was ${formatPrice(evt.old_value)})` : ''}`;
    case 'price_offered_changed':
      return `${actor} set price offered to ${formatPrice(evt.new_value)}${evt.old_value != null ? ` (was ${formatPrice(evt.old_value)})` : ''}`;
    case 'assigned': {
      const to = evt.new_assignee_name || `user #${evt.new_value}`;
      const from = evt.old_assignee_name ? ` (was ${evt.old_assignee_name})` : '';
      return `${actor} assigned this lead to ${to}${from}`;
    }
    case 'unassigned': {
      const from = evt.old_assignee_name || `user #${evt.old_value}`;
      return `${actor} unassigned this lead from ${from}`;
    }
    case 'label_added':
      return `${actor} added label “${evt.new_value?.name ?? ''}”`;
    case 'label_removed':
      return `${actor} removed label “${evt.old_value?.name ?? ''}”`;
    case 'note_added':
      return `${actor} added a note`;
    case 'note_edited':
      return `${actor} edited a note`;
    case 'note_deleted':
      return `${actor} deleted a note`;
    case 'task_created': {
      const title = evt.new_value?.title ?? 'a task';
      return `${actor} created task “${title}”`;
    }
    case 'task_updated': {
      const fields = Object.keys(evt.new_value?.changed_fields || {});
      if (fields.length === 0) return `${actor} updated a task`;
      return `${actor} updated task (${fields.join(', ')})`;
    }
    case 'task_completed':
      return `${actor} completed task${evt.old_value?.title ? ` “${evt.old_value.title}”` : ''}`;
    case 'task_cancelled':
      return `${actor} cancelled task${evt.old_value?.title ? ` “${evt.old_value.title}”` : ''}`;
    case 'task_reopened':
      return `${actor} reopened a task`;
    case 'contact_logged': {
      const ch = evt.new_value?.channel ?? 'contact';
      const oc = evt.new_value?.outcome;
      return `${actor} logged ${ch}${oc ? ` — ${String(oc).replace(/_/g, ' ')}` : ''}`;
    }
    case 'merge_prep_updated': {
      const fields = Object.keys(evt.new_value?.changed_fields || {});
      const choiceCount = Array.isArray(evt.new_value?.choices_changed)
        ? evt.new_value.choices_changed.length
        : Object.keys(evt.new_value?.choices_changed || {}).length;
      const parts = [];
      if (fields.length) parts.push(fields.join(', '));
      if (choiceCount)   parts.push(`${choiceCount} member hint${choiceCount === 1 ? '' : 's'}`);
      return `${actor} updated merge prep${parts.length ? ` (${parts.join('; ')})` : ''}`;
    }
    default:
      return `${actor} — ${evt.activity_type}`;
  }
}

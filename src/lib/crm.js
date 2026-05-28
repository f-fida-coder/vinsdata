// Mirror of LEAD_STATUSES / LEAD_PRIORITIES / LEAD_ACTIVITY_TYPES from api/pipeline.php.

// User roles. Internal DB keys (left) vs display labels (right). "sales_agent"
// is what the team calls "Acquisition Agent" — VinVault acquires vehicles from
// leads, doesn't sell to them. Keep this in sync with USER_ROLES in
// api/pipeline.php.
export const USER_ROLES = [
  { key: 'admin',       label: 'Admin' },
  { key: 'sales_agent', label: 'Acquisition Agent' },
  { key: 'carfax',      label: 'Carfax' },
  { key: 'filter',      label: 'Filter' },
  { key: 'tlo',         label: 'TLO' },
  { key: 'marketer',    label: 'Marketer' },
];
export const ROLE_LABEL = Object.fromEntries(USER_ROLES.map((r) => [r.key, r.label]));
export const roleLabel = (key) => ROLE_LABEL[key] || key || '—';


export const LEAD_STATUSES = [
  { key: 'new',             label: 'New',             bg: 'bg-blue-50',    text: 'text-blue-700',    dot: 'bg-blue-500' },
  { key: 'contacted',       label: 'Contacted',       bg: 'bg-sky-50',     text: 'text-sky-700',     dot: 'bg-sky-500' },
  { key: 'callback',        label: 'Callback',        bg: 'bg-amber-50',   text: 'text-amber-700',   dot: 'bg-amber-500' },
  { key: 'interested',      label: 'Interested',      bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  { key: 'value_gap',       label: 'Value Gap',       bg: 'bg-orange-50',  text: 'text-orange-700',  dot: 'bg-orange-500' },
  { key: 'not_interested',  label: 'Not interested',  bg: 'bg-gray-100',   text: 'text-gray-700',    dot: 'bg-gray-500' },
  { key: 'wrong_number',    label: 'Wrong number',    bg: 'bg-rose-50',    text: 'text-rose-700',    dot: 'bg-rose-400' },
  { key: 'no_answer',       label: 'No answer',       bg: 'bg-slate-50',   text: 'text-slate-700',   dot: 'bg-slate-400' },
  { key: 'voicemail_left',  label: 'Voicemail left',  bg: 'bg-indigo-50',  text: 'text-indigo-700',  dot: 'bg-indigo-500' },
  { key: 'deal_closed',     label: 'Deal closed',     bg: 'bg-green-100',  text: 'text-green-800',   dot: 'bg-green-600' },
  { key: 'nurture',         label: 'Nurture',         bg: 'bg-violet-50',  text: 'text-violet-700',  dot: 'bg-violet-500' },
  { key: 'disqualified',    label: 'Disqualified',    bg: 'bg-gray-100',   text: 'text-gray-600',    dot: 'bg-gray-400' },
  { key: 'do_not_call',     label: 'Do not call',     bg: 'bg-red-50',     text: 'text-red-700',     dot: 'bg-red-500' },
  { key: 'marketing',       label: 'Marketing',       bg: 'bg-fuchsia-50', text: 'text-fuchsia-700', dot: 'bg-fuchsia-500' },
];

export const MARKETING_CHANNELS = [
  { key: 'email',    label: 'Email',    icon: '✉', provider: 'Gmail / SendGrid' },
  { key: 'sms',      label: 'SMS',      icon: '✆', provider: 'OpenPhone' },
  { key: 'whatsapp', label: 'WhatsApp', icon: '◉', provider: 'Coming soon' },
];

// Standard SMS segmentation rules. US carriers split messages into
// 160-char chunks when the body is GSM-7-encodable and 70-char chunks
// when any UCS-2 character (emoji, smart quotes, em dash) is present.
// Multi-segment messages reserve 7 bits per segment for concat headers,
// so the per-segment limit drops by 7 chars in either encoding.
//
// The composer uses smsCounter() to show "1 / 160" or "2 segments · GSM-7"
// so the operator knows what OpenPhone will bill per recipient before
// they click Send.
export const SMS_LIMITS = {
  GSM7_SINGLE: 160,
  GSM7_MULTI:  153,
  UCS2_SINGLE: 70,
  UCS2_MULTI:  67,
};

// GSM-7 default alphabet (ETSI TS 100 900). If every char is in this set
// the encoding stays GSM-7. Any out-of-set character (most emoji, smart
// quotes, em dash) forces UCS-2, dropping the per-segment cap to 70.
// Extension chars (^{}\\[~]|€) are GSM-7 but count as 2 chars each.
const GSM7_BASIC = "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ\x1bÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM7_EXT   = "^{}\\[~]|€";

export function smsCounter(body = '') {
  let length = 0;
  let isGsm7 = true;
  for (const ch of body) {
    if (GSM7_BASIC.includes(ch))      length += 1;
    else if (GSM7_EXT.includes(ch))   length += 2;
    else { isGsm7 = false; break; }
  }
  if (!isGsm7) length = [...body].length; // count code points, not UTF-16 units

  const encoding = isGsm7 ? 'GSM-7' : 'UCS-2';
  const single   = isGsm7 ? SMS_LIMITS.GSM7_SINGLE : SMS_LIMITS.UCS2_SINGLE;
  const multi    = isGsm7 ? SMS_LIMITS.GSM7_MULTI  : SMS_LIMITS.UCS2_MULTI;

  if (length === 0) return { length: 0, segments: 0, perSegment: single, limit: single, encoding };
  if (length <= single) return { length, segments: 1, perSegment: single, limit: single, encoding };
  return { length, segments: Math.ceil(length / multi), perSegment: multi, limit: multi, encoding };
}

export const CAMPAIGN_STATUS_META = {
  draft:             { label: 'Draft',             bg: 'bg-gray-100',    text: 'text-gray-700',    dot: 'bg-gray-400' },
  queued:            { label: 'Queued',            bg: 'bg-blue-50',     text: 'text-blue-700',    dot: 'bg-blue-500' },
  sending:           { label: 'Sending',           bg: 'bg-amber-50',    text: 'text-amber-700',   dot: 'bg-amber-500' },
  sent:              { label: 'Sent',              bg: 'bg-emerald-50',  text: 'text-emerald-700', dot: 'bg-emerald-500' },
  partially_failed:  { label: 'Partial failure',   bg: 'bg-orange-50',   text: 'text-orange-700',  dot: 'bg-orange-500' },
  cancelled:         { label: 'Cancelled',         bg: 'bg-rose-50',     text: 'text-rose-700',    dot: 'bg-rose-400' },
};

export const RECIPIENT_STATUS_META = {
  pending:   { label: 'Pending',   text: 'text-gray-600',   dot: 'bg-gray-400' },
  sending:   { label: 'Sending',   text: 'text-amber-700',  dot: 'bg-amber-500' },
  sent:      { label: 'Sent',      text: 'text-emerald-700',dot: 'bg-emerald-500' },
  failed:    { label: 'Failed',    text: 'text-red-700',    dot: 'bg-red-500' },
  skipped:   { label: 'Skipped',   text: 'text-gray-500',   dot: 'bg-gray-300' },
  bounced:   { label: 'Bounced',   text: 'text-orange-700', dot: 'bg-orange-500' },
  opted_out: { label: 'Opted out', text: 'text-rose-700',   dot: 'bg-rose-500' },
};

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

// Tiers are auto-computed from the lead's normalized payload (owner Age +
// NumberOfOwners). Tier 1 = best. An agent can also override the tier
// from the lead drawer — that override is stored on lead_states and wins
// over the auto-computed value. See api/pipeline.php LEAD_TIER_THRESHOLDS.
export const LEAD_TIERS = [
  { key: 'tier_1', label: 'Tier 1', short: 'T1', bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500', hint: 'Age 60+ · ≤4 owners' },
  { key: 'tier_2', label: 'Tier 2', short: 'T2', bg: 'bg-amber-50',   text: 'text-amber-700',   dot: 'bg-amber-500',   hint: 'Age 50–59 · ≤4 owners' },
  { key: 'tier_3', label: 'Tier 3', short: 'T3', bg: 'bg-gray-100',   text: 'text-gray-600',    dot: 'bg-gray-400',    hint: 'Everything else / unknown' },
];

export const TIER_BY_KEY = Object.fromEntries(LEAD_TIERS.map((t) => [t.key, t]));

// Transport / dispatch — mirror of TRANSPORT_STATUSES in api/pipeline.php.
export const TRANSPORT_STATUSES = [
  { key: 'new',        label: 'New',        bg: 'bg-gray-100',   text: 'text-gray-700',    dot: 'bg-gray-500',    hex: '#6b7280' },
  { key: 'notified',   label: 'Notified',   bg: 'bg-amber-50',   text: 'text-amber-700',   dot: 'bg-amber-500',   hex: '#f59e0b' },
  { key: 'assigned',   label: 'Assigned',   bg: 'bg-blue-50',    text: 'text-blue-700',    dot: 'bg-blue-500',    hex: '#3b82f6' },
  { key: 'in_transit', label: 'In transit', bg: 'bg-violet-50',  text: 'text-violet-700',  dot: 'bg-violet-500',  hex: '#8b5cf6' },
  { key: 'delivered',  label: 'Delivered',  bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500', hex: '#10b981' },
  { key: 'cancelled',  label: 'Cancelled',  bg: 'bg-rose-50',    text: 'text-rose-700',    dot: 'bg-rose-400',    hex: '#f43f5e' },
];

export const TRANSPORT_STATUS_BY_KEY = Object.fromEntries(TRANSPORT_STATUSES.map((s) => [s.key, s]));

export const BOS_PAYMENT_TYPES = [
  { key: 'cash',  label: 'Cash Payment' },
  { key: 'trade', label: 'Trade' },
  { key: 'gift',  label: 'As a Gift' },
  { key: 'other', label: 'Other' },
];

const TIER_THRESHOLDS = [
  // Evaluated in order; first match wins. maxAge=null means open-ended.
  { key: 'tier_1', minAge: 60, maxAge: null, maxOwners: 4 },
  { key: 'tier_2', minAge: 50, maxAge: 59,   maxOwners: 4 },
];

/** Mirror of api/pipeline.php's computeLeadTier(). Reads from normalized_payload. */
export function computeLeadTier(np) {
  if (!np || typeof np !== 'object') return 'tier_3';
  const clean = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(String(v).replace(/[\s,]/g, ''));
    return Number.isFinite(n) ? n : null;
  };
  const age    = clean(np.Age ?? np.age);
  const owners = clean(np.NumberOfOwners ?? np.number_of_owners);
  if (age === null || owners === null) return 'tier_3';
  for (const t of TIER_THRESHOLDS) {
    if (age < t.minAge) continue;
    if (t.maxAge !== null && age > t.maxAge) continue;
    if (owners > t.maxOwners) continue;
    return t.key;
  }
  return 'tier_3';
}

export const DEFAULT_LEAD_STATE = {
  status: 'new', priority: 'medium',
  lead_temperature: null, price_wanted: null, price_offered: null,
  assigned_user_id: null, assigned_user_name: null,
};

/** Pretty-print a US-style phone number. Non-US or malformed inputs pass through. */
export function formatPhone(value) {
  if (value === null || value === undefined || value === '') return '';
  const digits = String(value).replace(/\D+/g, '');
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return String(value);
}

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
  moved_to_marketing:     { label: 'Moved to marketing', dot: 'bg-fuchsia-500' },
  campaign_sent:          { label: 'Campaign sent',      dot: 'bg-fuchsia-500' },
  campaign_opened:        { label: 'Campaign opened',    dot: 'bg-emerald-500' },
  campaign_clicked:       { label: 'Campaign clicked',   dot: 'bg-emerald-600' },
  campaign_replied:       { label: 'Campaign replied',   dot: 'bg-blue-500' },
  campaign_bounced:       { label: 'Campaign bounced',   dot: 'bg-orange-500' },
  opted_out:              { label: 'Opted out',          dot: 'bg-rose-500' },
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
    case 'moved_to_marketing':
      return `${actor} moved this lead to mass marketing`;
    case 'campaign_sent': {
      const name = evt.new_value?.campaign_name || 'a campaign';
      return `${actor} sent "${name}" to this lead`;
    }
    case 'campaign_opened':
      return `Lead opened campaign${evt.new_value?.campaign_name ? ` "${evt.new_value.campaign_name}"` : ''}`;
    case 'campaign_clicked':
      return `Lead clicked a link in${evt.new_value?.campaign_name ? ` "${evt.new_value.campaign_name}"` : ' a campaign'}`;
    case 'campaign_replied':
      return `Lead replied to${evt.new_value?.campaign_name ? ` "${evt.new_value.campaign_name}"` : ' a campaign'}`;
    case 'campaign_bounced':
      return `Campaign bounced${evt.new_value?.reason ? ` — ${evt.new_value.reason}` : ''}`;
    case 'opted_out':
      return `Lead opted out of marketing${evt.new_value?.reason ? ` (${evt.new_value.reason})` : ''}`;
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

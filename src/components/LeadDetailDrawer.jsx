import { useState, useEffect, useCallback, useMemo } from 'react';
import api, { extractApiError, getArtifactDownloadUrl } from '../api';
import { NORMALIZED_FIELDS } from '../lib/normalizedFields';
import { useAuth } from '../context/AuthContext';
import {
  LEAD_STATUSES, LEAD_PRIORITIES, LEAD_TEMPERATURES,
  STATUS_BY_KEY, PRIORITY_BY_KEY, TEMPERATURE_BY_KEY,
  DEFAULT_LEAD_STATE, ACTIVITY_META, describeActivity,
  CAMPAIGN_STATUS_META, RECIPIENT_STATUS_META, MARKETING_CHANNELS,
  LEAD_TIERS, TIER_BY_KEY, computeLeadTier, roleLabel, formatPhone,
} from '../lib/crm';
import {
  TASK_TYPES, TASK_TYPE_BY_KEY,
  CONTACT_CHANNELS, CONTACT_OUTCOMES, CHANNEL_BY_KEY, OUTCOME_BY_KEY,
  relativeDue, isOverdue,
} from '../lib/tasks';
import LeadTransportSection from './LeadTransportSection';
import LeadBillOfSaleSection from './LeadBillOfSaleSection';
import LeadOutreachSection from './LeadOutreachSection';
import { Icon } from './ui';

const FIELD_LABELS = Object.fromEntries(NORMALIZED_FIELDS.map((f) => [f.key, f.label]));
const FIELD_ORDER = [
  'full_name', 'first_name', 'last_name',
  'vin',
  'phone_primary', 'phone_secondary', 'email_primary',
  'full_address', 'city', 'state', 'zip_code',
  'make', 'model', 'year', 'mileage',
];

function formatDate(s) {
  if (!s) return '—';
  const d = new Date(String(s).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString();
}

function CollapsibleSection({ title, defaultOpen = false, children, count }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500 hover:text-gray-800"
      >
        <span>{title}{typeof count === 'number' ? ` (${count})` : ''}</span>
        <svg className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
      </button>
      {open && <div>{children}</div>}
    </section>
  );
}

function KeyValueTable({ rows, monospaceValue = false }) {
  if (!rows || rows.length === 0) {
    return <p className="text-xs text-gray-400 italic">No data.</p>;
  }
  return (
    <div className="border border-gray-100 rounded-xl overflow-hidden">
      <table className="w-full text-xs">
        <tbody>
          {rows.map(([k, v], i) => (
            <tr key={k + i} className={i % 2 ? 'bg-gray-50/40' : ''}>
              <td className="px-3 py-1.5 font-medium text-gray-600 align-top w-2/5 whitespace-nowrap">{k}</td>
              <td className={`px-3 py-1.5 text-gray-800 ${monospaceValue ? 'font-mono text-[11px]' : ''} break-words`}>{v === null || v === undefined || v === '' ? <span className="text-gray-300">—</span> : String(v)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatusPill({ statusKey }) {
  const s = STATUS_BY_KEY[statusKey] || STATUS_BY_KEY.new;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-semibold ${s.bg} ${s.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />{s.label}
    </span>
  );
}
function PriorityPill({ priorityKey }) {
  const p = PRIORITY_BY_KEY[priorityKey] || PRIORITY_BY_KEY.medium;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-semibold ${p.bg} ${p.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${p.dot}`} />{p.label}
    </span>
  );
}
function TemperaturePill({ temperatureKey }) {
  if (!temperatureKey) return null;
  const t = TEMPERATURE_BY_KEY[temperatureKey];
  if (!t) return null;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-semibold ${t.bg} ${t.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${t.dot}`} />{t.label}
    </span>
  );
}

function TierPill({ tierKey }) {
  const t = TIER_BY_KEY[tierKey];
  if (!t) return null;
  return (
    <span
      title={t.hint}
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-semibold ${t.bg} ${t.text}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${t.dot}`} />{t.label}
    </span>
  );
}

// ---------- CRM State section ----------

function normalizePriceInput(v) {
  if (v === '' || v === null || v === undefined) return '';
  return String(v);
}

// Compact contacts panel — phones (up to 4 slots) and emails (up to 2)
// in a single tight section. Operators kept saying the old version
// took too much vertical space; the redesign:
//   - hides empty slots entirely (no point showing "Phone 4: —")
//   - drops to text-xs with py-0.5 row height
//   - single-line per row, whitespace-nowrap so long numbers don't
//     wrap mid-digit when the drawer is narrow
//   - tiny ✓ icon for verified instead of a full "Verified" pill
// Phones support a verified-slot toggle (persisted via known_phone_slot
// on lead_states); emails are display-only for now.
function ContactSlotsSection({ leadId, np, initialSlot, onChanged }) {
  const [slot, setSlot] = useState(initialSlot ?? null);
  const [savingKey, setSavingKey] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => { setSlot(initialSlot ?? null); }, [initialSlot]);

  // Only the slots that actually have a value — we don't render empty rows.
  const phones = [
    { key: 'phone_primary',   value: np?.phone_primary },
    { key: 'phone_secondary', value: np?.phone_secondary },
    { key: 'phone_3',         value: np?.['Phone Number 3'] || np?.['Phone Number3'] },
    { key: 'phone_4',         value: np?.['Phone Number 4'] || np?.['Phone Number4'] },
  ].filter(p => p.value);

  const emails = [
    { key: 'email_primary', value: np?.email_primary },
    { key: 'email_2',       value: np?.['Email 2'] || np?.Email2 },
  ].filter(e => e.value);

  // Hide the whole section if there's nothing to show.
  if (phones.length === 0 && emails.length === 0) return null;

  const toggle = async (next) => {
    if (savingKey) return;
    const newSlot = slot === next ? null : next;
    const previous = slot;
    setSlot(newSlot);
    setSavingKey(next);
    setError('');
    try {
      await api.put('/lead_state', { lead_id: leadId, known_phone_slot: newSlot });
      onChanged?.();
    } catch (err) {
      setSlot(previous);
      setError(extractApiError(err, 'Failed to update verified phone'));
    } finally {
      setSavingKey(null);
    }
  };

  // Shared row renderer — `verifyable=true` shows the verify toggle on
  // hover; emails pass false (no verification UI for them).
  const Row = ({ idx, label, valueText, verifyable, verified, onToggleVerify, saving }) => (
    <div className="flex items-center gap-2 px-1.5 py-0.5 rounded text-xs whitespace-nowrap hover:bg-gray-50">
      <span className="w-3 text-[10px] text-gray-400 font-medium shrink-0">{idx}</span>
      <span className="text-gray-700 truncate flex-1 min-w-0" title={valueText}>{valueText}</span>
      {verifyable && (
        verified ? (
          <button
            type="button"
            onClick={onToggleVerify}
            disabled={saving}
            className="shrink-0 inline-flex items-center justify-center w-4 h-4 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-bold hover:bg-emerald-200 disabled:opacity-50"
            title="Verified — click to unmark"
            aria-label="Unmark verified phone"
          >
            ✓
          </button>
        ) : (
          <button
            type="button"
            onClick={onToggleVerify}
            disabled={saving}
            className="shrink-0 inline-flex items-center justify-center w-4 h-4 rounded-full border border-gray-300 text-gray-400 text-[10px] font-bold hover:border-emerald-500 hover:text-emerald-600 disabled:opacity-50"
            title="Mark as the confirmed-reachable number"
            aria-label="Mark phone as verified"
          >
            ○
          </button>
        )
      )}
    </div>
  );

  return (
    <CollapsibleSection title="Contacts" defaultOpen>
      {error && (
        <div className="bg-red-50 border border-red-100 text-red-700 rounded p-1.5 text-[11px] mb-1.5">{error}</div>
      )}

      {phones.length > 0 && (
        <div className="mb-1.5">
          <p className="text-[9px] uppercase tracking-wider text-gray-400 font-semibold px-1.5 mb-0.5">Phones</p>
          {phones.map((p, i) => (
            <Row
              key={p.key}
              idx={i + 1}
              valueText={formatPhone(p.value)}
              verifyable
              verified={slot === p.key}
              onToggleVerify={() => toggle(p.key)}
              saving={savingKey !== null}
            />
          ))}
        </div>
      )}

      {emails.length > 0 && (
        <div>
          <p className="text-[9px] uppercase tracking-wider text-gray-400 font-semibold px-1.5 mb-0.5">Emails</p>
          {emails.map((e, i) => (
            <Row
              key={e.key}
              idx={i + 1}
              valueText={e.value}
              verifyable={false}
            />
          ))}
        </div>
      )}
    </CollapsibleSection>
  );
}

function CrmStateSection({ leadId, initialState, importedMiles, autoTier, users, isAdmin, onChanged }) {
  // Miles default: prefer the operator's saved override on lead_states;
  // otherwise fall back to whatever came in from the CSV (mileage /
  // LastReportedMiles) so the field isn't empty when the lead clearly
  // had a mileage value. Strip commas so the input shows clean digits
  // ready for editing. If both are missing, render an empty string.
  const milesDefault = (() => {
    if (initialState?.vehicle_odometer != null) return String(initialState.vehicle_odometer);
    if (importedMiles == null || importedMiles === '') return '';
    const cleaned = String(importedMiles).replace(/[,\s]/g, '');
    return /^\d+$/.test(cleaned) ? cleaned : '';
  })();

  const [state, setState] = useState({
    status:           initialState?.status   ?? DEFAULT_LEAD_STATE.status,
    priority:         initialState?.priority ?? DEFAULT_LEAD_STATE.priority,
    lead_temperature: initialState?.lead_temperature ?? '',
    price_wanted:     normalizePriceInput(initialState?.price_wanted),
    price_offered:    normalizePriceInput(initialState?.price_offered),
    // Vehicle overrides — empty string in the form = "clear the value"
    // on save (server converts '' to null). Initial state pulls from
    // lead_states; the drawer's BoS section continues to show the BoS
    // copy separately so the two don't collide.
    vehicle_color:    initialState?.vehicle_color ?? '',
    vehicle_odometer: milesDefault,
    assigned_user_id: initialState?.assigned_user_id ?? null,
    // Manual tier override. '' = "auto" (use the computed tier). Any
    // LEAD_TIERS key pins the lead to that tier; once set it sticks
    // even if Age / owners change later.
    tier_override:    initialState?.tier_override ?? '',
  });
  const [baseline, setBaseline] = useState(state);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // When status flips to 'callback', the inline scheduler shows so the
  // operator can immediately spawn a "Callback" task with the right
  // due time. Saved alongside the state change.
  const [callbackDueAt, setCallbackDueAt] = useState('');
  const justSetCallback = state.status === 'callback' && baseline.status !== 'callback';

  const dirty = useMemo(() => (
    state.status !== baseline.status
    || state.priority !== baseline.priority
    || (state.lead_temperature || '') !== (baseline.lead_temperature || '')
    || (state.price_wanted    || '') !== (baseline.price_wanted    || '')
    || (state.price_offered   || '') !== (baseline.price_offered   || '')
    || (state.vehicle_color    || '') !== (baseline.vehicle_color    || '')
    || (state.vehicle_odometer || '') !== (baseline.vehicle_odometer || '')
    || (state.assigned_user_id ?? null) !== (baseline.assigned_user_id ?? null)
    || (state.tier_override    || '') !== (baseline.tier_override    || '')
  ), [state, baseline]);

  const save = async () => {
    setSaving(true); setError('');
    try {
      const payload = { lead_id: leadId };
      if (state.status !== baseline.status) payload.status = state.status;
      if (state.priority !== baseline.priority) payload.priority = state.priority;
      if ((state.lead_temperature || '') !== (baseline.lead_temperature || '')) {
        payload.lead_temperature = state.lead_temperature || null;
      }
      if ((state.price_wanted || '') !== (baseline.price_wanted || '')) {
        payload.price_wanted = state.price_wanted === '' ? null : Number(state.price_wanted);
      }
      if ((state.price_offered || '') !== (baseline.price_offered || '')) {
        payload.price_offered = state.price_offered === '' ? null : Number(state.price_offered);
      }
      if ((state.vehicle_color || '') !== (baseline.vehicle_color || '')) {
        payload.vehicle_color = state.vehicle_color === '' ? null : state.vehicle_color;
      }
      if ((state.vehicle_odometer || '') !== (baseline.vehicle_odometer || '')) {
        // Strip any commas the operator typed ("123,456" → "123456"). The
        // server also accepts the comma form, but we normalise here so
        // baseline comparisons stay clean on the next render.
        const cleaned = String(state.vehicle_odometer).replace(/[,\s]/g, '');
        payload.vehicle_odometer = cleaned === '' ? null : Number(cleaned);
      }
      if ((state.assigned_user_id ?? null) !== (baseline.assigned_user_id ?? null)) {
        payload.assigned_user_id = state.assigned_user_id ?? null;
      }
      if ((state.tier_override || '') !== (baseline.tier_override || '')) {
        // '' clears the override → server normalises to NULL and the
        // lead returns to the auto-computed tier on next render.
        payload.tier_override = state.tier_override === '' ? null : state.tier_override;
      }
      await api.put('/lead_state', payload);
      // If the operator just flipped this lead to 'callback' AND
      // picked a date/time in the inline scheduler, create the
      // matching Callback task on the same lead so the follow-up is
      // already on someone's queue. We assign to the lead's current
      // agent if set, else to the actor who pushed the status change.
      if (state.status === 'callback' && baseline.status !== 'callback' && callbackDueAt) {
        try {
          await api.post('/lead_tasks', {
            lead_id:          leadId,
            title:            'Callback follow-up',
            task_type:        'callback',
            due_at:           callbackDueAt,
            assigned_user_id: state.assigned_user_id ?? null,
          });
          setCallbackDueAt('');
        } catch (e) {
          // Don't blow up the state save — surface the task error inline.
          setError(extractApiError(e, 'Status saved, but failed to create callback task'));
        }
      }
      setBaseline(state);
      onChanged?.();
    } catch (err) {
      setError(extractApiError(err, 'Failed to save state'));
    } finally {
      setSaving(false);
    }
  };

  // Status text for the top bar. Operator clicks Save explicitly —
  // auto-save was removed per operator feedback (it was firing on
  // every keystroke pause and getting in the way of multi-field edits).
  const statusText = saving ? 'Saving…'
    : error ? 'Save failed'
    : dirty ? 'Unsaved changes'
    : 'All changes saved';
  const statusColor = saving ? 'text-blue-600'
    : error ? 'text-red-600'
    : dirty ? 'text-amber-600'
    : 'text-gray-400';

  return (
    <CollapsibleSection title="CRM state" defaultOpen>
      {/* Top action bar — Save button + dirty/clean status. Manual
          save only; auto-save was removed because it kept firing
          between fields and interrupting multi-field edits. */}
      <div className="flex items-center justify-between gap-2 mb-3 pb-2 border-b border-gray-100">
        <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium ${statusColor}`}>
          {saving && (
            <svg className="w-3 h-3 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
          )}
          {!saving && dirty && <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />}
          {statusText}
        </span>
        <button
          onClick={save}
          disabled={!dirty || saving}
          className="px-3 py-1 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-md disabled:opacity-40"
          title={dirty ? 'Save changes' : 'No unsaved changes'}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <label className="block">
          <span className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Status</span>
          <select
            value={state.status}
            onChange={(e) => setState({ ...state, status: e.target.value })}
            className="w-full bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
          >
            {LEAD_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          {/* Inline scheduler — appears the moment the operator flips
              this lead to 'callback'. Picking a date here creates a
              "Callback follow-up" task automatically when the section
              saves. Leaving it blank just saves the status. */}
          {justSetCallback && (
            <div className="mt-1.5 rounded-md border border-amber-200 bg-amber-50/60 px-2 py-1.5">
              <p className="text-[10px] text-amber-900 mb-1">Schedule the callback (creates a task):</p>
              <input
                type="datetime-local"
                value={callbackDueAt}
                onChange={(e) => setCallbackDueAt(e.target.value)}
                className="w-full bg-white border border-amber-200 rounded-md px-2 py-1 text-xs focus:ring-2 focus:ring-amber-500 focus:border-transparent outline-none"
              />
            </div>
          )}
        </label>
        <label className="block">
          <span className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Priority</span>
          <select
            value={state.priority}
            onChange={(e) => setState({ ...state, priority: e.target.value })}
            className="w-full bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
          >
            {LEAD_PRIORITIES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Temperature</span>
          <select
            value={state.lead_temperature ?? ''}
            onChange={(e) => setState({ ...state, lead_temperature: e.target.value })}
            className="w-full bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
          >
            <option value="">— Not set —</option>
            {LEAD_TEMPERATURES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        </label>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-2">
        <label className="block sm:col-span-1">
          <span className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">
            Agent {!isAdmin && <span className="text-gray-400 normal-case tracking-normal">(admin only)</span>}
          </span>
          <select
            value={state.assigned_user_id ?? ''}
            disabled={!isAdmin}
            onChange={(e) => setState({ ...state, assigned_user_id: e.target.value === '' ? null : Number(e.target.value) })}
            className="w-full bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none disabled:text-gray-500 disabled:cursor-not-allowed"
          >
            <option value="">Unassigned</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name} ({roleLabel(u.role)})</option>)}
          </select>
        </label>
        <label className="block">
          <span className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Price wanted</span>
          <input
            type="number" min="0" step="0.01" inputMode="decimal"
            value={state.price_wanted}
            onChange={(e) => setState({ ...state, price_wanted: e.target.value })}
            placeholder="—"
            className="w-full bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
          />
        </label>
        <label className="block">
          <span className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Price offered</span>
          <input
            type="number" min="0" step="0.01" inputMode="decimal"
            value={state.price_offered}
            onChange={(e) => setState({ ...state, price_offered: e.target.value })}
            placeholder="—"
            className="w-full bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
          />
        </label>
      </div>

      {/* Vehicle overrides: blank = use the imported value. These flow
          into the BoS prefill (api/bos_helpers.php defaultsFromLead) so
          correcting miles here updates downstream paperwork. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
        <label className="block">
          <span className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Color</span>
          <input
            type="text"
            value={state.vehicle_color}
            onChange={(e) => setState({ ...state, vehicle_color: e.target.value })}
            placeholder="e.g. Silver, Sunset Pearl"
            maxLength={50}
            className="w-full bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
          />
        </label>
        <label className="block">
          <span className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Miles</span>
          <input
            type="text" inputMode="numeric"
            value={state.vehicle_odometer}
            onChange={(e) => setState({ ...state, vehicle_odometer: e.target.value })}
            placeholder="e.g. 87,500"
            className="w-full bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
          />
        </label>
      </div>

      {/* Tier override. "Auto" defers to the rules in api/pipeline.php
          (Age 60+ → Tier 1; Age 50–59 → Tier 2; else Tier 3). Any
          explicit pick sticks even if the underlying data changes. */}
      <div className="mt-2">
        <span className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">
          Tier{' '}
          <span className="text-gray-400 normal-case tracking-normal">
            (auto: {TIER_BY_KEY[autoTier]?.label || '—'})
          </span>
        </span>
        <select
          value={state.tier_override ?? ''}
          onChange={(e) => setState({ ...state, tier_override: e.target.value })}
          className="w-full bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
        >
          <option value="">Auto (rule-based)</option>
          {LEAD_TIERS.map((t) => (
            <option key={t.key} value={t.key}>{t.label} — {t.hint}</option>
          ))}
        </select>
        {state.tier_override && state.tier_override !== autoTier && (
          <p className="text-[10px] text-amber-700 mt-1">
            Manual override active. Set to “Auto” to follow the rules again.
          </p>
        )}
      </div>

      {/* Status/Priority/Temperature pills used to render here as a
          live preview; removed per operator request — the same three
          pills already appear in the drawer header chips above, so
          this duplicated the signal. */}
      {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
    </CollapsibleSection>
  );
}

// ---------- Labels section ----------

function LabelsSection({ leadId, initialLabels, availableLabels, onChanged, defaultOpen = true }) {
  const [labels, setLabels] = useState(initialLabels || []);
  const [selectedAdd, setSelectedAdd] = useState('');
  // The add-label picker is hidden by default — the drawer renders just
  // the attached labels so it doesn't read as "here is every label in
  // the system". An explicit "+ Add label" button reveals the dropdown
  // only when the operator actually wants to attach one.
  const [adding, setAdding] = useState(false);
  // Local follow-up due date for the next attach. Only meaningful when the
  // selected label has auto_follow_up=true; ignored on submit otherwise.
  // datetime-local format: yyyy-mm-ddThh:mm (operator picks date + time).
  // Blank = no due date (open task with no deadline).
  const [followUpDate, setFollowUpDate] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');

  const attachedIds = useMemo(() => new Set(labels.map((l) => l.id)), [labels]);
  const candidates = availableLabels.filter((l) => !attachedIds.has(l.id));
  const selectedLabel = useMemo(
    () => availableLabels.find((l) => String(l.id) === String(selectedAdd)) || null,
    [availableLabels, selectedAdd]
  );
  // The labels list API returns auto_follow_up as a boolean. Some older
  // callers may still send 0/1 — coerce so the UI is forgiving.
  const isAutoFollowUp = !!selectedLabel?.auto_follow_up;

  const attach = async () => {
    if (!selectedAdd) return;
    const label = selectedLabel;
    if (!label) return;
    setWorking(true); setError('');
    try {
      const body = { lead_id: leadId, label_id: label.id };
      // Only forward the value for auto-follow-up labels so a stale state
      // can't piggy-back onto a regular attach. parseDatetime on the
      // server normalises both `yyyy-mm-ddThh:mm` (datetime-local input)
      // and bare dates, so we just pass the raw value through.
      if (isAutoFollowUp && followUpDate) {
        body.follow_up_due_at = followUpDate;
      }
      await api.post('/lead_labels', body);
      setLabels((prev) => [...prev, label].sort((a, b) => a.name.localeCompare(b.name)));
      setSelectedAdd('');
      setFollowUpDate('');
      setAdding(false);
      onChanged?.();
    } catch (err) {
      setError(extractApiError(err, 'Failed to attach label'));
    } finally {
      setWorking(false);
    }
  };

  const detach = async (labelId) => {
    setWorking(true); setError('');
    try {
      await api.delete('/lead_labels', { data: { lead_id: leadId, label_id: labelId } });
      setLabels((prev) => prev.filter((l) => l.id !== labelId));
      onChanged?.();
    } catch (err) {
      setError(extractApiError(err, 'Failed to detach label'));
    } finally {
      setWorking(false);
    }
  };

  return (
    <CollapsibleSection title="Labels" count={labels.length} defaultOpen={defaultOpen}>
      {/* Attached labels only — the full catalog is intentionally NOT
          listed by default so the section reads as "what's on this lead"
          instead of "every label in the system". */}
      <div className="flex flex-wrap items-center gap-1.5">
        {labels.length === 0 && !adding && (
          <p className="text-xs text-gray-400 italic">No labels attached.</p>
        )}
        {labels.map((l) => (
          <span
            key={l.id}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-white px-2 py-0.5 rounded-md whitespace-nowrap"
            style={{ backgroundColor: l.color }}
          >
            {l.name}
            <button
              onClick={() => detach(l.id)}
              disabled={working}
              className="hover:opacity-70 disabled:opacity-40"
              aria-label="Remove"
            >&times;</button>
          </span>
        ))}
        {!adding && candidates.length > 0 && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex items-center text-[11px] font-medium text-gray-600 hover:text-gray-900 border border-dashed border-gray-300 hover:border-gray-400 rounded-md px-2 py-0.5"
          >
            + Add label
          </button>
        )}
      </div>

      {adding && (
        <div className="flex items-center gap-2 mt-3">
          <select
            value={selectedAdd}
            onChange={(e) => { setSelectedAdd(e.target.value); setFollowUpDate(''); }}
            disabled={candidates.length === 0 || working}
            autoFocus
            className="flex-1 bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none disabled:opacity-50"
          >
            <option value="">{candidates.length === 0 ? 'No more labels available' : 'Select a label to add'}</option>
            {candidates.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <button
            onClick={attach}
            disabled={!selectedAdd || working}
            className="px-3 py-1.5 text-xs font-medium bg-gray-900 hover:bg-gray-700 text-white rounded-lg disabled:opacity-40"
          >
            Add
          </button>
          <button
            onClick={() => { setAdding(false); setSelectedAdd(''); setFollowUpDate(''); }}
            disabled={working}
            className="px-2 py-1.5 text-xs text-gray-500 hover:text-gray-800"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Auto-follow-up affordance: only renders once the operator has
          picked a label that carries the flag. Leaving the date blank is
          deliberately valid → creates an open task with no due date. */}
      {adding && isAutoFollowUp && (
        <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50/60 px-2.5 py-2">
          <p className="text-[11px] text-amber-900 mb-1.5">
            This label auto-creates a follow-up task. Pick a due date &amp; time or leave blank.
          </p>
          <input
            type="datetime-local"
            value={followUpDate}
            onChange={(e) => setFollowUpDate(e.target.value)}
            disabled={working}
            className="w-full bg-white border border-amber-200 rounded-md px-2 py-1 text-xs focus:ring-2 focus:ring-amber-500 focus:border-transparent outline-none disabled:opacity-50"
          />
        </div>
      )}
      {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
    </CollapsibleSection>
  );
}

// ---------- Tasks section ----------

function TaskRow({ t, currentUser, onComplete, onCancel, onReopen, onEdit, editingId, editingDraft, onSaveEdit, onCancelEdit, onDraftChange, users }) {
  const isAdmin = currentUser?.role === 'admin';
  const isOwner = currentUser?.id && Number(t.created_by) === Number(currentUser.id);
  const canEdit = t.status === 'open' && (isAdmin || isOwner);
  const canCancel = t.status === 'open' && (isAdmin || isOwner);
  const canReopen = t.status !== 'open' && (isAdmin || isOwner);
  const typeMeta = TASK_TYPE_BY_KEY[t.task_type] || {};
  const overdue = t.status === 'open' && isOverdue(t.due_at);

  if (editingId === t.id) {
    return (
      <li className="rounded-lg border border-blue-200 bg-blue-50/30 p-2.5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input
            type="text"
            value={editingDraft.title}
            onChange={(e) => onDraftChange({ ...editingDraft, title: e.target.value })}
            maxLength={255}
            placeholder="Title"
            className="sm:col-span-2 w-full bg-white border border-gray-200 rounded-md px-2 py-1.5 text-sm"
          />
          <select
            value={editingDraft.task_type}
            onChange={(e) => onDraftChange({ ...editingDraft, task_type: e.target.value })}
            className="w-full bg-white border border-gray-200 rounded-md px-2 py-1.5 text-xs"
          >
            {TASK_TYPES.map((tt) => <option key={tt.key} value={tt.key}>{tt.label}</option>)}
          </select>
          <input
            type="datetime-local"
            value={editingDraft.due_at}
            onChange={(e) => onDraftChange({ ...editingDraft, due_at: e.target.value })}
            className="w-full bg-white border border-gray-200 rounded-md px-2 py-1.5 text-xs"
          />
          <select
            value={editingDraft.assigned_user_id ?? ''}
            onChange={(e) => onDraftChange({ ...editingDraft, assigned_user_id: e.target.value === '' ? null : Number(e.target.value) })}
            className="sm:col-span-2 w-full bg-white border border-gray-200 rounded-md px-2 py-1.5 text-xs"
          >
            <option value="">Unassigned</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name} ({roleLabel(u.role)})</option>)}
          </select>
          <textarea
            value={editingDraft.notes || ''}
            onChange={(e) => onDraftChange({ ...editingDraft, notes: e.target.value })}
            rows={2}
            maxLength={5000}
            placeholder="Notes (optional)"
            className="sm:col-span-2 w-full bg-white border border-gray-200 rounded-md px-2 py-1.5 text-sm"
          />
        </div>
        <div className="flex justify-end gap-2 mt-2">
          <button onClick={onCancelEdit} className="text-xs text-gray-500 hover:text-gray-800 px-2 py-1">Cancel</button>
          <button onClick={() => onSaveEdit(t.id)} className="px-3 py-1 text-xs font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700">Save</button>
        </div>
      </li>
    );
  }

  return (
    <li className={`rounded-lg border p-2.5 ${t.status === 'open' ? (overdue ? 'border-red-200 bg-red-50/30' : 'border-gray-100 bg-white') : 'border-gray-100 bg-gray-50/60'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-700">
              {typeMeta.label || t.task_type}
            </span>
            {t.status !== 'open' && (
              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${t.status === 'completed' ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}>
                {t.status}
              </span>
            )}
            {overdue && t.status === 'open' && (
              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-100 text-red-700">overdue</span>
            )}
          </div>
          <p className={`text-sm mt-0.5 ${t.status === 'completed' ? 'text-gray-500 line-through' : 'text-gray-900'}`}>{t.title}</p>
          <p className="text-[11px] text-gray-500 mt-0.5">
            {t.due_at ? (<>Due <span className={overdue && t.status === 'open' ? 'text-red-600 font-medium' : ''}>{relativeDue(t.due_at)}</span> · </>) : null}
            {t.assigned_user_name ? `Assigned to ${t.assigned_user_name}` : 'Unassigned'}
            {t.created_by_name ? ` · by ${t.created_by_name}` : ''}
          </p>
          {t.notes && <p className="text-xs text-gray-700 mt-1 whitespace-pre-wrap break-words">{t.notes}</p>}
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {t.status === 'open' && (
            <button onClick={() => onComplete(t.id)} title="Complete" className="p-1 text-emerald-600 hover:bg-emerald-50 rounded-md">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
            </button>
          )}
          {canEdit && (
            <button onClick={() => onEdit(t)} title="Edit" className="p-1 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-md">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
            </button>
          )}
          {canCancel && (
            <button onClick={() => onCancel(t.id)} title="Cancel" className="p-1 text-gray-500 hover:text-rose-600 hover:bg-rose-50 rounded-md">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          )}
          {canReopen && (
            <button onClick={() => onReopen(t.id)} title="Reopen" className="p-1 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-md">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

function TasksSection({ leadId, currentUser, users, onChanged, defaultOpen = true }) {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCompleted, setShowCompleted] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ title: '', task_type: 'follow_up', due_at: '', assigned_user_id: null, notes: '' });
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editingDraft, setEditingDraft] = useState({ title: '', task_type: 'follow_up', due_at: '', assigned_user_id: null, notes: '' });

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/lead_tasks', { params: { lead_id: leadId } });
      setTasks(res.data || []);
      setError('');
    } catch (err) {
      setError(extractApiError(err, 'Failed to load tasks'));
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => { reload(); }, [reload]);

  const openTasks      = tasks.filter((t) => t.status === 'open');
  const closedTasks    = tasks.filter((t) => t.status !== 'open');
  const overdueCount   = openTasks.filter((t) => isOverdue(t.due_at)).length;

  const bubble = () => { reload(); onChanged?.(); };

  const create = async () => {
    if (!draft.title.trim()) return;
    if (!draft.due_at) {
      setError('Pick a due date for this task.');
      return;
    }
    setSaving(true); setError('');
    try {
      await api.post('/lead_tasks', {
        lead_id:          leadId,
        title:            draft.title.trim(),
        task_type:        draft.task_type,
        due_at:           draft.due_at,
        assigned_user_id: draft.assigned_user_id,
        notes:            draft.notes || null,
      });
      setDraft({ title: '', task_type: 'follow_up', due_at: '', assigned_user_id: null, notes: '' });
      setCreating(false);
      bubble();
    } catch (err) {
      setError(extractApiError(err, 'Failed to create task'));
    } finally {
      setSaving(false);
    }
  };

  const complete = async (id) => {
    if (!window.confirm('Mark this task as complete?')) return;
    try { await api.patch('/lead_tasks', { id, action: 'complete' }); bubble(); }
    catch (err) { setError(extractApiError(err, 'Failed to complete task')); }
  };
  const cancel = async (id) => {
    if (!window.confirm('Cancel this task?')) return;
    try { await api.patch('/lead_tasks', { id, action: 'cancel' }); bubble(); }
    catch (err) { setError(extractApiError(err, 'Failed to cancel task')); }
  };
  const reopen = async (id) => {
    try { await api.patch('/lead_tasks', { id, action: 'reopen' }); bubble(); }
    catch (err) { setError(extractApiError(err, 'Failed to reopen task')); }
  };

  const startEdit = (t) => {
    setEditingId(t.id);
    setEditingDraft({
      title: t.title,
      task_type: t.task_type,
      due_at: t.due_at ? t.due_at.slice(0, 16).replace(' ', 'T') : '',
      assigned_user_id: t.assigned_user_id,
      notes: t.notes || '',
    });
  };
  const cancelEdit = () => setEditingId(null);
  const saveEdit = async (id) => {
    if (!editingDraft.title.trim()) { setError('Task title is required'); return; }
    try {
      await api.patch('/lead_tasks', {
        id,
        title: editingDraft.title.trim(),
        task_type: editingDraft.task_type,
        due_at: editingDraft.due_at || null,
        assigned_user_id: editingDraft.assigned_user_id,
        notes: editingDraft.notes || null,
      });
      setEditingId(null);
      bubble();
    } catch (err) {
      setError(extractApiError(err, 'Failed to save task'));
    }
  };

  return (
    <CollapsibleSection
      title="Tasks"
      count={openTasks.length + (overdueCount > 0 ? 0 : 0)}
      defaultOpen={defaultOpen}
    >
      {overdueCount > 0 && (
        <p className="text-[11px] text-red-600 mb-2">{overdueCount} overdue · {openTasks.length - overdueCount} on track</p>
      )}
      {error && <p className="text-xs text-red-600 mb-2">{error}</p>}

      {loading ? (
        <p className="text-xs text-gray-400">Loading…</p>
      ) : (
        <>
          {openTasks.length === 0 && !creating && (
            <p className="text-xs text-gray-400 italic">No open tasks.</p>
          )}
          {openTasks.length > 0 && (
            <ul className="space-y-2">
              {openTasks.map((t) => (
                <TaskRow
                  key={t.id} t={t}
                  currentUser={currentUser}
                  users={users}
                  onComplete={complete}
                  onCancel={cancel}
                  onReopen={reopen}
                  onEdit={startEdit}
                  editingId={editingId}
                  editingDraft={editingDraft}
                  onDraftChange={setEditingDraft}
                  onSaveEdit={saveEdit}
                  onCancelEdit={cancelEdit}
                />
              ))}
            </ul>
          )}

          {closedTasks.length > 0 && (
            <div className="mt-3">
              <button
                onClick={() => setShowCompleted((v) => !v)}
                className="text-[11px] font-medium text-blue-600 hover:text-blue-800"
              >
                {showCompleted ? 'Hide' : `Show ${closedTasks.length} closed`}
              </button>
              {showCompleted && (
                <ul className="space-y-2 mt-2">
                  {closedTasks.map((t) => (
                    <TaskRow
                      key={t.id} t={t}
                      currentUser={currentUser}
                      users={users}
                      onComplete={complete}
                      onCancel={cancel}
                      onReopen={reopen}
                      onEdit={startEdit}
                      editingId={editingId}
                      editingDraft={editingDraft}
                      onDraftChange={setEditingDraft}
                      onSaveEdit={saveEdit}
                      onCancelEdit={cancelEdit}
                    />
                  ))}
                </ul>
              )}
            </div>
          )}

          {creating ? (
            <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50/30 p-2.5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input
                  type="text"
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  maxLength={255}
                  placeholder="Task title (required)"
                  className="sm:col-span-2 w-full bg-white border border-gray-200 rounded-md px-2 py-1.5 text-sm"
                  autoFocus
                />
                <select
                  value={draft.task_type}
                  onChange={(e) => setDraft({ ...draft, task_type: e.target.value })}
                  className="w-full bg-white border border-gray-200 rounded-md px-2 py-1.5 text-xs"
                >
                  {TASK_TYPES.map((tt) => <option key={tt.key} value={tt.key}>{tt.label}</option>)}
                </select>
                <input
                  type="datetime-local"
                  required
                  value={draft.due_at}
                  onChange={(e) => setDraft({ ...draft, due_at: e.target.value })}
                  placeholder="Due date (required)"
                  className="w-full bg-white border border-gray-200 rounded-md px-2 py-1.5 text-xs"
                  title="Due date is required"
                />
                <select
                  value={draft.assigned_user_id ?? ''}
                  onChange={(e) => setDraft({ ...draft, assigned_user_id: e.target.value === '' ? null : Number(e.target.value) })}
                  className="sm:col-span-2 w-full bg-white border border-gray-200 rounded-md px-2 py-1.5 text-xs"
                >
                  <option value="">Unassigned</option>
                  {users.map((u) => <option key={u.id} value={u.id}>{u.name} ({roleLabel(u.role)})</option>)}
                </select>
                <textarea
                  value={draft.notes}
                  onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                  rows={2}
                  maxLength={5000}
                  placeholder="Notes (optional)"
                  className="sm:col-span-2 w-full bg-white border border-gray-200 rounded-md px-2 py-1.5 text-sm"
                />
              </div>
              <div className="flex justify-end gap-2 mt-2">
                <button onClick={() => setCreating(false)} className="text-xs text-gray-500 hover:text-gray-800 px-2 py-1">Cancel</button>
                <button
                  onClick={create}
                  disabled={!draft.title.trim() || !draft.due_at || saving}
                  className="px-3 py-1 text-xs font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-40"
                  title={!draft.due_at ? 'Pick a due date first' : ''}
                >
                  {saving ? 'Creating…' : 'Create task'}
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setCreating(true)}
              className="mt-3 w-full text-center text-sm font-medium text-blue-600 hover:text-blue-800 border border-dashed border-blue-200 hover:bg-blue-50 rounded-lg py-2"
            >
              + New task
            </button>
          )}
        </>
      )}
    </CollapsibleSection>
  );
}

// ---------- Contact log section ----------

function ContactLogSection({ leadId, onChanged }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ channel: 'phone', outcome: 'attempted', happened_at: '', notes: '' });
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/lead_contact_logs', { params: { lead_id: leadId } });
      setLogs(res.data || []);
      setError('');
    } catch (err) {
      setError(extractApiError(err, 'Failed to load contact log'));
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => { reload(); }, [reload]);

  const create = async () => {
    setSaving(true); setError('');
    try {
      await api.post('/lead_contact_logs', {
        lead_id:     leadId,
        channel:     draft.channel,
        outcome:     draft.outcome,
        happened_at: draft.happened_at || null,
        notes:       draft.notes || null,
      });
      setDraft({ channel: 'phone', outcome: 'attempted', happened_at: '', notes: '' });
      setCreating(false);
      reload();
      onChanged?.();
    } catch (err) {
      setError(extractApiError(err, 'Failed to log contact'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <CollapsibleSection title="Contact log" count={logs.length} defaultOpen>
      {error && <p className="text-xs text-red-600 mb-2">{error}</p>}
      {loading ? (
        <p className="text-xs text-gray-400">Loading…</p>
      ) : logs.length === 0 && !creating ? (
        <p className="text-xs text-gray-400 italic">No contacts logged yet.</p>
      ) : (
        <ul className="space-y-2">
          {logs.map((l) => {
            const ch = CHANNEL_BY_KEY[l.channel] || {};
            const oc = OUTCOME_BY_KEY[l.outcome] || {};
            return (
              <li key={l.id} className="rounded-lg border border-gray-100 bg-gray-50/50 p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-base leading-none">{ch.emoji || '•'}</span>
                    <span className="text-sm font-medium text-gray-800">{ch.label || l.channel}</span>
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${oc.bg || 'bg-gray-50'} ${oc.text || 'text-gray-700'}`}>
                      {oc.label || l.outcome}
                    </span>
                  </div>
                  <p className="text-[11px] text-gray-500">{formatDate(l.happened_at)}</p>
                </div>
                <p className="text-[11px] text-gray-500 mt-0.5">by <span className="font-medium text-gray-700">{l.user_name}</span></p>
                {l.notes && <p className="text-xs text-gray-700 mt-1 whitespace-pre-wrap break-words">{l.notes}</p>}
              </li>
            );
          })}
        </ul>
      )}

      {creating ? (
        <div className="mt-3 rounded-lg border border-indigo-200 bg-indigo-50/30 p-2.5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <select
              value={draft.channel}
              onChange={(e) => setDraft({ ...draft, channel: e.target.value })}
              className="w-full bg-white border border-gray-200 rounded-md px-2 py-1.5 text-xs"
            >
              {CONTACT_CHANNELS.map((c) => <option key={c.key} value={c.key}>{c.emoji} {c.label}</option>)}
            </select>
            <select
              value={draft.outcome}
              onChange={(e) => setDraft({ ...draft, outcome: e.target.value })}
              className="w-full bg-white border border-gray-200 rounded-md px-2 py-1.5 text-xs"
            >
              {CONTACT_OUTCOMES.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
            <input
              type="datetime-local"
              value={draft.happened_at}
              onChange={(e) => setDraft({ ...draft, happened_at: e.target.value })}
              placeholder="Now"
              className="sm:col-span-2 w-full bg-white border border-gray-200 rounded-md px-2 py-1.5 text-xs"
            />
            <textarea
              value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              rows={2}
              maxLength={5000}
              placeholder="Notes (optional)"
              className="sm:col-span-2 w-full bg-white border border-gray-200 rounded-md px-2 py-1.5 text-sm"
            />
          </div>
          <div className="flex justify-end gap-2 mt-2">
            <button onClick={() => setCreating(false)} className="text-xs text-gray-500 hover:text-gray-800 px-2 py-1">Cancel</button>
            <button onClick={create} disabled={saving} className="px-3 py-1 text-xs font-medium bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-40">
              {saving ? 'Logging…' : 'Log contact'}
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setCreating(true)}
          className="mt-3 w-full text-center text-sm font-medium text-indigo-600 hover:text-indigo-800 border border-dashed border-indigo-200 hover:bg-indigo-50 rounded-lg py-2"
        >
          + Log contact
        </button>
      )}
    </CollapsibleSection>
  );
}

// ---------- Notes section ----------

function NotesSection({ leadId, currentUser, onNotesLoaded, defaultOpen = true }) {
  const [notes, setNotes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editingText, setEditingText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/lead_notes', { params: { lead_id: leadId } });
      const list = res.data || [];
      setNotes(list);
      onNotesLoaded?.(list);
    } catch (err) {
      setError(extractApiError(err, 'Failed to load notes'));
    } finally {
      setLoading(false);
    }
  }, [leadId, onNotesLoaded]);

  useEffect(() => { reload(); }, [reload]);

  const create = async () => {
    if (!draft.trim()) return;
    setSaving(true); setError('');
    try {
      await api.post('/lead_notes', { lead_id: leadId, note: draft.trim() });
      setDraft('');
      reload();
    } catch (err) {
      setError(extractApiError(err, 'Failed to add note'));
    } finally {
      setSaving(false);
    }
  };
  const startEdit = (n) => { setEditingId(n.id); setEditingText(n.note); };
  const cancelEdit = () => { setEditingId(null); setEditingText(''); };
  const saveEdit = async () => {
    if (!editingText.trim()) return;
    setSaving(true); setError('');
    try {
      await api.patch('/lead_notes', { id: editingId, note: editingText.trim() });
      cancelEdit();
      reload();
    } catch (err) {
      setError(extractApiError(err, 'Failed to edit note'));
    } finally {
      setSaving(false);
    }
  };
  const remove = async (id) => {
    if (!window.confirm('Delete this note?')) return;
    setSaving(true); setError('');
    try {
      await api.delete('/lead_notes', { data: { id } });
      reload();
    } catch (err) {
      setError(extractApiError(err, 'Failed to delete note'));
    } finally {
      setSaving(false);
    }
  };

  const canModify = (note) => (
    (currentUser?.id && Number(note.user_id) === Number(currentUser.id)) || currentUser?.role === 'admin'
  );

  return (
    <CollapsibleSection title="Notes" count={notes.length} defaultOpen={defaultOpen}>
      <div>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={2}
          maxLength={5000}
          placeholder="Add a note…"
          className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
        />
        <div className="flex justify-end mt-1.5">
          <button
            onClick={create}
            disabled={!draft.trim() || saving}
            className="px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-40"
          >
            Add note
          </button>
        </div>
      </div>
      {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
      {loading ? (
        <p className="text-xs text-gray-400 mt-3">Loading…</p>
      ) : notes.length === 0 ? (
        <p className="text-xs text-gray-400 italic mt-3">No notes yet.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {notes.map((n) => (
            <li key={n.id} className="rounded-lg border border-gray-100 bg-gray-50/50 p-2.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] text-gray-500">
                  <span className="font-medium text-gray-700">{n.user_name}</span>
                  {' · '}{formatDate(n.created_at)}{n.edited ? ' · edited' : ''}
                </p>
                {canModify(n) && editingId !== n.id && (
                  <div className="flex items-center gap-1">
                    <button onClick={() => startEdit(n)} className="text-[11px] text-blue-600 hover:text-blue-800">Edit</button>
                    <span className="text-gray-300">·</span>
                    <button onClick={() => remove(n.id)} className="text-[11px] text-red-600 hover:text-red-800">Delete</button>
                  </div>
                )}
              </div>
              {editingId === n.id ? (
                <div className="mt-1.5">
                  <textarea
                    value={editingText}
                    onChange={(e) => setEditingText(e.target.value)}
                    rows={2}
                    maxLength={5000}
                    className="w-full bg-white border border-gray-200 rounded-lg px-2 py-1.5 text-sm"
                  />
                  <div className="flex justify-end gap-2 mt-1">
                    <button onClick={cancelEdit} className="text-[11px] text-gray-500 hover:text-gray-700">Cancel</button>
                    <button onClick={saveEdit} disabled={saving} className="px-2 py-1 text-[11px] font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-40">Save</button>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-gray-800 mt-1 whitespace-pre-wrap break-words">{n.note}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </CollapsibleSection>
  );
}

// ---------- Marketing ----------

function MarketingSection({ leadId, currentStatus, onChanged }) {
  const [sends, setSends] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [moving, setMoving] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      // We don't have a dedicated "sends for lead" endpoint — pull from activities and filter.
      const res = await api.get('/lead_activities', { params: { lead_id: leadId, limit: 100 } });
      const marketingEvents = (res.data || []).filter((e) =>
        ['campaign_sent','campaign_opened','campaign_clicked','campaign_replied','campaign_bounced','opted_out','moved_to_marketing'].includes(e.activity_type)
      );
      setSends(marketingEvents);
      setError('');
    } catch (err) {
      setError(extractApiError(err, 'Failed to load marketing history'));
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => { reload(); }, [reload]);

  const moveToMarketing = async () => {
    if (!window.confirm('Move this lead into mass marketing? It will be removed from the cold-call queue.')) return;
    setMoving(true); setError('');
    try {
      await api.post('/lead_bulk_actions', {
        action:   'send_to_marketing',
        lead_ids: [leadId],
      });
      reload();
      onChanged?.();
    } catch (err) {
      setError(extractApiError(err, 'Failed to move to marketing'));
    } finally {
      setMoving(false);
    }
  };

  const isInMarketing = currentStatus === 'marketing';

  return (
    <CollapsibleSection title="Marketing" count={sends.length} defaultOpen={isInMarketing || sends.length > 0}>
      {error && <p className="text-xs text-red-600 mb-2">{error}</p>}

      {!isInMarketing ? (
        <button
          onClick={moveToMarketing}
          disabled={moving}
          className="w-full text-sm font-medium bg-gradient-to-r from-fuchsia-600 to-pink-500 text-white rounded-lg px-3 py-2 shadow-md shadow-fuchsia-500/20 hover:shadow-lg disabled:opacity-50 transition-all"
        >
          {moving ? 'Moving…' : 'Move to Mass Marketing'}
        </button>
      ) : (
        <div className="rounded-lg bg-fuchsia-50 border border-fuchsia-100 px-3 py-2 text-xs text-fuchsia-800 mb-2">
          ✓ In mass marketing — this lead is excluded from the cold-call queue.
        </div>
      )}

      {loading ? (
        <p className="text-xs text-gray-400 mt-2">Loading history…</p>
      ) : sends.length === 0 ? (
        <p className="text-xs text-gray-400 italic mt-2">No campaign touches yet.</p>
      ) : (
        <ul className="space-y-1.5 mt-2">
          {sends.map((e) => {
            const meta = ACTIVITY_META[e.activity_type] || { label: e.activity_type, dot: 'bg-gray-400' };
            return (
              <li key={e.id} className="flex items-start gap-2 text-xs rounded-md border border-gray-100 bg-gray-50/50 px-2 py-1.5">
                <span className={`w-1.5 h-1.5 rounded-full mt-1.5 ${meta.dot}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-gray-800 font-medium">{meta.label}</div>
                  {e.new_value?.campaign_name && (
                    <div className="text-gray-600 truncate">
                      {e.new_value.campaign_id ? (
                        <a href={`/marketing/${e.new_value.campaign_id}`} className="text-fuchsia-600 hover:underline">
                          {e.new_value.campaign_name}
                        </a>
                      ) : e.new_value.campaign_name}
                      {e.new_value.channel && <span className="text-gray-400"> · {e.new_value.channel}</span>}
                    </div>
                  )}
                </div>
                <span className="text-[10px] text-gray-400 shrink-0">{formatDate(e.created_at)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </CollapsibleSection>
  );
}

// ---------- Activity log ----------

function ActivityInner({ leadId }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api.get('/lead_activities', { params: { lead_id: leadId, limit: 200 } })
      .then((res) => { if (!cancelled) setEvents(res.data || []); })
      .catch((err) => { if (!cancelled) setError(extractApiError(err, 'Failed to load activity')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [leadId]);

  return (
    <CollapsibleSection title="Activity" count={events.length}>
      {loading ? (
        <p className="text-xs text-gray-400">Loading…</p>
      ) : error ? (
        <p className="text-xs text-red-600">{error}</p>
      ) : events.length === 0 ? (
        <p className="text-xs text-gray-400 italic">No activity yet.</p>
      ) : (
        <ol className="space-y-2.5">
          {events.map((e) => {
            const meta = ACTIVITY_META[e.activity_type] || { dot: 'bg-gray-400' };
            return (
              <li key={e.id} className="flex gap-2.5">
                <div className={`mt-1 w-2 h-2 rounded-full ${meta.dot} shrink-0`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-800">{describeActivity(e)}</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">{formatDate(e.created_at)}</p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </CollapsibleSection>
  );
}

function ActivitySection({ leadId, reloadKey }) {
  // Keyed wrapper so reloadKey changes remount the inner component cleanly.
  return <ActivityInner key={`${leadId}-${reloadKey}`} leadId={leadId} />;
}

// ---------- Drawer ----------

/**
 * Sibling-vehicles banner. Renders when the lead detail endpoint
 * returns one or more other live leads on the same phone number.
 * Clicking a row hands the sibling's id back to the parent so the
 * drawer can swap to that lead in place (no remount).
 */
function RelatedLeadsBanner({ leads, onOpen }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="mt-3 rounded-lg border border-violet-200 bg-violet-50/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-left"
      >
        <span className="text-[11px] font-semibold uppercase tracking-wider text-violet-700">
          Owns {leads.length + 1} vehicles · {leads.length} other on file
        </span>
        <svg className={`w-3.5 h-3.5 text-violet-700 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/>
        </svg>
      </button>
      {open && (
        <ul className="border-t border-violet-200 divide-y divide-violet-100">
          {leads.map((s) => {
            const vehicle = [s.year, s.make, s.model].filter(Boolean).join(' ') || 'Vehicle';
            const stamp = s.imported_at ? new Date(String(s.imported_at).replace(' ', 'T')).toLocaleDateString() : '';
            const vinTail = s.vin ? String(s.vin).slice(-6) : '';
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => onOpen?.(s.id)}
                  className="w-full text-left px-3 py-2 hover:bg-violet-100/50 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-gray-900 truncate">{vehicle}</p>
                      <p className="text-[10px] text-gray-500 mt-0.5 truncate">
                        {vinTail && <span className="font-mono">VIN …{vinTail}</span>}
                        {s.batch_name && <> · Batch {s.batch_name}{stamp ? ` (${stamp})` : ''}</>}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {s.assigned_user_name && (
                        <span className="text-[10px] text-gray-500">→ {s.assigned_user_name}</span>
                      )}
                      <span className="text-[10px] font-semibold text-violet-700">Open →</span>
                    </div>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function LeadDetailInner({ leadId, onClose, onChanged, onOpenLead }) {
  const { user } = useAuth();
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [users, setUsers] = useState([]);
  const [availableLabels, setAvailableLabels] = useState([]);
  const [activityReloadKey, setActivityReloadKey] = useState(0);
  // notesSummary was used by the now-removed latest-note preview at the
  // top of the drawer. NotesSection still has its own scoped list +
  // editing UI below — the operator hits that directly.

  const loadDetail = useCallback(async () => {
    try {
      const res = await api.get('/leads', { params: { id: leadId } });
      setDetail(res.data);
      setError('');
    } catch (err) {
      setError(extractApiError(err, 'Failed to load lead'));
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => { loadDetail(); }, [loadDetail]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.get('/lead_filter_options').catch(() => ({ data: { users: [], labels: [] } })),
      api.get('/labels').catch(() => ({ data: [] })),
    ]).then(([opts, labels]) => {
      if (cancelled) return;
      setUsers(opts.data?.users || []);
      setAvailableLabels(labels.data || []);
    });
    return () => { cancelled = true; };
  }, []);

  const title = (() => {
    if (!detail) return 'Lead';
    const np = detail.normalized_payload || {};
    const name = np.full_name || [np.first_name, np.last_name].filter(Boolean).join(' ');
    return name || np.vin || `Row #${detail.source_row_number}`;
  })();

  const crmState = detail?.crm_state ?? DEFAULT_LEAD_STATE;

  const handleChildChanged = () => {
    setActivityReloadKey((k) => k + 1);
    loadDetail().then(() => onChanged?.());
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-gray-900/50" />
      <aside
        className="relative bg-white w-full sm:w-[580px] h-full shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 border-b border-gray-100 px-5 sm:px-6 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold">Lead</p>
              <h2 className="text-base sm:text-lg font-semibold text-gray-900 truncate mt-0.5">{title}</h2>
              {(() => {
                const np = detail?.normalized_payload || {};
                if (!detail) return null;
                // Build the VIN line + vehicle quick-facts in the same
                // small grey font. VIN keeps its monospace; year/make/
                // model/miles run regular so they read as one sentence.
                const ymm = [np.year, np.make, np.model].filter(Boolean).join(' ');
                const milesNum = (() => {
                  const raw = np.mileage ?? np.LastReportedMiles;
                  if (raw === undefined || raw === null || raw === '') return null;
                  const n = Number(String(raw).replace(/[,\s]/g, ''));
                  return Number.isFinite(n) ? n.toLocaleString() : String(raw);
                })();
                if (!np.vin && !ymm && !milesNum) return null;
                return (
                  <p className="text-[11px] text-gray-500 mt-1 whitespace-nowrap truncate">
                    {np.vin && (
                      <>
                        <span className="font-mono">VIN {np.vin}</span>
                        {(ymm || milesNum) && <span className="text-gray-300"> · </span>}
                      </>
                    )}
                    {ymm && <span>{ymm}</span>}
                    {ymm && milesNum && <span className="text-gray-300"> · </span>}
                    {milesNum && <span>{milesNum} mi</span>}
                  </p>
                );
              })()}
            </div>
            {/* Only the close button lives in the title-bar action
                slot. The archive / restore action moved to a clearly
                separated row below the status chips — sitting next to
                the × made it a misclick risk. */}
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100"
              aria-label="Close drawer"
            >
              &times;
            </button>
          </div>
          {detail && (
            <>
              {/* Header chips — intentionally just the five tags the
                  operator cares about at a glance:
                    Tier · Status · Priority · Temperature · Agent.
                  Batch / Row # / notes-count / price / latest-note
                  used to live here too; they were noise. Source file
                  and batch metadata stay available in the Source
                  section at the bottom of the drawer.

                  The archive / restore action sits at the end of this
                  row, well separated from the × close button at the
                  top-right of the header. Subdued styling (text link,
                  not an icon button) signals it's a less-common
                  action that still needs the confirmation prompt. */}
              <div className="flex items-center gap-2 mt-3 flex-wrap">
                <TierPill tierKey={detail.tier || computeLeadTier(detail.normalized_payload || {})} />
                <StatusPill statusKey={crmState.status} />
                <PriorityPill priorityKey={crmState.priority} />
                <TemperaturePill temperatureKey={crmState.lead_temperature} />
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-gray-50 text-gray-700 border border-gray-100 whitespace-nowrap">
                  {crmState.assigned_user_name ? `Agent: ${crmState.assigned_user_name}` : 'Unassigned'}
                </span>
                <span className="ml-auto"/>
                <button
                  onClick={async () => {
                    const archived = !!detail.deleted_at;
                    const action = archived ? 'restore' : 'archive';
                    const msg = archived
                      ? `Restore ${title}? They'll reappear in the active leads list.`
                      : `Archive ${title}? They'll disappear from the leads list (recoverable from the Archived view).`;
                    if (!window.confirm(msg)) return;
                    try {
                      await api.post('/lead_archive', { lead_id: detail.id, action });
                      onChanged?.();
                      onClose?.();
                    } catch (err) {
                      window.alert(extractApiError(err, `Failed to ${action} lead`));
                    }
                  }}
                  className={`inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md border whitespace-nowrap ${
                    detail.deleted_at
                      ? 'text-emerald-700 bg-white border-emerald-200 hover:bg-emerald-50'
                      : 'text-red-600 bg-white border-red-200 hover:bg-red-50'
                  }`}
                  title={detail.deleted_at ? 'Restore this lead' : 'Archive this lead (recoverable from the Archived view)'}
                >
                  <Icon name={detail.deleted_at ? 'check' : 'trash'} size={11} />
                  {detail.deleted_at ? 'Restore' : 'Archive'}
                </button>
              </div>

              {/* Multi-vehicle banner. When the same phone shows up on
                  other live leads, the operator usually wants to know
                  before they call: this person also owns 2 Toyotas and
                  a Silverado. Click any row to jump to that lead. */}
              {(detail.related_leads || []).length > 0 && (
                <RelatedLeadsBanner
                  leads={detail.related_leads}
                  onOpen={onOpenLead}
                />
              )}
            </>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-4 space-y-5">
          {loading && !detail && (
            <div className="py-10 text-center">
              <div className="w-8 h-8 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin mx-auto" />
              <p className="text-xs text-gray-400 mt-2">Loading lead…</p>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-100 text-red-700 rounded-xl p-3 text-sm">{error}</div>
          )}

          {detail && (() => {
            // Agents (carfax/filter/tlo) only need CRM state + Contact log + Marketing
            // open by default; collapsing the rest cuts the visual wall.
            // Agents (carfax / filter / tlo / sales_agent) get the
            // trimmed view — only admins + marketers see every collab
            // section expanded by default.
            const isAgent = user?.role && !['admin','marketer'].includes(user.role);
            return (
            <>
              <CrmStateSection
                leadId={detail.id}
                initialState={crmState}
                importedMiles={
                  detail.normalized_payload?.mileage
                  ?? detail.normalized_payload?.LastReportedMiles
                  ?? null
                }
                autoTier={computeLeadTier(detail.normalized_payload || {})}
                users={users}
                isAdmin={user?.role === 'admin'}
                onChanged={handleChildChanged}
              />

              {/* Compact contacts panel — phones (with verified-slot
                  toggle) + emails (display only). Empty slots are
                  hidden so the section stays small. */}
              <ContactSlotsSection
                leadId={detail.id}
                np={detail.normalized_payload || {}}
                initialSlot={crmState.known_phone_slot}
                onChanged={handleChildChanged}
              />

              {/* Operator-facing collab sections come first — these are
                  the highest-traffic actions ("set a label", "add a note",
                  "log the call"). Outreach + BoS + lead details sit
                  below them. */}
              <LabelsSection
                leadId={detail.id}
                initialLabels={detail.labels || []}
                availableLabels={availableLabels}
                onChanged={handleChildChanged}
                defaultOpen={!isAgent}
              />

              <TasksSection
                leadId={detail.id}
                currentUser={user}
                users={users}
                onChanged={handleChildChanged}
                defaultOpen={!isAgent}
              />

              <ContactLogSection
                leadId={detail.id}
                onChanged={handleChildChanged}
              />

              <NotesSection
                leadId={detail.id}
                currentUser={user}
                defaultOpen={!isAgent}
              />

              <CollapsibleSection title="Outreach" defaultOpen>
                <LeadOutreachSection
                  leadId={detail.id}
                  normalizedPayload={detail.normalized_payload}
                  onChanged={handleChildChanged}
                />
              </CollapsibleSection>

              <CollapsibleSection title="Bill of Sale" defaultOpen>
                <div className="space-y-4">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1.5">Delivery schedule</p>
                    <LeadTransportSection
                      leadId={detail.id}
                      normalizedPayload={detail.normalized_payload}
                      onChanged={handleChildChanged}
                    />
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1.5">Sale document</p>
                    <LeadBillOfSaleSection
                      leadId={detail.id}
                      onChanged={handleChildChanged}
                    />
                  </div>
                </div>
              </CollapsibleSection>

              <CollapsibleSection title="Lead details" defaultOpen>
                {(() => {
                  const np = detail.normalized_payload || {};
                  const raw = detail.raw_payload || {};
                  const mapping = detail.mapping || {};

                  // Reverse mapping: normalized field key → original spreadsheet header.
                  // Used so a normalized value (e.g. year=2015) keeps a sensible label
                  // and so we can skip showing the same column twice as a "raw" extra.
                  const fieldToHeader = {};
                  for (const [header, field] of Object.entries(mapping)) {
                    if (field && field !== '_ignore' && !fieldToHeader[field]) {
                      fieldToHeader[field] = header;
                    }
                  }

                  const coreRows = FIELD_ORDER
                    .filter((k) => np[k] !== undefined && np[k] !== '' && np[k] !== null)
                    .map((k) => [FIELD_LABELS[k] || k, np[k]]);

                  // Extra normalized fields that aren't in FIELD_ORDER (rare).
                  const extraNormalized = Object.entries(np)
                    .filter(([k, v]) => !FIELD_ORDER.includes(k) && v !== '' && v !== null && v !== undefined)
                    .map(([k, v]) => [FIELD_LABELS[k] || k, v]);

                  // Everything from the raw spreadsheet row that isn't already
                  // surfaced through a normalized field above.
                  const shownHeaders = new Set(
                    [...FIELD_ORDER, ...Object.keys(np)]
                      .map((f) => fieldToHeader[f])
                      .filter(Boolean)
                  );
                  const rawExtras = Object.entries(raw)
                    .filter(([h, v]) => !shownHeaders.has(h) && v !== '' && v !== null && v !== undefined)
                    .map(([h, v]) => [h, v]);

                  return (
                    <>
                      {coreRows.length > 0 && <KeyValueTable rows={coreRows} />}
                      {extraNormalized.length > 0 && (
                        <div className="mt-3">
                          <p className="text-[11px] text-gray-400 mb-1">Other normalized fields:</p>
                          <KeyValueTable rows={extraNormalized} />
                        </div>
                      )}
                      {rawExtras.length > 0 && (
                        <div className="mt-3">
                          <p className="text-[11px] text-gray-400 mb-1">From spreadsheet:</p>
                          <KeyValueTable rows={rawExtras} />
                        </div>
                      )}
                      {coreRows.length === 0 && extraNormalized.length === 0 && rawExtras.length === 0 && (
                        <p className="text-xs text-gray-400 italic">No data captured for this lead.</p>
                      )}
                    </>
                  );
                })()}
              </CollapsibleSection>

              <MarketingSection
                leadId={detail.id}
                currentStatus={crmState?.status}
                onChanged={handleChildChanged}
              />

              <ActivitySection leadId={detail.id} reloadKey={activityReloadKey} />

              <CollapsibleSection title="Source">
                <KeyValueTable rows={[
                  ['Batch',            detail.batch_name],
                  ['Source stage',     detail.source_stage],
                  ['Source row #',     detail.source_row_number],
                  ['File',             detail.file_display_name || detail.file_name],
                  ['Vehicle',          detail.vehicle_name],
                  ['Artifact',         (
                    <span className="inline-flex items-center gap-2">
                      <span className="truncate">{detail.artifact_name}</span>
                      <a href={getArtifactDownloadUrl(detail.artifact_id)} className="text-[11px] text-blue-600 hover:underline">download</a>
                    </span>
                  )],
                  ['Artifact uploaded', formatDate(detail.artifact_uploaded_at)],
                  ['Imported at',      formatDate(detail.imported_at)],
                  ['Imported by',      detail.imported_by_name],
                  ['Mapping template', detail.template_name || '(inline mapping)'],
                  ['Batch notes',      detail.batch_notes || '—'],
                ]} />
              </CollapsibleSection>
            </>
            );
          })()}
        </div>
      </aside>
    </div>
  );
}

export default function LeadDetailDrawer({ leadId, onClose, onChanged, onOpenLead }) {
  if (!leadId) return null;
  return (
    <LeadDetailInner
      key={leadId}
      leadId={leadId}
      onClose={onClose}
      onChanged={onChanged}
      onOpenLead={onOpenLead}
    />
  );
}

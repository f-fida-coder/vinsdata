import { useState, useEffect, useCallback, useMemo } from 'react';
import api, { extractApiError } from '../api';
import LeadDetailDrawer from './LeadDetailDrawer';
import { STATUS_BY_KEY, PRIORITY_BY_KEY, TEMPERATURE_BY_KEY, formatPrice } from '../lib/crm';
import { MATCH_TYPE_BY_KEY, confidenceLabel, confidenceStyle, formatMatchKey } from '../lib/duplicates';

const PREP_STATUS_META = {
  not_started: { label: 'Not started', bg: 'bg-gray-100',   text: 'text-gray-600',    dot: 'bg-gray-400' },
  draft:       { label: 'Draft',       bg: 'bg-amber-50',   text: 'text-amber-700',   dot: 'bg-amber-500' },
  prepared:    { label: 'Prepared',    bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },
};

function formatDate(s) {
  if (!s) return '—';
  const d = new Date(String(s).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString();
}

function memberName(m) {
  const np = m.normalized_payload || {};
  return np.full_name || [np.first_name, np.last_name].filter(Boolean).join(' ').trim() || np.vin || `Row #${m.source_row_number}`;
}

function PrepStatusPill({ status }) {
  const meta = PREP_STATUS_META[status] || PREP_STATUS_META.not_started;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-semibold ${meta.bg} ${meta.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />{meta.label}
    </span>
  );
}

function ValueRow({ label, children }) {
  return (
    <div className="flex items-baseline gap-2 text-[11px]">
      <span className="text-gray-400 w-20 shrink-0">{label}</span>
      <span className="text-gray-800 truncate">{children || <span className="text-gray-300">—</span>}</span>
    </div>
  );
}

function FlagToggle({ checked, onChange, label, color = 'blue' }) {
  const palette = {
    blue:   checked ? 'bg-zinc-100 text-zinc-700 border-zinc-200'       : 'bg-white hover:bg-gray-50 text-gray-600 border-gray-200',
    amber:  checked ? 'bg-amber-50 text-amber-700 border-amber-200'    : 'bg-white hover:bg-gray-50 text-gray-600 border-gray-200',
    violet: checked ? 'bg-violet-50 text-violet-700 border-violet-200' : 'bg-white hover:bg-gray-50 text-gray-600 border-gray-200',
    gray:   checked ? 'bg-gray-100 text-gray-700 border-gray-300'      : 'bg-white hover:bg-gray-50 text-gray-600 border-gray-200',
  };
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md border transition-colors ${palette[color]}`}
    >
      {checked && <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>}
      {label}
    </button>
  );
}

function MemberCard({ m, isPrimary, onSetPrimary, choice, onChoiceChange, onOpenCrm }) {
  const np = m.normalized_payload || {};
  const status   = STATUS_BY_KEY[m.crm_status]        || STATUS_BY_KEY.new;
  const priority = PRIORITY_BY_KEY[m.crm_priority]    || PRIORITY_BY_KEY.medium;
  const temp     = TEMPERATURE_BY_KEY[m.lead_temperature];
  const setField = (field, value) => onChoiceChange({ ...choice, [field]: value });

  return (
    <div className={`rounded-xl border p-3 ${isPrimary ? 'border-blue-300 bg-zinc-50 ring-1 ring-blue-200' : 'border-gray-100 bg-white'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <label className="inline-flex items-center gap-1.5 cursor-pointer">
              <input type="radio" checked={isPrimary} onChange={() => onSetPrimary(m.imported_lead_id)} className="text-[var(--vv-text)] focus:ring-[var(--vv-bg-dark)]" />
              <span className="text-sm font-semibold text-gray-900">{memberName(m)}</span>
            </label>
            {isPrimary && <span className="text-[10px] font-bold uppercase tracking-wider text-blue-700 bg-blue-100 px-1.5 py-0.5 rounded">Primary</span>}
          </div>
          {np.vin && <p className="text-[11px] font-mono text-gray-500 mt-0.5">VIN {np.vin}</p>}
        </div>
        <button onClick={() => onOpenCrm(m.imported_lead_id)} className="shrink-0 text-[11px] text-[var(--vv-text)] hover:underline font-medium">
          Open CRM →
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 mt-2">
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold ${status.bg} ${status.text}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${status.dot}`} />{status.label}
        </span>
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold ${priority.bg} ${priority.text}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${priority.dot}`} />{priority.label}
        </span>
        {temp && (
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold ${temp.bg} ${temp.text}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${temp.dot}`} />{temp.label}
          </span>
        )}
        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-gray-50 text-gray-700 border border-gray-100">
          {m.assigned_user_name || 'Unassigned'}
        </span>
        {(m.labels || []).slice(0, 4).map((l) => (
          <span key={l.id} className="inline-flex items-center text-[10px] font-medium text-white px-1.5 py-0.5 rounded" style={{ backgroundColor: l.color }}>
            {l.name}
          </span>
        ))}
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-sky-50 text-sky-700 border border-sky-100">
          {m.notes_count} {m.notes_count === 1 ? 'note' : 'notes'}
        </span>
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-indigo-50 text-indigo-700 border border-indigo-100">
          {m.tasks_open}/{m.tasks_total} tasks
        </span>
      </div>

      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
        <ValueRow label="Phone">{np.phone_primary}</ValueRow>
        <ValueRow label="Email">{np.email_primary}</ValueRow>
        <ValueRow label="Phone 2">{np.phone_secondary}</ValueRow>
        <ValueRow label="Address">{np.full_address}</ValueRow>
        <ValueRow label="City/St">{[np.city, np.state].filter(Boolean).join(', ')}</ValueRow>
        <ValueRow label="ZIP">{np.zip_code}</ValueRow>
        <ValueRow label="Vehicle">{[np.year, np.make, np.model].filter(Boolean).join(' ')}</ValueRow>
        <ValueRow label="Mileage">{np.mileage}</ValueRow>
        <ValueRow label="Wanted">{m.price_wanted != null ? formatPrice(m.price_wanted) : null}</ValueRow>
        <ValueRow label="Offered">{m.price_offered != null ? formatPrice(m.price_offered) : null}</ValueRow>
      </div>

      <div className="mt-2 pt-2 border-t border-gray-100 text-[10px] text-gray-500 flex flex-wrap gap-x-3 gap-y-0.5">
        <span><span className="text-gray-400">Batch:</span> {m.batch_name}</span>
        <span className="truncate max-w-[220px]"><span className="text-gray-400">File:</span> {m.file_display_name || m.file_name}</span>
        <span><span className="text-gray-400">Row:</span> #{m.source_row_number}</span>
        <span><span className="text-gray-400">Imported:</span> {formatDate(m.imported_at)}</span>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <FlagToggle label="Best phone"    color="blue"   checked={!!choice.likely_best_phone}   onChange={(v) => setField('likely_best_phone', v)} />
        <FlagToggle label="Best email"    color="blue"   checked={!!choice.likely_best_email}   onChange={(v) => setField('likely_best_email', v)} />
        <FlagToggle label="Best address"  color="blue"   checked={!!choice.likely_best_address} onChange={(v) => setField('likely_best_address', v)} />
        <FlagToggle label="Keep for reference" color="gray" checked={!!choice.keep_for_reference} onChange={(v) => setField('keep_for_reference', v)} />
      </div>
    </div>
  );
}

function MergePrepDrawerInner({ duplicateGroupId, onClose, onChanged }) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  const [primary, setPrimary]    = useState(null);
  const [notes, setNotes]        = useState('');
  const [choices, setChoices]    = useState({});       // { [leadId]: {keep_for_reference, ...} }
  const [baseline, setBaseline]  = useState(null);     // snapshot of initial state for dirty tracking
  const [saving, setSaving]      = useState(false);
  const [openCrmLeadId, setOpenCrmLeadId] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get('/lead_merge_prep', { params: { duplicate_group_id: duplicateGroupId } });
      setData(res.data);
      setError('');
      setPrimary(res.data?.prep?.preferred_primary_lead_id ?? null);
      setNotes(res.data?.prep?.review_notes ?? '');
      const initial = {};
      (res.data?.members || []).forEach((m) => {
        initial[m.imported_lead_id] = {
          keep_for_reference: false,
          likely_best_phone: false,
          likely_best_email: false,
          likely_best_address: false,
          notes: null,
        };
      });
      (res.data?.choices || []).forEach((c) => {
        initial[c.imported_lead_id] = {
          keep_for_reference:  !!c.keep_for_reference,
          likely_best_phone:   !!c.likely_best_phone,
          likely_best_email:   !!c.likely_best_email,
          likely_best_address: !!c.likely_best_address,
          notes:               c.notes ?? null,
        };
      });
      setChoices(initial);
      setBaseline({
        primary: res.data?.prep?.preferred_primary_lead_id ?? null,
        notes:   res.data?.prep?.review_notes ?? '',
        choices: JSON.parse(JSON.stringify(initial)),
      });
    } catch (err) {
      setError(extractApiError(err, 'Failed to load prep workspace'));
    } finally {
      setLoading(false);
    }
  }, [duplicateGroupId]);

  useEffect(() => { load(); }, [load]);

  const dirty = useMemo(() => {
    if (!baseline) return false;
    if ((primary ?? null) !== (baseline.primary ?? null)) return true;
    if ((notes ?? '') !== (baseline.notes ?? '')) return true;
    return JSON.stringify(choices) !== JSON.stringify(baseline.choices);
  }, [primary, notes, choices, baseline]);

  const save = async ({ markPrepared = false } = {}) => {
    if (!data) return;
    setSaving(true); setError('');
    try {
      const body = {
        duplicate_group_id: duplicateGroupId,
        preferred_primary_lead_id: primary,
        review_notes: notes || null,
        status: markPrepared ? 'prepared' : (data.prep?.status === 'prepared' ? 'prepared' : 'draft'),
        choices: Object.entries(choices).map(([leadId, c]) => ({
          imported_lead_id: Number(leadId),
          keep_for_reference:  c.keep_for_reference,
          likely_best_phone:   c.likely_best_phone,
          likely_best_email:   c.likely_best_email,
          likely_best_address: c.likely_best_address,
          notes:               c.notes ?? null,
        })),
      };
      await api.put('/lead_merge_prep', body);
      await load();
      onChanged?.();
    } catch (err) {
      setError(extractApiError(err, 'Save failed'));
    } finally {
      setSaving(false);
    }
  };

  const revertToDraft = async () => {
    if (!window.confirm('Move this group back to draft?')) return;
    setSaving(true); setError('');
    try {
      await api.put('/lead_merge_prep', { duplicate_group_id: duplicateGroupId, status: 'draft' });
      await load();
      onChanged?.();
    } catch (err) {
      setError(extractApiError(err, 'Revert failed'));
    } finally {
      setSaving(false);
    }
  };

  const group   = data?.group;
  const prep    = data?.prep;
  const members = data?.members || [];
  const status  = prep?.status || 'not_started';
  const typeMeta = group ? MATCH_TYPE_BY_KEY[group.match_type] : null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-gray-900/50" />
      <aside
        className="relative bg-white w-full sm:w-[760px] h-full shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 border-b border-gray-100 px-5 sm:px-6 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold">Merge prep</p>
              <h2 className="text-base sm:text-lg font-semibold text-gray-900 mt-0.5">Group #{duplicateGroupId}</h2>
              {group && (
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  {typeMeta && (
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold ${typeMeta.bg} ${typeMeta.text}`}>
                      {typeMeta.label}
                    </span>
                  )}
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold ${confidenceStyle(group.confidence)}`}>
                    {confidenceLabel(group.confidence)} · {(group.confidence * 100).toFixed(0)}%
                  </span>
                  <PrepStatusPill status={status} />
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-gray-50 text-gray-700 border border-gray-100">
                    {group.member_count} leads
                  </span>
                  {prep?.prepared_by_name && (
                    <span className="text-[11px] text-gray-500">
                      Prepared by <span className="font-medium text-gray-700">{prep.prepared_by_name}</span> · {formatDate(prep.prepared_at)}
                    </span>
                  )}
                </div>
              )}
            </div>
            <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100">&times;</button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-4 space-y-4">
          {loading && !data && (
            <div className="py-10 text-center">
              <div className="w-8 h-8 border-4 border-zinc-200 border-t-[var(--vv-bg-dark)] rounded-full animate-spin mx-auto" />
              <p className="text-xs text-gray-400 mt-2">Loading workspace…</p>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-100 text-red-700 rounded-xl p-3 text-sm">{error}</div>
          )}

          {group && (
            <>
              <section className="rounded-xl border border-amber-100 bg-amber-50/60 p-3 text-xs">
                <p className="font-semibold uppercase tracking-wider text-amber-700 mb-1">Merge prep only</p>
                <p className="text-sm text-amber-900">
                  This workspace is a safe compare-and-plan view. Nothing here merges, deletes, or overwrites any record.
                </p>
                <p className="text-xs text-amber-800 mt-1 font-mono break-all">
                  Match key: {formatMatchKey(group.match_type, group.match_key)}
                </p>
              </section>

              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">Members ({members.length})</h3>
                <p className="text-[11px] text-gray-500 mb-2">Select the lead that best represents the consolidated record. Use flags to hint which member has the best phone, email, or address.</p>
                <div className="space-y-2.5">
                  {members.map((m) => (
                    <MemberCard
                      key={m.imported_lead_id}
                      m={m}
                      isPrimary={primary === m.imported_lead_id}
                      onSetPrimary={setPrimary}
                      choice={choices[m.imported_lead_id] || {}}
                      onChoiceChange={(c) => setChoices((prev) => ({ ...prev, [m.imported_lead_id]: c }))}
                      onOpenCrm={setOpenCrmLeadId}
                    />
                  ))}
                </div>
              </section>

              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">Review notes</h3>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  maxLength={5000}
                  placeholder="Why did you pick this primary lead? Any caveats for a future merge?"
                  className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-[var(--vv-bg-dark)] focus:border-transparent outline-none"
                />
              </section>
            </>
          )}
        </div>

        {group && (
          <div className="shrink-0 border-t border-gray-100 px-5 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-2 bg-white">
            <p className="text-[11px] text-gray-500">
              {primary ? 'Primary picked.' : <span className="text-amber-600">Pick a primary before marking prepared.</span>}
              {dirty && <span className="ml-2 text-[var(--vv-text)] font-medium">Unsaved changes</span>}
            </p>
            <div className="flex gap-2">
              {status === 'prepared' && (
                <button onClick={revertToDraft} disabled={saving} className="px-3 py-1.5 text-xs font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-100 rounded-lg disabled:opacity-40">
                  Revert to draft
                </button>
              )}
              <button
                onClick={() => save({ markPrepared: false })}
                disabled={saving || !dirty}
                className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-lg disabled:opacity-40"
              >
                {saving ? 'Saving…' : 'Save draft'}
              </button>
              <button
                onClick={() => save({ markPrepared: true })}
                disabled={saving || primary === null}
                className="px-3 py-1.5 text-xs font-medium text-white bg-[var(--vv-bg-dark)] hover:bg-black rounded-lg shadow disabled:opacity-40"
              >
                {saving ? 'Saving…' : 'Mark prepared'}
              </button>
            </div>
          </div>
        )}
      </aside>

      <LeadDetailDrawer leadId={openCrmLeadId} onClose={() => setOpenCrmLeadId(null)} onChanged={load} />
    </div>
  );
}

export default function MergePrepDrawer({ duplicateGroupId, onClose, onChanged }) {
  if (!duplicateGroupId) return null;
  return <MergePrepDrawerInner key={duplicateGroupId} duplicateGroupId={duplicateGroupId} onClose={onClose} onChanged={onChanged} />;
}

import { useState, useEffect, useCallback, useMemo } from 'react';
import api, { extractApiError, getArtifactDownloadUrl } from '../api';
import { NORMALIZED_FIELDS } from '../lib/normalizedFields';
import { useAuth } from '../context/AuthContext';
import {
  LEAD_STATUSES, LEAD_PRIORITIES, LEAD_TEMPERATURES,
  STATUS_BY_KEY, PRIORITY_BY_KEY, TEMPERATURE_BY_KEY,
  DEFAULT_LEAD_STATE, ACTIVITY_META, describeActivity, formatPrice,
} from '../lib/crm';
import {
  TASK_TYPES, TASK_TYPE_BY_KEY,
  CONTACT_CHANNELS, CONTACT_OUTCOMES, CHANNEL_BY_KEY, OUTCOME_BY_KEY,
  relativeDue, isOverdue,
} from '../lib/tasks';

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

// ---------- CRM State section ----------

function normalizePriceInput(v) {
  if (v === '' || v === null || v === undefined) return '';
  return String(v);
}

function CrmStateSection({ leadId, initialState, users, isAdmin, onChanged }) {
  const [state, setState] = useState({
    status:           initialState?.status   ?? DEFAULT_LEAD_STATE.status,
    priority:         initialState?.priority ?? DEFAULT_LEAD_STATE.priority,
    lead_temperature: initialState?.lead_temperature ?? '',
    price_wanted:     normalizePriceInput(initialState?.price_wanted),
    price_offered:    normalizePriceInput(initialState?.price_offered),
    assigned_user_id: initialState?.assigned_user_id ?? null,
  });
  const [baseline, setBaseline] = useState(state);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const dirty = useMemo(() => (
    state.status !== baseline.status
    || state.priority !== baseline.priority
    || (state.lead_temperature || '') !== (baseline.lead_temperature || '')
    || (state.price_wanted    || '') !== (baseline.price_wanted    || '')
    || (state.price_offered   || '') !== (baseline.price_offered   || '')
    || (state.assigned_user_id ?? null) !== (baseline.assigned_user_id ?? null)
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
      if ((state.assigned_user_id ?? null) !== (baseline.assigned_user_id ?? null)) {
        payload.assigned_user_id = state.assigned_user_id ?? null;
      }
      await api.put('/lead_state', payload);
      setBaseline(state);
      onChanged?.();
    } catch (err) {
      setError(extractApiError(err, 'Failed to save state'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <CollapsibleSection title="CRM state" defaultOpen>
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
            {users.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
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

      <div className="flex items-center gap-2 mt-2 flex-wrap">
        <StatusPill statusKey={state.status} />
        <PriorityPill priorityKey={state.priority} />
        {state.lead_temperature && <TemperaturePill temperatureKey={state.lead_temperature} />}
      </div>
      {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
      <div className="flex justify-end mt-2">
        <button
          onClick={save}
          disabled={!dirty || saving}
          className="px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-40"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </CollapsibleSection>
  );
}

// ---------- Labels section ----------

function LabelsSection({ leadId, initialLabels, availableLabels, onChanged }) {
  const [labels, setLabels] = useState(initialLabels || []);
  const [selectedAdd, setSelectedAdd] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');

  const attachedIds = useMemo(() => new Set(labels.map((l) => l.id)), [labels]);
  const candidates = availableLabels.filter((l) => !attachedIds.has(l.id));

  const attach = async () => {
    if (!selectedAdd) return;
    const label = availableLabels.find((l) => String(l.id) === String(selectedAdd));
    if (!label) return;
    setWorking(true); setError('');
    try {
      await api.post('/lead_labels', { lead_id: leadId, label_id: label.id });
      setLabels((prev) => [...prev, label].sort((a, b) => a.name.localeCompare(b.name)));
      setSelectedAdd('');
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
    <CollapsibleSection title="Labels" count={labels.length} defaultOpen>
      <div className="flex flex-wrap items-center gap-1.5">
        {labels.length === 0 && <p className="text-xs text-gray-400 italic">No labels attached.</p>}
        {labels.map((l) => (
          <span key={l.id} className="inline-flex items-center gap-1 text-[11px] font-medium text-white px-2 py-0.5 rounded-md" style={{ backgroundColor: l.color }}>
            {l.name}
            <button onClick={() => detach(l.id)} disabled={working} className="hover:opacity-70 disabled:opacity-40" aria-label="Remove">&times;</button>
          </span>
        ))}
      </div>
      <div className="flex items-center gap-2 mt-3">
        <select
          value={selectedAdd}
          onChange={(e) => setSelectedAdd(e.target.value)}
          disabled={candidates.length === 0 || working}
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
      </div>
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
            {users.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
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

function TasksSection({ leadId, currentUser, users, onChanged }) {
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
    setSaving(true); setError('');
    try {
      await api.post('/lead_tasks', {
        lead_id:          leadId,
        title:            draft.title.trim(),
        task_type:        draft.task_type,
        due_at:           draft.due_at || null,
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
      defaultOpen
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
                  value={draft.due_at}
                  onChange={(e) => setDraft({ ...draft, due_at: e.target.value })}
                  className="w-full bg-white border border-gray-200 rounded-md px-2 py-1.5 text-xs"
                />
                <select
                  value={draft.assigned_user_id ?? ''}
                  onChange={(e) => setDraft({ ...draft, assigned_user_id: e.target.value === '' ? null : Number(e.target.value) })}
                  className="sm:col-span-2 w-full bg-white border border-gray-200 rounded-md px-2 py-1.5 text-xs"
                >
                  <option value="">Unassigned</option>
                  {users.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}
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
                <button onClick={create} disabled={!draft.title.trim() || saving} className="px-3 py-1 text-xs font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-40">
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

function NotesSection({ leadId, currentUser, onNotesLoaded }) {
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
    <CollapsibleSection title="Notes" count={notes.length} defaultOpen>
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

function LeadDetailInner({ leadId, onClose, onChanged }) {
  const { user } = useAuth();
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [users, setUsers] = useState([]);
  const [availableLabels, setAvailableLabels] = useState([]);
  const [activityReloadKey, setActivityReloadKey] = useState(0);
  const [notesSummary, setNotesSummary] = useState([]);

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
              {detail?.normalized_payload?.vin && (
                <p className="text-[11px] text-gray-500 mt-1 font-mono">VIN {detail.normalized_payload.vin}</p>
              )}
            </div>
            <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100">&times;</button>
          </div>
          {detail && (
            <>
              <div className="flex items-center gap-2 mt-3 flex-wrap">
                <StatusPill statusKey={crmState.status} />
                <PriorityPill priorityKey={crmState.priority} />
                <TemperaturePill temperatureKey={crmState.lead_temperature} />
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-gray-50 text-gray-700 border border-gray-100">
                  {crmState.assigned_user_name ? `Agent: ${crmState.assigned_user_name}` : 'Unassigned'}
                </span>
                {notesSummary.length > 0 && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-sky-50 text-sky-700 border border-sky-100">
                    {notesSummary.length} {notesSummary.length === 1 ? 'note' : 'notes'}
                  </span>
                )}
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-100">
                  Batch: {detail.batch_name}
                </span>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-100">
                  Row #{detail.source_row_number}
                </span>
              </div>
              {(crmState.price_wanted !== null || crmState.price_offered !== null) && (
                <div className="flex items-center gap-3 mt-2 text-[11px] text-gray-600">
                  <span><span className="text-gray-400">Wanted:</span> <span className="font-semibold text-gray-800">{formatPrice(crmState.price_wanted)}</span></span>
                  <span className="text-gray-300">·</span>
                  <span><span className="text-gray-400">Offered:</span> <span className="font-semibold text-gray-800">{formatPrice(crmState.price_offered)}</span></span>
                </div>
              )}
              {notesSummary[0] && (
                <div className="mt-2 rounded-lg bg-sky-50/60 border border-sky-100 px-2.5 py-1.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-sky-700">Latest note</p>
                  <p className="text-xs text-gray-700 mt-0.5 line-clamp-2 whitespace-pre-wrap break-words">
                    {notesSummary[0].note}
                  </p>
                  <p className="text-[10px] text-gray-500 mt-0.5">— {notesSummary[0].user_name}</p>
                </div>
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

          {detail && (
            <>
              <CrmStateSection
                leadId={detail.id}
                initialState={crmState}
                users={users}
                isAdmin={user?.role === 'admin'}
                onChanged={handleChildChanged}
              />

              <LabelsSection
                leadId={detail.id}
                initialLabels={detail.labels || []}
                availableLabels={availableLabels}
                onChanged={handleChildChanged}
              />

              <TasksSection
                leadId={detail.id}
                currentUser={user}
                users={users}
                onChanged={handleChildChanged}
              />

              <ContactLogSection
                leadId={detail.id}
                onChanged={handleChildChanged}
              />

              <NotesSection leadId={detail.id} currentUser={user} onNotesLoaded={setNotesSummary} />

              <ActivitySection leadId={detail.id} reloadKey={activityReloadKey} />

              <CollapsibleSection title="Lead data" defaultOpen>
                <KeyValueTable
                  rows={FIELD_ORDER
                    .filter((k) => detail.normalized_payload && detail.normalized_payload[k] !== undefined && detail.normalized_payload[k] !== '')
                    .map((k) => [FIELD_LABELS[k] || k, detail.normalized_payload[k]])}
                />
                {Object.keys(detail.normalized_payload || {}).filter((k) => !FIELD_ORDER.includes(k)).length > 0 && (
                  <div className="mt-2">
                    <p className="text-[11px] text-gray-400 mb-1">Other normalized fields:</p>
                    <KeyValueTable
                      rows={Object.entries(detail.normalized_payload)
                        .filter(([k]) => !FIELD_ORDER.includes(k))
                        .map(([k, v]) => [FIELD_LABELS[k] || k, v])}
                    />
                  </div>
                )}
              </CollapsibleSection>

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

              <CollapsibleSection title="Mapping snapshot" count={detail.mapping ? Object.keys(detail.mapping).length : 0}>
                <p className="text-[11px] text-gray-400 mb-2">Header → normalized field used when this batch was imported.</p>
                <KeyValueTable rows={Object.entries(detail.mapping || {}).map(([h, f]) => [h, f])} />
              </CollapsibleSection>

              <CollapsibleSection title="Raw row" count={detail.raw_payload ? Object.keys(detail.raw_payload).length : 0}>
                <p className="text-[11px] text-gray-400 mb-2">Exact spreadsheet row as captured at import.</p>
                <KeyValueTable monospaceValue rows={Object.entries(detail.raw_payload || {}).map(([h, v]) => [h, v])} />
              </CollapsibleSection>
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

export default function LeadDetailDrawer({ leadId, onClose, onChanged }) {
  if (!leadId) return null;
  return <LeadDetailInner key={leadId} leadId={leadId} onClose={onClose} onChanged={onChanged} />;
}

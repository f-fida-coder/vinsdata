import { useState, useEffect, useCallback } from 'react';
import api, { extractApiError } from '../api';
import { useAuth } from '../context/AuthContext';

const DEFAULT_PREDICATE = { field: 'state', op: 'eq', value: '' };
const ACTION_OPTIONS = [
  { key: 'flag_for_review', label: 'Flag for review', hint: 'Send to manual review queue' },
  { key: 'reject',          label: 'Auto-reject',     hint: 'Silently exclude from the funnel' },
];

// Ops that don't need a value input.
const NO_VALUE_OPS = new Set(['is_null', 'is_not_null']);
// Ops that take an array (comma-separated in the UI).
const ARRAY_OPS = new Set(['in', 'not_in']);

const OP_LABELS = {
  eq: 'equals', neq: 'not equals',
  lt: '<', gt: '>', lte: '≤', gte: '≥',
  in: 'in list', not_in: 'not in list',
  contains: 'contains', starts_with: 'starts with',
  is_null: 'is empty', is_not_null: 'is not empty',
};

function Modal({ open, title, onClose, children }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="relative w-full max-w-lg sm:rounded-lg rounded-t-lg flex flex-col max-h-[90vh]"
        style={{
          backgroundColor: 'var(--vv-bg-surface)',
          border: '1px solid var(--vv-border)',
          boxShadow: '0 10px 40px rgba(9,9,11,0.16)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center justify-between px-5 py-3 shrink-0"
          style={{ borderBottom: '1px solid var(--vv-border)' }}
        >
          <h2 className="text-[14px] font-semibold">{title}</h2>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-[var(--vv-bg-surface-muted)]">&times;</button>
        </div>
        <div className="px-5 py-4 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

function RuleForm({ initial, fields, ops, onCancel, onSubmit, submitting }) {
  const [name, setName]             = useState(initial?.name ?? '');
  const [description, setDesc]      = useState(initial?.description ?? '');
  const [predicate, setPredicate]   = useState(initial?.predicate ?? DEFAULT_PREDICATE);
  const [action, setAction]         = useState(initial?.action ?? 'flag_for_review');
  const [active, setActive]         = useState(initial ? !!initial.active : true);

  const fieldKeys = Object.keys(fields || {});

  const updatePred = (patch) => setPredicate((p) => ({ ...p, ...patch }));

  const takesArray = ARRAY_OPS.has(predicate.op);
  const takesNoValue = NO_VALUE_OPS.has(predicate.op);

  const submit = (e) => {
    e.preventDefault();
    let value = predicate.value;
    if (takesNoValue) {
      value = undefined;
    } else if (takesArray) {
      const raw = typeof value === 'string' ? value : Array.isArray(value) ? value.join(', ') : '';
      value = raw.split(',').map((s) => s.trim()).filter(Boolean);
    }
    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      predicate: {
        field: predicate.field,
        op: predicate.op,
        ...(takesNoValue ? {} : { value }),
      },
      action,
      active,
    };
    onSubmit(payload);
  };

  const inputStyle = {
    backgroundColor: 'var(--vv-bg-surface-muted)',
    border: '1px solid var(--vv-border)',
    borderRadius: 'var(--vv-radius-md)',
  };

  return (
    <form onSubmit={submit} className="space-y-3 text-[13px]">
      <div>
        <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--vv-text-muted)' }}>Name</label>
        <input
          value={name} onChange={(e) => setName(e.target.value)} required maxLength={150}
          className="w-full px-3 py-2 outline-none focus:ring-2 focus:ring-[var(--vv-accent)]"
          style={inputStyle}
        />
      </div>

      <div>
        <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--vv-text-muted)' }}>Description</label>
        <textarea
          value={description} onChange={(e) => setDesc(e.target.value)} rows={2}
          className="w-full px-3 py-2 outline-none focus:ring-2 focus:ring-[var(--vv-accent)]"
          style={inputStyle}
        />
      </div>

      <div>
        <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--vv-text-muted)' }}>Predicate</label>
        <div className="grid grid-cols-3 gap-2">
          <select
            value={predicate.field}
            onChange={(e) => updatePred({ field: e.target.value })}
            className="px-2 py-2 outline-none focus:ring-2 focus:ring-[var(--vv-accent)]"
            style={inputStyle}
          >
            {fieldKeys.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
          <select
            value={predicate.op}
            onChange={(e) => updatePred({ op: e.target.value })}
            className="px-2 py-2 outline-none focus:ring-2 focus:ring-[var(--vv-accent)]"
            style={inputStyle}
          >
            {(ops || []).map((o) => <option key={o} value={o}>{OP_LABELS[o] ?? o}</option>)}
          </select>
          {!takesNoValue && (
            <input
              value={Array.isArray(predicate.value) ? predicate.value.join(', ') : (predicate.value ?? '')}
              onChange={(e) => updatePred({ value: e.target.value })}
              placeholder={takesArray ? 'a, b, c' : 'value'}
              className="px-2 py-2 outline-none focus:ring-2 focus:ring-[var(--vv-accent)]"
              style={inputStyle}
            />
          )}
          {takesNoValue && <div />}
        </div>
      </div>

      <div>
        <label className="block text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--vv-text-muted)' }}>Action</label>
        <div className="flex gap-2">
          {ACTION_OPTIONS.map((a) => {
            const selected = action === a.key;
            return (
              <label
                key={a.key}
                className="flex-1 cursor-pointer px-3 py-2 flex items-center gap-2"
                style={{
                  backgroundColor: selected ? 'var(--vv-bg-dark)' : 'var(--vv-bg-surface)',
                  border: `1px solid ${selected ? 'var(--vv-bg-dark)' : 'var(--vv-border)'}`,
                  borderRadius: 'var(--vv-radius-md)',
                  color: selected ? '#ffffff' : 'var(--vv-text)',
                }}
              >
                <input
                  type="radio"
                  name="action"
                  checked={selected}
                  onChange={() => setAction(a.key)}
                  className="accent-white"
                />
                <div className="flex-1">
                  <div className="font-medium">{a.label}</div>
                  <div
                    className="text-[11px]"
                    style={{ color: selected ? 'rgba(255,255,255,0.72)' : 'var(--vv-text-muted)' }}
                  >
                    {a.hint}
                  </div>
                </div>
              </label>
            );
          })}
        </div>
      </div>

      <label className="flex items-center gap-2">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="accent-[var(--vv-accent)]" />
        <span>Active</span>
      </label>

      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={onCancel} className="px-3 py-1.5 text-[13px] rounded-md" style={{ border: '1px solid var(--vv-border)' }}>Cancel</button>
        <button type="submit" disabled={submitting} className="px-3 py-1.5 text-[13px] rounded-md text-white disabled:opacity-60" style={{ backgroundColor: 'var(--vv-accent)' }}>
          {submitting ? 'Saving…' : 'Save rule'}
        </button>
      </div>
    </form>
  );
}

export default function FilterRulesPage() {
  const { user } = useAuth();
  const [state, setState] = useState({ rules: [], fields: {}, ops: [], loading: true, error: '' });
  const [editing, setEditing] = useState(null); // null | 'new' | ruleObject
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }));
    try {
      const res = await api.get('/filter_rules');
      setState({
        rules: res.data.rules || [],
        fields: res.data.fields || {},
        ops: res.data.ops || [],
        loading: false,
        error: '',
      });
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: extractApiError(err, 'Failed to load filter rules') }));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (user?.role !== 'admin') {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-[14px]" style={{ color: 'var(--vv-status-danger)' }}>Access denied — admin only.</p>
      </div>
    );
  }

  const submitRule = async (payload) => {
    setSubmitting(true);
    try {
      if (editing === 'new') {
        await api.post('/filter_rules', payload);
      } else if (editing && editing.id) {
        await api.patch('/filter_rules', { id: editing.id, ...payload });
      }
      setEditing(null);
      load();
    } catch (err) {
      setState((s) => ({ ...s, error: extractApiError(err, 'Save failed') }));
    } finally {
      setSubmitting(false);
    }
  };

  const deleteRule = async (rule) => {
    if (!confirm(`Delete rule "${rule.name}"? If any leads have been evaluated by it the rule will be deactivated instead.`)) return;
    try {
      await api.delete('/filter_rules', { data: { id: rule.id } });
      load();
    } catch (err) {
      setState((s) => ({ ...s, error: extractApiError(err, 'Delete failed') }));
    }
  };

  const toggleActive = async (rule) => {
    try {
      await api.patch('/filter_rules', { id: rule.id, active: !rule.active });
      load();
    } catch (err) {
      setState((s) => ({ ...s, error: extractApiError(err, 'Update failed') }));
    }
  };

  const describePredicate = (p) => {
    if (!p || !p.field || !p.op) return '—';
    const op = OP_LABELS[p.op] ?? p.op;
    if (NO_VALUE_OPS.has(p.op)) return `${p.field} ${op}`;
    const v = Array.isArray(p.value) ? p.value.join(', ') : String(p.value ?? '');
    return `${p.field} ${op} ${v}`;
  };

  return (
    <div className="max-w-[1600px] mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">VIN Filter rules</h1>
          <p className="text-[12px] mt-0.5" style={{ color: 'var(--vv-text-muted)' }}>
            Rules run when a file moves from carfax to filter. Reject matches block the lead; flag matches enter the review queue.
          </p>
        </div>
        <button
          onClick={() => setEditing('new')}
          className="px-3 py-1.5 text-[13px] rounded-md text-white"
          style={{ backgroundColor: 'var(--vv-accent)' }}
        >
          + New rule
        </button>
      </div>

      {state.error && (
        <div className="mb-4 px-4 py-2 rounded-md text-[13px]" style={{ backgroundColor: '#FEE2E2', color: 'var(--vv-status-danger)', border: '1px solid #FECACA' }}>
          {state.error}
        </div>
      )}

      <div
        className="overflow-hidden"
        style={{ backgroundColor: 'var(--vv-bg-surface)', border: '1px solid var(--vv-border)', borderRadius: 'var(--vv-radius-lg)' }}
      >
        {state.loading ? (
          <div className="py-10 text-center text-[13px]" style={{ color: 'var(--vv-text-muted)' }}>Loading…</div>
        ) : state.rules.length === 0 ? (
          <div className="py-10 text-center text-[13px]" style={{ color: 'var(--vv-text-muted)' }}>
            No rules yet. Click <span className="font-medium" style={{ color: 'var(--vv-text)' }}>+ New rule</span> to add the first one.
          </div>
        ) : (
          <table className="w-full text-[13px]">
            <thead style={{ backgroundColor: 'var(--vv-bg-surface-muted)' }}>
              <tr style={{ borderBottom: '1px solid var(--vv-border)' }}>
                <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--vv-text-muted)' }}>Rule</th>
                <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--vv-text-muted)' }}>Predicate</th>
                <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--vv-text-muted)' }}>Action</th>
                <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--vv-text-muted)' }}>Active</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {state.rules.map((r) => (
                <tr key={r.id} style={{ borderBottom: '1px solid var(--vv-border)' }}>
                  <td className="px-4 py-2">
                    <div className="font-medium">{r.name}</div>
                    {r.description && <div className="text-[11px]" style={{ color: 'var(--vv-text-muted)' }}>{r.description}</div>}
                  </td>
                  <td className="px-4 py-2 font-mono text-[12px]" style={{ color: 'var(--vv-text-muted)' }}>
                    {describePredicate(r.predicate)}
                  </td>
                  <td className="px-4 py-2">
                    <span
                      className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium"
                      style={{
                        backgroundColor: r.action === 'reject' ? '#FEE2E2' : '#FEF3C7',
                        color:           r.action === 'reject' ? 'var(--vv-status-danger)' : 'var(--vv-status-warning)',
                      }}
                    >
                      {r.action === 'reject' ? 'Auto-reject' : 'Flag for review'}
                    </span>
                  </td>
                  <td className="px-4 py-2">
                    <button
                      onClick={() => toggleActive(r)}
                      className="inline-flex items-center gap-1.5 text-[12px]"
                      style={{ color: r.active ? 'var(--vv-status-success)' : 'var(--vv-text-subtle)' }}
                    >
                      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: r.active ? 'var(--vv-status-success)' : 'var(--vv-text-subtle)' }} />
                      {r.active ? 'Active' : 'Disabled'}
                    </button>
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button onClick={() => setEditing(r)} className="text-[12px] px-2 py-1 mr-1 rounded" style={{ color: 'var(--vv-accent)' }}>Edit</button>
                    <button onClick={() => deleteRule(r)} className="text-[12px] px-2 py-1 rounded" style={{ color: 'var(--vv-status-danger)' }}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Modal
        open={!!editing}
        title={editing === 'new' ? 'New filter rule' : `Edit: ${editing?.name ?? ''}`}
        onClose={() => setEditing(null)}
      >
        <RuleForm
          initial={editing === 'new' ? null : editing}
          fields={state.fields}
          ops={state.ops}
          onCancel={() => setEditing(null)}
          onSubmit={submitRule}
          submitting={submitting}
        />
      </Modal>
    </div>
  );
}

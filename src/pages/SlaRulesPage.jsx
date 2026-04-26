import { useState, useEffect, useCallback } from 'react';
import api, { extractApiError } from '../api';
import { useAuth } from '../context/AuthContext';
import { LEAD_STATUSES, LEAD_TEMPERATURES } from '../lib/crm';

const NOTIFY_ROLE_OPTIONS = [
  { key: '',         label: '— none —' },
  { key: 'admin',    label: 'All admins' },
  { key: 'marketer', label: 'All marketers' },
  { key: 'carfax',   label: 'All Carfax users' },
  { key: 'filter',   label: 'All Filter users' },
  { key: 'tlo',      label: 'All TLO users' },
];

function Modal({ open, title, onClose, children }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="relative w-full max-w-xl flex flex-col max-h-[90vh]"
        style={{
          backgroundColor: 'var(--vv-bg-surface)',
          border: '1px solid var(--vv-border)',
          borderRadius: 'var(--vv-radius-lg)',
          boxShadow: '0 10px 40px rgba(9,9,11,0.16)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 shrink-0" style={{ borderBottom: '1px solid var(--vv-border)' }}>
          <h2 className="text-[14px] font-semibold">{title}</h2>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-[var(--vv-bg-surface-muted)]">&times;</button>
        </div>
        <div className="px-5 py-4 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

function MultiSelect({ label, options, selected, onChange }) {
  const toggle = (key) => {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key); else next.add(key);
    onChange([...next]);
  };
  return (
    <div>
      <label className="block mb-1.5 text-[10px] uppercase font-semibold" style={{ color: 'var(--vv-text-subtle)', letterSpacing: 'var(--vv-tracking-label)' }}>
        {label}
      </label>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const active = selected.includes(o.key);
          return (
            <button
              key={o.key}
              type="button"
              onClick={() => toggle(o.key)}
              className="text-[12px] px-2.5 py-1 rounded-md transition-colors"
              style={{
                backgroundColor: active ? 'var(--vv-bg-dark)' : 'var(--vv-bg-surface)',
                color: active ? '#ffffff' : 'var(--vv-text)',
                border: `1px solid ${active ? 'var(--vv-bg-dark)' : 'var(--vv-border)'}`,
              }}
            >
              {o.label}
            </button>
          );
        })}
      </div>
      <p className="mt-1.5 text-[11px]" style={{ color: 'var(--vv-text-subtle)' }}>
        {selected.length === 0 ? 'Any' : selected.length === options.length ? 'All' : `${selected.length} selected`}
      </p>
    </div>
  );
}

function RuleForm({ initial, onCancel, onSubmit, submitting }) {
  const [name, setName]                 = useState(initial?.name ?? '');
  const [description, setDesc]          = useState(initial?.description ?? '');
  const [temperatures, setTemperatures] = useState(initial?.temperatures ?? []);
  const [statuses, setStatuses]         = useState(initial?.statuses ?? []);
  const [days, setDays]                 = useState(initial?.days ?? 7);
  const [notifyAssignee, setNA]         = useState(initial ? initial.notify_assignee : true);
  const [notifyRole, setNR]             = useState(initial?.notify_role ?? '');
  const [active, setActive]             = useState(initial ? initial.active : true);

  const submit = (e) => {
    e.preventDefault();
    onSubmit({
      name: name.trim(),
      description: description.trim() || null,
      temperatures: temperatures.length ? temperatures : null,
      statuses:     statuses.length     ? statuses     : null,
      days: Number(days) || 7,
      notify_assignee: notifyAssignee,
      notify_role: notifyRole || null,
      active,
    });
  };

  const inputStyle = {
    backgroundColor: 'var(--vv-bg-surface-muted)',
    border: '1px solid var(--vv-border)',
    borderRadius: 'var(--vv-radius-md)',
  };

  return (
    <form onSubmit={submit} className="space-y-4 text-[13px]">
      <div>
        <label className="block mb-1.5 text-[10px] uppercase font-semibold" style={{ color: 'var(--vv-text-subtle)', letterSpacing: 'var(--vv-tracking-label)' }}>Name</label>
        <input
          value={name} onChange={(e) => setName(e.target.value)} required maxLength={150}
          placeholder="e.g. Warm leads idle a week"
          className="w-full px-3 py-2 outline-none focus:ring-2 focus:ring-[var(--vv-bg-dark)]"
          style={inputStyle}
        />
      </div>

      <div>
        <label className="block mb-1.5 text-[10px] uppercase font-semibold" style={{ color: 'var(--vv-text-subtle)', letterSpacing: 'var(--vv-tracking-label)' }}>Description</label>
        <textarea
          value={description} onChange={(e) => setDesc(e.target.value)} rows={2}
          className="w-full px-3 py-2 outline-none focus:ring-2 focus:ring-[var(--vv-bg-dark)]"
          style={inputStyle}
        />
      </div>

      <MultiSelect
        label="If lead temperature is"
        options={LEAD_TEMPERATURES.map((t) => ({ key: t.key, label: t.label }))}
        selected={temperatures}
        onChange={setTemperatures}
      />

      <MultiSelect
        label="If lead status is"
        options={LEAD_STATUSES.map((s) => ({ key: s.key, label: s.label }))}
        selected={statuses}
        onChange={setStatuses}
      />

      <div>
        <label className="block mb-1.5 text-[10px] uppercase font-semibold" style={{ color: 'var(--vv-text-subtle)', letterSpacing: 'var(--vv-tracking-label)' }}>
          And no activity for at least
        </label>
        <div className="flex items-center gap-2">
          <input
            type="number" min={1} max={365} value={days}
            onChange={(e) => setDays(e.target.value)}
            className="w-20 px-3 py-2 outline-none focus:ring-2 focus:ring-[var(--vv-bg-dark)] tabular-nums"
            style={inputStyle}
          />
          <span style={{ color: 'var(--vv-text-muted)' }}>days</span>
        </div>
      </div>

      <div className="space-y-2">
        <label className="block text-[10px] uppercase font-semibold" style={{ color: 'var(--vv-text-subtle)', letterSpacing: 'var(--vv-tracking-label)' }}>
          Then notify
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={notifyAssignee} onChange={(e) => setNA(e.target.checked)} className="accent-[var(--vv-bg-dark)]" />
          <span>The lead's assigned user</span>
        </label>
        <div className="flex items-center gap-2">
          <span className="text-[12px]" style={{ color: 'var(--vv-text-muted)' }}>and / or</span>
          <select
            value={notifyRole} onChange={(e) => setNR(e.target.value)}
            className="px-2 py-1.5 text-[13px] outline-none focus:ring-2 focus:ring-[var(--vv-bg-dark)]"
            style={inputStyle}
          >
            {NOTIFY_ROLE_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        </div>
      </div>

      <label className="flex items-center gap-2">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="accent-[var(--vv-bg-dark)]" />
        <span>Active</span>
      </label>

      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={onCancel} className="px-3 py-1.5 text-[13px] rounded-md" style={{ border: '1px solid var(--vv-border)' }}>Cancel</button>
        <button type="submit" disabled={submitting} className="px-3 py-1.5 text-[13px] rounded-md text-white disabled:opacity-60" style={{ backgroundColor: 'var(--vv-bg-dark)' }}>
          {submitting ? 'Saving…' : 'Save rule'}
        </button>
      </div>
    </form>
  );
}

export default function SlaRulesPage() {
  const { user } = useAuth();
  const [rules, setRules]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [editing, setEditing]     = useState(null);
  const [submitting, setSubmit]   = useState(false);
  const [evaluating, setEval]     = useState(false);
  const [lastResult, setLastResult] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await api.get('/sla_rules');
      setRules(res.data.rules || []);
    } catch (err) {
      setError(extractApiError(err, 'Failed to load SLA rules'));
    } finally {
      setLoading(false);
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
    setSubmit(true);
    try {
      if (editing === 'new') await api.post('/sla_rules', payload);
      else if (editing && editing.id) await api.patch('/sla_rules', { id: editing.id, ...payload });
      setEditing(null);
      load();
    } catch (err) {
      setError(extractApiError(err, 'Save failed'));
    } finally { setSubmit(false); }
  };

  const deleteRule = async (rule) => {
    if (!confirm(`Delete rule "${rule.name}"? Rules with existing alerts are deactivated instead.`)) return;
    try {
      await api.delete('/sla_rules', { data: { id: rule.id } });
      load();
    } catch (err) {
      setError(extractApiError(err, 'Delete failed'));
    }
  };

  const toggleActive = async (rule) => {
    try {
      await api.patch('/sla_rules', { id: rule.id, active: !rule.active });
      load();
    } catch (err) {
      setError(extractApiError(err, 'Update failed'));
    }
  };

  const runEval = async () => {
    setEval(true); setLastResult(null);
    try {
      const res = await api.post('/sla_evaluate', {});
      setLastResult(res.data.summary);
    } catch (err) {
      setError(extractApiError(err, 'Evaluation failed'));
    } finally { setEval(false); }
  };

  const describePredicate = (r) => {
    const parts = [];
    if (r.temperatures.length) parts.push(`temp ∈ {${r.temperatures.join(', ')}}`);
    if (r.statuses.length)     parts.push(`status ∈ {${r.statuses.join(', ')}}`);
    parts.push(`no activity for ${r.days}d`);
    return parts.join(' · ');
  };

  const describeNotify = (r) => {
    const parts = [];
    if (r.notify_assignee) parts.push('assignee');
    if (r.notify_role)     parts.push(r.notify_role + 's');
    return parts.length ? parts.join(' + ') : '— nobody —';
  };

  return (
    <div className="max-w-[1600px] mx-auto">
      <div className="flex items-start justify-between mb-5 gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">SLA rules</h1>
          <p className="text-[12px] mt-0.5" style={{ color: 'var(--vv-text-muted)' }}>
            Surface leads that have gone quiet. Rules fire when matching leads see no activity for the configured window;
            alerts auto-resolve when something happens on the lead.
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={runEval}
            disabled={evaluating}
            className="px-3 py-1.5 text-[13px] rounded-md disabled:opacity-60"
            style={{ border: '1px solid var(--vv-border)' }}
          >
            {evaluating ? 'Running…' : 'Run evaluator now'}
          </button>
          <button
            onClick={() => setEditing('new')}
            className="px-3 py-1.5 text-[13px] rounded-md text-white"
            style={{ backgroundColor: 'var(--vv-bg-dark)' }}
          >
            + New rule
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 px-4 py-2 rounded-md text-[13px]" style={{ backgroundColor: '#FEE2E2', color: 'var(--vv-status-danger)', border: '1px solid #FECACA' }}>
          {error}
        </div>
      )}

      {lastResult && (
        <div
          className="mb-4 px-4 py-2 rounded-md text-[13px]"
          style={{
            backgroundColor: '#DCFCE7',
            color: 'var(--vv-status-success)',
            border: '1px solid #BBF7D0',
          }}
        >
          Evaluated {lastResult.rules_evaluated} rule(s); fired {lastResult.alerts_fired} alert(s).
        </div>
      )}

      <div
        className="overflow-hidden"
        style={{ backgroundColor: 'var(--vv-bg-surface)', border: '1px solid var(--vv-border)', borderRadius: 'var(--vv-radius-lg)' }}
      >
        {loading ? (
          <div className="py-10 text-center text-[13px]" style={{ color: 'var(--vv-text-muted)' }}>Loading…</div>
        ) : rules.length === 0 ? (
          <div className="py-10 text-center text-[13px]" style={{ color: 'var(--vv-text-muted)' }}>
            No SLA rules yet. Click <span className="font-medium" style={{ color: 'var(--vv-text)' }}>+ New rule</span> to add the first.
          </div>
        ) : (
          <table className="w-full text-[13px]">
            <thead style={{ backgroundColor: 'var(--vv-bg-surface-muted)' }}>
              <tr style={{ borderBottom: '1px solid var(--vv-border)' }}>
                <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase" style={{ color: 'var(--vv-text-muted)', letterSpacing: 'var(--vv-tracking-label)' }}>Rule</th>
                <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase" style={{ color: 'var(--vv-text-muted)', letterSpacing: 'var(--vv-tracking-label)' }}>Predicate</th>
                <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase" style={{ color: 'var(--vv-text-muted)', letterSpacing: 'var(--vv-tracking-label)' }}>Notifies</th>
                <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase" style={{ color: 'var(--vv-text-muted)', letterSpacing: 'var(--vv-tracking-label)' }}>Active</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id} style={{ borderBottom: '1px solid var(--vv-border)' }}>
                  <td className="px-4 py-2">
                    <div className="font-medium">{r.name}</div>
                    {r.description && <div className="text-[11px]" style={{ color: 'var(--vv-text-muted)' }}>{r.description}</div>}
                  </td>
                  <td className="px-4 py-2 font-mono text-[12px]" style={{ color: 'var(--vv-text-muted)' }}>{describePredicate(r)}</td>
                  <td className="px-4 py-2 text-[12px]">{describeNotify(r)}</td>
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
                    <button onClick={() => setEditing(r)} className="text-[12px] px-2 py-1 mr-1 rounded" style={{ color: 'var(--vv-text)' }}>Edit</button>
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
        title={editing === 'new' ? 'New SLA rule' : `Edit: ${editing?.name ?? ''}`}
        onClose={() => setEditing(null)}
      >
        <RuleForm
          initial={editing === 'new' ? null : editing}
          onCancel={() => setEditing(null)}
          onSubmit={submitRule}
          submitting={submitting}
        />
      </Modal>
    </div>
  );
}

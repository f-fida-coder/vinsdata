import { useState } from 'react';
import { LEAD_STATUSES, LEAD_PRIORITIES } from '../lib/crm';
import { TASK_TYPES } from '../lib/tasks';

// ---------- Action catalog ----------

const ACTIONS = [
  { key: 'set_status',         label: 'Change status',     tone: 'blue',    adminOnly: false },
  { key: 'set_priority',       label: 'Change priority',   tone: 'amber',   adminOnly: false },
  { key: 'assign',             label: 'Assign agent',      tone: 'emerald', adminOnly: true },
  { key: 'add_label',          label: 'Add label',         tone: 'violet',  adminOnly: false },
  { key: 'remove_label',       label: 'Remove label',      tone: 'gray',    adminOnly: false },
  { key: 'create_task',        label: 'Create task',       tone: 'indigo',  adminOnly: false },
  { key: 'send_to_marketing',  label: 'Send to marketing', tone: 'fuchsia', adminOnly: false },
];

const BUTTON_TONE = {
  blue:    'text-blue-700 bg-blue-50 hover:bg-blue-100 border-zinc-200',
  amber:   'text-amber-700 bg-amber-50 hover:bg-amber-100 border-amber-100',
  emerald: 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border-emerald-100',
  violet:  'text-violet-700 bg-violet-50 hover:bg-violet-100 border-violet-100',
  indigo:  'text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border-indigo-100',
  gray:    'text-gray-700 bg-gray-50 hover:bg-gray-100 border-gray-200',
  fuchsia: 'text-fuchsia-700 bg-fuchsia-50 hover:bg-fuchsia-100 border-fuchsia-100',
};

// ---------- Sticky selection bar ----------

export function BulkActionsBar({ selection, onClear, onAction, user }) {
  const count = selection.size;
  if (count === 0) return null;
  const isAdmin = user?.role === 'admin';

  return (
    <div className="sticky top-0 z-20 bg-blue-50 border border-zinc-200 rounded-xl px-3 sm:px-4 py-2.5 mb-3 flex flex-wrap items-center gap-2 shadow-sm">
      <div className="flex items-center gap-2 mr-1">
        <div className="w-6 h-6 rounded-md bg-[var(--vv-bg-dark)] text-white flex items-center justify-center text-[11px] font-bold">{count}</div>
        <span className="text-sm font-medium text-blue-800">selected</span>
      </div>
      <div className="h-5 w-px bg-blue-200" />
      {ACTIONS.map((a) => {
        const disabled = a.adminOnly && !isAdmin;
        return (
          <button
            key={a.key}
            disabled={disabled}
            title={disabled ? 'Admin only' : undefined}
            onClick={() => onAction(a.key)}
            className={`inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-md border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${BUTTON_TONE[a.tone]}`}
          >
            {a.label}
          </button>
        );
      })}
      <button onClick={onClear} className="text-xs text-blue-500 hover:underline ml-auto">Clear selection</button>
    </div>
  );
}

// ---------- Action modal ----------

function ModalShell({ title, onClose, children, submitLabel = 'Apply', onSubmit, submitting, submitDisabled, destructive = false }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-gray-900/60" />
      <div className="relative bg-white w-full max-w-md sm:rounded-2xl rounded-t-2xl shadow-2xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <h2 className="text-base font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100">&times;</button>
        </div>
        <div className="px-5 py-4 overflow-y-auto space-y-3">{children}</div>
        <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2 shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-50 hover:bg-gray-100 rounded-lg">Cancel</button>
          <button
            onClick={onSubmit}
            disabled={submitDisabled || submitting}
            className={`px-4 py-2 text-sm font-medium text-white rounded-lg shadow disabled:opacity-40 ${destructive ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}`}
          >
            {submitting ? 'Working…' : submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, required, children }) {
  return (
    <label className="block">
      <span className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">
        {label} {required && <span className="text-red-500">*</span>}
      </span>
      {children}
    </label>
  );
}

function initialPayloadFor(action) {
  switch (action) {
    case 'set_status':        return { status: 'new' };
    case 'set_priority':      return { priority: 'medium' };
    case 'assign':            return { assigned_user_id: '' };
    case 'add_label':
    case 'remove_label':      return { label_id: '' };
    case 'create_task':       return { title: '', task_type: 'follow_up', notes: '', due_at: '', assigned_user_id: '' };
    case 'send_to_marketing': return {};
    default:                  return {};
  }
}

function BulkActionModalInner({ action, count, onClose, onSubmit, submitting, options }) {
  const [payload, setPayload] = useState(() => initialPayloadFor(action));

  const title = (() => {
    switch (action) {
      case 'set_status':        return `Change status (${count} leads)`;
      case 'set_priority':      return `Change priority (${count} leads)`;
      case 'assign':            return `Assign agent (${count} leads)`;
      case 'add_label':         return `Add label (${count} leads)`;
      case 'remove_label':      return `Remove label (${count} leads)`;
      case 'create_task':       return `Create task (${count} leads)`;
      case 'send_to_marketing': return `Send to marketing (${count} leads)`;
      default:                  return 'Bulk action';
    }
  })();

  const handleSubmit = () => {
    // Normalize payload shape for the API.
    const out = { ...payload };
    if (action === 'assign') {
      out.assigned_user_id = out.assigned_user_id === '' ? null : Number(out.assigned_user_id);
    }
    if (action === 'create_task') {
      out.title = (out.title || '').trim();
      out.notes = (out.notes || '').trim() || null;
      out.due_at = out.due_at || null;
      out.assigned_user_id = out.assigned_user_id === '' ? null : Number(out.assigned_user_id);
    }
    if (action === 'add_label' || action === 'remove_label') {
      out.label_id = Number(out.label_id);
    }
    onSubmit(out);
  };

  // Per-action validity
  let submitDisabled = false;
  if (action === 'add_label' || action === 'remove_label') submitDisabled = !payload.label_id;
  if (action === 'create_task') submitDisabled = !(payload.title && payload.title.trim());

  const destructive = action === 'remove_label';
  const unassigning = action === 'assign' && (payload.assigned_user_id === '' || payload.assigned_user_id == null);

  return (
    <ModalShell
      title={title}
      onClose={onClose}
      onSubmit={handleSubmit}
      submitting={submitting}
      submitDisabled={submitDisabled}
      submitLabel={destructive ? 'Remove from all' : 'Apply'}
      destructive={destructive}
    >
      <div className="bg-blue-50 border border-zinc-200 rounded-lg p-2.5 text-xs text-blue-800">
        This will affect <strong>{count}</strong> {count === 1 ? 'lead' : 'leads'}. Unchanged leads are skipped silently.
      </div>

      {action === 'send_to_marketing' && (
        <div className="rounded-lg bg-fuchsia-50 border border-fuchsia-100 px-3 py-3 text-sm text-fuchsia-900">
          <p className="font-medium mb-1">Move these leads into mass marketing?</p>
          <p className="text-xs text-fuchsia-800">
            Their status will change to <strong>Marketing</strong>. They'll be excluded from cold-call queues
            and become eligible for email/SMS campaigns. You can move them back anytime by changing the status.
          </p>
        </div>
      )}

      {action === 'set_status' && (
        <Field label="New status" required>
          <select
            value={payload.status || 'new'}
            onChange={(e) => setPayload({ ...payload, status: e.target.value })}
            className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm"
          >
            {LEAD_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </Field>
      )}

      {action === 'set_priority' && (
        <Field label="New priority" required>
          <select
            value={payload.priority || 'medium'}
            onChange={(e) => setPayload({ ...payload, priority: e.target.value })}
            className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm"
          >
            {LEAD_PRIORITIES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
        </Field>
      )}

      {action === 'assign' && (
        <>
          <Field label="Agent">
            <select
              value={payload.assigned_user_id ?? ''}
              onChange={(e) => setPayload({ ...payload, assigned_user_id: e.target.value })}
              className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm"
            >
              <option value="">Unassigned</option>
              {(options.users || []).map((u) => (
                <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
              ))}
            </select>
          </Field>
          {unassigning && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-md px-2 py-1.5">
              Selecting "Unassigned" will clear the agent on {count} {count === 1 ? 'lead' : 'leads'}.
            </p>
          )}
        </>
      )}

      {(action === 'add_label' || action === 'remove_label') && (
        <Field label="Label" required>
          <select
            value={payload.label_id || ''}
            onChange={(e) => setPayload({ ...payload, label_id: e.target.value })}
            className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm"
          >
            <option value="">Select a label…</option>
            {(options.labels || []).map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </Field>
      )}

      {action === 'create_task' && (
        <>
          <Field label="Title" required>
            <input
              type="text"
              value={payload.title || ''}
              onChange={(e) => setPayload({ ...payload, title: e.target.value })}
              maxLength={255}
              placeholder="e.g. Follow up with interested leads"
              className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm"
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="Type">
              <select
                value={payload.task_type || 'follow_up'}
                onChange={(e) => setPayload({ ...payload, task_type: e.target.value })}
                className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm"
              >
                {TASK_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
            </Field>
            <Field label="Due at">
              <input
                type="datetime-local"
                value={payload.due_at || ''}
                onChange={(e) => setPayload({ ...payload, due_at: e.target.value })}
                className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm"
              />
            </Field>
          </div>
          <Field label="Assign each task to">
            <select
              value={payload.assigned_user_id ?? ''}
              onChange={(e) => setPayload({ ...payload, assigned_user_id: e.target.value })}
              className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm"
            >
              <option value="">Unassigned</option>
              {(options.users || []).map((u) => (
                <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
              ))}
            </select>
          </Field>
          <Field label="Notes">
            <textarea
              value={payload.notes || ''}
              onChange={(e) => setPayload({ ...payload, notes: e.target.value })}
              rows={2}
              maxLength={5000}
              placeholder="Shared context (optional)"
              className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm"
            />
          </Field>
          <p className="text-[11px] text-gray-500">
            Creates one task per selected lead. Each task is logged as its own activity on its lead.
          </p>
        </>
      )}
    </ModalShell>
  );
}

export function BulkActionModal({ open, action, ...rest }) {
  if (!open || !action) return null;
  return <BulkActionModalInner key={action} action={action} {...rest} />;
}

// ---------- Result modal ----------

export function BulkResultModal({ result, onClose, onRefresh }) {
  const [showFailures, setShowFailures] = useState(false);
  if (!result) return null;
  const { total, succeeded, failed, skipped } = result;
  const failures = (result.results || []).filter((r) => !r.ok);

  return (
    <ModalShell
      title="Bulk action complete"
      onClose={() => { onClose(); onRefresh?.(); }}
      onSubmit={() => { onClose(); onRefresh?.(); }}
      submitLabel="Close"
    >
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-lg border border-emerald-100 bg-emerald-50 p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700">Succeeded</p>
          <p className="text-2xl font-bold text-emerald-700 mt-1">{succeeded}</p>
        </div>
        <div className={`rounded-lg border p-3 ${skipped > 0 ? 'border-gray-200 bg-gray-50' : 'border-gray-100 bg-white'}`}>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Skipped</p>
          <p className="text-2xl font-bold text-gray-700 mt-1">{skipped}</p>
        </div>
        <div className={`rounded-lg border p-3 ${failed > 0 ? 'border-red-100 bg-red-50' : 'border-gray-100 bg-white'}`}>
          <p className={`text-[10px] font-semibold uppercase tracking-wider ${failed > 0 ? 'text-red-700' : 'text-gray-500'}`}>Failed</p>
          <p className={`text-2xl font-bold mt-1 ${failed > 0 ? 'text-red-700' : 'text-gray-400'}`}>{failed}</p>
        </div>
      </div>
      <p className="text-xs text-gray-500">Total requested: {total}. Skipped rows were unchanged — no-ops don't generate activity.</p>

      {failures.length > 0 && (
        <div>
          <button
            onClick={() => setShowFailures((v) => !v)}
            className="text-xs font-medium text-red-600 hover:text-red-800"
          >
            {showFailures ? 'Hide' : `Show ${failures.length} failure${failures.length === 1 ? '' : 's'}`}
          </button>
          {showFailures && (
            <ul className="mt-2 space-y-1 max-h-40 overflow-y-auto border border-red-100 rounded-md p-2 bg-red-50/40">
              {failures.map((f, i) => (
                <li key={i} className="text-[11px] text-red-700">
                  <span className="font-mono">Lead #{f.lead_id}</span> — <span className="font-semibold">{f.code}</span>: {f.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </ModalShell>
  );
}

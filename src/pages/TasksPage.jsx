import { useState, useEffect, useCallback, useMemo } from 'react';
import api, { extractApiError } from '../api';
import { useAuth } from '../context/AuthContext';
import LeadDetailDrawer from '../components/LeadDetailDrawer';
import { TASK_TYPES, TASK_TYPE_BY_KEY, relativeDue, isOverdue, isDueToday } from '../lib/tasks';
import { Icon, Avatar, Button } from '../components/ui';

const QUEUES = [
  { key: 'mine_open', label: 'My tasks',  hint: 'Tasks assigned to you' },
  { key: 'due_today', label: 'Due today', hint: 'Open tasks due today' },
  { key: 'overdue',   label: 'Overdue',   hint: 'Tasks past their due date' },
  { key: 'all_open',  label: 'All open',  hint: 'Every open task across the team' },
];

const TYPE_ICON = {
  callback:       'phone',
  follow_up:      'arrowRight',
  review:         'eye',
  verify_contact: 'check',
  custom:         'tag',
};
const TYPE_COLOR = {
  callback:       'var(--info)',
  follow_up:      'var(--warm)',
  review:         'var(--cold)',
  verify_contact: 'var(--success)',
  custom:         'var(--text-2)',
};

const HERO_TILES = [
  { key: 'open_tasks',       label: 'Open',         icon: 'check',  tone: 'cold',   queue: 'mine_open' },
  { key: 'tasks_due_today',  label: 'Due today',    icon: 'clock',  tone: 'warm',   queue: 'due_today' },
  { key: 'tasks_overdue',    label: 'Overdue',      icon: 'fire',   tone: 'danger', queue: 'overdue' },
  { key: 'unassigned',       label: 'Unassigned',   icon: 'user',   tone: 'info',   queue: null },
];

const TONE_VAR = {
  accent: 'var(--accent)',
  info:   'var(--info)',
  warm:   'var(--warm)',
  cold:   'var(--cold)',
  hot:    'var(--hot)',
  danger: 'var(--danger)',
  success: 'var(--success)',
};

function HeroTile({ label, value, icon, tone, active, onClick }) {
  const color = TONE_VAR[tone] || 'var(--text-1)';
  return (
    <button
      type="button"
      className={`tk-tile ${active ? 'is-active' : ''} ${onClick ? 'is-clickable' : ''}`}
      style={{ '--tile-color': color }}
      onClick={onClick}
      disabled={!onClick}
    >
      <span className="tk-tile-icon">
        <Icon name={icon} size={16}/>
      </span>
      <span className="tk-tile-body">
        <span className="tk-tile-label">{label}</span>
        <span className="tk-tile-value">{Number(value || 0).toLocaleString()}</span>
      </span>
    </button>
  );
}

function TaskRow({ task, onComplete, onOpenLead, currentUserId }) {
  const overdue = isOverdue(task.due_at) && !task.completed_at;
  const dueToday = isDueToday(task.due_at);
  const typeMeta = TASK_TYPE_BY_KEY[task.task_type] || {};
  const typeColor = TYPE_COLOR[task.task_type] || 'var(--text-2)';
  const typeIcon = TYPE_ICON[task.task_type] || 'tag';
  const isMine = Number(task.assigned_user_id) === Number(currentUserId);

  return (
    <div
      className={`tk-row ${overdue ? 'is-overdue' : ''} ${dueToday ? 'is-due-today' : ''}`}
      onClick={onOpenLead}
    >
      <button
        type="button"
        className="tk-check"
        onClick={(e) => { e.stopPropagation(); onComplete(task.id); }}
        title="Mark complete"
        aria-label="Mark complete"
      >
        <Icon name="check" size={12}/>
      </button>

      <div className="tk-type" style={{ '--type-color': typeColor }}>
        <Icon name={typeIcon} size={13}/>
      </div>

      <div className="tk-main">
        <div className="tk-title-row">
          <span className="tk-title">{task.title}</span>
          {typeMeta.label && <span className="tk-typebadge">{typeMeta.label}</span>}
        </div>
        {task.notes && <div className="tk-notes">{task.notes}</div>}
      </div>

      <div className="tk-lead">
        <span className="tk-lead-name">{task.lead?.display_name || `Lead #${task.imported_lead_id}`}</span>
        {task.lead?.phone && <span className="tk-lead-phone">{task.lead.phone}</span>}
      </div>

      <div className="tk-due">
        {task.due_at ? (
          <>
            <span className={`tk-due-rel ${overdue ? 'is-overdue' : dueToday ? 'is-today' : ''}`}>
              {relativeDue(task.due_at)}
            </span>
            <span className="tk-due-abs">{formatDateTime(task.due_at)}</span>
          </>
        ) : (
          <span className="tk-due-empty">No due date</span>
        )}
      </div>

      <div className="tk-assignee">
        {task.assigned_user_name ? (
          <>
            <Avatar name={task.assigned_user_name} size={20}/>
            <span className="tk-assignee-name">{task.assigned_user_name}{isMine && <span className="tk-you">you</span>}</span>
          </>
        ) : (
          <>
            <span className="tk-avatar-empty"/>
            <span className="tk-assignee-name tk-unassigned">Unassigned</span>
          </>
        )}
      </div>

      <div className="tk-actions" onClick={(e) => e.stopPropagation()}>
        <Button variant="ghost" size="sm" icon="check" onClick={() => onComplete(task.id)}>Done</Button>
      </div>
    </div>
  );
}

function formatDateTime(s) {
  if (!s) return '';
  const d = new Date(String(s).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function TasksPage() {
  const { user } = useAuth();
  const [queue, setQueue] = useState('mine_open');
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState(null);
  const [detailId, setDetailId] = useState(null);
  // New-task modal state. `newTaskOpen` toggles the modal.
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [users, setUsers] = useState([]);
  useEffect(() => {
    // Loaded once for the assignee dropdown. Lives in
    // /api/lead_filter_options (no admin gate, same shape as elsewhere).
    let cancelled = false;
    api.get('/lead_filter_options')
      .then((r) => { if (!cancelled) setUsers(Array.isArray(r.data?.users) ? r.data.users : []); })
      .catch(() => { /* non-blocking; dropdown will be empty if it fails */ });
    return () => { cancelled = true; };
  }, []);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/lead_tasks', { params: { queue, limit: 500 } });
      setTasks(res.data || []);
      setError('');
    } catch (err) {
      setError(extractApiError(err, 'Failed to load tasks'));
    } finally {
      setLoading(false);
    }
  }, [queue]);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  const fetchSummary = useCallback(async () => {
    try {
      const res = await api.get('/reports', { params: { type: 'leads' } });
      setSummary(res.data?.leads || null);
    } catch { /* non-blocking */ }
  }, []);
  useEffect(() => { fetchSummary(); }, [fetchSummary]);

  const complete = async (id) => {
    if (!window.confirm('Mark this task as complete?')) return;
    try {
      await api.patch('/lead_tasks', { id, action: 'complete' });
      fetchTasks(); fetchSummary();
    } catch (err) {
      setError(extractApiError(err, 'Failed to complete task'));
    }
  };

  const queueCounts = useMemo(() => ({
    mine_open: summary?.open_tasks_mine ?? null,
    due_today: summary?.tasks_due_today ?? 0,
    overdue:   summary?.tasks_overdue ?? 0,
    all_open:  summary?.open_tasks ?? 0,
  }), [summary]);

  const activeQueue = QUEUES.find((q) => q.key === queue) || QUEUES[0];

  return (
    <div className="page tasks-page">
      <div className="tk-header">
        <div>
          <h1 className="section-title">Tasks</h1>
          <p className="section-subtitle">{activeQueue.hint}</p>
        </div>
        <Button variant="primary" icon="plus" onClick={() => setNewTaskOpen(true)}>
          New task
        </Button>
      </div>

      {/* Hero tiles — clickable, jump to the matching queue */}
      <div className="tk-hero">
        {HERO_TILES.map((t) => (
          <HeroTile
            key={t.key}
            label={t.label}
            value={summary?.[t.key]}
            icon={t.icon}
            tone={t.tone}
            active={t.queue === queue}
            onClick={t.queue ? () => setQueue(t.queue) : undefined}
          />
        ))}
      </div>

      {error && (
        <div className="card" style={{ marginBottom: 16, color: 'var(--danger)', borderColor: 'var(--danger)' }}>{error}</div>
      )}

      {/* Tabs with count badges */}
      <div className="tk-tabs">
        {QUEUES.map((q) => {
          const count = queueCounts[q.key];
          return (
            <button
              key={q.key}
              type="button"
              className={`tk-tab ${queue === q.key ? 'is-active' : ''}`}
              onClick={() => setQueue(q.key)}
            >
              <span>{q.label}</span>
              {count != null && count > 0 && <span className="tk-tab-count">{Number(count).toLocaleString()}</span>}
            </button>
          );
        })}
      </div>

      <div className="tk-card">
        {loading ? (
          <div className="tk-loading">
            <div className="vv-spinner"/>
            <p>Loading tasks…</p>
          </div>
        ) : tasks.length === 0 ? (
          <EmptyTasks queue={queue}/>
        ) : (
          <div className="tk-list">
            <div className="tk-list-head">
              <span/>
              <span/>
              <span>Task</span>
              <span>Lead</span>
              <span>Due</span>
              <span>Assignee</span>
              <span/>
            </div>
            {tasks.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                currentUserId={user?.id}
                onComplete={complete}
                onOpenLead={() => setDetailId(t.imported_lead_id)}
              />
            ))}
          </div>
        )}
      </div>

      <LeadDetailDrawer
        leadId={detailId}
        onClose={() => setDetailId(null)}
        onChanged={() => { fetchTasks(); fetchSummary(); }}
      />

      {newTaskOpen && (
        <NewTaskModal
          users={users}
          currentUserId={user?.id}
          onClose={() => setNewTaskOpen(false)}
          onCreated={() => { setNewTaskOpen(false); fetchTasks(); fetchSummary(); }}
        />
      )}
    </div>
  );
}

// ---- New-task modal -----------------------------------------------------
// Two-step flow:
//   1. Pick a lead (debounced /api/leads?q search). Required by the API.
//   2. Fill task details (title, type, due, assignee, notes) and save.
// Assignee dropdown defaults to the current operator but accepts any
// user in /api/lead_filter_options so admins can assign to anyone.
function NewTaskModal({ users, currentUserId, onClose, onCreated }) {
  const [step, setStep]       = useState('pick'); // 'pick' | 'fill'
  const [picked, setPicked]   = useState(null);
  const [q, setQ]             = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [saving, setSaving]   = useState(false);

  // Form fields
  const [title, setTitle]   = useState('');
  const [type, setType]     = useState('follow_up');
  const [dueAt, setDueAt]   = useState('');
  const [assignee, setAssignee] = useState(currentUserId ?? '');
  const [notes, setNotes]   = useState('');

  // Debounced lead search.
  useEffect(() => {
    if (step !== 'pick') return;
    let cancelled = false;
    const handle = setTimeout(() => {
      setLoading(true); setError('');
      const params = { per_page: 10, page: 1 };
      if (q.trim() !== '') params.q = q.trim();
      api.get('/leads', { params })
        .then((res) => { if (!cancelled) setResults(res.data?.leads || []); })
        .catch((err) => { if (!cancelled) setError(extractApiError(err, 'Lead search failed')); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 200);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [q, step]);

  const fmtLead = (lead) => {
    const np = lead.normalized_payload || {};
    const name = np.full_name
      || [np.first_name, np.last_name].filter(Boolean).join(' ')
      || `Lead #${lead.id}`;
    const vehicle = [np.year, np.make, np.model].filter(Boolean).join(' ');
    return { name, vehicle, vin: np.vin };
  };

  const save = async () => {
    if (!picked || title.trim() === '') return;
    setSaving(true); setError('');
    try {
      const payload = {
        lead_id:          picked.id,
        title:            title.trim(),
        task_type:        type,
        assigned_user_id: assignee === '' ? null : Number(assignee),
      };
      if (dueAt) payload.due_at = dueAt;
      if (notes.trim()) payload.notes = notes.trim();
      await api.post('/lead_tasks', payload);
      onCreated?.();
    } catch (err) {
      setError(extractApiError(err, 'Failed to create task'));
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'w-full bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-2 text-[13px] focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none';
  const labelCls = 'block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div className="relative bg-white max-w-xl w-full rounded-2xl shadow-2xl flex flex-col max-h-[85vh]" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-gray-900">
              {step === 'pick' ? 'New task' : `New task — ${fmtLead(picked).name}`}
            </h3>
            <p className="text-[11px] text-gray-500 mt-0.5">
              {step === 'pick'
                ? 'Pick the lead this task belongs to, then fill the details.'
                : 'Set the title, due date, and assignee. Assign to anyone on the team.'}
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100">&times;</button>
        </div>

        {step === 'pick' && (
          <>
            <div className="px-5 pt-4 pb-3">
              <input
                type="text"
                autoFocus
                placeholder="Search by name, VIN, phone, email, vehicle…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className={inputCls}
              />
            </div>
            {error && <div className="mx-5 mb-3 bg-red-50 border border-red-100 text-red-700 rounded-lg p-2 text-xs">{error}</div>}
            <div className="px-3 pb-3 overflow-y-auto flex-1">
              {loading ? (
                <div className="text-center text-xs text-gray-400 py-6">Searching…</div>
              ) : results.length === 0 ? (
                <div className="text-center text-xs text-gray-400 py-6">No leads match.</div>
              ) : (
                <ul className="space-y-1">
                  {results.map((lead) => {
                    const meta = fmtLead(lead);
                    return (
                      <li key={lead.id}>
                        <button
                          type="button"
                          onClick={() => { setPicked(lead); setStep('fill'); }}
                          className="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-50 border border-transparent hover:border-gray-200 transition"
                        >
                          <div className="text-[13px] font-medium text-gray-900">{meta.name}</div>
                          <div className="text-[11px] text-gray-500 mt-0.5">
                            {meta.vehicle || '—'}{meta.vin ? ` · ${meta.vin}` : ''}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </>
        )}

        {step === 'fill' && (
          <>
            <div className="px-5 pt-4 pb-3 overflow-y-auto flex-1 space-y-3">
              {error && <div className="bg-red-50 border border-red-100 text-red-700 rounded-lg p-2 text-xs">{error}</div>}
              <div>
                <label className={labelCls}>Title</label>
                <input
                  type="text"
                  autoFocus
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Call back about ZR1 offer"
                  className={inputCls}
                  maxLength={255}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={labelCls}>Type</label>
                  <select value={type} onChange={(e) => setType(e.target.value)} className={inputCls}>
                    {TASK_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Due</label>
                  <input
                    type="datetime-local"
                    value={dueAt}
                    onChange={(e) => setDueAt(e.target.value)}
                    className={inputCls}
                  />
                </div>
              </div>
              <div>
                <label className={labelCls}>Assigned to</label>
                <select value={assignee} onChange={(e) => setAssignee(e.target.value)} className={inputCls}>
                  <option value="">Unassigned</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}{u.role ? ` · ${u.role}` : ''}{u.id === currentUserId ? ' (me)' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelCls}>Notes</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  placeholder="Optional"
                  className={inputCls}
                  maxLength={5000}
                />
              </div>
            </div>
            <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setStep('pick')}
                className="px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-900"
              >
                ← Change lead
              </button>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 rounded-md"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={save}
                  disabled={saving || title.trim() === ''}
                  className="px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-md disabled:opacity-40"
                >
                  {saving ? 'Creating…' : 'Create task'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function EmptyTasks({ queue }) {
  const titles = {
    mine_open: 'You’re all caught up',
    due_today: 'Nothing due today',
    overdue:   'No overdue tasks',
    all_open:  'No open tasks',
  };
  const bodies = {
    mine_open: 'You have no open tasks. Great work — go close some leads.',
    due_today: 'Today’s plate is clear. Time to get ahead on tomorrow.',
    overdue:   'Inbox zero on overdue. Keep it that way.',
    all_open:  'The whole team is caught up. Nice.',
  };
  return (
    <div className="tk-empty">
      <div className="tk-empty-icon"><Icon name="check" size={28}/></div>
      <h3 className="tk-empty-title">{titles[queue] || 'No tasks'}</h3>
      <p className="tk-empty-body">{bodies[queue] || ''}</p>
    </div>
  );
}

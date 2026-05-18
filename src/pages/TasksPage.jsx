import { useState, useEffect, useCallback, useMemo } from 'react';
import api, { extractApiError } from '../api';
import { useAuth } from '../context/AuthContext';
import LeadDetailDrawer from '../components/LeadDetailDrawer';
import { TASK_TYPE_BY_KEY, relativeDue, isOverdue, isDueToday } from '../lib/tasks';
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

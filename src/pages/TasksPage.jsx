import { useState, useEffect, useCallback } from 'react';
import api, { extractApiError } from '../api';
import { useAuth } from '../context/AuthContext';
import LeadDetailDrawer from '../components/LeadDetailDrawer';
import { TASK_TYPE_BY_KEY, relativeDue, isOverdue } from '../lib/tasks';
import { SectionHeader, KPI, Button, Avatar, EmptyState, PriorityChip, StatusBadge } from '../components/ui';

const QUEUES = [
  { key: 'mine_open',  label: 'My open tasks' },
  { key: 'due_today',  label: 'Due today' },
  { key: 'overdue',    label: 'Overdue' },
  { key: 'all_open',   label: 'All open' },
];

function formatDateTime(s) {
  if (!s) return '—';
  const d = new Date(String(s).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString();
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

  const queueHint = {
    mine_open: 'Tasks assigned to you that are still open.',
    due_today: 'All open tasks with a due date today.',
    overdue:   'Open tasks whose due date has already passed.',
    all_open:  'Every open task across the team.',
  }[queue] || '';

  return (
    <div className="page">
      <SectionHeader
        title="Tasks"
        subtitle={queueHint}
      />

      {summary && (
        <div className="kpi-row" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
          <KPI label="Open Tasks" value={summary.open_tasks ?? 0} dot="var(--text-2)"/>
          <KPI label="Due Today" value={summary.tasks_due_today ?? 0} dot="var(--warm)"/>
          <KPI label="Overdue" value={summary.tasks_overdue ?? 0} dot="var(--hot)"/>
          <KPI label="Unassigned leads" value={summary.unassigned ?? 0} dot="var(--cold)"/>
        </div>
      )}

      {error && (
        <div className="card" style={{ marginBottom: 16, color: 'var(--danger)', borderColor: 'var(--danger)' }}>{error}</div>
      )}

      <div className="vv-tabs">
        {QUEUES.map((q) => (
          <span key={q.key} className={`vv-tab ${queue === q.key ? 'active' : ''}`} onClick={() => setQueue(q.key)}>
            {q.label}
          </span>
        ))}
      </div>

      <div className="tbl-wrap">
        {loading ? (
          <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-3)' }}>Loading…</div>
        ) : tasks.length === 0 ? (
          <EmptyState
            icon="check"
            title={queue === 'mine_open' ? 'You have no tasks here' : 'No tasks match this queue'}
            body={queue === 'mine_open' ? 'Great work — go close some leads.' : ''}
          />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th className="tbl-checkbox"><input type="checkbox"/></th>
                <th>Task</th>
                <th>Lead</th>
                <th>Type</th>
                <th>Due</th>
                <th>Assignee</th>
                <th>Created by</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => {
                const overdue = isOverdue(t.due_at);
                const typeMeta = TASK_TYPE_BY_KEY[t.task_type] || {};
                return (
                  <tr key={t.id} onClick={() => setDetailId(t.imported_lead_id)} style={overdue ? { background: 'rgba(180, 38, 30, 0.04)' } : undefined}>
                    <td className="tbl-checkbox" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox"/>
                    </td>
                    <td>
                      <div className="cell-strong">{t.title}</div>
                      {t.notes && <div className="cell-muted" style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.notes}</div>}
                    </td>
                    <td>
                      <div className="cell-strong">{t.lead?.display_name || `Lead #${t.imported_lead_id}`}</div>
                      {t.lead?.phone && <div className="cell-muted">{t.lead.phone}</div>}
                    </td>
                    <td><span className="status-badge sb-neutral">{typeMeta.label || t.task_type}</span></td>
                    <td>
                      {t.due_at ? (
                        <div>
                          <div style={{ color: overdue ? 'var(--danger)' : 'var(--text-1)', fontWeight: overdue ? 500 : 400 }}>
                            {relativeDue(t.due_at)}{overdue ? ' · overdue' : ''}
                          </div>
                          <div className="cell-muted" style={{ fontSize: 11 }}>{formatDateTime(t.due_at)}</div>
                        </div>
                      ) : <span className="cell-muted">No due date</span>}
                    </td>
                    <td>
                      {t.assigned_user_name ? (
                        <div className="row">
                          <Avatar name={t.assigned_user_name} size={20}/>
                          <span style={{ fontSize: 12 }}>{t.assigned_user_name}</span>
                          {Number(t.assigned_user_id) === Number(user?.id) && (
                            <span className="status-badge sb-info" style={{ marginLeft: 4 }}>you</span>
                          )}
                        </div>
                      ) : <span className="cell-muted">Unassigned</span>}
                    </td>
                    <td className="cell-muted">{t.created_by_name}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <Button variant="secondary" size="sm" icon="check" onClick={() => complete(t.id)}>Done</Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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

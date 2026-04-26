import { useState, useEffect, useCallback } from 'react';
import api, { extractApiError } from '../api';
import { useAuth } from '../context/AuthContext';
import LeadDetailDrawer from '../components/LeadDetailDrawer';
import SummaryCards from '../components/SummaryCards';
import { TASK_TYPE_BY_KEY, relativeDue, isOverdue } from '../lib/tasks';

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

  const queueHint = (() => {
    switch (queue) {
      case 'mine_open': return 'Tasks assigned to you that are still open.';
      case 'due_today': return 'All open tasks with a due date today.';
      case 'overdue':   return 'Open tasks whose due date has already passed.';
      default:          return 'Every open task across the team.';
    }
  })();

  return (
    <div className="max-w-[1600px] mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6 sm:mb-8">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 tracking-tight">Tasks</h1>
          <p className="text-xs sm:text-sm text-gray-500 mt-0.5">{queueHint}</p>
        </div>
      </div>

      {summary && (summary.tasks_overdue > 0 || summary.tasks_due_today > 0) && (
        <div className={`rounded-xl border px-4 py-3 mb-4 flex items-center justify-between gap-3 ${
          summary.tasks_overdue > 0
            ? 'bg-red-50 border-red-100 text-red-800'
            : 'bg-amber-50 border-amber-100 text-amber-800'
        }`}>
          <div className="flex items-center gap-3">
            <svg className="w-5 h-5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            <div className="text-sm">
              {summary.tasks_overdue > 0 && (
                <span className="font-semibold">{summary.tasks_overdue} overdue</span>
              )}
              {summary.tasks_overdue > 0 && summary.tasks_due_today > 0 && ' · '}
              {summary.tasks_due_today > 0 && (
                <span className="font-semibold">{summary.tasks_due_today} due today</span>
              )}
              <span className="opacity-80 ml-1">— clear these first.</span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {summary.tasks_overdue > 0 && queue !== 'overdue' && (
              <button onClick={() => setQueue('overdue')} className="text-xs font-medium bg-white/60 hover:bg-white rounded-md px-2 py-1 border border-current/20">
                Show overdue
              </button>
            )}
            {summary.tasks_due_today > 0 && queue !== 'due_today' && (
              <button onClick={() => setQueue('due_today')} className="text-xs font-medium bg-white/60 hover:bg-white rounded-md px-2 py-1 border border-current/20">
                Show due today
              </button>
            )}
          </div>
        </div>
      )}

      {summary && (
        <SummaryCards
          cards={[
            { label: 'Open tasks',     value: summary.open_tasks,        color: 'blue' },
            { label: 'Due today',      value: summary.tasks_due_today,   color: 'amber' },
            { label: 'Overdue',        value: summary.tasks_overdue,     color: 'red' },
            { label: 'Unassigned leads', value: summary.unassigned,      color: 'gray' },
          ]}
        />
      )}

      {error && (
        <div className="bg-red-50 border border-red-100 text-red-600 px-4 py-3 rounded-xl mb-4 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-red-400 hover:text-red-600 p-1">&times;</button>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-gray-100 mb-4 shadow-sm overflow-hidden">
        <div className="flex border-b border-gray-100 overflow-x-auto">
          {QUEUES.map((q) => (
            <button
              key={q.key}
              onClick={() => setQueue(q.key)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                queue === q.key
                  ? 'text-blue-700 border-blue-600'
                  : 'text-gray-500 border-transparent hover:text-gray-800'
              }`}
            >
              {q.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="flex flex-col items-center justify-center py-16">
            <div className="w-10 h-10 border-4 border-zinc-200 border-t-blue-600 rounded-full animate-spin"></div>
            <p className="text-sm text-gray-400 mt-3">Loading tasks…</p>
          </div>
        ) : tasks.length === 0 ? (
          <div className="py-16 text-center">
            <p className="text-sm text-gray-400">
              {queue === 'mine_open' ? 'You have no open tasks. Great work.' : 'No tasks match this queue.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px]">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="pl-5 pr-2 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Lead</th>
                  <th className="px-3 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Task</th>
                  <th className="px-3 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Type</th>
                  <th className="px-3 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Due</th>
                  <th className="px-3 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Assigned</th>
                  <th className="px-3 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Created by</th>
                  <th className="px-3 py-3 w-16"></th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((t) => {
                  const overdue = isOverdue(t.due_at);
                  const typeMeta = TASK_TYPE_BY_KEY[t.task_type] || {};
                  return (
                    <tr key={t.id} className={`border-b border-gray-50 hover:bg-gray-50/60 transition-colors ${overdue ? 'bg-red-50/20' : ''}`}>
                      <td className="pl-5 pr-2 py-3">
                        <button
                          onClick={() => setDetailId(t.imported_lead_id)}
                          className="text-sm text-gray-900 font-medium hover:underline hover:text-[var(--vv-text)] text-left"
                        >
                          {t.lead?.display_name || `Lead #${t.imported_lead_id}`}
                        </button>
                        {t.lead?.batch_name && (
                          <p className="text-[11px] text-gray-400 truncate max-w-[260px]">{t.lead.batch_name}</p>
                        )}
                        {t.lead?.phone && (
                          <p className="text-[11px] text-gray-500">{t.lead.phone}</p>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <p className="text-sm text-gray-800">{t.title}</p>
                        {t.notes && <p className="text-[11px] text-gray-500 line-clamp-1 max-w-[260px]">{t.notes}</p>}
                      </td>
                      <td className="px-3 py-3">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-700">
                          {typeMeta.label || t.task_type}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        {t.due_at ? (
                          <div>
                            <p className={`text-sm ${overdue ? 'text-red-600 font-semibold' : 'text-gray-700'}`}>{relativeDue(t.due_at)}</p>
                            <p className="text-[11px] text-gray-400">{formatDateTime(t.due_at)}</p>
                          </div>
                        ) : <span className="text-xs text-gray-300">No due date</span>}
                      </td>
                      <td className="px-3 py-3 text-sm text-gray-700">
                        {t.assigned_user_name || <span className="text-gray-400 italic">Unassigned</span>}
                        {Number(t.assigned_user_id) === Number(user?.id) && (
                          <span className="ml-1 text-[10px] font-semibold text-blue-700 bg-blue-50 px-1 py-0.5 rounded">you</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-xs text-gray-500">{t.created_by_name}</td>
                      <td className="pr-4 py-3 text-right">
                        <button
                          onClick={() => complete(t.id)}
                          title="Complete"
                          className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-100 px-2 py-1 rounded-md"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                          Done
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
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

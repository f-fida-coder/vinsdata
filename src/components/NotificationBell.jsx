import { useState, useEffect, useRef, useCallback } from 'react';
import api, { extractApiError } from '../api';
import LeadDetailDrawer from './LeadDetailDrawer';
import { NOTIFICATION_META, relativeFrom } from '../lib/notifications';

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const TIMESTAMP_REFRESH_MS = 60 * 1000; // refresh relative timestamps every minute

export default function NotificationBell({ tone = 'dark' }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState({ notifications: [], unread_count: 0, overdue_count: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [leadDrawerId, setLeadDrawerId] = useState(null);
  const [, setTick] = useState(0); // forces re-render to refresh relative timestamps
  const wrapperRef = useRef(null);

  const load = useCallback(async ({ scan = false } = {}) => {
    try {
      const res = await api.get('/notifications', { params: { scan: scan ? 1 : 0, limit: 50 } });
      setData(res.data || { notifications: [], unread_count: 0, overdue_count: 0 });
      setError('');
    } catch (err) {
      setError(extractApiError(err, 'Failed to load notifications'));
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial scan + refresh every 5 minutes.
  useEffect(() => {
    load({ scan: true });
    const t = setInterval(() => load({ scan: true }), POLL_INTERVAL_MS);
    return () => clearInterval(t);
  }, [load]);

  // Refresh relative timestamps every minute so "3m ago" stays accurate.
  useEffect(() => {
    const t = setInterval(() => setTick((v) => v + 1), TIMESTAMP_REFRESH_MS);
    return () => clearInterval(t);
  }, []);

  // Close dropdown on outside click.
  useEffect(() => {
    const handler = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const markRead = async (ids) => {
    try {
      await api.post('/notifications', { ids });
      // Optimistic: flip locally and decrement count.
      const flipped = new Set(ids.map(Number));
      setData((prev) => ({
        ...prev,
        unread_count:  Math.max(0, prev.unread_count - ids.filter((id) => prev.notifications.find((n) => n.id === id && !n.is_read)).length),
        notifications: prev.notifications.map((n) => flipped.has(n.id) ? { ...n, is_read: true } : n),
      }));
    } catch (err) {
      setError(extractApiError(err, 'Failed to mark as read'));
    }
  };

  const markAll = async () => {
    try {
      await api.post('/notifications', { mark_all: true });
      setData((prev) => ({
        ...prev,
        unread_count: 0,
        notifications: prev.notifications.map((n) => ({ ...n, is_read: true })),
      }));
    } catch (err) {
      setError(extractApiError(err, 'Failed to mark all as read'));
    }
  };

  const handleRowClick = (n) => {
    if (!n.is_read) markRead([n.id]);
    if (n.related_lead_id) {
      setLeadDrawerId(n.related_lead_id);
    }
    setOpen(false);
  };

  const badge = data.unread_count > 99 ? '99+' : String(data.unread_count);
  const buttonClass = tone === 'dark'
    ? 'text-gray-400 hover:text-white hover:bg-white/5'
    : 'text-gray-500 hover:text-gray-800 hover:bg-gray-100';

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`relative w-9 h-9 flex items-center justify-center rounded-lg transition-colors ${buttonClass}`}
        aria-label="Notifications"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {data.unread_count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
            {badge}
          </span>
        )}
      </button>

      {open && (
        <div className={`absolute z-50 mt-2 w-[360px] max-w-[calc(100vw-24px)] bg-white rounded-xl shadow-2xl border border-gray-100 ${tone === 'dark' ? 'left-0' : 'right-0'}`}>
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-900">
              Notifications{data.unread_count > 0 ? ` · ${data.unread_count} unread` : ''}
            </h3>
            {data.unread_count > 0 && (
              <button onClick={markAll} className="text-xs font-medium text-[var(--vv-text)] hover:underline">
                Mark all read
              </button>
            )}
          </div>

          {data.overdue_count > 0 && (
            <div className="px-4 py-2 bg-red-50 border-b border-red-100 text-[11px] text-red-700 font-medium">
              {data.overdue_count} overdue {data.overdue_count === 1 ? 'task needs' : 'tasks need'} attention.
            </div>
          )}

          {error && (
            <div className="px-4 py-2 bg-red-50 border-b border-red-100 text-xs text-red-700">{error}</div>
          )}

          <div className="max-h-[60vh] overflow-y-auto">
            {loading ? (
              <p className="px-4 py-6 text-center text-xs text-gray-400">Loading…</p>
            ) : data.notifications.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-gray-400 italic">You&rsquo;re all caught up.</p>
            ) : (
              <ul>
                {data.notifications.map((n) => {
                  const meta = NOTIFICATION_META[n.type] || { accent: 'bg-gray-400', label: n.type };
                  return (
                    <li key={n.id}>
                      <button
                        onClick={() => handleRowClick(n)}
                        className={`w-full text-left px-4 py-2.5 border-b border-gray-50 flex gap-2.5 hover:bg-gray-50 transition-colors ${n.is_read ? 'opacity-70' : 'bg-zinc-50'}`}
                      >
                        <div className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${n.is_read ? 'bg-gray-300' : meta.accent}`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <p className={`text-sm truncate ${n.is_read ? 'text-gray-600' : 'text-gray-900 font-medium'}`}>{n.title}</p>
                            <span className="shrink-0 text-[10px] text-gray-400">{relativeFrom(n.created_at)}</span>
                          </div>
                          {n.message && (
                            <p className="text-[11px] text-gray-500 truncate">{n.message}</p>
                          )}
                          {(n.related_lead_name || n.related_task_title) && (
                            <p className="text-[10px] text-gray-400 mt-0.5 truncate">
                              {n.related_task_title ? `· ${n.related_task_title}` : ''}
                              {n.related_lead_name ? ` · ${n.related_lead_name}` : ''}
                            </p>
                          )}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}

      <LeadDetailDrawer
        leadId={leadDrawerId}
        onClose={() => setLeadDrawerId(null)}
        onChanged={() => load({ scan: true })}
      />
    </div>
  );
}

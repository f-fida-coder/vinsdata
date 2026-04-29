import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api, { extractApiError } from '../api';
import { MARKETING_CHANNELS, CAMPAIGN_STATUS_META } from '../lib/crm';

function formatDate(s) {
  if (!s) return '—';
  const d = new Date(String(s).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString();
}

function ChannelBadge({ channel }) {
  const meta = MARKETING_CHANNELS.find((c) => c.key === channel) || { label: channel, icon: '·' };
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-gray-600 bg-gray-100 border border-gray-200 rounded-md px-1.5 py-0.5">
      <span className="text-gray-400">{meta.icon}</span>
      {meta.label}
    </span>
  );
}

function StatusPill({ status }) {
  const m = CAMPAIGN_STATUS_META[status] || { label: status, bg: 'bg-gray-100', text: 'text-gray-600', dot: 'bg-gray-400' };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold ${m.bg} ${m.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${m.dot}`} />{m.label}
    </span>
  );
}

function Stat({ label, value, tone = 'gray' }) {
  const tones = {
    gray:    'text-gray-500',
    blue:    'text-blue-600',
    amber:   'text-amber-600',
    emerald: 'text-emerald-600',
    red:     'text-red-600',
  };
  return (
    <div className="text-center">
      <div className={`text-lg font-bold tabular-nums ${tones[tone]}`}>{value ?? '—'}</div>
      <div className="text-[10px] font-medium uppercase tracking-wider text-gray-400">{label}</div>
    </div>
  );
}

export default function MarketingCampaignsPage() {
  const nav = useNavigate();
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({ status: '', channel: '' });

  const fetchCampaigns = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const params = {};
      if (filters.status)  params.status  = filters.status;
      if (filters.channel) params.channel = filters.channel;
      const res = await api.get('/marketing_campaigns', { params });
      setCampaigns(res.data || []);
    } catch (err) {
      setError(extractApiError(err, 'Failed to load campaigns'));
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => { fetchCampaigns(); }, [fetchCampaigns]);

  const totalSent = campaigns.reduce((n, c) => n + (c.sent_count || 0), 0);
  const totalQueued = campaigns.filter((c) => ['draft','queued','sending','partially_failed'].includes(c.status)).length;

  return (
    <div className="page">
      <div className="section-header">
        <div>
          <h1 className="section-title">Mass Marketing</h1>
          <p className="section-subtitle">
            {campaigns.length.toLocaleString()} {campaigns.length === 1 ? 'campaign' : 'campaigns'} · {totalSent.toLocaleString()} total sends · {totalQueued} active
          </p>
        </div>
        <div className="section-actions">
          <button
            onClick={() => nav('/marketing/new')}
            className="vv-btn vv-btn-primary vv-btn-md"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14"/></svg>
            New campaign
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-100 text-red-600 px-4 py-3 rounded-xl mb-4 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-red-400 hover:text-red-600 p-1">&times;</button>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-gray-100 p-3 sm:p-4 mb-4 shadow-sm">
        <div className="flex flex-wrap items-end gap-2 sm:gap-3">
          <div className="flex items-center gap-2 text-gray-400 mr-1">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" /></svg>
            <span className="text-xs font-semibold uppercase tracking-wider">Filters</span>
          </div>
          <select
            value={filters.status}
            onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
            className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
          >
            <option value="">Any status</option>
            {Object.entries(CAMPAIGN_STATUS_META).map(([k, m]) => (
              <option key={k} value={k}>{m.label}</option>
            ))}
          </select>
          <select
            value={filters.channel}
            onChange={(e) => setFilters((f) => ({ ...f, channel: e.target.value }))}
            className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
          >
            <option value="">Any channel</option>
            {MARKETING_CHANNELS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
          {(filters.status || filters.channel) && (
            <button onClick={() => setFilters({ status: '', channel: '' })} className="text-xs text-blue-600 hover:text-blue-800 font-medium px-2 py-2">
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="w-10 h-10 border-4 border-fuchsia-100 border-t-fuchsia-600 rounded-full animate-spin"></div>
            <p className="text-sm text-gray-400 mt-3">Loading campaigns…</p>
          </div>
        ) : campaigns.length === 0 ? (
          <div className="py-16 text-center">
            <svg className="w-12 h-12 text-gray-200 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            <p className="text-sm text-gray-500">No campaigns yet.</p>
            <button onClick={() => nav('/marketing/new')} className="text-sm text-fuchsia-600 hover:text-fuchsia-700 font-medium mt-2">
              Create your first campaign
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px]">
              <thead className="bg-gray-50/70">
                <tr className="border-b border-gray-200">
                  <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Name</th>
                  <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Channel</th>
                  <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-3 py-2.5 text-right text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Recipients</th>
                  <th className="px-3 py-2.5 text-right text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Sent</th>
                  <th className="px-3 py-2.5 text-right text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Failed</th>
                  <th className="px-3 py-2.5 text-right text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Opted out</th>
                  <th className="px-3 py-2.5 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Created</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => nav(`/marketing/${c.id}`)}
                    className="border-b border-gray-50 hover:bg-fuchsia-50/30 transition-colors cursor-pointer"
                  >
                    <td className="px-4 py-3">
                      <Link to={`/marketing/${c.id}`} className="text-sm font-medium text-gray-900 hover:text-fuchsia-700">
                        {c.name}
                      </Link>
                      {c.created_by_name && (
                        <div className="text-[11px] text-gray-400 mt-0.5">by {c.created_by_name}</div>
                      )}
                    </td>
                    <td className="px-3 py-3"><ChannelBadge channel={c.channel} /></td>
                    <td className="px-3 py-3"><StatusPill status={c.status} /></td>
                    <td className="px-3 py-3 text-right tabular-nums text-[13px] text-gray-700">{c.recipient_count ?? 0}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-[13px] text-emerald-700">{c.sent_count ?? 0}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-[13px] text-red-600">{c.failed_count ?? 0}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-[13px] text-gray-500">{c.opted_out_count ?? 0}</td>
                    <td className="px-3 py-3 text-[11px] text-gray-400">{formatDate(c.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

// Keep the unused helper — it'll be used by the detail page for summary tiles.
export { Stat };

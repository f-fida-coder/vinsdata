import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import api, { extractApiError } from '../api';
import LeadDetailDrawer from '../components/LeadDetailDrawer';
import { CAMPAIGN_STATUS_META, RECIPIENT_STATUS_META, MARKETING_CHANNELS } from '../lib/crm';

function formatDateTime(s) {
  if (!s) return '—';
  const d = new Date(String(s).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString();
}

function StatTile({ label, value, tone = 'gray', hint }) {
  const tones = {
    gray:    'from-gray-100 to-gray-50 text-gray-700',
    blue:    'from-blue-50 to-blue-100 text-blue-700',
    emerald: 'from-emerald-50 to-emerald-100 text-emerald-700',
    amber:   'from-amber-50 to-amber-100 text-amber-700',
    red:     'from-red-50 to-red-100 text-red-700',
    fuchsia: 'from-fuchsia-50 to-pink-100 text-fuchsia-700',
  };
  return (
    <div className={`rounded-2xl bg-gradient-to-br ${tones[tone]} border border-white/50 p-4`}>
      <div className="text-3xl font-bold tabular-nums">{value ?? '—'}</div>
      <div className="text-[11px] font-semibold uppercase tracking-wider opacity-80 mt-0.5">{label}</div>
      {hint && <div className="text-[10px] opacity-60 mt-0.5">{hint}</div>}
    </div>
  );
}

export default function MarketingDetailPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const [campaign, setCampaign] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [tab, setTab] = useState('recipients');

  const [recipients, setRecipients] = useState({ recipients: [], total: 0, page: 1, per_page: 50 });
  const [recipientFilter, setRecipientFilter] = useState('');
  const [recipPage, setRecipPage] = useState(1);
  const [leadDrawerId, setLeadDrawerId] = useState(null);

  const fetchCampaign = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await api.get('/marketing_campaigns', { params: { id } });
      setCampaign(res.data);
    } catch (err) {
      setError(extractApiError(err, 'Failed to load campaign'));
    } finally {
      setLoading(false);
    }
  }, [id]);

  const fetchRecipients = useCallback(async () => {
    try {
      const params = { recipients_for: id, page: recipPage, per_page: 50 };
      if (recipientFilter) params.send_status = recipientFilter;
      const res = await api.get('/marketing_campaigns', { params });
      setRecipients(res.data);
    } catch { /* non-blocking */ }
  }, [id, recipPage, recipientFilter]);

  useEffect(() => { fetchCampaign(); }, [fetchCampaign]);
  useEffect(() => { fetchRecipients(); }, [fetchRecipients]);

  const sendNow = async () => {
    if (!campaign) return;
    const count = (campaign.recipient_count ?? 0) - (campaign.sent_count ?? 0) - (campaign.opted_out_count ?? 0);
    if (!window.confirm(`Send this campaign to ${count} pending recipient(s) now? This cannot be undone.`)) return;
    setSending(true); setError('');
    try {
      await api.post('/marketing_send', { campaign_id: Number(id) });
      await Promise.all([fetchCampaign(), fetchRecipients()]);
    } catch (err) {
      setError(extractApiError(err, 'Send failed'));
    } finally {
      setSending(false);
    }
  };

  const cancelCampaign = async () => {
    if (!window.confirm('Cancel this campaign? Pending recipients will not be sent.')) return;
    try {
      await api.patch('/marketing_campaigns', { id: Number(id), cancel: true });
      fetchCampaign();
    } catch (err) {
      setError(extractApiError(err, 'Cancel failed'));
    }
  };

  const deleteCampaign = async () => {
    if (!window.confirm('Delete this campaign and its recipient list? This cannot be undone.')) return;
    try {
      await api.delete('/marketing_campaigns', { data: { id: Number(id) } });
      nav('/marketing');
    } catch (err) {
      setError(extractApiError(err, 'Delete failed'));
    }
  };

  if (loading) {
    return (
      <div className="max-w-[1200px] mx-auto flex flex-col items-center justify-center py-20">
        <div className="w-10 h-10 border-4 border-fuchsia-100 border-t-fuchsia-600 rounded-full animate-spin"></div>
        <p className="text-sm text-gray-400 mt-3">Loading campaign…</p>
      </div>
    );
  }

  if (!campaign) {
    return (
      <div className="max-w-[1200px] mx-auto py-10 text-center">
        <p className="text-sm text-gray-500">Campaign not found.</p>
        <Link to="/marketing" className="text-sm text-fuchsia-600 hover:text-fuchsia-700 font-medium mt-2 inline-block">&larr; All campaigns</Link>
      </div>
    );
  }

  const statusMeta  = CAMPAIGN_STATUS_META[campaign.status] || { label: campaign.status };
  const channelMeta = MARKETING_CHANNELS.find((c) => c.key === campaign.channel) || { label: campaign.channel };
  const isSendable  = ['draft', 'queued', 'partially_failed'].includes(campaign.status);
  const pendingCount = (campaign.recipient_count ?? 0) - (campaign.sent_count ?? 0) - (campaign.opted_out_count ?? 0);

  return (
    <div className="max-w-[1200px] mx-auto">
      <div className="mb-4">
        <Link to="/marketing" className="text-xs text-gray-500 hover:text-gray-700">&larr; All campaigns</Link>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-xl sm:text-2xl font-bold text-gray-900 tracking-tight">{campaign.name}</h1>
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold ${statusMeta.bg} ${statusMeta.text}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${statusMeta.dot}`} />{statusMeta.label}
            </span>
          </div>
          <p className="text-xs sm:text-sm text-gray-500">
            {channelMeta.label} · created by {campaign.created_by_name || 'unknown'} · {formatDateTime(campaign.created_at)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isSendable && pendingCount > 0 && (
            <button
              onClick={sendNow}
              disabled={sending}
              className="inline-flex items-center gap-2 bg-gradient-to-r from-fuchsia-600 to-pink-500 text-white px-4 py-2.5 rounded-xl text-sm font-medium shadow-lg shadow-fuchsia-500/25 transition-all disabled:opacity-50"
            >
              {sending ? 'Sending…' : `Send ${pendingCount} pending`}
            </button>
          )}
          {['draft','queued'].includes(campaign.status) && (
            <button onClick={cancelCampaign} className="px-3 py-2 text-sm font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100">
              Cancel
            </button>
          )}
          {['draft','cancelled'].includes(campaign.status) && (
            <button onClick={deleteCampaign} className="px-3 py-2 text-sm font-medium text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100">
              Delete
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-100 text-red-600 px-4 py-3 rounded-xl mb-4 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-red-400 hover:text-red-600 p-1">&times;</button>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
        <StatTile label="Recipients"   value={campaign.recipient_count ?? 0} tone="fuchsia" />
        <StatTile label="Sent"         value={campaign.sent_count ?? 0}       tone="emerald" />
        <StatTile label="Failed"       value={campaign.failed_count ?? 0}     tone="red" />
        <StatTile label="Opted out"    value={campaign.opted_out_count ?? 0}  tone="amber" />
        <StatTile label="Pending"      value={campaign.pending_count ?? 0}    tone="blue" />
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="flex items-center gap-1 border-b border-gray-100 px-4 pt-2">
          {[
            { key: 'recipients', label: 'Recipients' },
            { key: 'message',    label: 'Message' },
            { key: 'segment',    label: 'Segment' },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab === t.key
                  ? 'text-fuchsia-700 border-fuchsia-500'
                  : 'text-gray-500 border-transparent hover:text-gray-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'recipients' && (
          <div>
            <div className="flex flex-wrap items-center gap-2 px-4 py-3 bg-gray-50/50 border-b border-gray-100">
              <span className="text-xs text-gray-500 mr-2">Filter:</span>
              <button
                onClick={() => { setRecipientFilter(''); setRecipPage(1); }}
                className={`text-[11px] px-2 py-1 rounded-full border ${!recipientFilter ? 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
              >
                All
              </button>
              {Object.entries(RECIPIENT_STATUS_META).map(([k, m]) => (
                <button
                  key={k}
                  onClick={() => { setRecipientFilter(k); setRecipPage(1); }}
                  className={`text-[11px] px-2 py-1 rounded-full border flex items-center gap-1 ${recipientFilter === k ? 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${m.dot}`} />{m.label}
                </button>
              ))}
              <span className="ml-auto text-xs text-gray-500">{recipients.total.toLocaleString()} total</span>
            </div>

            {recipients.recipients.length === 0 ? (
              <div className="py-12 text-center text-sm text-gray-400">No recipients in this filter.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px]">
                  <thead className="bg-gray-50/40">
                    <tr className="border-b border-gray-100">
                      <th className="px-4 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Lead</th>
                      <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Sent to</th>
                      <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                      <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Sent at</th>
                      <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Opened</th>
                      <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Fail reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recipients.recipients.map((r) => {
                      const m = RECIPIENT_STATUS_META[r.send_status] || { label: r.send_status, text: 'text-gray-600', dot: 'bg-gray-400' };
                      return (
                        <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50/50 cursor-pointer" onClick={() => setLeadDrawerId(r.imported_lead_id)}>
                          <td className="px-4 py-2 text-[13px] text-gray-900 font-medium">{r.lead_name || `Lead #${r.imported_lead_id}`}</td>
                          <td className="px-3 py-2 text-[13px] text-gray-600 font-mono">{r.resolved_to}</td>
                          <td className="px-3 py-2">
                            <span className={`inline-flex items-center gap-1 text-[10px] font-semibold ${m.text}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${m.dot}`} />{m.label}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-[11px] text-gray-500">{formatDateTime(r.sent_at)}</td>
                          <td className="px-3 py-2 text-[11px] text-gray-500">{r.opened_at ? formatDateTime(r.opened_at) : '—'}</td>
                          <td className="px-3 py-2 text-[11px] text-red-600 truncate max-w-[240px]" title={r.fail_reason || ''}>{r.fail_reason || '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {recipients.total > recipients.per_page && (
              <div className="flex items-center justify-center gap-2 py-3 border-t border-gray-100">
                <button
                  onClick={() => setRecipPage((p) => Math.max(1, p - 1))}
                  disabled={recipPage <= 1}
                  className="px-3 py-1 text-xs rounded-md border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-40"
                >‹ Prev</button>
                <span className="text-xs text-gray-500">
                  Page {recipPage} / {Math.max(1, Math.ceil(recipients.total / recipients.per_page))}
                </span>
                <button
                  onClick={() => setRecipPage((p) => p + 1)}
                  disabled={recipPage >= Math.ceil(recipients.total / recipients.per_page)}
                  className="px-3 py-1 text-xs rounded-md border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-40"
                >Next ›</button>
              </div>
            )}
          </div>
        )}

        {tab === 'message' && (
          <div className="p-6 space-y-4">
            {campaign.channel === 'email' && (
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Subject</div>
                <div className="text-sm text-gray-900">{campaign.subject_snapshot || <span className="text-gray-400">—</span>}</div>
              </div>
            )}
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Body (as stored — variables are rendered per recipient)</div>
              <pre className="whitespace-pre-wrap text-[13px] text-gray-700 bg-gray-50 rounded-lg p-4 border border-gray-100 font-mono">{campaign.body_snapshot}</pre>
            </div>
            {campaign.sender_identity && (
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Sender identity</div>
                <div className="text-sm text-gray-700 font-mono">{campaign.sender_identity}</div>
              </div>
            )}
          </div>
        )}

        {tab === 'segment' && (
          <div className="p-6">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-2">Filters used</div>
            {Object.keys(campaign.segment || {}).length === 0 ? (
              <p className="text-sm text-gray-400">All leads (no filters).</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(campaign.segment).map(([k, v]) => (
                  <span key={k} className="inline-flex items-center gap-1 bg-fuchsia-50 text-fuchsia-700 text-[11px] font-medium px-2 py-1 rounded-md border border-fuchsia-100">
                    {k}: <span className="font-semibold">{String(v)}</span>
                  </span>
                ))}
              </div>
            )}
            <Link
              to={`/leads?in_campaign_id=${campaign.id}`}
              className="inline-flex items-center gap-1 mt-4 text-sm text-fuchsia-600 hover:text-fuchsia-700 font-medium"
            >
              View recipients in CRM &rarr;
            </Link>
          </div>
        )}
      </div>

      <LeadDetailDrawer leadId={leadDrawerId} onClose={() => setLeadDrawerId(null)} onChanged={() => {}} />
    </div>
  );
}

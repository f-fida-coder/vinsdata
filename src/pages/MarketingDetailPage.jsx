import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import api, { extractApiError } from '../api';
import LeadDetailDrawer from '../components/LeadDetailDrawer';
import { CAMPAIGN_STATUS_META, RECIPIENT_STATUS_META, MARKETING_CHANNELS } from '../lib/crm';
import { Button, Icon, KPI } from '../components/ui';

const STATUS_VARIANT = {
  draft: 'muted',
  queued: 'info',
  sending: 'warn',
  sent: 'success',
  partially_failed: 'warn',
  cancelled: 'danger',
};

const RECIPIENT_VARIANT = {
  pending: 'muted',
  sending: 'warn',
  sent: 'success',
  failed: 'danger',
  skipped: 'muted',
  bounced: 'warn',
  opted_out: 'danger',
};

const RECIPIENT_DOT_VAR = {
  pending: 'var(--text-3)',
  sending: 'var(--warm)',
  sent: 'var(--success)',
  failed: 'var(--danger)',
  skipped: 'var(--text-3)',
  bounced: 'var(--warm)',
  opted_out: 'var(--danger)',
};

function formatDateTime(s) {
  if (!s) return '—';
  const d = new Date(String(s).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString();
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
      <div className="page" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 80 }}>
        <div className="vv-spinner"/>
        <p className="cell-muted tiny" style={{ marginTop: 12 }}>Loading campaign…</p>
      </div>
    );
  }

  if (!campaign) {
    return (
      <div className="page" style={{ textAlign: 'center', padding: 60 }}>
        <p className="cell-muted">Campaign not found.</p>
        <Link to="/marketing" style={{ color: 'var(--accent)', fontSize: 13, marginTop: 8, display: 'inline-block' }}>&larr; All campaigns</Link>
      </div>
    );
  }

  const statusMeta  = CAMPAIGN_STATUS_META[campaign.status] || { label: campaign.status };
  const statusVariant = STATUS_VARIANT[campaign.status] || 'neutral';
  const channelMeta = MARKETING_CHANNELS.find((c) => c.key === campaign.channel) || { label: campaign.channel };
  const isSendable  = ['draft', 'queued', 'partially_failed'].includes(campaign.status);
  const pendingCount = (campaign.recipient_count ?? 0) - (campaign.sent_count ?? 0) - (campaign.opted_out_count ?? 0);
  const totalPages = Math.max(1, Math.ceil(recipients.total / recipients.per_page));

  return (
    <div className="page">
      <div style={{ marginBottom: 12 }}>
        <Link to="/marketing" className="cell-muted tiny" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Icon name="chevronLeft" size={12}/> All campaigns
        </Link>
      </div>

      <div className="section-header">
        <div>
          <div className="row" style={{ gap: 8, marginBottom: 4 }}>
            <h1 className="section-title">{campaign.name}</h1>
            <span className={`status-badge sb-${statusVariant}`}>{statusMeta.label}</span>
          </div>
          <p className="section-subtitle">
            {channelMeta.label} · created by {campaign.created_by_name || 'unknown'} · {formatDateTime(campaign.created_at)}
          </p>
        </div>
        <div className="section-actions">
          {isSendable && pendingCount > 0 && (
            <Button variant="primary" icon="play" onClick={sendNow} disabled={sending}>
              {sending ? 'Sending…' : `Send ${pendingCount} pending`}
            </Button>
          )}
          {['draft','queued'].includes(campaign.status) && (
            <Button variant="secondary" onClick={cancelCampaign}>Cancel</Button>
          )}
          {['draft','cancelled'].includes(campaign.status) && (
            <Button variant="danger" icon="trash" onClick={deleteCampaign}>Delete</Button>
          )}
        </div>
      </div>

      {error && (
        <div
          className="row"
          style={{
            background: 'var(--danger-bg)',
            color: 'var(--danger)',
            padding: '10px 14px',
            borderRadius: 'var(--radius-lg)',
            marginBottom: 16,
            justifyContent: 'space-between',
          }}
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError('')}
            style={{ background: 'transparent', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: 18 }}
          >&times;</button>
        </div>
      )}

      <div className="kpi-row" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
        <KPI label="Recipients" value={(campaign.recipient_count ?? 0).toLocaleString()} dot="var(--info)"/>
        <KPI label="Sent"       value={(campaign.sent_count ?? 0).toLocaleString()}      dot="var(--success)"/>
        <KPI label="Failed"     value={(campaign.failed_count ?? 0).toLocaleString()}    dot="var(--danger)"/>
        <KPI label="Opted out"  value={(campaign.opted_out_count ?? 0).toLocaleString()} dot="var(--warm)"/>
        <KPI label="Pending"    value={(campaign.pending_count ?? 0).toLocaleString()}   dot="var(--text-2)"/>
      </div>

      <div className="tbl-wrap">
        <div style={{ padding: '0 16px', borderBottom: '1px solid var(--border-0)' }}>
          <div className="tabs" style={{ marginBottom: 0 }}>
            {[
              { key: 'recipients', label: 'Recipients' },
              { key: 'message',    label: 'Message' },
              { key: 'segment',    label: 'Segment' },
            ].map((t) => (
              <span
                key={t.key}
                className={`tab ${tab === t.key ? 'active' : ''}`}
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </span>
            ))}
          </div>
        </div>

        {tab === 'recipients' && (
          <div>
            <div
              className="row"
              style={{
                gap: 6,
                flexWrap: 'wrap',
                padding: '10px 14px',
                background: 'var(--bg-2)',
                borderBottom: '1px solid var(--border-0)',
              }}
            >
              <span className="cell-muted tiny" style={{ marginRight: 4 }}>Filter:</span>
              <span
                className={`chip ${!recipientFilter ? 'active' : ''}`}
                onClick={() => { setRecipientFilter(''); setRecipPage(1); }}
              >
                All
              </span>
              {Object.entries(RECIPIENT_STATUS_META).map(([k, m]) => (
                <span
                  key={k}
                  className={`chip ${recipientFilter === k ? 'active' : ''}`}
                  onClick={() => { setRecipientFilter(k); setRecipPage(1); }}
                >
                  <span className="chip-dot" style={{ background: RECIPIENT_DOT_VAR[k] || 'var(--text-3)' }}/>
                  {m.label}
                </span>
              ))}
              <span className="spacer"/>
              <span className="cell-muted tiny">{recipients.total.toLocaleString()} total</span>
            </div>

            {recipients.recipients.length === 0 ? (
              <div style={{ padding: '60px 20px', textAlign: 'center' }}>
                <p className="cell-muted">No recipients in this filter.</p>
              </div>
            ) : (
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Lead</th>
                    <th>Sent to</th>
                    <th>Status</th>
                    <th>Sent at</th>
                    <th>Opened</th>
                    <th>Fail reason</th>
                  </tr>
                </thead>
                <tbody>
                  {recipients.recipients.map((r) => {
                    const m = RECIPIENT_STATUS_META[r.send_status] || { label: r.send_status };
                    const variant = RECIPIENT_VARIANT[r.send_status] || 'neutral';
                    return (
                      <tr key={r.id} onClick={() => setLeadDrawerId(r.imported_lead_id)}>
                        <td className="cell-strong">{r.lead_name || `Lead #${r.imported_lead_id}`}</td>
                        <td className="cell-mono">{r.resolved_to}</td>
                        <td><span className={`status-badge sb-${variant}`}>{m.label}</span></td>
                        <td className="cell-muted tiny">{formatDateTime(r.sent_at)}</td>
                        <td className="cell-muted tiny">{r.opened_at ? formatDateTime(r.opened_at) : '—'}</td>
                        <td
                          className="tiny"
                          style={{ color: r.fail_reason ? 'var(--danger)' : 'var(--text-3)', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                          title={r.fail_reason || ''}
                        >
                          {r.fail_reason || '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}

            {recipients.total > recipients.per_page && (
              <div className="tbl-pagination" style={{ justifyContent: 'center' }}>
                <div className="tbl-pag-controls">
                  <Button
                    variant="ghost"
                    size="sm"
                    icon="chevronLeft"
                    onClick={() => setRecipPage((p) => Math.max(1, p - 1))}
                    disabled={recipPage <= 1}
                  >Prev</Button>
                  <span style={{ padding: '0 6px' }}>Page {recipPage} / {totalPages}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    iconAfter="chevronRight"
                    onClick={() => setRecipPage((p) => p + 1)}
                    disabled={recipPage >= totalPages}
                  >Next</Button>
                </div>
              </div>
            )}
          </div>
        )}

        {tab === 'message' && (
          <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
            {campaign.channel === 'email' && (
              <div>
                <div className="drawer-section-label">Subject</div>
                <div style={{ fontSize: 14 }}>{campaign.subject_snapshot || <span className="cell-muted">—</span>}</div>
              </div>
            )}
            <div>
              <div className="drawer-section-label">Body (as stored — variables are rendered per recipient)</div>
              <pre
                className="cell-mono"
                style={{
                  whiteSpace: 'pre-wrap',
                  background: 'var(--bg-2)',
                  border: '1px solid var(--border-0)',
                  borderRadius: 'var(--radius-md)',
                  padding: 14,
                  fontSize: 13,
                  margin: 0,
                  color: 'var(--text-1)',
                }}
              >
                {campaign.body_snapshot}
              </pre>
            </div>
            {campaign.sender_identity && (
              <div>
                <div className="drawer-section-label">Sender identity</div>
                <div className="cell-mono">{campaign.sender_identity}</div>
              </div>
            )}
          </div>
        )}

        {tab === 'segment' && (
          <div style={{ padding: 24 }}>
            <div className="drawer-section-label">Filters used</div>
            {Object.keys(campaign.segment || {}).length === 0 ? (
              <p className="cell-muted">All leads (no filters).</p>
            ) : (
              <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                {Object.entries(campaign.segment).map(([k, v]) => (
                  <span key={k} className="status-badge sb-info">
                    {k}: <strong style={{ marginLeft: 2 }}>{String(v)}</strong>
                  </span>
                ))}
              </div>
            )}
            <div style={{ marginTop: 16 }}>
              <Link
                to={`/leads?in_campaign_id=${campaign.id}`}
                className="vv-btn vv-btn-ghost vv-btn-sm"
              >
                View recipients in CRM
                <Icon name="arrowRight" size={14}/>
              </Link>
            </div>
          </div>
        )}
      </div>

      <LeadDetailDrawer leadId={leadDrawerId} onClose={() => setLeadDrawerId(null)} onChanged={() => {}} />
    </div>
  );
}

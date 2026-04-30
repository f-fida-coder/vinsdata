import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api, { extractApiError } from '../api';
import { MARKETING_CHANNELS, CAMPAIGN_STATUS_META } from '../lib/crm';
import { Button, Icon, SectionHeader, EmptyState } from '../components/ui';

const STATUS_VARIANT = {
  draft: 'muted',
  queued: 'info',
  sending: 'warn',
  sent: 'success',
  partially_failed: 'warn',
  cancelled: 'danger',
};

const CHANNEL_ICON = { email: 'mail', sms: 'sms', whatsapp: 'phone' };

function formatDate(s) {
  if (!s) return '—';
  const d = new Date(String(s).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString();
}

function ChannelBadge({ channel }) {
  const meta = MARKETING_CHANNELS.find((c) => c.key === channel) || { label: channel };
  const iconName = CHANNEL_ICON[channel] || 'mail';
  return (
    <span className="row" style={{ gap: 6 }}>
      <Icon name={iconName} size={14} style={{ color: 'var(--text-2)' }}/>
      <span style={{ fontSize: 12 }}>{meta.label}</span>
    </span>
  );
}

function CampaignStatusBadge({ status }) {
  const meta = CAMPAIGN_STATUS_META[status] || { label: status };
  const variant = STATUS_VARIANT[status] || 'neutral';
  return <span className={`status-badge sb-${variant}`}>{meta.label}</span>;
}

function Stat({ label, value, tone = 'gray' }) {
  const colorMap = {
    gray:    'var(--text-2)',
    blue:    'var(--info)',
    amber:   'var(--warm)',
    emerald: 'var(--success)',
    red:     'var(--danger)',
  };
  return (
    <div style={{ textAlign: 'center' }}>
      <div
        className="kpi-value"
        style={{ fontSize: 22, color: colorMap[tone] || colorMap.gray }}
      >
        {value ?? '—'}
      </div>
      <div className="kpi-label" style={{ marginTop: 4 }}>{label}</div>
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
      <SectionHeader
        title="Mass Marketing"
        subtitle={`${campaigns.length.toLocaleString()} ${campaigns.length === 1 ? 'campaign' : 'campaigns'} · ${totalSent.toLocaleString()} total sends · ${totalQueued} active`}
        actions={
          <Button variant="primary" icon="plus" onClick={() => nav('/marketing/new')}>
            New campaign
          </Button>
        }
      />

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

      <div className="filters-row">
        <div className="filters-label">
          <Icon name="filter" size={14}/> Filters
        </div>
        <select
          value={filters.status}
          onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
          className="vv-input"
          style={{ width: 160 }}
        >
          <option value="">Any status</option>
          {Object.entries(CAMPAIGN_STATUS_META).map(([k, m]) => (
            <option key={k} value={k}>{m.label}</option>
          ))}
        </select>
        <select
          value={filters.channel}
          onChange={(e) => setFilters((f) => ({ ...f, channel: e.target.value }))}
          className="vv-input"
          style={{ width: 160 }}
        >
          <option value="">Any channel</option>
          {MARKETING_CHANNELS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
        {(filters.status || filters.channel) && (
          <Button variant="ghost" size="sm" onClick={() => setFilters({ status: '', channel: '' })}>
            Clear
          </Button>
        )}
      </div>

      <div className="tbl-wrap">
        {loading ? (
          <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-2)' }}>
            <div className="vv-spinner" style={{ margin: '0 auto 12px' }}/>
            <p className="tiny">Loading campaigns…</p>
          </div>
        ) : campaigns.length === 0 ? (
          <EmptyState
            icon="mail"
            title="No campaigns yet"
            body="Create your first campaign to reach leads via email, SMS, or WhatsApp."
            action={<Button variant="primary" icon="plus" onClick={() => nav('/marketing/new')}>New campaign</Button>}
          />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Campaign</th>
                <th>Channel</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Recipients</th>
                <th style={{ textAlign: 'right' }}>Sent</th>
                <th style={{ textAlign: 'right' }}>Failed</th>
                <th style={{ textAlign: 'right' }}>Opted out</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id} onClick={() => nav(`/marketing/${c.id}`)}>
                  <td>
                    <Link
                      to={`/marketing/${c.id}`}
                      className="cell-strong"
                      onClick={(e) => e.stopPropagation()}
                      style={{ color: 'var(--text-0)' }}
                    >
                      {c.name}
                    </Link>
                    {c.created_by_name && (
                      <div className="cell-muted tiny" style={{ marginTop: 2 }}>by {c.created_by_name}</div>
                    )}
                  </td>
                  <td><ChannelBadge channel={c.channel}/></td>
                  <td><CampaignStatusBadge status={c.status}/></td>
                  <td style={{ textAlign: 'right' }} className="cell-strong">{(c.recipient_count ?? 0).toLocaleString()}</td>
                  <td style={{ textAlign: 'right', color: 'var(--success)' }}>{(c.sent_count ?? 0).toLocaleString()}</td>
                  <td style={{ textAlign: 'right', color: c.failed_count ? 'var(--danger)' : 'var(--text-3)' }}>
                    {(c.failed_count ?? 0).toLocaleString()}
                  </td>
                  <td style={{ textAlign: 'right' }} className="cell-muted">{(c.opted_out_count ?? 0).toLocaleString()}</td>
                  <td className="cell-muted">{formatDate(c.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export { Stat };

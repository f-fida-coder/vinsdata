import { useState, useEffect, useMemo } from 'react';
import api, { extractApiError } from '../api';
import { Icon, Avatar, EmptyState } from '../components/ui';
import LeadDetailDrawer from '../components/LeadDetailDrawer';
import { useAuth } from '../context/AuthContext';
import {
  LEAD_STATUSES, LEAD_PRIORITIES, LEAD_TIERS,
  STATUS_BY_KEY, PRIORITY_BY_KEY, TIER_BY_KEY,
  computeLeadTier, formatPhone, formatPrice,
} from '../lib/crm';

const STATUS_DOT_VAR = {
  new: 'var(--info)', contacted: 'var(--text-2)', callback: 'var(--warm)',
  interested: 'var(--success)', not_interested: 'var(--text-3)',
  wrong_number: 'var(--hot)', no_answer: 'var(--text-3)',
  voicemail_left: 'var(--info)', deal_closed: 'var(--success)',
  nurture: 'var(--info)', disqualified: 'var(--text-3)',
  do_not_call: 'var(--danger)', marketing: 'var(--info)',
};
const PRIORITY_DOT_VAR = {
  low: 'var(--cold)', medium: 'var(--text-2)',
  high: 'var(--warm)', hot: 'var(--hot)',
};
const TIER_DOT_VAR = {
  tier_1: 'var(--tier1)', tier_2: 'var(--tier2)', tier_3: 'var(--tier3)',
};

// Each grouping mode defines a list of columns + the column the lead should
// land in when its grouping field is empty.
const GROUPINGS = {
  temperature: {
    label: 'Temperature',
    columns: [
      { key: '__none', label: 'No answer', dot: 'var(--text-3)' },
      { key: 'cold',   label: 'Cold',      dot: 'var(--cold)' },
      { key: 'warm',   label: 'Warm',      dot: 'var(--warm)' },
      { key: 'hot',    label: 'Hot',       dot: 'var(--hot)' },
      { key: 'closed', label: 'Closed',    dot: 'var(--success)' },
    ],
    pick: (l) => l.crm_state?.lead_temperature || l.lead_temperature || '__none',
  },
  status: {
    label: 'Status',
    columns: LEAD_STATUSES.map((s) => ({
      key: s.key,
      label: s.label,
      dot: STATUS_DOT_VAR[s.key] || 'var(--text-3)',
    })),
    pick: (l) => l.crm_state?.status || l.status || 'new',
  },
  priority: {
    label: 'Priority',
    columns: LEAD_PRIORITIES.map((p) => ({
      key: p.key,
      label: p.label,
      dot: PRIORITY_DOT_VAR[p.key] || 'var(--text-3)',
    })),
    pick: (l) => l.crm_state?.priority || l.priority || 'medium',
  },
  tier: {
    label: 'Tier',
    columns: LEAD_TIERS.map((t) => ({
      key: t.key,
      label: t.label,
      dot: TIER_DOT_VAR[t.key] || 'var(--text-3)',
    })),
    pick: (l) => l.tier || computeLeadTier(l.normalized_payload || {}) || 'tier_3',
  },
};

function relativeAgo(s) {
  if (!s) return null;
  const d = new Date(String(s).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return null;
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return `${Math.floor(diff / 604800)}w ago`;
}

function leadName(l) {
  const np = l.normalized_payload || {};
  const name = np.full_name || [np.first_name, np.last_name].filter(Boolean).join(' ').trim();
  return name || np.vin || `Lead #${l.id}`;
}

function leadVehicle(l) {
  const np = l.normalized_payload || {};
  const parts = [np.year, np.make, np.model].filter(Boolean);
  if (parts.length === 0) return null;
  // Title-case the make/model strings while leaving year alone.
  return parts.map((p) => /^\d/.test(String(p))
    ? String(p)
    : String(p).charAt(0).toUpperCase() + String(p).slice(1).toLowerCase()
  ).join(' ');
}

function PipelineCard({ lead, onClick }) {
  const np = lead.normalized_payload || {};
  const name = leadName(lead);
  const vehicle = leadVehicle(lead);
  const phone = np.phone_primary ? formatPhone(np.phone_primary) : null;
  const crm = lead.crm_state || {};
  const statusKey = crm.status || lead.status;
  const statusMeta = statusKey ? STATUS_BY_KEY[statusKey] : null;
  const priorityKey = crm.priority || lead.priority;
  const priorityMeta = priorityKey && priorityKey !== 'medium' ? PRIORITY_BY_KEY[priorityKey] : null;
  const tierKey = lead.tier || computeLeadTier(np);
  const tierMeta = TIER_BY_KEY[tierKey];
  const offered = crm.price_offered ?? lead.price_offered;
  const wanted = crm.price_wanted ?? lead.price_wanted;
  const assignee = crm.assigned_user_name || lead.assigned_user_name;
  const updated = lead.updated_at || lead.imported_at;
  const ago = relativeAgo(updated);
  const tasksOpen = lead.open_tasks_count || 0;
  const overdue = lead.tasks_overdue_count || 0;

  return (
    <div className="pl-card" onClick={onClick}>
      <div className="pl-card-top">
        <div className="pl-card-name" title={name}>{name}</div>
        {tierMeta && (
          <span className="pl-card-tier" style={{ '--tier-color': TIER_DOT_VAR[tierKey] }}>
            <span className="pl-card-tier-dot"/>
            {tierMeta.short}
          </span>
        )}
      </div>

      {vehicle && <div className="pl-card-vehicle">{vehicle}</div>}

      <div className="pl-card-meta">
        {statusMeta && (
          <span className="pl-pill" style={{ '--pill-color': STATUS_DOT_VAR[statusKey] }}>
            <span className="pl-pill-dot"/>{statusMeta.label}
          </span>
        )}
        {priorityMeta && (
          <span className="pl-pill" style={{ '--pill-color': PRIORITY_DOT_VAR[priorityKey] }}>
            <span className="pl-pill-dot"/>{priorityMeta.label}
          </span>
        )}
        {tasksOpen > 0 && (
          <span className={`pl-pill ${overdue > 0 ? 'pl-pill-danger' : ''}`} title={overdue > 0 ? `${overdue} overdue` : `${tasksOpen} open tasks`}>
            <Icon name="check" size={10}/> {tasksOpen}
            {overdue > 0 && <span className="pl-overdue-marker">!</span>}
          </span>
        )}
      </div>

      {(phone || offered != null || wanted != null) && (
        <div className="pl-card-info">
          {phone && (
            <span className="pl-info-row">
              <Icon name="phone" size={11}/>
              <span>{phone}</span>
            </span>
          )}
          {(offered != null || wanted != null) && (
            <span className="pl-info-row pl-info-money">
              {offered != null && <span><span className="pl-info-label">Offered</span> {formatPrice(offered)}</span>}
              {wanted != null && <span><span className="pl-info-label">Wanted</span> {formatPrice(wanted)}</span>}
            </span>
          )}
        </div>
      )}

      <div className="pl-card-foot">
        {assignee ? (
          <span className="pl-assignee">
            <Avatar name={assignee} size={18}/>
            <span>{assignee}</span>
          </span>
        ) : (
          <span className="pl-assignee pl-unassigned">
            <span className="pl-avatar-empty"/>
            <span>Unassigned</span>
          </span>
        )}
        {ago && <span className="pl-timestamp">{ago}</span>}
      </div>
    </div>
  );
}

function ColumnSkeleton() {
  return (
    <div className="pl-col-skel">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="pl-card pl-card-skeleton">
          <div className="pl-skel pl-skel-line" style={{ width: '70%' }}/>
          <div className="pl-skel pl-skel-line" style={{ width: '50%' }}/>
          <div className="pl-skel pl-skel-line" style={{ width: '90%' }}/>
        </div>
      ))}
    </div>
  );
}

export default function PipelinePage() {
  const { user } = useAuth();
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [scope, setScope] = useState('all');
  const [grouping, setGrouping] = useState('temperature');
  const [drawerId, setDrawerId] = useState(null);
  const isAdmin = user?.role === 'admin' || user?.role === 'marketer';

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true); setError('');
      try {
        const params = { per_page: 200 };
        if (scope === 'mine' && user?.id) params.assigned_user_id = user.id;
        const res = await api.get('/leads', { params });
        if (!cancel) setLeads(Array.isArray(res.data?.leads) ? res.data.leads : []);
      } catch (err) {
        if (!cancel) setError(extractApiError(err, 'Failed to load pipeline'));
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, [scope, user?.id]);

  const config = GROUPINGS[grouping] || GROUPINGS.temperature;
  const cols = config.columns;

  const grouped = useMemo(() => {
    const out = Object.fromEntries(cols.map((c) => [c.key, []]));
    for (const l of leads) {
      const k = config.pick(l);
      if (out[k]) out[k].push(l);
      else if (out.__none) out.__none.push(l);
    }
    return out;
  }, [leads, cols, config]);

  // Highest-value first for visual scanability.
  const sortedGrouped = useMemo(() => {
    const out = {};
    for (const c of cols) {
      out[c.key] = [...(grouped[c.key] || [])].sort((a, b) => {
        const aV = (a.crm_state?.price_offered ?? a.price_offered) || 0;
        const bV = (b.crm_state?.price_offered ?? b.price_offered) || 0;
        return bV - aV;
      });
    }
    return out;
  }, [grouped, cols]);

  const totalLeads = leads.length;

  return (
    <div className="page pipeline-page">
      <div className="pl-header">
        <div>
          <h1 className="section-title">Lead Pipeline</h1>
          <p className="section-subtitle">
            {loading ? 'Loading…' : (
              <>
                <strong>{totalLeads.toLocaleString()}</strong> leads · grouped by {config.label.toLowerCase()}
              </>
            )}
          </p>
        </div>
        <div className="pl-controls">
          <div className="pl-grouping">
            <span className="pl-grouping-label">Group by</span>
            <div className="seg pl-grouping-seg">
              {Object.entries(GROUPINGS).map(([key, g]) => (
                <button
                  key={key}
                  type="button"
                  className={`seg-btn ${grouping === key ? 'active' : ''}`}
                  onClick={() => setGrouping(key)}
                >
                  {g.label}
                </button>
              ))}
            </div>
          </div>
          {isAdmin && (
            <div className="seg">
              <button type="button" className={`seg-btn ${scope === 'all' ? 'active' : ''}`} onClick={() => setScope('all')}>All leads</button>
              <button type="button" className={`seg-btn ${scope === 'mine' ? 'active' : ''}`} onClick={() => setScope('mine')}>My leads</button>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="card" style={{ marginBottom: 16, borderColor: 'var(--danger)', color: 'var(--danger)' }}>{error}</div>
      )}

      {!loading && leads.length === 0 ? (
        <EmptyState icon="users" title="No leads yet" body="Import leads from the Files dashboard, then come back here to work the pipeline."/>
      ) : (
        <div className="pl-board">
          {cols.map((c) => {
            const colLeads = sortedGrouped[c.key] || [];
            const totalValue = colLeads.reduce((sum, l) => {
              const v = (l.crm_state?.price_offered ?? l.price_offered) || 0;
              return sum + Number(v);
            }, 0);
            return (
              <div key={c.key} className="pl-col">
                <div className="pl-col-head">
                  <div className="pl-col-head-top">
                    <span className="pl-col-title">
                      <span className="pl-col-dot" style={{ background: c.dot }}/>
                      {c.label}
                    </span>
                    <span className="pl-col-count">{colLeads.length}</span>
                  </div>
                  {totalValue > 0 && (
                    <div className="pl-col-subtotal">{formatPrice(totalValue)} offered</div>
                  )}
                  <span className="pl-col-accent" style={{ background: c.dot }}/>
                </div>
                <div className="pl-col-body">
                  {loading ? (
                    <ColumnSkeleton/>
                  ) : colLeads.length === 0 ? (
                    <div className="pl-col-empty">No leads in this column</div>
                  ) : (
                    colLeads.slice(0, 50).map((l) => (
                      <PipelineCard key={l.id} lead={l} onClick={() => setDrawerId(l.id)}/>
                    ))
                  )}
                  {!loading && colLeads.length > 50 && (
                    <div className="pl-col-more">+{colLeads.length - 50} more · open Leads page to filter</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <LeadDetailDrawer
        leadId={drawerId}
        onClose={() => setDrawerId(null)}
        onChanged={() => { setScope((s) => s); }}
      />
    </div>
  );
}

import { useEffect, useState, useRef } from 'react';
import api, { extractApiError } from '../api';
import { Button, Icon } from '../components/ui';
import { LEAD_STATUSES, LEAD_PRIORITIES, LEAD_TEMPERATURES, STATUS_BY_KEY, PRIORITY_BY_KEY, TEMPERATURE_BY_KEY, TRANSPORT_STATUSES, TRANSPORT_STATUS_BY_KEY } from '../lib/crm';

const DUP_STATUS_META = {
  pending:                     { label: 'Pending',           color: 'var(--warm)' },
  confirmed_duplicate:         { label: 'Confirmed',         color: 'var(--success)' },
  not_duplicate:               { label: 'Not duplicate',     color: 'var(--text-3)' },
  ignored:                     { label: 'Ignored',           color: 'var(--text-3)' },
};

const STAGE_META = {
  generated: { label: 'Generated', color: 'var(--text-3)' },
  carfax:    { label: 'Carfax',    color: 'var(--warm)' },
  filter:    { label: 'Filter',    color: 'var(--cold)' },
  tlo:       { label: 'TLO',       color: 'var(--success)' },
};

// Tone metadata for the hero KPI tiles + section icons.
const KPI_TILES = [
  { key: 'total',                label: 'Total leads',    icon: 'users',    tone: 'accent' },
  { key: 'unassigned',           label: 'Unassigned',     icon: 'user',     tone: 'warm' },
  { key: 'imported_today',       label: 'Imported today', icon: 'arrowDown', tone: 'info' },
  { key: 'imported_this_week',   label: 'Imported (7d)',  icon: 'calendar', tone: 'info' },
  { key: 'open_tasks',           label: 'Open tasks',     icon: 'check',    tone: 'cold' },
  { key: 'tasks_overdue',        label: 'Tasks overdue',  icon: 'fire',     tone: 'danger' },
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

function HeroKPI({ label, value, icon, tone }) {
  const color = TONE_VAR[tone] || 'var(--text-1)';
  return (
    <div className="rp-kpi" style={{ '--kpi-color': color }}>
      <div className="rp-kpi-icon">
        <Icon name={icon} size={16}/>
      </div>
      <div className="rp-kpi-body">
        <div className="rp-kpi-label">{label}</div>
        <div className="rp-kpi-value">{Number(value || 0).toLocaleString()}</div>
      </div>
    </div>
  );
}

function ReportCard({ icon, iconColor = 'var(--text-1)', title, subtitle, headline, children, span }) {
  return (
    <div className="rp-card" style={span ? { gridColumn: `span ${span}` } : undefined}>
      <div className="rp-card-head">
        <div className="rp-card-head-left">
          <div className="rp-card-icon" style={{ '--icon-color': iconColor }}>
            <Icon name={icon} size={14}/>
          </div>
          <div>
            <div className="rp-card-title">{title}</div>
            {subtitle && <div className="rp-card-sub">{subtitle}</div>}
          </div>
        </div>
        {headline}
      </div>
      <div className="rp-card-body">{children}</div>
    </div>
  );
}

function BarItem({ label, count, total, color, leading }) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div className={`rp-bar ${leading ? 'is-leading' : ''}`}>
      <div className="rp-bar-row">
        <span className="rp-bar-label">
          <span className="rp-bar-dot" style={{ background: color || 'var(--text-2)' }}/>
          <span className="rp-bar-text">{label}</span>
        </span>
        <span className="rp-bar-stats">
          <span className="rp-bar-pct">{pct >= 1 ? `${Math.round(pct)}%` : pct > 0 ? '<1%' : '—'}</span>
          <span className="rp-bar-count">{count.toLocaleString()}</span>
        </span>
      </div>
      <div className="rp-bar-track">
        <span
          className="rp-bar-fill"
          style={{
            width: `${Math.max(pct, 0)}%`,
            background: color || 'var(--text-1)',
          }}
        />
      </div>
    </div>
  );
}

function StatTile({ label, value, tone }) {
  const color = TONE_VAR[tone] || 'var(--text-1)';
  return (
    <div className="rp-stat" style={{ '--stat-color': color }}>
      <div className="rp-stat-label">{label}</div>
      <div className="rp-stat-value">{Number(value || 0).toLocaleString()}</div>
    </div>
  );
}

function HeadlineStat({ value, label, color }) {
  return (
    <div className="rp-headline" style={{ '--headline-color': color || 'var(--text-1)' }}>
      <div className="rp-headline-value">{Number(value || 0).toLocaleString()}</div>
      <div className="rp-headline-label">{label}</div>
    </div>
  );
}

function leadingItem(rows) {
  if (!rows || rows.length === 0) return null;
  return rows.reduce((max, r) => (r.count || 0) > (max.count || 0) ? r : max, rows[0]);
}

function ExportMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const linkCls = 'flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 w-full text-left';

  return (
    <div className="relative" ref={ref}>
      <Button variant="primary" icon="download" onClick={() => setOpen((v) => !v)}>Export</Button>
      {open && (
        <div className="absolute right-0 top-full mt-2 w-64 bg-white border border-gray-100 rounded-xl shadow-lg z-10 overflow-hidden">
          <a href="/api/reports_export?type=all&format=pdf"     target="_blank" rel="noreferrer" className={linkCls}><Icon name="file"/>Full report — PDF</a>
          <a href="/api/reports_export?type=all&format=csv"                                       className={linkCls}><Icon name="file"/>Full report — CSV</a>
          <div className="border-t border-gray-100" />
          <a href="/api/reports_export?type=leads&format=csv"                                     className={linkCls}><Icon name="users"/>Leads summary — CSV</a>
          <a href="/api/reports_export?type=dispatch&format=csv"                                  className={linkCls}><Icon name="truck"/>Bill of Sale summary — CSV</a>
          <a href="/api/reports_export?type=duplicates&format=csv"                                className={linkCls}><Icon name="duplicate"/>Duplicates summary — CSV</a>
          <div className="border-t border-gray-100" />
          <a href="/api/leads?format=csv"                                                         className={linkCls}><Icon name="download"/>All leads (rows) — CSV</a>
          <a href="/api/dispatch_calendar?format=csv&start=2000-01-01&end=2099-12-31"             className={linkCls}><Icon name="download"/>All sales / deliveries — CSV</a>
        </div>
      )}
    </div>
  );
}

export default function ReportsPage() {
  const [data, setData] = useState(null);
  const [dups, setDups] = useState(null);
  const [dispatch, setDispatch] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true); setError('');
    try {
      const [a, b, c] = await Promise.all([
        api.get('/reports', { params: { type: 'leads' } }),
        api.get('/reports', { params: { type: 'duplicates' } }).catch(() => ({ data: { duplicates: null } })),
        api.get('/reports', { params: { type: 'dispatch' } }).catch(() => ({ data: { dispatch: null } })),
      ]);
      setData(a.data?.leads || null);
      setDups(b.data?.duplicates || null);
      setDispatch(c.data?.dispatch || null);
    } catch (err) {
      setError(extractApiError(err, 'Failed to load reports'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  if (loading && !data) {
    return (
      <div className="page reports-page">
        <div className="rp-header">
          <div>
            <h1 className="section-title">Reports</h1>
            <p className="section-subtitle">Snapshot of the CRM's current state</p>
          </div>
        </div>
        <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-3)' }}>Loading…</div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="page reports-page">
        <div className="rp-header">
          <div>
            <h1 className="section-title">Reports</h1>
          </div>
        </div>
        <div className="card" style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}>{error}</div>
      </div>
    );
  }
  if (!data) return null;

  const sumOf = (rows) => (rows || []).reduce((s, r) => s + (r.count || 0), 0);

  // ---- Status ----
  const statusRows = (data.by_status || []).map((r) => ({
    key: r.key,
    label: STATUS_BY_KEY[r.key]?.label || r.key,
    count: r.count || 0,
    color: STATUS_DOT_VAR[r.key] || 'var(--text-2)',
  })).sort((a, b) => b.count - a.count);
  const statusTotal = sumOf(statusRows);
  const statusLeader = leadingItem(statusRows);

  // ---- Temperature ----
  const tempRows = (data.by_temperature || []).map((r) => ({
    key: r.key,
    label: TEMPERATURE_BY_KEY[r.key]?.label || r.key,
    count: r.count || 0,
    color: TEMP_COLOR[r.key] || 'var(--text-2)',
  }));
  const tempTotal = sumOf(tempRows);
  const tempLeader = leadingItem(tempRows);

  // ---- Priority ----
  const priorityRows = (data.by_priority || []).map((r) => ({
    key: r.key,
    label: PRIORITY_BY_KEY[r.key]?.label || r.key,
    count: r.count || 0,
    color: PRIORITY_COLOR[r.key] || 'var(--text-2)',
  }));
  const priorityTotal = sumOf(priorityRows);
  const priorityLeader = leadingItem(priorityRows);

  // ---- Stage ----
  const stageRows = (data.by_source_stage || []).map((r) => ({
    key: r.key,
    label: STAGE_META[r.key]?.label || r.key,
    count: r.count || 0,
    color: STAGE_META[r.key]?.color || 'var(--text-2)',
  }));
  const stageTotal = sumOf(stageRows);
  const stageLeader = leadingItem(stageRows);

  return (
    <div className="page reports-page">
      <div className="rp-header">
        <div>
          <h1 className="section-title">Reports</h1>
          <p className="section-subtitle">Live snapshot of the CRM · refresh anytime</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="secondary" icon="refresh" onClick={load}>Refresh</Button>
          <ExportMenu/>
        </div>
      </div>

      {/* Hero KPI tiles */}
      <div className="rp-hero">
        {KPI_TILES.map((t) => (
          <HeroKPI key={t.key} label={t.label} value={data[t.key]} icon={t.icon} tone={t.tone}/>
        ))}
      </div>

      {/* Three side-by-side: Status, Temperature, Priority */}
      <div className="rp-grid rp-grid-3">
        <ReportCard
          icon="activity"
          iconColor="var(--info)"
          title="By status"
          subtitle="Lead lifecycle"
          headline={statusLeader && <HeadlineStat value={statusLeader.count} label={statusLeader.label} color={statusLeader.color}/>}
        >
          {statusRows.length === 0
            ? <EmptyBars/>
            : statusRows.map((r) => (
                <BarItem
                  key={r.key}
                  label={r.label}
                  count={r.count}
                  total={statusTotal}
                  color={r.color}
                  leading={r.key === statusLeader?.key}
                />
              ))}
        </ReportCard>

        <ReportCard
          icon="fire"
          iconColor="var(--warm)"
          title="By temperature"
          subtitle="Outreach state"
          headline={tempLeader && <HeadlineStat value={tempLeader.count} label={tempLeader.label} color={tempLeader.color}/>}
        >
          {tempRows.length === 0
            ? <EmptyBars/>
            : tempRows.map((r) => (
                <BarItem key={r.key} label={r.label} count={r.count} total={tempTotal} color={r.color} leading={r.key === tempLeader?.key}/>
              ))}
        </ReportCard>

        <ReportCard
          icon="flag"
          iconColor="var(--danger)"
          title="By priority"
          subtitle="Operator-set priority"
          headline={priorityLeader && <HeadlineStat value={priorityLeader.count} label={priorityLeader.label} color={priorityLeader.color}/>}
        >
          {priorityRows.length === 0
            ? <EmptyBars/>
            : priorityRows.map((r) => (
                <BarItem key={r.key} label={r.label} count={r.count} total={priorityTotal} color={r.color} leading={r.key === priorityLeader?.key}/>
              ))}
        </ReportCard>
      </div>

      {/* Wide stage card + tasks tiles */}
      <div className="rp-grid rp-grid-stage-tasks">
        <ReportCard
          icon="pipeline"
          iconColor="var(--cold)"
          title="By data stage"
          subtitle="Where each VIN sits in enrichment"
          headline={stageLeader && <HeadlineStat value={stageLeader.count} label={stageLeader.label} color={stageLeader.color}/>}
        >
          {stageRows.length === 0
            ? <EmptyBars/>
            : stageRows.map((r) => (
                <BarItem key={r.key} label={r.label} count={r.count} total={stageTotal} color={r.color} leading={r.key === stageLeader?.key}/>
              ))}
        </ReportCard>

        <ReportCard
          icon="check"
          iconColor="var(--success)"
          title="Tasks"
          subtitle="Active workload"
        >
          <div className="rp-stats-row">
            <StatTile label="Open" value={data.open_tasks} tone="accent"/>
            <StatTile label="Due today" value={data.tasks_due_today} tone="warm"/>
            <StatTile label="Overdue" value={data.tasks_overdue} tone="danger"/>
          </div>
        </ReportCard>
      </div>

      {/* Bill of Sale — sales/deliveries across the CRM */}
      {dispatch && (
        <div className="rp-grid rp-grid-2">
          <ReportCard
            icon="truck"
            iconColor="var(--info)"
            title="Bill of Sale"
            subtitle={`${(dispatch.total ?? 0).toLocaleString()} sales total · ${dispatch.scheduled_7d ?? 0} this week`}
            headline={<HeadlineStat value={dispatch.scheduled_today ?? 0} label="today" color="var(--info)"/>}
          >
            <div className="rp-stats-row" style={{ marginBottom: 14 }}>
              <StatTile label="Today"       value={dispatch.scheduled_today}    tone="accent"/>
              <StatTile label="Next 7d"     value={dispatch.scheduled_7d}       tone="info"/>
              <StatTile label="Delivered (30d)" value={dispatch.delivered_30d}  tone="success"/>
              <StatTile label="Overdue"     value={dispatch.overdue}            tone="danger"/>
              <StatTile label="Unassigned"  value={dispatch.unassigned_active}  tone="warm"/>
            </div>
            {(dispatch.by_status || []).map((r) => {
              const meta = TRANSPORT_STATUS_BY_KEY[r.key] || {};
              const total = (dispatch.by_status || []).reduce((s, x) => s + (x.count || 0), 0);
              return (
                <BarItem
                  key={r.key}
                  label={meta.label || r.key}
                  count={r.count}
                  total={total}
                  color={meta.hex || 'var(--text-2)'}
                />
              );
            })}
          </ReportCard>

          <ReportCard
            icon="users"
            iconColor="var(--accent)"
            title="By transporter"
            subtitle="Workload across active carriers"
          >
            {(dispatch.by_transporter || []).length === 0 ? <EmptyBars/> : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: 'var(--text-3)', fontSize: 12 }}>
                      <th style={{ padding: '6px 8px', borderBottom: '1px solid var(--border-0)' }}>Transporter</th>
                      <th style={{ padding: '6px 8px', borderBottom: '1px solid var(--border-0)', textAlign: 'right' }}>Active</th>
                      <th style={{ padding: '6px 8px', borderBottom: '1px solid var(--border-0)', textAlign: 'right' }}>Delivered</th>
                      <th style={{ padding: '6px 8px', borderBottom: '1px solid var(--border-0)', textAlign: 'right' }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dispatch.by_transporter.map((r) => (
                      <tr key={r.id}>
                        <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--border-0)' }}>{r.name}</td>
                        <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--border-0)', textAlign: 'right' }}>{r.active}</td>
                        <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--border-0)', textAlign: 'right' }}>{r.delivered}</td>
                        <td style={{ padding: '6px 8px', borderBottom: '1px solid var(--border-0)', textAlign: 'right', fontWeight: 600 }}>{r.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </ReportCard>
        </div>
      )}

      {/* Duplicates + Match types */}
      {dups && (
        <div className="rp-grid rp-grid-2">
          <ReportCard
            icon="duplicate"
            iconColor="var(--warm)"
            title="Duplicate groups"
            subtitle={`${(dups.total ?? 0).toLocaleString()} total · ${dups.created_this_week ?? 0} new this week`}
            headline={<HeadlineStat value={dups.total ?? 0} label="groups" color="var(--warm)"/>}
          >
            {(dups.by_review_status || []).length === 0 ? <EmptyBars/> : (
              (dups.by_review_status || []).map((r) => {
                const reviewTotal = sumOf(dups.by_review_status);
                return (
                  <BarItem
                    key={r.key}
                    label={DUP_STATUS_META[r.key]?.label || r.key}
                    count={r.count}
                    total={reviewTotal}
                    color={DUP_STATUS_META[r.key]?.color || 'var(--text-2)'}
                  />
                );
              })
            )}
            {dups.merge_prep && (
              <div className="rp-stats-row" style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border-0)' }}>
                <StatTile label="Confirmed" value={dups.merge_prep.confirmed_groups} tone="success"/>
                <StatTile label="Prep draft" value={dups.merge_prep.draft} tone="info"/>
                <StatTile label="Prepared" value={dups.merge_prep.prepared} tone="accent"/>
              </div>
            )}
          </ReportCard>

          <ReportCard
            icon="merge"
            iconColor="var(--info)"
            title="Match types"
            subtitle="What attribute paired the dup cases"
          >
            {(dups.by_match_type || []).length === 0 ? <EmptyBars/> : (
              (dups.by_match_type || []).map((r) => {
                const matchTotal = sumOf(dups.by_match_type);
                return (
                  <BarItem
                    key={r.key}
                    label={r.key}
                    count={r.count}
                    total={matchTotal}
                    color="var(--text-1)"
                  />
                );
              })
            )}
          </ReportCard>
        </div>
      )}
    </div>
  );
}

function EmptyBars() {
  return (
    <div className="rp-empty">
      <Icon name="info" size={20}/>
      <div className="rp-empty-title">No data yet</div>
      <div className="rp-empty-body">Counts will appear here as leads come in.</div>
    </div>
  );
}

// Reuse the same dot-color maps the Pipeline page uses, so colors stay
// consistent across the app.
const STATUS_DOT_VAR = {
  new: 'var(--info)', contacted: 'var(--text-2)', callback: 'var(--warm)',
  interested: 'var(--success)', not_interested: 'var(--text-3)',
  wrong_number: 'var(--hot)', no_answer: 'var(--text-3)',
  voicemail_left: 'var(--info)', deal_closed: 'var(--success)',
  nurture: 'var(--info)', disqualified: 'var(--text-3)',
  do_not_call: 'var(--danger)', marketing: 'var(--info)',
};
const PRIORITY_COLOR = {
  low: 'var(--cold)', medium: 'var(--text-2)',
  high: 'var(--warm)', hot: 'var(--hot)',
};
const TEMP_COLOR = {
  cold: 'var(--cold)', warm: 'var(--warm)',
  hot: 'var(--hot)', closed: 'var(--success)',
};

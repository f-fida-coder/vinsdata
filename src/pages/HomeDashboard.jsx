import { Fragment, useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import api, { extractApiError } from '../api';
import { useAuth } from '../context/AuthContext';
import { LEAD_STATUSES, STATUS_BY_KEY, roleLabel } from '../lib/crm';

/**
 * Home dashboard — high-level CRM pulse.
 *
 * Lays out in three stacked bands:
 *   1. KPI strip (total / unassigned / hot / deals closed / open tasks / overdue / outreach).
 *      Each clickable card deep-links into the Leads or Tasks page with the
 *      corresponding filter already applied so the admin can drill in fast.
 *   2. Funnel — New → Contacted → Interested → Deal closed with counts and
 *      a conversion % between adjacent stages.
 *   3. Two side-by-side tables: per file (assigned vs unassigned ratio, hot,
 *      closed) and per agent (lead pipeline + open / overdue tasks).
 *   4. Compact bottom row: top 10 makes by lead volume + most recent
 *      imports.
 *
 * All data loads from /api/dashboard_overview — single request, scoped to
 * the operator's role server-side. Agents see only their own slice.
 */
export default function HomeDashboard() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await api.get('/dashboard_overview');
      setData(res.data);
    } catch (err) {
      setError(extractApiError(err, 'Failed to load dashboard'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="page" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
        <h1 className="section-title">Dashboard</h1>
        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
          {user?.name ? `Welcome back, ${user.name.split(' ')[0]}` : ''}
          <button
            onClick={load}
            disabled={loading}
            style={{
              marginLeft: 10, background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'var(--info)', fontSize: 12, fontWeight: 500,
            }}
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </span>
      </div>

      {error && (
        <div className="card" style={{ background: 'var(--danger-bg)', color: 'var(--danger)', padding: 12 }}>
          {error}
        </div>
      )}

      {loading && !data && (
        <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-3)' }}>
          <div className="spinner" style={{ margin: '0 auto 12px', width: 32, height: 32, border: '3px solid var(--border-1)', borderTopColor: 'var(--info)', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }}/>
          Loading dashboard…
        </div>
      )}

      {data && (
        <>
          <KpiStrip kpis={data.kpis} isAdmin={data.is_admin} />
          <Funnel funnel={data.funnel} />
          <div className="dash-grid">
            <FilesPanel rows={data.by_file} isAdmin={data.is_admin} />
            <AgentStatusDetailPanel rows={data.by_agent} isAdmin={data.is_admin} />
          </div>
          {/* Admin-only operational tables. Each shows a different
              slice of per-agent productivity. Stacked full-width since
              they all have multiple columns and don't pair well
              side-by-side. */}
          {data.is_admin && (
            <>
              <AgentTemperatureDetailPanel rows={data.by_agent} />
              <StalledDealsPanel           rows={data.stalled_deals || []} />
              <ActivityPanel              rows={data.by_agent} />
              <LeadManagementPanel        rows={data.by_agent} />
              <DealClosedPanel            rows={data.by_agent} />
            </>
          )}
          <div className="dash-grid">
            <MakesPanel rows={data.by_make} />
            <RecentImportsPanel rows={data.recent_imports} />
          </div>
        </>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        /* Two-band KPI layout (best-practice: action items first,
           snapshot second). Each band has its own label and a row of
           cards underneath. */
        .dash-kpi-section { display: flex; flex-direction: column; gap: 14px; }
        .dash-kpi-band { display: flex; flex-direction: column; gap: 6px; }
        .dash-kpi-band-label {
          font-size: 11px; font-weight: 700; color: var(--text-3);
          text-transform: uppercase; letter-spacing: 0.06em;
        }
        .dash-kpi-strip {
          display: grid; gap: 12px;
          grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
        }
        .dash-kpi {
          background: var(--bg-1); border: 1px solid var(--border-0);
          border-radius: var(--radius-lg, 10px); padding: 14px;
          display: flex; flex-direction: column; gap: 4px;
          text-decoration: none; color: inherit; transition: border-color 120ms, background 120ms;
        }
        .dash-kpi:hover { border-color: var(--info); }
        .dash-kpi-label { font-size: 11px; color: var(--text-3); font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
        .dash-kpi-value { font-size: 26px; font-weight: 700; color: var(--text-0); line-height: 1.1; font-variant-numeric: tabular-nums; }
        .dash-kpi-sub { font-size: 11px; color: var(--text-3); }
        .dash-kpi-accent-info    { border-top: 3px solid var(--info); }
        .dash-kpi-accent-warm    { border-top: 3px solid var(--warm); }
        .dash-kpi-accent-hot     { border-top: 3px solid var(--hot); }
        .dash-kpi-accent-success { border-top: 3px solid var(--success); }
        .dash-kpi-accent-violet  { border-top: 3px solid #8b5cf6; }
        .dash-kpi-accent-neutral { border-top: 3px solid var(--text-3); }

        /* "Snapshot" band — quieter visual style so it doesn't compete
           with the action cards above. No accent stripe, smaller value
           font, subdued background. */
        .dash-kpi-quiet {
          background: var(--bg-2); border-color: transparent;
        }
        .dash-kpi-quiet .dash-kpi-value { font-size: 22px; color: var(--text-1); }
        .dash-kpi-quiet:hover { border-color: var(--border-1); background: var(--bg-1); }
        .dash-kpi-tone-success .dash-kpi-value { color: var(--success); }

        /* Filled-red treatment for overdue tasks when count > 0 —
           escalates the worst-news signal so it can't be missed. */
        .dash-kpi-filled-hot {
          background: var(--hot-bg, #fee2e2);
          border-color: var(--hot, #b91c1c);
        }
        .dash-kpi-filled-hot .dash-kpi-label { color: var(--hot, #b91c1c); }
        .dash-kpi-filled-hot .dash-kpi-value { color: var(--hot, #b91c1c); }
        .dash-kpi-filled-hot:hover { background: #fecaca; border-color: var(--hot, #b91c1c); }

        .dash-section { background: var(--bg-1); border: 1px solid var(--border-0); border-radius: var(--radius-lg, 10px); padding: 14px; }
        .dash-section-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 12px; }
        .dash-section-title { font-size: 13px; font-weight: 600; color: var(--text-0); }
        .dash-section-sub { font-size: 11px; color: var(--text-3); }

        .dash-grid { display: grid; gap: 14px; grid-template-columns: 1fr; }
        @media (min-width: 1024px) { .dash-grid { grid-template-columns: 1fr 1fr; } }
        /* Tap-friendly row sizes on phones for the agent / files / makes
           tables — bigger padding + visible tap surface so the per-row
           click-through works without zooming. */
        @media (max-width: 640px) {
          .dash-table td { padding: 10px 8px; }
          .dash-table th { padding: 8px; }
          .dash-table { font-size: 13px; }
        }

        .dash-funnel { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0; align-items: stretch; }
        .dash-funnel-step {
          padding: 10px 14px; display: flex; flex-direction: column; gap: 4px;
          border-right: 1px solid var(--border-0);
        }
        .dash-funnel-step:last-child { border-right: 0; }
        /* Phone: stack the funnel two-per-row so each step keeps its
           own value column instead of squishing four numbers into a
           narrow screen. */
        @media (max-width: 640px) {
          .dash-funnel { grid-template-columns: repeat(2, 1fr); }
          .dash-funnel-step { border-right: 1px solid var(--border-0); border-bottom: 1px solid var(--border-0); }
          .dash-funnel-step:nth-child(2n) { border-right: 0; }
          .dash-funnel-step:nth-last-child(-n + 2) { border-bottom: 0; }
        }
        .dash-funnel-step-label { font-size: 11px; color: var(--text-3); font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
        .dash-funnel-step-value { font-size: 22px; font-weight: 700; color: var(--text-0); font-variant-numeric: tabular-nums; }
        .dash-funnel-step-conv { font-size: 10px; color: var(--text-3); }

        .dash-table { width: 100%; border-collapse: collapse; font-size: 12px; }
        .dash-table th { text-align: left; font-size: 10px; font-weight: 600; color: var(--text-3); text-transform: uppercase; letter-spacing: 0.04em; padding: 6px 8px; border-bottom: 1px solid var(--border-0); }
        .dash-table td { padding: 8px; border-bottom: 1px solid var(--border-0); vertical-align: middle; }
        .dash-table tr:last-child td { border-bottom: 0; }
        .dash-table tbody tr:hover { background: var(--bg-2); }

        .dash-bar { display: inline-block; width: 80px; height: 6px; background: var(--border-1); border-radius: 3px; overflow: hidden; vertical-align: middle; }
        .dash-bar-fill { height: 100%; background: var(--info); }

        .dash-pill { display: inline-flex; align-items: center; padding: 1px 6px; border-radius: 4px; font-size: 10px; font-weight: 600; }
        .dash-pill-hot { background: var(--hot-bg, #fee2e2); color: var(--hot, #b91c1c); }
        .dash-pill-success { background: var(--success-bg, #d1fae5); color: var(--success, #047857); }
        .dash-pill-warn { background: var(--warm-bg, #fef3c7); color: var(--warm, #a16207); }
        .dash-pill-neutral { background: var(--bg-2); color: var(--text-2); }
        .dash-pill-info { background: var(--info-bg, #dbeafe); color: var(--info, #1d4ed8); }
      `}</style>
    </div>
  );
}

// ---- KPI Strip --------------------------------------------------------

function KpiStrip({ kpis, isAdmin }) {
  // Dashboard best practices for a CRM home:
  //   1. Action items first (overdue, hot, unassigned) — the things
  //      an operator needs to DO. A red banner emphasizes overdue
  //      tasks when count > 0, since that's the worst-news signal.
  //   2. Snapshot KPIs second (totals + 7-day deltas) — context, not
  //      action. Smaller emphasis, less color.
  //   3. Every card deep-links into Leads or Tasks with the matching
  //      filter pre-applied, so a click is a workflow shortcut.
  //
  // Agents don't see "unassigned" because they only ever see their
  // own scope — the server returns 0 there anyway.

  const overdueCount = kpis.overdue_tasks ?? 0;

  // Group 1: things that need attention RIGHT NOW. Overdue first so it
  // anchors the top-left (F-pattern); the card flips to a filled red
  // background when count > 0 to escalate visually.
  const actionItems = [
    {
      label: 'Overdue tasks',
      value: overdueCount,
      accent: overdueCount > 0 ? 'hot' : 'neutral',
      filled: overdueCount > 0,
      to: '/leads?tasks_overdue=1',
    },
    { label: 'Hot leads',   value: kpis.hot,        accent: 'hot',  to: '/leads?lead_temperature=hot' },
    isAdmin && { label: 'Unassigned', value: kpis.unassigned, accent: 'warm', to: '/leads?assigned_user_id=unassigned' },
    { label: 'Open tasks',  value: kpis.open_tasks, accent: 'violet', to: '/tasks?status=open' },
  ].filter(Boolean);

  // Group 2: snapshot context. Less weight, no accent stripe so the
  // eye knows these are info-only, not action prompts.
  const snapshot = [
    { label: 'Total leads',   value: kpis.total,              to: '/leads' },
    { label: 'Closed · 7d',   value: kpis.deals_closed_week,  to: '/leads?status=deal_closed', tone: 'success' },
    { label: 'Outreach · 7d', value: kpis.outreach_sent_week, to: null },
  ];

  const renderCard = (it) => {
    const isFilled = it.filled;
    const accentCls = it.accent ? `dash-kpi-accent-${it.accent}` : '';
    const filledCls = isFilled ? 'dash-kpi-filled-hot' : '';
    const cls = `dash-kpi ${accentCls} ${filledCls}`.trim();
    const inner = (
      <>
        <span className="dash-kpi-label">{it.label}</span>
        <span className="dash-kpi-value">{(it.value ?? 0).toLocaleString()}</span>
      </>
    );
    return it.to
      ? <Link key={it.label} to={it.to} className={cls}>{inner}</Link>
      : <div key={it.label} className={cls}>{inner}</div>;
  };

  return (
    <div className="dash-kpi-section">
      {/* Action band — labelled so operators understand the grouping. */}
      <div className="dash-kpi-band">
        <div className="dash-kpi-band-label">Needs attention</div>
        <div className="dash-kpi-strip">
          {actionItems.map(renderCard)}
        </div>
      </div>

      {/* Snapshot band — context metrics in a calmer visual style. */}
      <div className="dash-kpi-band">
        <div className="dash-kpi-band-label">Snapshot</div>
        <div className="dash-kpi-strip">
          {snapshot.map((it) => {
            const cls = `dash-kpi dash-kpi-quiet${it.tone === 'success' ? ' dash-kpi-tone-success' : ''}`;
            const inner = (
              <>
                <span className="dash-kpi-label">{it.label}</span>
                <span className="dash-kpi-value">{(it.value ?? 0).toLocaleString()}</span>
              </>
            );
            return it.to
              ? <Link key={it.label} to={it.to} className={cls}>{inner}</Link>
              : <div key={it.label} className={cls}>{inner}</div>;
          })}
        </div>
      </div>
    </div>
  );
}

// ---- Funnel -----------------------------------------------------------

function Funnel({ funnel }) {
  // Conversion between adjacent stages — gives a quick "is the team
  // actually moving leads through" read at a glance.
  const conv = (i) => {
    if (i === 0) return null;
    const prev = funnel[i - 1]?.count ?? 0;
    const curr = funnel[i]?.count ?? 0;
    if (prev === 0) return null;
    return Math.round((curr / prev) * 100);
  };

  return (
    <div className="dash-section">
      <div className="dash-section-head">
        <span className="dash-section-title">Pipeline</span>
        <span className="dash-section-sub">New → Callback → Interested → Closed</span>
      </div>
      <div className="dash-funnel">
        {funnel.map((s, i) => {
          const meta = STATUS_BY_KEY[s.key] || { label: s.key };
          const c = conv(i);
          return (
            <Link
              key={s.key}
              to={`/leads?status=${s.key}`}
              className="dash-funnel-step"
              style={{ textDecoration: 'none', color: 'inherit' }}
            >
              <span className="dash-funnel-step-label">{meta.label}</span>
              <span className="dash-funnel-step-value">{s.count.toLocaleString()}</span>
              <span className="dash-funnel-step-conv">
                {c !== null ? `${c}% from prev` : ' '}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

// ---- Files panel ------------------------------------------------------

function FilesPanel({ rows, isAdmin }) {
  // Compact "last assigned" formatter — always MM/DD/YY so the year
  // is visible at a glance (operator asked for it explicitly; before
  // this we dropped the year for same-year dates to save space).
  // Returns null for files that never had an assignment so the cell
  // renders an em-dash instead of "Invalid Date".
  const fmtShortDate = (s) => {
    if (!s) return null;
    const d = new Date(String(s).replace(' ', 'T'));
    if (Number.isNaN(d.getTime())) return null;
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const yy = String(d.getFullYear()).slice(-2);
    return `${mm}/${dd}/${yy}`;
  };
  const fmtFullStamp = (s) => {
    if (!s) return '';
    const d = new Date(String(s).replace(' ', 'T'));
    return Number.isNaN(d.getTime()) ? s : d.toLocaleString();
  };

  return (
    <div className="dash-section">
      <div className="dash-section-head">
        <span className="dash-section-title">Files</span>
        <span className="dash-section-sub">
          {rows.length} {rows.length === 1 ? 'file' : 'files'} · sorted by lead count
        </span>
      </div>
      {rows.length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--text-3)', padding: 12 }}>No imports yet.</p>
      ) : (
        <div style={{ maxHeight: 360, overflowY: 'auto', overflowX: 'auto' }}>
          <table className="dash-table">
            <thead>
              <tr>
                <th>File / Vehicle</th>
                <th style={{ textAlign: 'right' }} title="Leads in this file that have a primary phone number (the callable pool)">Total</th>
                {isAdmin && <th>Assigned</th>}
                <th style={{ textAlign: 'right' }}>New</th>
                <th style={{ textAlign: 'right' }}>Hot</th>
                <th style={{ textAlign: 'right' }}>Closed</th>
                <th style={{ textAlign: 'right' }} title="Most recent date an assigned lead in this file was touched">Last assigned</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.file_id}>
                  <td>
                    <Link to={`/leads?file_id=${r.file_id}`} style={{ color: 'var(--text-0)', textDecoration: 'none' }}>
                      <div style={{ fontWeight: 500 }}>{r.file_name}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-3)' }}>{r.vehicle}</div>
                    </Link>
                  </td>
                  <td
                    style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}
                    title={r.total_all !== undefined ? `${r.total_all.toLocaleString()} total imported · ${r.total.toLocaleString()} with phone` : undefined}
                  >
                    {r.total.toLocaleString()}
                  </td>
                  {isAdmin && (
                    <td>
                      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        {/* Denominator is leads with a primary phone (the
                            callable pool), not all leads — so the bar
                            tracks how much of the workable list has an
                            agent on it rather than getting dragged down
                            by phoneless rows we can't action anyway. */}
                        <span
                          className="dash-bar"
                          title={`${r.assigned_with_phone ?? r.assigned} of ${r.with_phone ?? r.total} leads with a phone are assigned`}
                        >
                          <span className="dash-bar-fill" style={{ width: `${r.assigned_pct}%` }}/>
                        </span>
                        <span style={{ fontSize: 11, color: 'var(--text-2)' }}>{r.assigned_pct}%</span>
                        {/* "N left" = raw count of leads with no
                            assignee in this file. Total assignment
                            debt at a glance. Clicks through to the
                            unassigned subset on the leads page. */}
                        {r.unassigned > 0 && (
                          <Link
                            to={`/leads?file_id=${r.file_id}&assigned_user_id=unassigned`}
                            className="dash-pill dash-pill-warn"
                            title="Click to filter to all unassigned leads in this file"
                          >
                            {r.unassigned} left
                          </Link>
                        )}
                      </div>
                    </td>
                  )}
                  <td style={{ textAlign: 'right' }}>
                    {r.new_leads > 0
                      ? <span className="dash-pill dash-pill-info">{r.new_leads}</span>
                      : <span style={{ color: 'var(--text-3)' }}>—</span>}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {r.hot > 0 ? <span className="dash-pill dash-pill-hot">{r.hot}</span> : <span style={{ color: 'var(--text-3)' }}>—</span>}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {r.closed > 0 ? <span className="dash-pill dash-pill-success">{r.closed}</span> : <span style={{ color: 'var(--text-3)' }}>—</span>}
                  </td>
                  <td
                    style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontSize: 11, color: 'var(--text-2)' }}
                    title={r.last_assigned_at ? fmtFullStamp(r.last_assigned_at) : 'No leads in this file have been assigned yet'}
                  >
                    {fmtShortDate(r.last_assigned_at) || <span style={{ color: 'var(--text-3)' }}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---- Agents panel -----------------------------------------------------

function AgentStatusDetailPanel({ rows, isAdmin }) {
  return (
    <div className="dash-section">
      <div className="dash-section-head">
        <span className="dash-section-title">{isAdmin ? 'Agent Status Detail' : 'My pipeline'}</span>
        <span className="dash-section-sub">
          {rows.length} {isAdmin ? (rows.length === 1 ? 'active' : 'active') : ''} {isAdmin ? '' : 'agent'}
        </span>
      </div>
      {rows.length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--text-3)', padding: 12 }}>No leads assigned yet.</p>
      ) : (
        <div style={{ maxHeight: 360, overflowY: 'auto', overflowX: 'auto' }}>
          <table className="dash-table">
            <thead>
              <tr>
                <th>Agent</th>
                <th style={{ textAlign: 'right' }}>Leads</th>
                <th style={{ textAlign: 'right' }} title="Status changes the agent made today (since midnight UTC)">Today</th>
                <th style={{ textAlign: 'right' }} title="Status changes the agent made this week (Mon–Sun)">Week</th>
                <th style={{ textAlign: 'right' }}>Interested</th>
                <th style={{ textAlign: 'right' }} title="Leads where the lead has verbally committed to the deal">Verbal Commit.</th>
                <th style={{ textAlign: 'right' }}>Hot</th>
                <th style={{ textAlign: 'right' }}>Closed</th>
                <th style={{ textAlign: 'right' }}>Tasks</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.user_id}>
                  <td>
                    <Link to={`/leads?assigned_user_id=${r.user_id}`} style={{ color: 'var(--text-0)', textDecoration: 'none' }}>
                      <div style={{ fontWeight: 500 }}>{r.name}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-3)' }}>{roleLabel(r.role)}</div>
                    </Link>
                  </td>
                  <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                    {r.total_assigned.toLocaleString()}
                  </td>
                  {/* Status changes the agent made today — quick "are
                      they actually doing work today?" signal. Pill
                      coloring rises with activity: gray (0) → blue
                      (1-9) → green (10+). */}
                  <td style={{ textAlign: 'right' }}>
                    {r.status_changes_today > 0 ? (
                      <span
                        className="dash-pill"
                        style={{
                          background: r.status_changes_today >= 10 ? '#d1fae5' : '#dbeafe',
                          color:      r.status_changes_today >= 10 ? '#047857' : '#1d4ed8',
                        }}
                        title={`${r.status_changes_today} status change${r.status_changes_today === 1 ? '' : 's'} today`}
                      >
                        {r.status_changes_today}
                      </span>
                    ) : <span style={{ color: 'var(--text-3)' }}>—</span>}
                  </td>
                  {/* Week column — status changes this week (Mon-Sun).
                      Same color scaling, just a higher activity bar
                      since it's accumulated over 7 days. */}
                  <td style={{ textAlign: 'right' }}>
                    {r.status_changes_week > 0 ? (
                      <span
                        className="dash-pill"
                        style={{
                          background: r.status_changes_week >= 40 ? '#d1fae5' : '#dbeafe',
                          color:      r.status_changes_week >= 40 ? '#047857' : '#1d4ed8',
                        }}
                        title={`${r.status_changes_week} status change${r.status_changes_week === 1 ? '' : 's'} this week (Mon–Sun)`}
                      >
                        {r.status_changes_week}
                      </span>
                    ) : <span style={{ color: 'var(--text-3)' }}>—</span>}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {r.interested > 0 ? (
                      <Link
                        to={`/leads?assigned_user_id=${r.user_id}&status=interested`}
                        className="dash-pill"
                        style={{ background: '#d1fae5', color: '#047857' }}
                      >
                        {r.interested}
                      </Link>
                    ) : <span style={{ color: 'var(--text-3)' }}>—</span>}
                  </td>
                  {/* Verbal Commitment — between Interested and Hot in
                      the funnel; flagged as teal to distinguish from
                      Interested's emerald and the deal-closed greens. */}
                  <td style={{ textAlign: 'right' }}>
                    {r.verbal_commitment > 0 ? (
                      <Link
                        to={`/leads?assigned_user_id=${r.user_id}&status=verbal_commitment`}
                        className="dash-pill"
                        style={{ background: '#ccfbf1', color: '#0f766e' }}
                      >
                        {r.verbal_commitment}
                      </Link>
                    ) : <span style={{ color: 'var(--text-3)' }}>—</span>}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {r.hot > 0 ? <span className="dash-pill dash-pill-hot">{r.hot}</span> : <span style={{ color: 'var(--text-3)' }}>—</span>}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {r.closed > 0 ? <span className="dash-pill dash-pill-success">{r.closed}</span> : <span style={{ color: 'var(--text-3)' }}>—</span>}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {r.overdue_tasks > 0 ? (
                      <Link to={`/tasks?assigned_user_id=${r.user_id}&overdue=1`} className="dash-pill dash-pill-hot" title="overdue tasks">
                        {r.overdue_tasks} overdue
                      </Link>
                    ) : r.open_tasks > 0 ? (
                      <span className="dash-pill dash-pill-neutral">{r.open_tasks} open</span>
                    ) : (
                      <span style={{ color: 'var(--text-3)' }}>—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---- Admin-only operational tables ----------------------------------
//
// Four admin-only views, each a different slice of per-agent productivity.
// Share the same row source (data.by_agent) — backend builds every
// aggregate; each panel just picks the columns it cares about. Each
// row's Agent cell links to /leads?assigned_user_id=X so admins can
// drill into a specific agent's pool with one click.

function AgentRowCell({ row }) {
  return (
    <td>
      <Link to={`/leads?assigned_user_id=${row.user_id}`} style={{ color: 'var(--text-0)', textDecoration: 'none' }}>
        <div style={{ fontWeight: 500 }}>{row.name}</div>
        <div style={{ fontSize: 10, color: 'var(--text-3)' }}>{roleLabel(row.role)}</div>
      </Link>
    </td>
  );
}

function NumCell({ value, color, dim }) {
  if (!value) {
    return <td style={{ textAlign: 'right', color: 'var(--text-3)' }}>—</td>;
  }
  return (
    <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600, color: dim ? 'var(--text-2)' : (color || 'var(--text-0)') }}>
      {value.toLocaleString()}
    </td>
  );
}

function AgentTemperatureDetailPanel({ rows }) {
  return (
    <div className="dash-section">
      <div className="dash-section-head">
        <span className="dash-section-title">Agent Temperature Detail</span>
        <span className="dash-section-sub">Interested broken down by temperature + priority</span>
      </div>
      {rows.length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--text-3)', padding: 12 }}>No agents yet.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="dash-table">
            <thead>
              <tr>
                <th>Agent</th>
                <th style={{ textAlign: 'right' }} title="status=interested AND temperature=hot">Interested + Hot</th>
                <th style={{ textAlign: 'right' }} title="status=interested AND priority=high">Interested + High</th>
                <th style={{ textAlign: 'right' }} title="status=interested AND priority=medium">Interested + Medium</th>
                <th style={{ textAlign: 'right' }} title="status=verbal_commitment">Verbal Commit.</th>
                <th style={{ textAlign: 'right' }} title="status=pending_close">Pending Close</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.user_id}>
                  <AgentRowCell row={r}/>
                  <NumCell value={r.interested_hot}    color="var(--hot)"/>
                  <NumCell value={r.interested_high}   color="var(--warm)"/>
                  <NumCell value={r.interested_medium} dim/>
                  <NumCell value={r.verbal_commitment} color="#0f766e"/>
                  <NumCell value={r.pending_close}     color="#65a30d"/>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ActivityPanel({ rows }) {
  return (
    <div className="dash-section">
      <div className="dash-section-head">
        <span className="dash-section-title">Activity</span>
        <span className="dash-section-sub">Today / This week (Mon–Sun)</span>
      </div>
      {rows.length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--text-3)', padding: 12 }}>No agents yet.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="dash-table">
            <thead>
              {/* Two-row header: top groups columns by metric, bottom
                  splits each into Today / Week. Keeps the table from
                  needing 8 separately-labeled columns. */}
              <tr>
                <th rowSpan={2}>Agent</th>
                <th colSpan={2} style={{ textAlign: 'center', borderBottom: '1px solid var(--border-0)' }}>Status changes</th>
                <th colSpan={2} style={{ textAlign: 'center', borderBottom: '1px solid var(--border-0)' }} title="Calls picked up via OpenPhone (authenticated phone events)">Calls logged</th>
                <th colSpan={2} style={{ textAlign: 'center', borderBottom: '1px solid var(--border-0)' }}>Tasks completed</th>
                <th colSpan={2} style={{ textAlign: 'center', borderBottom: '1px solid var(--border-0)' }} title="Tasks the agent created AND assigned to themselves (not delegated)">Self-tasks created</th>
              </tr>
              <tr>
                <th style={{ textAlign: 'right', fontSize: 10 }}>Today</th>
                <th style={{ textAlign: 'right', fontSize: 10 }}>Week</th>
                <th style={{ textAlign: 'right', fontSize: 10 }}>Today</th>
                <th style={{ textAlign: 'right', fontSize: 10 }}>Week</th>
                <th style={{ textAlign: 'right', fontSize: 10 }}>Today</th>
                <th style={{ textAlign: 'right', fontSize: 10 }}>Week</th>
                <th style={{ textAlign: 'right', fontSize: 10 }}>Today</th>
                <th style={{ textAlign: 'right', fontSize: 10 }}>Week</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.user_id}>
                  <AgentRowCell row={r}/>
                  <NumCell value={r.status_changes_today}/>
                  <NumCell value={r.status_changes_week} dim/>
                  <NumCell value={r.calls_today}/>
                  <NumCell value={r.calls_week} dim/>
                  <NumCell value={r.tasks_completed_today}/>
                  <NumCell value={r.tasks_completed_week} dim/>
                  <NumCell value={r.self_tasks_today}/>
                  <NumCell value={r.self_tasks_week} dim/>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function LeadManagementPanel({ rows }) {
  return (
    <div className="dash-section">
      <div className="dash-section-head">
        <span className="dash-section-title">Lead Management</span>
        <span className="dash-section-sub">Untouched + No Answer pools per agent</span>
      </div>
      {rows.length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--text-3)', padding: 12 }}>No agents yet.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="dash-table">
            <thead>
              <tr>
                <th>Agent</th>
                <th style={{ textAlign: 'right' }} title="Assigned leads still in 'new' status (or no state row yet)">Untouched</th>
                <th style={{ textAlign: 'right' }} title="Assigned leads with status='no_answer'">No Answer</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.user_id}>
                  <AgentRowCell row={r}/>
                  <td style={{ textAlign: 'right' }}>
                    {r.untouched > 0 ? (
                      <Link
                        to={`/leads?assigned_user_id=${r.user_id}&status=new`}
                        className="dash-pill dash-pill-warn"
                      >
                        {r.untouched}
                      </Link>
                    ) : <span style={{ color: 'var(--text-3)' }}>—</span>}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {r.no_answer > 0 ? (
                      <Link
                        to={`/leads?assigned_user_id=${r.user_id}&status=no_answer`}
                        className="dash-pill dash-pill-neutral"
                      >
                        {r.no_answer}
                      </Link>
                    ) : <span style={{ color: 'var(--text-3)' }}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StalledDealsPanel({ rows }) {
  // Group rows by assigned agent so the admin sees the warning sorted
  // by who's letting deals slip. Unassigned leads fall into a synthetic
  // 'Unassigned' bucket at the top so they're impossible to miss.
  const grouped = useMemo(() => {
    const out = new Map();
    for (const r of rows) {
      const k = r.assigned_user_id || '__unassigned';
      const label = r.assigned_user_name || 'Unassigned';
      if (!out.has(k)) out.set(k, { user_id: r.assigned_user_id, name: label, items: [] });
      out.get(k).items.push(r);
    }
    return [...out.values()].sort((a, b) => {
      if (a.user_id === null && b.user_id !== null) return -1; // unassigned first
      if (b.user_id === null && a.user_id !== null) return 1;
      return (a.name || '').localeCompare(b.name || '');
    });
  }, [rows]);

  const fmtPhone = (p) => {
    if (!p) return null;
    const d = String(p).replace(/\D+/g, '');
    if (d.length === 11 && d[0] === '1') return `(${d.slice(1,4)}) ${d.slice(4,7)}-${d.slice(7)}`;
    if (d.length === 10)                  return `(${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6)}`;
    return p;
  };
  const fmtYmm = (r) => [r.year, r.make, r.model].filter(Boolean).join(' ');
  const STATUS_LABEL = {
    interested: 'Interested',
    verbal_commitment: 'Verbal Commit.',
    pending_close: 'Pending Close',
  };
  const STATUS_BG = {
    interested: { bg: '#d1fae5', text: '#047857' },
    verbal_commitment: { bg: '#ccfbf1', text: '#0f766e' },
    pending_close: { bg: '#ecfccb', text: '#65a30d' },
  };

  return (
    <div className="dash-section">
      <div className="dash-section-head">
        <span className="dash-section-title">Stalled Deals</span>
        <span className="dash-section-sub">
          Interested / Verbal Commit. / Pending Close · no note + no completed task in 5+ days
        </span>
      </div>
      {rows.length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--text-3)', padding: 12 }}>
          No stalled deals — every closing-funnel lead has a note or completed task within the last 5 days.
        </p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="dash-table">
            <thead>
              <tr>
                <th>Agent</th>
                <th>First name</th>
                <th>Last name</th>
                <th>Vehicle (year/make/model)</th>
                <th>Phone</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {grouped.map((group) => (
                <Fragment key={group.user_id ?? '__u'}>
                  {/* Group header row — bold agent name, spans the
                      whole table width. Clicking jumps to that agent's
                      filtered leads view. */}
                  <tr style={{ background: 'var(--bg-2)' }}>
                    <td colSpan={6} style={{ fontWeight: 700, fontSize: 12, padding: '6px 8px' }}>
                      {group.user_id != null ? (
                        <Link to={`/leads?assigned_user_id=${group.user_id}`} style={{ color: 'var(--text-0)', textDecoration: 'none' }}>
                          {group.name} <span style={{ fontWeight: 500, color: 'var(--text-3)' }}>· {group.items.length} stalled</span>
                        </Link>
                      ) : (
                        <span style={{ color: 'var(--warm)' }}>{group.name} · {group.items.length} stalled</span>
                      )}
                    </td>
                  </tr>
                  {group.items.map((r) => {
                    const phoneRendered = fmtPhone(r.phone);
                    const ymm = fmtYmm(r);
                    const sb = STATUS_BG[r.status] || { bg: 'var(--bg-2)', text: 'var(--text-2)' };
                    return (
                      <tr key={r.lead_id}>
                        <td className="cell-muted tiny" style={{ paddingLeft: 16 }}>↳</td>
                        <td>
                          <Link to={`/leads?lead_id=${r.lead_id}`} style={{ color: 'var(--text-0)', textDecoration: 'none', fontWeight: 500 }}>
                            {r.first_name || <span style={{ color: 'var(--text-3)' }}>—</span>}
                          </Link>
                        </td>
                        <td>
                          <Link to={`/leads?lead_id=${r.lead_id}`} style={{ color: 'var(--text-0)', textDecoration: 'none', fontWeight: 500 }}>
                            {r.last_name || <span style={{ color: 'var(--text-3)' }}>—</span>}
                          </Link>
                        </td>
                        <td>
                          {ymm ? (
                            <Link to={`/leads?lead_id=${r.lead_id}`} style={{ color: 'var(--text-1)', textDecoration: 'none' }}>
                              {ymm}
                            </Link>
                          ) : <span style={{ color: 'var(--text-3)' }}>—</span>}
                        </td>
                        <td>
                          {phoneRendered ? (
                            <a href={`tel:${r.phone}`} className="cell-mono" style={{ color: 'var(--text-1)', textDecoration: 'none' }}>
                              {phoneRendered}
                            </a>
                          ) : <span style={{ color: 'var(--text-3)' }}>—</span>}
                        </td>
                        <td>
                          <Link
                            to={`/leads?status=${r.status}${r.assigned_user_id ? `&assigned_user_id=${r.assigned_user_id}` : ''}`}
                            className="dash-pill"
                            style={{ background: sb.bg, color: sb.text }}
                          >
                            {STATUS_LABEL[r.status] || r.status}
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function DealClosedPanel({ rows }) {
  // Aggregate totals across all agents — appended as a footer row so
  // admins see the team-wide signal in addition to per-agent breakdown.
  const totals = rows.reduce((acc, r) => ({
    prev_month: acc.prev_month + (r.deals_prev_month || 0),
    curr_month: acc.curr_month + (r.deals_curr_month || 0),
    ytd:        acc.ytd        + (r.deals_ytd        || 0),
  }), { prev_month: 0, curr_month: 0, ytd: 0 });
  return (
    <div className="dash-section">
      <div className="dash-section-head">
        <span className="dash-section-title">Deals Closed</span>
        <span className="dash-section-sub">Status flipped to deal_closed by agent + total</span>
      </div>
      {rows.length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--text-3)', padding: 12 }}>No agents yet.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="dash-table">
            <thead>
              <tr>
                <th>Agent</th>
                <th style={{ textAlign: 'right' }}>Previous month</th>
                <th style={{ textAlign: 'right' }}>Current month</th>
                <th style={{ textAlign: 'right' }}>YTD</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.user_id}>
                  <AgentRowCell row={r}/>
                  <NumCell value={r.deals_prev_month} dim/>
                  <NumCell value={r.deals_curr_month} color="var(--success)"/>
                  <NumCell value={r.deals_ytd}/>
                </tr>
              ))}
              {/* Totals row — bold + top border so it visually separates
                  from the per-agent body. */}
              <tr style={{ borderTop: '2px solid var(--border-0)', background: 'var(--bg-2)' }}>
                <td style={{ fontWeight: 700 }}>Total</td>
                <td style={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                  {totals.prev_month.toLocaleString()}
                </td>
                <td style={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: 'var(--success)' }}>
                  {totals.curr_month.toLocaleString()}
                </td>
                <td style={{ textAlign: 'right', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                  {totals.ytd.toLocaleString()}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---- Top makes --------------------------------------------------------

function MakesPanel({ rows }) {
  // Max value drives the bar widths.
  const max = rows.reduce((m, r) => Math.max(m, r.total), 0) || 1;
  return (
    <div className="dash-section">
      <div className="dash-section-head">
        <span className="dash-section-title">Top makes</span>
        <span className="dash-section-sub">By lead volume</span>
      </div>
      {rows.length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--text-3)', padding: 12 }}>No make data yet.</p>
      ) : (
        <table className="dash-table">
          <tbody>
            {rows.map((r) => (
              <tr key={r.make}>
                <td style={{ width: '30%' }}>
                  <Link to={`/leads?make=${encodeURIComponent(r.make)}`} style={{ color: 'var(--text-0)', textDecoration: 'none', fontWeight: 500 }}>
                    {r.make}
                  </Link>
                </td>
                <td>
                  <span style={{ display: 'inline-block', width: '100%', maxWidth: 240, height: 6, background: 'var(--border-1)', borderRadius: 3, overflow: 'hidden' }}>
                    <span style={{ display: 'block', height: '100%', width: `${Math.round((r.total / max) * 100)}%`, background: 'var(--info)' }}/>
                  </span>
                </td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                  {r.total.toLocaleString()}
                </td>
                <td style={{ textAlign: 'right' }}>
                  {r.hot > 0 && <span className="dash-pill dash-pill-hot" title="hot leads">{r.hot}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ---- Recent imports ---------------------------------------------------

function RecentImportsPanel({ rows }) {
  const formatStamp = (s) => {
    if (!s) return '';
    const d = new Date(String(s).replace(' ', 'T'));
    if (Number.isNaN(d.getTime())) return s;
    return d.toLocaleString();
  };
  return (
    <div className="dash-section">
      <div className="dash-section-head">
        <span className="dash-section-title">Recent imports</span>
        <span className="dash-section-sub">Last 5 batches</span>
      </div>
      {rows.length === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--text-3)', padding: 12 }}>No imports yet.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {rows.map((r) => (
            <li key={r.batch_id}>
              <Link
                to={`/leads?batch_id=${r.batch_id}`}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '8px 10px', borderRadius: 6,
                  background: 'var(--bg-2)', textDecoration: 'none', color: 'inherit',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-0)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {r.vehicle || r.batch_name}
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-3)' }}>{formatStamp(r.imported_at)}</div>
                </div>
                <span className="dash-pill dash-pill-neutral" style={{ fontSize: 11, padding: '2px 8px' }}>
                  {r.lead_count.toLocaleString()} leads
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Keep the LEAD_STATUSES + roleLabel imports referenced to avoid the
// "imported but unused" lint when LEAD_STATUSES is only consulted via
// STATUS_BY_KEY above. (Some linters need a side-effect anchor.)
void LEAD_STATUSES;

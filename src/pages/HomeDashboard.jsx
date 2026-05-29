import { useState, useEffect, useCallback } from 'react';
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
            <AgentsPanel rows={data.by_agent} isAdmin={data.is_admin} />
          </div>
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
        <span className="dash-section-sub">New → Contacted → Interested → Closed</span>
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
                        {/* "+N todo" = the raw count of leads with no
                            assignee in this file. Operator asked for
                            the literal unassigned count (not the
                            phone-filtered one) so they can see total
                            assignment debt at a glance. */}
                        {r.unassigned > 0 && (
                          <Link
                            to={`/leads?file_id=${r.file_id}&assigned_user_id=unassigned`}
                            className="dash-pill dash-pill-warn"
                            title="Click to filter to all unassigned leads in this file"
                          >
                            +{r.unassigned} todo
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

function AgentsPanel({ rows, isAdmin }) {
  return (
    <div className="dash-section">
      <div className="dash-section-head">
        <span className="dash-section-title">{isAdmin ? 'Agents' : 'My pipeline'}</span>
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
                <th style={{ textAlign: 'right' }}>Contacted</th>
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
                  <td style={{ textAlign: 'right' }}>
                    {/* Click → leads filtered to this agent + status=contacted
                        so admins can drill straight into "who has Saad
                        actually been working today". */}
                    {r.contacted > 0 ? (
                      <Link
                        to={`/leads?assigned_user_id=${r.user_id}&status=contacted`}
                        className="dash-pill"
                        style={{ background: '#dbeafe', color: '#1d4ed8' }}
                      >
                        {r.contacted}
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

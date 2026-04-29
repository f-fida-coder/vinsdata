import { useEffect, useState } from 'react';
import api, { extractApiError } from '../api';
import { SectionHeader, KPI, Bar, Button, Icon } from '../components/ui';
import { LEAD_STATUSES, LEAD_PRIORITIES, LEAD_TEMPERATURES, STATUS_BY_KEY, PRIORITY_BY_KEY, TEMPERATURE_BY_KEY } from '../lib/crm';

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

export default function ReportsPage() {
  const [data, setData] = useState(null);
  const [dups, setDups] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true); setError('');
    try {
      const [a, b] = await Promise.all([
        api.get('/reports', { params: { type: 'leads' } }),
        api.get('/reports', { params: { type: 'duplicates' } }).catch(() => ({ data: { duplicates: null } })),
      ]);
      setData(a.data?.leads || null);
      setDups(b.data?.duplicates || null);
    } catch (err) {
      setError(extractApiError(err, 'Failed to load reports'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  if (loading && !data) {
    return (
      <div className="page">
        <SectionHeader title="Reports" subtitle="Snapshot of the CRM's current state"/>
        <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-3)' }}>Loading…</div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="page">
        <SectionHeader title="Reports"/>
        <div className="card" style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}>{error}</div>
      </div>
    );
  }
  if (!data) return null;

  const statusRows = data.by_status?.map((r) => [
    STATUS_BY_KEY[r.key]?.label || r.key,
    r.count,
    'var(--text-1)',
  ]) || [];
  const tempRows = data.by_temperature?.map((r) => [
    TEMPERATURE_BY_KEY[r.key]?.label || r.key,
    r.count,
    r.key === 'hot' ? 'var(--hot)' : r.key === 'warm' ? 'var(--warm)' : r.key === 'closed' ? 'var(--success)' : 'var(--cold)',
  ]) || [];
  const priorityRows = data.by_priority?.map((r) => [
    PRIORITY_BY_KEY[r.key]?.label || r.key,
    r.count,
    r.key === 'high' || r.key === 'hot' ? 'var(--danger)' : r.key === 'low' ? 'var(--cold)' : 'var(--text-1)',
  ]) || [];
  const stageRows = data.by_source_stage?.map((r) => [
    STAGE_META[r.key]?.label || r.key,
    r.count,
    STAGE_META[r.key]?.color || 'var(--text-2)',
  ]) || [];

  const maxOf = (rows, idx = 1) => Math.max(1, ...rows.map((r) => r[idx] || 0));

  return (
    <div className="page">
      <SectionHeader
        title="Reports"
        subtitle="Snapshot of the CRM's current state · updates each time you reload the page"
        actions={<Button variant="secondary" icon="refresh" onClick={load}>Refresh</Button>}
      />

      <div className="kpi-row" style={{ gridTemplateColumns: 'repeat(6, 1fr)' }}>
        <KPI label="Total Leads" value={data.total ?? 0}/>
        <KPI label="Unassigned" value={data.unassigned ?? 0} dot="var(--warm)"/>
        <KPI label="Imported today" value={data.imported_today ?? 0}/>
        <KPI label="Imported (7d)" value={data.imported_this_week ?? 0}/>
        <KPI label="Open tasks" value={data.open_tasks ?? 0}/>
        <KPI label="Tasks overdue" value={data.tasks_overdue ?? 0} dot="var(--hot)"/>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">By status</div>
              <div className="card-sub">Lead lifecycle stage</div>
            </div>
          </div>
          {statusRows.map(([l, c, col]) => <Bar key={l} label={l} count={c} max={maxOf(statusRows)} color={col}/>)}
        </div>

        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">By temperature</div>
              <div className="card-sub">Outreach state</div>
            </div>
          </div>
          {tempRows.map(([l, c, col]) => <Bar key={l} label={l} count={c} max={maxOf(tempRows)} color={col}/>)}
        </div>

        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">By priority</div>
              <div className="card-sub">Operator-set priority</div>
            </div>
          </div>
          {priorityRows.map(([l, c, col]) => <Bar key={l} label={l} count={c} max={maxOf(priorityRows)} color={col}/>)}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12, marginBottom: 12 }}>
        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">By data stage</div>
              <div className="card-sub">Where each VIN is in the enrichment pipeline</div>
            </div>
          </div>
          {stageRows.map(([l, c, col]) => <Bar key={l} label={l} count={c} max={maxOf(stageRows)} color={col}/>)}
        </div>

        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">Tasks</div>
              <div className="card-sub">Active task workload</div>
            </div>
          </div>
          <div className="grid-3" style={{ marginTop: 6 }}>
            <div>
              <div className="kpi-label">Open</div>
              <div className="kpi-value" style={{ fontSize: 28 }}>{data.open_tasks ?? 0}</div>
            </div>
            <div>
              <div className="kpi-label">Due today</div>
              <div className="kpi-value" style={{ fontSize: 28, color: 'var(--warm)' }}>{data.tasks_due_today ?? 0}</div>
            </div>
            <div>
              <div className="kpi-label">Overdue</div>
              <div className="kpi-value" style={{ fontSize: 28, color: 'var(--danger)' }}>{data.tasks_overdue ?? 0}</div>
            </div>
          </div>
        </div>
      </div>

      {dups && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="card">
            <div className="card-head">
              <div>
                <div className="card-title">Duplicate groups</div>
                <div className="card-sub">{dups.total ?? 0} total · {dups.created_this_week ?? 0} new this week</div>
              </div>
            </div>
            {(dups.by_review_status || []).map((r) => (
              <Bar key={r.key} label={DUP_STATUS_META[r.key]?.label || r.key} count={r.count} max={Math.max(1, ...((dups.by_review_status || []).map((x) => x.count)))} color={DUP_STATUS_META[r.key]?.color || 'var(--text-2)'}/>
            ))}
            {dups.merge_prep && (
              <div className="grid-3" style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border-0)' }}>
                <div><div className="kpi-label">Confirmed</div><div className="kpi-value" style={{ fontSize: 24 }}>{dups.merge_prep.confirmed_groups ?? 0}</div></div>
                <div><div className="kpi-label">Prep draft</div><div className="kpi-value" style={{ fontSize: 24 }}>{dups.merge_prep.draft ?? 0}</div></div>
                <div><div className="kpi-label">Prepared</div><div className="kpi-value" style={{ fontSize: 24 }}>{dups.merge_prep.prepared ?? 0}</div></div>
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-head">
              <div>
                <div className="card-title">Match types</div>
                <div className="card-sub">What attribute paired the dup cases</div>
              </div>
            </div>
            {(dups.by_match_type || []).map((r) => (
              <Bar key={r.key} label={r.key} count={r.count} max={Math.max(1, ...((dups.by_match_type || []).map((x) => x.count)))}/>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

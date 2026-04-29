import { useState, useEffect, useMemo } from 'react';
import api, { extractApiError } from '../api';
import { Icon, Avatar, Button, SectionHeader, StatusBadge, EmptyState } from '../components/ui';
import LeadDetailDrawer from '../components/LeadDetailDrawer';
import { useAuth } from '../context/AuthContext';
import { LEAD_TEMPERATURES, formatPhone } from '../lib/crm';

const COLUMNS = [
  { key: 'cold',   label: 'Cold',   color: 'var(--cold)' },
  { key: 'warm',   label: 'Warm',   color: 'var(--warm)' },
  { key: 'hot',    label: 'Hot',    color: 'var(--hot)' },
  { key: 'closed', label: 'Closed', color: 'var(--success)' },
];

const NO_TEMP_COL = { key: '__none', label: 'No Answer', color: 'var(--text-3)' };

export default function PipelinePage() {
  const { user } = useAuth();
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [scope, setScope] = useState('all');
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

  const cols = useMemo(() => isAdmin ? [NO_TEMP_COL, ...COLUMNS] : COLUMNS, [isAdmin]);
  const grouped = useMemo(() => {
    const out = Object.fromEntries(cols.map((c) => [c.key, []]));
    for (const l of leads) {
      const t = l.lead_temperature || NO_TEMP_COL.key;
      if (out[t]) out[t].push(l);
      else if (out[NO_TEMP_COL.key]) out[NO_TEMP_COL.key].push(l);
    }
    return out;
  }, [leads, cols]);

  return (
    <div className="page">
      <SectionHeader
        title="Lead Pipeline"
        subtitle={`${leads.length} leads in view · grouped by temperature`}
        actions={
          <>
            <div className="seg">
              <button className={`seg-btn ${scope === 'all' ? 'active' : ''}`} onClick={() => setScope('all')}>All leads</button>
              <button className={`seg-btn ${scope === 'mine' ? 'active' : ''}`} onClick={() => setScope('mine')}>My leads</button>
            </div>
          </>
        }
      />

      {error && (
        <div className="card" style={{ marginBottom: 16, borderColor: 'var(--danger)', color: 'var(--danger)' }}>{error}</div>
      )}

      {loading ? (
        <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-3)' }}>Loading…</div>
      ) : leads.length === 0 ? (
        <EmptyState icon="users" title="No leads yet" body="Import leads from the Files dashboard, then come back here to work the pipeline."/>
      ) : (
        <div className="kanban">
          {cols.map((c) => (
            <div key={c.key} className="kanban-col">
              <div className="kanban-col-head">
                <span className="row"><span className="kanban-col-dot" style={{ background: c.color }}/>{c.label}</span>
                <span className="count">{grouped[c.key]?.length ?? 0}</span>
              </div>
              {(grouped[c.key] || []).slice(0, 50).map((l) => {
                const name = [l.first_name, l.last_name].filter(Boolean).join(' ') || l.full_name || '—';
                const vehicle = [l.year, l.make, l.model].filter(Boolean).join(' ') || '—';
                const phone = l.phone_primary ? formatPhone(l.phone_primary) : '';
                return (
                  <div key={l.id} className="kanban-card" onClick={() => setDrawerId(l.id)}>
                    <div className="kanban-card-head">
                      <span className="kanban-card-name">{name}</span>
                      <Icon name="moreV" size={14} style={{ color: 'var(--text-3)' }}/>
                    </div>
                    <div className="kanban-card-vehicle">{vehicle}</div>
                    {phone && <div className="kanban-card-vehicle">{phone}</div>}
                    <div className="kanban-card-meta">
                      {l.status && <StatusBadge status={l.status}/>}
                      {l.price_offered && (
                        <span className="cell-mono" style={{ color: 'var(--text-1)' }}>
                          ${Number(l.price_offered).toLocaleString()}
                        </span>
                      )}
                    </div>
                    <div className="kanban-card-foot">
                      <span>
                        {l.assigned_user_name ? (
                          <span className="row" style={{ gap: 4 }}>
                            <Avatar name={l.assigned_user_name} size={16}/> {l.assigned_user_name}
                          </span>
                        ) : (
                          <em style={{ color: 'var(--text-3)' }}>Unassigned</em>
                        )}
                      </span>
                    </div>
                  </div>
                );
              })}
              {(grouped[c.key] || []).length === 0 && (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-3)', fontSize: 12 }}>No leads</div>
              )}
            </div>
          ))}
        </div>
      )}

      <LeadDetailDrawer
        leadId={drawerId}
        onClose={() => setDrawerId(null)}
        onChanged={() => {
          // optimistic: re-fetch
          setScope((s) => s);
        }}
      />
    </div>
  );
}

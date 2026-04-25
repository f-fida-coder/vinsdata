import { useState, useEffect, useCallback } from 'react';
import api, { extractApiError } from '../api';

const STATUS_TABS = [
  { key: 'pending',  label: 'Pending review' },
  { key: 'accepted', label: 'Accepted' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'all',      label: 'All' },
];

function formatDate(s) {
  if (!s) return '—';
  const d = new Date(String(s).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString();
}

export default function FilterReviewPage() {
  const [status, setStatus] = useState('pending');
  const [rows, setRows]     = useState([]);
  const [total, setTotal]   = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState('');
  const [submittingId, setSubmittingId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await api.get('/filter_rule_reviews', { params: { status } });
      setRows(res.data.reviews || []);
      setTotal(res.data.total ?? 0);
    } catch (err) {
      setError(extractApiError(err, 'Failed to load review queue'));
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => { load(); }, [load]);

  const decide = async (row, decision) => {
    setSubmittingId(row.result_id);
    try {
      await api.post('/filter_rule_reviews', { result_id: row.result_id, decision });
      load();
    } catch (err) {
      setError(extractApiError(err, 'Decision failed'));
    } finally {
      setSubmittingId(null);
    }
  };

  return (
    <div className="max-w-[1600px] mx-auto">
      <div className="mb-5">
        <h1 className="text-xl font-semibold tracking-tight">Filter review queue</h1>
        <p className="text-[12px] mt-0.5" style={{ color: 'var(--vv-text-muted)' }}>
          Leads flagged by a filter rule. Accept to keep them in the funnel, reject to exclude.
        </p>
      </div>

      <div className="flex items-center gap-1 mb-4 text-[12px]">
        {STATUS_TABS.map((t) => {
          const active = status === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setStatus(t.key)}
              className="px-3 py-1.5 rounded-md transition-colors"
              style={{
                backgroundColor: active ? 'var(--vv-bg-dark)' : 'transparent',
                color: active ? '#ffffff' : 'var(--vv-text-muted)',
                border: `1px solid ${active ? 'var(--vv-bg-dark)' : 'var(--vv-border)'}`,
                fontWeight: active ? 600 : 500,
              }}
            >
              {t.label}
            </button>
          );
        })}
        <span className="ml-3 text-[12px]" style={{ color: 'var(--vv-text-subtle)' }}>
          {total.toLocaleString()} total
        </span>
      </div>

      {error && (
        <div className="mb-4 px-4 py-2 rounded-md text-[13px]" style={{ backgroundColor: '#FEE2E2', color: 'var(--vv-status-danger)', border: '1px solid #FECACA' }}>
          {error}
        </div>
      )}

      <div
        className="overflow-hidden"
        style={{ backgroundColor: 'var(--vv-bg-surface)', border: '1px solid var(--vv-border)', borderRadius: 'var(--vv-radius-lg)' }}
      >
        {loading ? (
          <div className="py-10 text-center text-[13px]" style={{ color: 'var(--vv-text-muted)' }}>Loading…</div>
        ) : rows.length === 0 ? (
          <div className="py-12 text-center text-[13px]" style={{ color: 'var(--vv-text-muted)' }}>
            No leads in this bucket.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead style={{ backgroundColor: 'var(--vv-bg-surface-muted)' }}>
                <tr style={{ borderBottom: '1px solid var(--vv-border)' }}>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--vv-text-muted)' }}>Flagged</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--vv-text-muted)' }}>Rule</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--vv-text-muted)' }}>VIN</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--vv-text-muted)' }}>Vehicle</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--vv-text-muted)' }}>Location</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--vv-text-muted)' }}>Source file</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--vv-text-muted)' }}>Status</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const vehicle  = [r.norm_year, r.norm_make, r.norm_model].filter(Boolean).join(' ') || '—';
                  const location = [r.normalized_payload?.city, r.norm_state].filter(Boolean).join(', ') || '—';
                  const isPending = r.review_status === 'pending';
                  return (
                    <tr key={r.result_id} style={{ borderBottom: '1px solid var(--vv-border)' }}>
                      <td className="px-3 py-2 text-[11px]" style={{ color: 'var(--vv-text-subtle)' }}>{formatDate(r.created_at)}</td>
                      <td className="px-3 py-2">{r.rule_name}</td>
                      <td className="px-3 py-2 font-mono text-[12px]" style={{ color: 'var(--vv-text-muted)' }}>{r.norm_vin || '—'}</td>
                      <td className="px-3 py-2">{vehicle}</td>
                      <td className="px-3 py-2" style={{ color: 'var(--vv-text-muted)' }}>{location}</td>
                      <td className="px-3 py-2 text-[12px] truncate max-w-[200px]" style={{ color: 'var(--vv-text-muted)' }}>{r.file_display_name}</td>
                      <td className="px-3 py-2">
                        <span
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium"
                          style={{
                            backgroundColor:
                              r.review_status === 'accepted' ? '#DCFCE7' :
                              r.review_status === 'rejected' ? '#FEE2E2' :
                              '#FEF3C7',
                            color:
                              r.review_status === 'accepted' ? 'var(--vv-status-success)' :
                              r.review_status === 'rejected' ? 'var(--vv-status-danger)' :
                              'var(--vv-status-warning)',
                          }}
                        >
                          {r.review_status ?? '—'}
                        </span>
                        {!isPending && r.reviewer_name && (
                          <div className="text-[10px] mt-0.5" style={{ color: 'var(--vv-text-subtle)' }}>
                            by {r.reviewer_name}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        {isPending ? (
                          <>
                            <button
                              disabled={submittingId === r.result_id}
                              onClick={() => decide(r, 'accept')}
                              className="text-[12px] px-2 py-1 mr-1 rounded disabled:opacity-60"
                              style={{ color: 'var(--vv-status-success)' }}
                            >
                              Accept
                            </button>
                            <button
                              disabled={submittingId === r.result_id}
                              onClick={() => decide(r, 'reject')}
                              className="text-[12px] px-2 py-1 rounded disabled:opacity-60"
                              style={{ color: 'var(--vv-status-danger)' }}
                            >
                              Reject
                            </button>
                          </>
                        ) : (
                          <span className="text-[11px]" style={{ color: 'var(--vv-text-subtle)' }}>—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

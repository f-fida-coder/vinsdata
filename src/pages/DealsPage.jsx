import { useState, useEffect, useCallback } from 'react';
import api, { extractApiError } from '../api';
import LeadDetailDrawer from '../components/LeadDetailDrawer';
import { formatPrice } from '../lib/crm';

const TABS = [
  { key: 'all',    label: 'All deals' },
  { key: 'open',   label: 'Open' },
  { key: 'closed', label: 'Acquired (not sold)' },
  { key: 'sold',   label: 'Sold' },
];

function formatDate(s) {
  if (!s) return '—';
  const d = new Date(String(s).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString();
}

function StatCard({ label, value, sub, accent }) {
  return (
    <div
      className="p-4"
      style={{
        backgroundColor: 'var(--vv-bg-surface)',
        border: '1px solid var(--vv-border)',
        borderRadius: 'var(--vv-radius-lg)',
      }}
    >
      <div
        className="text-[10px] font-semibold uppercase"
        style={{ color: 'var(--vv-text-subtle)', letterSpacing: 'var(--vv-tracking-label)' }}
      >
        {label}
      </div>
      <div
        className="text-xl font-semibold mt-1 tabular-nums"
        style={{
          color: accent ?? 'var(--vv-text)',
          letterSpacing: 'var(--vv-tracking-tight)',
        }}
      >
        {value}
      </div>
      {sub && (
        <div className="text-[11px] mt-0.5" style={{ color: 'var(--vv-text-subtle)' }}>{sub}</div>
      )}
    </div>
  );
}

export default function DealsPage() {
  const [status, setStatus] = useState('sold');
  const [data, setData] = useState({ deals: [], totals: { count: 0, total_cost: 0, total_sale: 0, total_profit: 0, sold_count: 0, avg_days_on_market: null } });
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [detailLeadId, setDetailLeadId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await api.get('/deals', { params: { status } });
      setData({ deals: res.data.deals || [], totals: res.data.totals });
    } catch (err) {
      setError(extractApiError(err, 'Failed to load deals'));
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => { load(); }, [load]);

  const t = data.totals || {};

  return (
    <div className="max-w-[1600px] mx-auto">
      <div className="mb-5">
        <h1 className="text-xl font-semibold tracking-tight">Deals</h1>
        <p className="text-[12px] mt-0.5" style={{ color: 'var(--vv-text-muted)' }}>
          Acquisitions and resales. A deal exists for any lead with purchase data captured.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-4 text-[12px]">
        {TABS.map((tab) => {
          const active = status === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setStatus(tab.key)}
              className="px-3 py-1.5 rounded-md transition-colors"
              style={{
                backgroundColor: active ? 'var(--vv-bg-dark)' : 'transparent',
                color: active ? '#ffffff' : 'var(--vv-text-muted)',
                border: `1px solid ${active ? 'var(--vv-bg-dark)' : 'var(--vv-border)'}`,
                fontWeight: active ? 600 : 500,
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Aggregates */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-5">
        <StatCard label="Deals in view" value={(t.count ?? 0).toLocaleString()} />
        <StatCard label="Total cost" value={formatPrice(t.total_cost)} sub={t.count > 0 ? `Across ${t.count} deals` : null} />
        <StatCard label="Total sale" value={formatPrice(t.total_sale)} sub={t.sold_count > 0 ? `Across ${t.sold_count} sold` : null} />
        <StatCard
          label="Net profit"
          value={formatPrice(t.total_profit)}
          accent={t.total_profit > 0 ? 'var(--vv-status-success)' : (t.total_profit < 0 ? 'var(--vv-status-danger)' : undefined)}
          sub={t.sold_count > 0 ? `From ${t.sold_count} sold deals` : null}
        />
        <StatCard
          label="Avg days on market"
          value={t.avg_days_on_market == null ? '—' : `${t.avg_days_on_market} d`}
          sub={t.sold_count > 0 ? null : 'No sales recorded'}
        />
      </div>

      {error && (
        <div
          className="mb-4 px-4 py-2 rounded-md text-[13px]"
          style={{ backgroundColor: '#FEE2E2', color: 'var(--vv-status-danger)', border: '1px solid #FECACA' }}
        >
          {error}
        </div>
      )}

      <div
        className="overflow-hidden"
        style={{ backgroundColor: 'var(--vv-bg-surface)', border: '1px solid var(--vv-border)', borderRadius: 'var(--vv-radius-lg)' }}
      >
        {loading ? (
          <div className="py-10 text-center text-[13px]" style={{ color: 'var(--vv-text-muted)' }}>Loading…</div>
        ) : data.deals.length === 0 ? (
          <div className="py-12 text-center text-[13px]" style={{ color: 'var(--vv-text-muted)' }}>
            No deals in this view yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead style={{ backgroundColor: 'var(--vv-bg-surface-muted)' }}>
                <tr style={{ borderBottom: '1px solid var(--vv-border)' }}>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase" style={{ color: 'var(--vv-text-muted)', letterSpacing: 'var(--vv-tracking-label)' }}>Vehicle</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase" style={{ color: 'var(--vv-text-muted)', letterSpacing: 'var(--vv-tracking-label)' }}>Owner</th>
                  <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tabular-nums" style={{ color: 'var(--vv-text-muted)', letterSpacing: 'var(--vv-tracking-label)' }}>Purchase</th>
                  <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tabular-nums" style={{ color: 'var(--vv-text-muted)', letterSpacing: 'var(--vv-tracking-label)' }}>Sale</th>
                  <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tabular-nums" style={{ color: 'var(--vv-text-muted)', letterSpacing: 'var(--vv-tracking-label)' }}>Profit</th>
                  <th className="px-3 py-2 text-right text-[10px] font-semibold uppercase tabular-nums" style={{ color: 'var(--vv-text-muted)', letterSpacing: 'var(--vv-tracking-label)' }}>DoM</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase" style={{ color: 'var(--vv-text-muted)', letterSpacing: 'var(--vv-tracking-label)' }}>Purchase date</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase" style={{ color: 'var(--vv-text-muted)', letterSpacing: 'var(--vv-tracking-label)' }}>Sell date</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold uppercase" style={{ color: 'var(--vv-text-muted)', letterSpacing: 'var(--vv-tracking-label)' }}>Agent</th>
                </tr>
              </thead>
              <tbody>
                {data.deals.map((d) => {
                  const ymm = [d.norm_year, d.norm_make, d.norm_model].filter(Boolean).join(' ') || '—';
                  const profitColor = d.net_profit == null
                    ? 'var(--vv-text-subtle)'
                    : d.net_profit >= 0 ? 'var(--vv-status-success)' : 'var(--vv-status-danger)';
                  return (
                    <tr
                      key={d.id}
                      onClick={() => setDetailLeadId(d.imported_lead_id)}
                      className="cursor-pointer transition-colors hover:bg-[var(--vv-bg-surface-muted)]"
                      style={{ borderBottom: '1px solid var(--vv-border)' }}
                    >
                      <td className="px-3 py-2 align-top">
                        <div className="font-medium">{ymm}</div>
                        {d.norm_vin && (
                          <div className="text-[10px] font-mono mt-0.5" style={{ color: 'var(--vv-text-subtle)' }}>
                            {d.norm_vin}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2" style={{ color: d.owner_name ? 'var(--vv-text)' : 'var(--vv-text-subtle)' }}>
                        {d.owner_name || '—'}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {d.purchase_price != null ? formatPrice(d.purchase_price) : <span style={{ color: 'var(--vv-text-subtle)' }}>—</span>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {d.sale_price != null ? formatPrice(d.sale_price) : <span style={{ color: 'var(--vv-text-subtle)' }}>—</span>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium" style={{ color: profitColor }}>
                        {d.net_profit != null ? formatPrice(d.net_profit) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums" style={{ color: d.days_on_market != null ? 'var(--vv-text)' : 'var(--vv-text-subtle)' }}>
                        {d.days_on_market != null ? `${d.days_on_market} d` : '—'}
                      </td>
                      <td className="px-3 py-2 text-[12px]" style={{ color: 'var(--vv-text-muted)' }}>{formatDate(d.purchase_date)}</td>
                      <td className="px-3 py-2 text-[12px]" style={{ color: 'var(--vv-text-muted)' }}>{formatDate(d.sold_date)}</td>
                      <td className="px-3 py-2 text-[12px]" style={{ color: d.assigned_user_name ? 'var(--vv-text)' : 'var(--vv-text-subtle)' }}>
                        {d.assigned_user_name || 'Unassigned'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <LeadDetailDrawer
        leadId={detailLeadId}
        onClose={() => setDetailLeadId(null)}
        onChanged={load}
      />
    </div>
  );
}

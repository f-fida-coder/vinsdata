import { useState, useEffect, useCallback, useMemo } from 'react';
import api, { extractApiError } from '../api';
import LeadDetailDrawer from '../components/LeadDetailDrawer';
import { useAuth } from '../context/AuthContext';
import {
  LEAD_TEMPERATURES, TEMPERATURE_BY_KEY,
  STATUS_BY_KEY, PRIORITY_BY_KEY,
  formatPhone, formatPrice,
} from '../lib/crm';

// Column definitions: 'unset' is the implicit Untriaged bucket for leads
// that have no temperature set yet. Renders to the left so operators see
// what hasn't been triaged at a glance.
const COLUMNS = [
  { key: 'unset',     label: 'Untriaged', dot: 'bg-zinc-300',   bg: 'bg-zinc-50',    text: 'text-zinc-600',   hint: 'No temperature set' },
  ...LEAD_TEMPERATURES.map((t) => ({ ...t, hint: undefined })),
];

const PER_COLUMN = 100;

function relTime(iso) {
  if (!iso) return null;
  const d = new Date(String(iso).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return null;
  const ms = Date.now() - d.getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

function LeadCard({ lead, onClick }) {
  const np = lead.normalized_payload || {};
  const crm = lead.crm_state || {};
  const name = np.full_name || [np.first_name, np.last_name].filter(Boolean).join(' ') || '— No name —';
  const vehicle = [np.year, np.make, np.model].filter(Boolean).join(' ');
  const phone = np.phone_primary;
  const statusMeta = crm.status ? STATUS_BY_KEY[crm.status] : null;
  const priorityMeta = crm.priority ? PRIORITY_BY_KEY[crm.priority] : null;
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-3 py-2.5 transition-colors hover:bg-[var(--vv-bg-surface-muted)]"
      style={{
        backgroundColor: 'var(--vv-bg-surface)',
        border: '1px solid var(--vv-border)',
        borderRadius: 'var(--vv-radius-md)',
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-medium truncate" style={{ color: 'var(--vv-text)' }}>{name}</div>
          {vehicle && (
            <div className="text-[11px] truncate mt-0.5" style={{ color: 'var(--vv-text-muted)' }}>
              {vehicle}
            </div>
          )}
          {phone && (
            <div className="text-[11px] tabular-nums mt-0.5" style={{ color: 'var(--vv-text-muted)' }}>
              {formatPhone(phone)}
            </div>
          )}
        </div>
        {priorityMeta && (
          <span
            className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${priorityMeta.dot}`}
            title={`Priority: ${priorityMeta.label}`}
          />
        )}
      </div>
      <div className="mt-2 flex items-center gap-2 flex-wrap">
        {statusMeta && (
          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${statusMeta.bg} ${statusMeta.text}`}>
            <span className={`w-1 h-1 rounded-full ${statusMeta.dot}`} />
            {statusMeta.label}
          </span>
        )}
        {crm.assigned_user_name && (
          <span className="text-[10px]" style={{ color: 'var(--vv-text-subtle)' }}>
            {crm.assigned_user_name}
          </span>
        )}
        {(crm.price_wanted != null || crm.price_offered != null) && (
          <span className="text-[10px] tabular-nums ml-auto" style={{ color: 'var(--vv-text-subtle)' }}>
            {crm.price_offered != null ? formatPrice(crm.price_offered) : formatPrice(crm.price_wanted)}
          </span>
        )}
      </div>
      {lead.imported_at && (
        <div className="mt-1.5 text-[10px]" style={{ color: 'var(--vv-text-subtle)' }}>
          imported {relTime(lead.imported_at)}
        </div>
      )}
    </button>
  );
}

function Column({ col, leads, total, loading, onCardClick }) {
  return (
    <div
      className="flex flex-col w-[280px] shrink-0"
      style={{
        backgroundColor: 'var(--vv-bg-surface-muted)',
        border: '1px solid var(--vv-border)',
        borderRadius: 'var(--vv-radius-lg)',
      }}
    >
      <div
        className="px-3 py-2.5 flex items-center justify-between sticky top-0 z-10"
        style={{
          backgroundColor: 'var(--vv-bg-surface-muted)',
          borderBottom: '1px solid var(--vv-border)',
          borderTopLeftRadius: 'var(--vv-radius-lg)',
          borderTopRightRadius: 'var(--vv-radius-lg)',
        }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className={`w-2 h-2 rounded-full ${col.dot} shrink-0`} />
          <span
            className="text-[11px] font-semibold uppercase truncate"
            style={{
              color: 'var(--vv-text)',
              letterSpacing: 'var(--vv-tracking-label)',
            }}
            title={col.hint}
          >
            {col.label}
          </span>
        </div>
        <span className="text-[11px] tabular-nums shrink-0" style={{ color: 'var(--vv-text-muted)' }}>
          {total === null ? '…' : total.toLocaleString()}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-[120px]">
        {loading ? (
          <div className="py-8 text-center text-[11px]" style={{ color: 'var(--vv-text-subtle)' }}>Loading…</div>
        ) : leads.length === 0 ? (
          <div className="py-8 text-center text-[11px]" style={{ color: 'var(--vv-text-subtle)' }}>No leads</div>
        ) : (
          leads.map((lead) => (
            <LeadCard key={lead.id} lead={lead} onClick={() => onCardClick(lead.id)} />
          ))
        )}
        {!loading && total !== null && total > leads.length && (
          <div className="py-2 text-center text-[10px]" style={{ color: 'var(--vv-text-subtle)' }}>
            +{(total - leads.length).toLocaleString()} more · open Leads to filter
          </div>
        )}
      </div>
    </div>
  );
}

export default function PipelinePage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'marketer';

  // One entry per column key with its own page payload.
  const [columns, setColumns] = useState(() =>
    Object.fromEntries(COLUMNS.map((c) => [c.key, { leads: [], total: null, loading: true }]))
  );
  const [error, setError] = useState('');
  const [detailId, setDetailId] = useState(null);
  const [scope, setScope] = useState('all'); // 'all' | 'mine' (operators see only their assigned leads by default)

  useEffect(() => {
    if (!isAdmin) setScope('mine');
  }, [isAdmin]);

  const fetchColumn = useCallback(async (col) => {
    const params = { per_page: PER_COLUMN, page: 1 };
    params.lead_temperature = col.key; // 'unset' is honored by the leads endpoint
    if (scope === 'mine') params.assigned_user_id = user?.id;
    try {
      const res = await api.get('/leads', { params });
      setColumns((prev) => ({
        ...prev,
        [col.key]: {
          leads: res.data.leads || [],
          total: res.data.total ?? (res.data.leads?.length ?? 0),
          loading: false,
        },
      }));
    } catch (err) {
      setError(extractApiError(err, `Failed to load ${col.label}`));
      setColumns((prev) => ({ ...prev, [col.key]: { leads: [], total: null, loading: false } }));
    }
  }, [scope, user?.id]);

  const reloadAll = useCallback(() => {
    setColumns(Object.fromEntries(COLUMNS.map((c) => [c.key, { leads: [], total: null, loading: true }])));
    COLUMNS.forEach((col) => fetchColumn(col));
  }, [fetchColumn]);

  useEffect(() => { reloadAll(); }, [reloadAll]);

  const grandTotal = useMemo(
    () => Object.values(columns).reduce((sum, c) => sum + (c.total || 0), 0),
    [columns]
  );

  return (
    <div className="max-w-[1800px] mx-auto">
      <div className="flex items-start justify-between mb-5 gap-3 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">Lead Pipeline</h1>
          <p className="text-[12px] mt-0.5" style={{ color: 'var(--vv-text-muted)' }}>
            Every lead grouped by temperature. Click a card to open the full record.
            <span className="ml-2 tabular-nums" style={{ color: 'var(--vv-text-subtle)' }}>
              {grandTotal.toLocaleString()} total in view
            </span>
          </p>
        </div>
        {isAdmin && (
          <div className="flex items-center gap-1 text-[12px]">
            {[
              { key: 'all',  label: 'All leads' },
              { key: 'mine', label: 'My leads' },
            ].map((opt) => {
              const active = scope === opt.key;
              return (
                <button
                  key={opt.key}
                  onClick={() => setScope(opt.key)}
                  className="px-3 py-1.5 rounded-md transition-colors"
                  style={{
                    backgroundColor: active ? 'var(--vv-bg-dark)' : 'transparent',
                    color: active ? '#ffffff' : 'var(--vv-text-muted)',
                    border: `1px solid ${active ? 'var(--vv-bg-dark)' : 'var(--vv-border)'}`,
                    fontWeight: active ? 600 : 500,
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {error && (
        <div
          className="mb-4 px-4 py-2 rounded-md text-[13px]"
          style={{
            backgroundColor: '#FEE2E2',
            color: 'var(--vv-status-danger)',
            border: '1px solid #FECACA',
          }}
        >
          {error}
        </div>
      )}

      <div className="overflow-x-auto pb-3">
        <div
          className="flex gap-3 min-h-[60vh]"
          style={{ minWidth: `${COLUMNS.length * 290 + 12}px` }}
        >
          {COLUMNS.map((col) => (
            <Column
              key={col.key}
              col={col}
              leads={columns[col.key]?.leads ?? []}
              total={columns[col.key]?.total ?? null}
              loading={columns[col.key]?.loading ?? false}
              onCardClick={setDetailId}
            />
          ))}
        </div>
      </div>

      <LeadDetailDrawer
        leadId={detailId}
        onClose={() => setDetailId(null)}
        onChanged={reloadAll}
      />
    </div>
  );
}

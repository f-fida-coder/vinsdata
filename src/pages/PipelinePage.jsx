import { useState, useEffect, useCallback, useMemo } from 'react';
import api, { extractApiError } from '../api';
import LeadDetailDrawer from '../components/LeadDetailDrawer';
import PhonesDropdown from '../components/PhonesDropdown';
import { useAuth } from '../context/AuthContext';
import {
  LEAD_TEMPERATURES,
  STATUS_BY_KEY, PRIORITY_BY_KEY,
  formatPrice,
} from '../lib/crm';

// Five temperature columns: No Answer | Cold | Warm | Hot | Closed.
// (The 'Untriaged' column for leads with no temperature was removed.)
const COLUMNS = LEAD_TEMPERATURES.map((t) => ({ ...t, hint: undefined }));

const PER_COLUMN = 25;

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
          <div className="text-[11px] mt-0.5" style={{ color: 'var(--vv-text-muted)' }}>
            <PhonesDropdown payload={np} size="xs" />
          </div>
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

function Column({ col, leads, total, page, loading, onCardClick, onPage }) {
  const totalPages = total != null ? Math.max(1, Math.ceil(total / PER_COLUMN)) : 1;
  const showPager  = total != null && total > PER_COLUMN;

  return (
    <div
      className="flex flex-col w-[260px] shrink-0 max-h-[calc(100vh-220px)]"
      style={{
        backgroundColor: 'var(--vv-bg-surface-muted)',
        border: '1px solid var(--vv-border)',
        borderRadius: 'var(--vv-radius-lg)',
      }}
    >
      <div
        className="px-3 py-2 flex items-center justify-between"
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
          >
            {col.label}
          </span>
        </div>
        <span className="text-[11px] tabular-nums shrink-0" style={{ color: 'var(--vv-text-muted)' }}>
          {total === null ? '…' : total.toLocaleString()}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1.5 min-h-[120px]">
        {loading ? (
          <div className="py-8 text-center text-[11px]" style={{ color: 'var(--vv-text-subtle)' }}>Loading…</div>
        ) : leads.length === 0 ? (
          <div className="py-8 text-center text-[11px]" style={{ color: 'var(--vv-text-subtle)' }}>No leads</div>
        ) : (
          leads.map((lead) => (
            <LeadCard key={lead.id} lead={lead} onClick={() => onCardClick(lead.id)} />
          ))
        )}
      </div>

      {showPager && (
        <div
          className="px-2 py-1.5 flex items-center justify-between text-[10px]"
          style={{
            backgroundColor: 'var(--vv-bg-surface-muted)',
            borderTop: '1px solid var(--vv-border)',
            borderBottomLeftRadius: 'var(--vv-radius-lg)',
            borderBottomRightRadius: 'var(--vv-radius-lg)',
            color: 'var(--vv-text-muted)',
          }}
        >
          <button
            onClick={() => onPage(Math.max(1, page - 1))}
            disabled={page <= 1 || loading}
            className="px-1.5 py-0.5 rounded disabled:opacity-30"
            style={{ border: '1px solid var(--vv-border)', backgroundColor: 'var(--vv-bg-surface)' }}
          >
            ‹
          </button>
          <span className="tabular-nums">
            {page} / {totalPages.toLocaleString()}
          </span>
          <button
            onClick={() => onPage(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages || loading}
            className="px-1.5 py-0.5 rounded disabled:opacity-30"
            style={{ border: '1px solid var(--vv-border)', backgroundColor: 'var(--vv-bg-surface)' }}
          >
            ›
          </button>
        </div>
      )}
    </div>
  );
}

export default function PipelinePage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'marketer';

  // One entry per column key with its own page state. Each column paginates
  // independently; flipping a page in 'Hot' doesn't reload the others.
  const [columns, setColumns] = useState(() =>
    Object.fromEntries(COLUMNS.map((c) => [c.key, { leads: [], total: null, loading: true, page: 1 }]))
  );
  const [error, setError] = useState('');
  const [detailId, setDetailId] = useState(null);
  const [scope, setScope] = useState('all'); // 'all' | 'mine'

  useEffect(() => {
    if (!isAdmin) setScope('mine');
  }, [isAdmin]);

  const fetchColumn = useCallback(async (col, page = 1) => {
    setColumns((prev) => ({ ...prev, [col.key]: { ...(prev[col.key] || {}), loading: true, page } }));
    const params = { per_page: PER_COLUMN, page, lead_temperature: col.key };
    if (scope === 'mine') params.assigned_user_id = user?.id;
    try {
      const res = await api.get('/leads', { params });
      setColumns((prev) => ({
        ...prev,
        [col.key]: {
          leads: res.data.leads || [],
          total: res.data.total ?? (res.data.leads?.length ?? 0),
          loading: false,
          page,
        },
      }));
    } catch (err) {
      setError(extractApiError(err, `Failed to load ${col.label}`));
      setColumns((prev) => ({ ...prev, [col.key]: { leads: [], total: null, loading: false, page } }));
    }
  }, [scope, user?.id]);

  const setColumnPage = useCallback((colKey, page) => {
    const col = COLUMNS.find((c) => c.key === colKey);
    if (col) fetchColumn(col, page);
  }, [fetchColumn]);

  const reloadAll = useCallback(() => {
    setColumns(Object.fromEntries(COLUMNS.map((c) => [c.key, { leads: [], total: null, loading: true, page: 1 }])));
    COLUMNS.forEach((col) => fetchColumn(col, 1));
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
          className="flex gap-3"
          style={{ minWidth: `${COLUMNS.length * 270 + 12}px` }}
        >
          {COLUMNS.map((col) => (
            <Column
              key={col.key}
              col={col}
              leads={columns[col.key]?.leads ?? []}
              total={columns[col.key]?.total ?? null}
              page={columns[col.key]?.page ?? 1}
              loading={columns[col.key]?.loading ?? false}
              onCardClick={setDetailId}
              onPage={(p) => setColumnPage(col.key, p)}
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

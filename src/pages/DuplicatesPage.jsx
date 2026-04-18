import { useState, useEffect, useCallback, useMemo } from 'react';
import api, { extractApiError } from '../api';
import { useAuth } from '../context/AuthContext';
import DuplicateGroupDrawer from '../components/DuplicateGroupDrawer';
import SavedViewsMenu from '../components/SavedViewsMenu';
import SummaryCards from '../components/SummaryCards';
import {
  MATCH_TYPES, MATCH_TYPE_BY_KEY,
  REVIEW_STATUSES, REVIEW_STATUS_BY_KEY,
  confidenceLabel, confidenceStyle, formatMatchKey,
} from '../lib/duplicates';

const PER_PAGE_OPTIONS = [25, 50, 100];

const EMPTY_FILTERS = {
  review_status: '',
  match_type: '',
  min_confidence: '',
  batch_id: '',
  file_id: '',
  created_from: '',
  created_to: '',
};

const CHIP_LABELS = {
  review_status:  'Status',
  match_type:     'Match type',
  min_confidence: 'Min confidence',
  batch_id:       'Batch',
  file_id:        'File',
  created_from:   'Created from',
  created_to:     'Created to',
};

function formatDate(s) {
  if (!s) return '—';
  const d = new Date(String(s).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString();
}

export default function DuplicatesPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(50);
  const [data, setData] = useState({ groups: [], total: 0, page: 1, per_page: 50 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [options, setOptions] = useState({ batches: [], files: [] });
  const [detailId, setDetailId] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [scanSummary, setScanSummary] = useState(null);
  const [scanError, setScanError] = useState('');
  const [summary, setSummary] = useState(null);
  const [activeViewId, setActiveViewId] = useState(null);
  const [defaultApplied, setDefaultApplied] = useState(false);

  const fetchGroups = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const params = { page, per_page: perPage };
      Object.entries(filters).forEach(([k, v]) => { if (v !== '' && v !== null) params[k] = v; });
      const res = await api.get('/duplicate_groups', { params });
      setData(res.data);
    } catch (err) {
      setError(extractApiError(err, 'Failed to load duplicate groups'));
    } finally {
      setLoading(false);
    }
  }, [filters, page, perPage]);

  useEffect(() => { fetchGroups(); }, [fetchGroups]);

  useEffect(() => {
    let cancelled = false;
    api.get('/lead_filter_options')
      .then((res) => {
        if (cancelled) return;
        setOptions({ batches: res.data?.batches || [], files: res.data?.files || [] });
      })
      .catch(() => { /* non-blocking */ });
    return () => { cancelled = true; };
  }, []);

  const fetchSummary = useCallback(async () => {
    try {
      const res = await api.get('/reports', { params: { type: 'duplicates' } });
      setSummary(res.data?.duplicates || null);
    } catch { /* non-blocking */ }
  }, []);
  useEffect(() => { fetchSummary(); }, [fetchSummary]);

  // Apply default saved view on first load.
  useEffect(() => {
    if (defaultApplied) return;
    let cancelled = false;
    api.get('/saved_views', { params: { view_type: 'duplicates' } })
      .then((res) => {
        if (cancelled) return;
        const def = (res.data || []).find((v) => v.is_default);
        if (def) {
          setFilters({ ...EMPTY_FILTERS, ...(def.filters_json || {}) });
          setActiveViewId(def.id);
          setPage(1);
        }
      })
      .catch(() => { /* silent */ })
      .finally(() => { if (!cancelled) setDefaultApplied(true); });
    return () => { cancelled = true; };
  }, [defaultApplied]);

  const applyView = (view) => {
    if (!view) { setActiveViewId(null); return; }
    setFilters({ ...EMPTY_FILTERS, ...(view.filters_json || {}) });
    setActiveViewId(view.id);
    setPage(1);
  };

  const totalPages = Math.max(1, Math.ceil(data.total / perPage));

  const activeChips = useMemo(() => (
    Object.entries(filters).filter(([, v]) => v !== '').map(([k, v]) => ({ key: k, value: v }))
  ), [filters]);

  const clearFilter = (key) => { setFilters((p) => ({ ...p, [key]: '' })); setPage(1); setActiveViewId(null); };
  const clearAll = () => { setFilters(EMPTY_FILTERS); setPage(1); setActiveViewId(null); };
  const updateFilter = (key, value) => { setFilters((p) => ({ ...p, [key]: value })); setPage(1); setActiveViewId(null); };

  const renderChipValue = (k, v) => {
    if (k === 'review_status') return REVIEW_STATUS_BY_KEY[v]?.label || v;
    if (k === 'match_type')    return MATCH_TYPE_BY_KEY[v]?.label || v;
    if (k === 'batch_id') {
      const b = options.batches.find((x) => String(x.id) === String(v)); return b ? b.batch_name : v;
    }
    if (k === 'file_id') {
      const f = options.files.find((x) => String(x.id) === String(v)); return f ? f.display_name : v;
    }
    return String(v);
  };

  const runScan = async () => {
    if (!isAdmin) return;
    if (!window.confirm('Scan all imported leads for duplicate groups? Existing review decisions are preserved.')) return;
    setScanning(true); setScanError(''); setScanSummary(null);
    try {
      const res = await api.post('/duplicate_scan', {});
      setScanSummary(res.data?.summary || null);
      fetchGroups();
      fetchSummary();
    } catch (err) {
      setScanError(extractApiError(err, 'Scan failed'));
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className="max-w-[1600px] mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6 sm:mb-8">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 tracking-tight">Duplicate Review</h1>
          <p className="text-xs sm:text-sm text-gray-500 mt-0.5">
            {data.total.toLocaleString()} {data.total === 1 ? 'group' : 'groups'} detected · no auto-merge
          </p>
        </div>
        {isAdmin && (
          <button
            onClick={runScan}
            disabled={scanning}
            className="inline-flex items-center gap-2 bg-gradient-to-r from-blue-600 to-blue-500 text-white px-4 py-2.5 rounded-xl text-sm font-medium shadow-lg shadow-blue-500/25 hover:shadow-xl disabled:opacity-50 transition-all"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
            {scanning ? 'Scanning…' : 'Run duplicate scan'}
          </button>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-100 text-red-600 px-4 py-3 rounded-xl mb-4 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-red-400 hover:text-red-600 p-1">&times;</button>
        </div>
      )}
      {scanError && (
        <div className="bg-red-50 border border-red-100 text-red-600 px-4 py-3 rounded-xl mb-4">{scanError}</div>
      )}
      {scanSummary && (
        <div className="bg-blue-50 border border-blue-100 text-blue-800 px-4 py-3 rounded-xl mb-4 text-sm flex items-start justify-between gap-3">
          <div>
            <p className="font-semibold">Scan complete</p>
            <p className="text-xs mt-1">
              Scanned {scanSummary.scanned_rows.toLocaleString()} rows · created {scanSummary.created} new groups ·
              updated {scanSummary.updated} · added {scanSummary.members_added} memberships · {scanSummary.total_groups} total groups.
            </p>
          </div>
          <button onClick={() => setScanSummary(null)} className="text-blue-500 hover:text-blue-800">&times;</button>
        </div>
      )}

      {summary && (
        <SummaryCards
          cards={[
            { label: 'Total groups',          value: summary.total,                                                                color: 'blue' },
            { label: 'Pending',               value: summary.by_review_status.find((r) => r.key === 'pending')?.count ?? 0,            color: 'amber' },
            { label: 'Confirmed duplicate',   value: summary.by_review_status.find((r) => r.key === 'confirmed_duplicate')?.count ?? 0, color: 'red' },
            { label: 'Not duplicate',         value: summary.by_review_status.find((r) => r.key === 'not_duplicate')?.count ?? 0,       color: 'emerald' },
            { label: 'Created today',         value: summary.created_today,                                                        color: 'violet' },
          ]}
        />
      )}

      <div className="bg-white rounded-2xl border border-gray-100 p-3 sm:p-4 mb-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <button
            onClick={() => setShowFilters((v) => !v)}
            className={`inline-flex items-center gap-1.5 text-sm font-medium px-3 py-2 rounded-lg border transition-colors ${showFilters ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'}`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" /></svg>
            Filters
            {activeChips.length > 0 && (
              <span className="ml-1 text-[10px] font-semibold bg-blue-600 text-white px-1.5 py-0.5 rounded-full">{activeChips.length}</span>
            )}
          </button>
          {activeChips.length > 0 && (
            <button onClick={clearAll} className="text-xs text-blue-600 hover:text-blue-800 font-medium px-2 py-2">Clear all</button>
          )}
          <div className="ml-auto">
            <SavedViewsMenu
              viewType="duplicates"
              currentFilters={filters}
              activeViewId={activeViewId}
              onApply={applyView}
            />
          </div>
        </div>

        {showFilters && (
          <div className="mt-3 pt-3 border-t border-gray-100 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
            <FilterSelect label="Review status" value={filters.review_status} onChange={(v) => updateFilter('review_status', v)}>
              <option value="">Any</option>
              {REVIEW_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </FilterSelect>
            <FilterSelect label="Match type" value={filters.match_type} onChange={(v) => updateFilter('match_type', v)}>
              <option value="">Any match</option>
              {MATCH_TYPES.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </FilterSelect>
            <FilterSelect label="Minimum confidence" value={filters.min_confidence} onChange={(v) => updateFilter('min_confidence', v)}>
              <option value="">Any</option>
              <option value="0.9">Very high (≥0.90)</option>
              <option value="0.8">High (≥0.80)</option>
              <option value="0.65">Medium (≥0.65)</option>
              <option value="0.5">Low (≥0.50)</option>
            </FilterSelect>
            <FilterSelect label="Batch" value={filters.batch_id} onChange={(v) => updateFilter('batch_id', v)}>
              <option value="">Any batch</option>
              {options.batches.map((b) => <option key={b.id} value={b.id}>{b.batch_name}</option>)}
            </FilterSelect>
            <FilterSelect label="Source file" value={filters.file_id} onChange={(v) => updateFilter('file_id', v)}>
              <option value="">Any file</option>
              {options.files.map((f) => <option key={f.id} value={f.id}>{f.display_name}</option>)}
            </FilterSelect>
            <FilterInput type="date" label="Created from" value={filters.created_from} onChange={(v) => updateFilter('created_from', v)} />
            <FilterInput type="date" label="Created to"   value={filters.created_to}   onChange={(v) => updateFilter('created_to',   v)} />
          </div>
        )}
      </div>

      {activeChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mb-3">
          {activeChips.map(({ key, value }) => (
            <span key={key} className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 text-[11px] font-medium px-2 py-1 rounded-md border border-blue-100">
              {CHIP_LABELS[key]}: <span className="font-semibold">{renderChipValue(key, value)}</span>
              <button onClick={() => clearFilter(key)} className="ml-0.5 text-blue-500 hover:text-blue-800">&times;</button>
            </span>
          ))}
        </div>
      )}

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-16 sm:py-20">
            <div className="w-10 h-10 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin"></div>
            <p className="text-sm text-gray-400 mt-3">Loading groups…</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px]">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="pl-5 pr-2 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Match type</th>
                  <th className="px-3 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Confidence</th>
                  <th className="px-3 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Members</th>
                  <th className="px-3 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Key</th>
                  <th className="px-3 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-3 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Last reviewed</th>
                  <th className="px-3 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Created</th>
                </tr>
              </thead>
              <tbody>
                {data.groups.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-16 text-center">
                      <p className="text-sm text-gray-400">No duplicate groups match these filters.</p>
                      {activeChips.length > 0 && (
                        <button onClick={clearAll} className="text-sm text-blue-600 hover:text-blue-700 font-medium mt-2">Clear all filters</button>
                      )}
                      {isAdmin && activeChips.length === 0 && (
                        <p className="text-xs text-gray-400 mt-2">Run a scan to detect duplicates.</p>
                      )}
                    </td>
                  </tr>
                ) : data.groups.map((g) => {
                  const typeMeta = MATCH_TYPE_BY_KEY[g.match_type];
                  const statusMeta = REVIEW_STATUS_BY_KEY[g.review_status];
                  return (
                    <tr key={g.id} onClick={() => setDetailId(g.id)} className="border-b border-gray-50 hover:bg-gray-50/60 cursor-pointer transition-colors">
                      <td className="pl-5 pr-2 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold ${typeMeta?.bg || 'bg-gray-50'} ${typeMeta?.text || 'text-gray-700'}`}>
                          {typeMeta?.label || g.match_type}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold ${confidenceStyle(g.confidence)}`}>
                          {confidenceLabel(g.confidence)} · {(g.confidence * 100).toFixed(0)}%
                        </span>
                      </td>
                      <td className="px-3 py-3 text-sm text-gray-700 font-medium">{g.member_count}</td>
                      <td className="px-3 py-3 text-xs text-gray-600 truncate max-w-[320px] font-mono">{formatMatchKey(g.match_type, g.match_key)}</td>
                      <td className="px-3 py-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold ${statusMeta?.bg} ${statusMeta?.text}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${statusMeta?.dot}`} />{statusMeta?.label}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-xs text-gray-400">
                        {g.reviewed_at ? (
                          <>
                            <p>{formatDate(g.reviewed_at)}</p>
                            {g.reviewed_by_name && <p className="text-gray-500">by {g.reviewed_by_name}</p>}
                          </>
                        ) : '—'}
                      </td>
                      <td className="px-3 py-3 text-xs text-gray-400">{formatDate(g.created_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-4 py-3 border-t border-gray-100 bg-gray-50/40">
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span>Rows per page:</span>
            <select
              value={perPage}
              onChange={(e) => { setPerPage(Number(e.target.value)); setPage(1); }}
              className="bg-white border border-gray-200 rounded-md px-2 py-1 text-xs"
            >
              {PER_PAGE_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <span className="ml-2">
              {data.total === 0 ? '0' : `${(page - 1) * perPage + 1}–${Math.min(page * perPage, data.total)}`} of {data.total.toLocaleString()}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage(1)} disabled={page <= 1} className="px-2 py-1 text-xs rounded-md border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-40">«</button>
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="px-2 py-1 text-xs rounded-md border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-40">‹ Prev</button>
            <span className="text-xs text-gray-500 px-2">Page {page} / {totalPages}</span>
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="px-2 py-1 text-xs rounded-md border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-40">Next ›</button>
            <button onClick={() => setPage(totalPages)} disabled={page >= totalPages} className="px-2 py-1 text-xs rounded-md border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-40">»</button>
          </div>
        </div>
      </div>

      <DuplicateGroupDrawer groupId={detailId} onClose={() => setDetailId(null)} onChanged={() => { fetchGroups(); fetchSummary(); }} />
    </div>
  );
}

function FilterSelect({ label, value, onChange, children }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-1">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
      >{children}</select>
    </label>
  );
}

function FilterInput({ label, value, onChange, type = 'text' }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-1">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
      />
    </label>
  );
}

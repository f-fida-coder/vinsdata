import { useState, useEffect, useCallback, useMemo } from 'react';
import api, { extractApiError } from '../api';
import MergePrepDrawer from '../components/MergePrepDrawer';
import SummaryCards from '../components/SummaryCards';
import { MATCH_TYPES, MATCH_TYPE_BY_KEY, confidenceLabel, confidenceStyle, formatMatchKey } from '../lib/duplicates';

const PER_PAGE_OPTIONS = [25, 50, 100];

const PREP_STATUS_OPTIONS = [
  { key: 'not_started', label: 'Not started', bg: 'bg-gray-100',   text: 'text-gray-600',    dot: 'bg-gray-400' },
  { key: 'draft',       label: 'Draft',       bg: 'bg-amber-50',   text: 'text-amber-700',   dot: 'bg-amber-500' },
  { key: 'prepared',    label: 'Prepared',    bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },
];
const PREP_STATUS_BY_KEY = Object.fromEntries(PREP_STATUS_OPTIONS.map((s) => [s.key, s]));

const EMPTY_FILTERS = {
  prep_status: '',
  match_type:  '',
  batch_id:    '',
  file_id:     '',
  prepared_by: '',
};

const CHIP_LABELS = {
  prep_status: 'Prep status',
  match_type:  'Match type',
  batch_id:    'Batch',
  file_id:     'File',
  prepared_by: 'Prepared by',
};

function formatDate(s) {
  if (!s) return '—';
  const d = new Date(String(s).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString();
}

export default function MergePrepPage() {
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(50);
  const [data, setData] = useState({ groups: [], total: 0, page: 1, per_page: 50 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [options, setOptions] = useState({ batches: [], files: [], users: [] });
  const [summary, setSummary] = useState(null);
  const [detailGroupId, setDetailGroupId] = useState(null);

  const fetchGroups = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const params = { page, per_page: perPage };
      Object.entries(filters).forEach(([k, v]) => { if (v !== '' && v !== null) params[k] = v; });
      const res = await api.get('/lead_merge_prep', { params });
      setData(res.data);
    } catch (err) {
      setError(extractApiError(err, 'Failed to load merge prep workspace'));
    } finally {
      setLoading(false);
    }
  }, [filters, page, perPage]);

  useEffect(() => { fetchGroups(); }, [fetchGroups]);

  const fetchSummary = useCallback(async () => {
    try {
      const res = await api.get('/reports', { params: { type: 'duplicates' } });
      setSummary(res.data?.duplicates || null);
    } catch { /* non-blocking */ }
  }, []);
  useEffect(() => { fetchSummary(); }, [fetchSummary]);

  useEffect(() => {
    let cancelled = false;
    api.get('/lead_filter_options')
      .then((res) => {
        if (cancelled) return;
        setOptions({
          batches: res.data?.batches || [],
          files:   res.data?.files   || [],
          users:   res.data?.users   || [],
        });
      })
      .catch(() => { /* non-blocking */ });
    return () => { cancelled = true; };
  }, []);

  const totalPages = Math.max(1, Math.ceil(data.total / perPage));
  const activeChips = useMemo(
    () => Object.entries(filters).filter(([, v]) => v !== '').map(([k, v]) => ({ key: k, value: v })),
    [filters],
  );

  const clearFilter = (key) => { setFilters((p) => ({ ...p, [key]: '' })); setPage(1); };
  const clearAll = () => { setFilters(EMPTY_FILTERS); setPage(1); };
  const updateFilter = (key, value) => { setFilters((p) => ({ ...p, [key]: value })); setPage(1); };

  const renderChipValue = (k, v) => {
    if (k === 'prep_status') return PREP_STATUS_BY_KEY[v]?.label || v;
    if (k === 'match_type')  return MATCH_TYPE_BY_KEY[v]?.label || v;
    if (k === 'batch_id') {
      const b = options.batches.find((x) => String(x.id) === String(v)); return b ? b.batch_name : v;
    }
    if (k === 'file_id') {
      const f = options.files.find((x) => String(x.id) === String(v)); return f ? f.display_name : v;
    }
    if (k === 'prepared_by') {
      const u = options.users.find((x) => String(x.id) === String(v)); return u ? u.name : v;
    }
    return String(v);
  };

  return (
    <div className="page">
      <div className="section-header">
        <div>
          <h1 className="section-title">Merge Prep</h1>
          <p className="section-subtitle">
            {data.total.toLocaleString()} confirmed {data.total === 1 ? 'group' : 'groups'} · non-destructive workspace · choose primary record and merge fields
          </p>
        </div>
      </div>

      {summary?.merge_prep && (
        <SummaryCards
          cards={[
            { label: 'Confirmed groups', value: summary.merge_prep.confirmed_groups, color: 'blue' },
            { label: 'Not started',      value: summary.merge_prep.not_started,      color: 'gray' },
            { label: 'Draft',            value: summary.merge_prep.draft,            color: 'amber' },
            { label: 'Prepared',         value: summary.merge_prep.prepared,         color: 'emerald' },
            { label: 'Prepared by me',   value: summary.merge_prep.prepared_by_me,   color: 'violet' },
          ]}
        />
      )}

      {error && (
        <div className="bg-red-50 border border-red-100 text-red-600 px-4 py-3 rounded-xl mb-4 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-red-400 hover:text-red-600 p-1">&times;</button>
        </div>
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
        </div>

        {showFilters && (
          <div className="mt-3 pt-3 border-t border-gray-100 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
            <FilterSelect label="Prep status" value={filters.prep_status} onChange={(v) => updateFilter('prep_status', v)}>
              <option value="">Any</option>
              {PREP_STATUS_OPTIONS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </FilterSelect>
            <FilterSelect label="Match type" value={filters.match_type} onChange={(v) => updateFilter('match_type', v)}>
              <option value="">Any match</option>
              {MATCH_TYPES.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </FilterSelect>
            <FilterSelect label="Batch" value={filters.batch_id} onChange={(v) => updateFilter('batch_id', v)}>
              <option value="">Any batch</option>
              {options.batches.map((b) => <option key={b.id} value={b.id}>{b.batch_name}</option>)}
            </FilterSelect>
            <FilterSelect label="Source file" value={filters.file_id} onChange={(v) => updateFilter('file_id', v)}>
              <option value="">Any file</option>
              {options.files.map((f) => <option key={f.id} value={f.id}>{f.display_name}</option>)}
            </FilterSelect>
            <FilterSelect label="Prepared by" value={filters.prepared_by} onChange={(v) => updateFilter('prepared_by', v)}>
              <option value="">Anyone</option>
              {options.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </FilterSelect>
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
          <div className="flex flex-col items-center justify-center py-16">
            <div className="w-10 h-10 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin"></div>
            <p className="text-sm text-gray-400 mt-3">Loading…</p>
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
                  <th className="px-3 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Prep status</th>
                  <th className="px-3 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Preferred primary</th>
                  <th className="px-3 py-3 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Prepared by</th>
                </tr>
              </thead>
              <tbody>
                {data.groups.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="py-16 text-center">
                      <p className="text-sm text-gray-400">
                        {activeChips.length > 0
                          ? 'No confirmed groups match these filters.'
                          : 'No confirmed duplicate groups yet. Confirm one in Duplicate Review to start prepping it.'}
                      </p>
                      {activeChips.length > 0 && (
                        <button onClick={clearAll} className="text-sm text-blue-600 hover:text-blue-700 font-medium mt-2">Clear all filters</button>
                      )}
                    </td>
                  </tr>
                ) : data.groups.map((g) => {
                  const typeMeta = MATCH_TYPE_BY_KEY[g.match_type];
                  const statusMeta = PREP_STATUS_BY_KEY[g.prep_status] || PREP_STATUS_BY_KEY.not_started;
                  return (
                    <tr key={g.duplicate_group_id}
                        onClick={() => setDetailGroupId(g.duplicate_group_id)}
                        className="border-b border-gray-50 hover:bg-gray-50/60 cursor-pointer transition-colors">
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
                      <td className="px-3 py-3 text-xs text-gray-600 truncate max-w-[280px] font-mono">{formatMatchKey(g.match_type, g.match_key)}</td>
                      <td className="px-3 py-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold ${statusMeta.bg} ${statusMeta.text}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${statusMeta.dot}`} />{statusMeta.label}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-sm text-gray-700">
                        {g.preferred_primary_name || <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-3 py-3 text-xs text-gray-500">
                        {g.prepared_by_name ? (
                          <>
                            <p className="text-gray-700">{g.prepared_by_name}</p>
                            <p className="text-gray-400">{formatDate(g.prepared_at)}</p>
                          </>
                        ) : <span className="text-gray-300">—</span>}
                      </td>
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

      <MergePrepDrawer
        duplicateGroupId={detailGroupId}
        onClose={() => setDetailGroupId(null)}
        onChanged={() => { fetchGroups(); fetchSummary(); }}
      />
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

import { useState, useEffect, useCallback, useMemo } from 'react';
import api, { extractApiError } from '../api';
import MergePrepDrawer from '../components/MergePrepDrawer';
import SummaryCards from '../components/SummaryCards';
import { MATCH_TYPES, MATCH_TYPE_BY_KEY, confidenceLabel, confidenceStyle, formatMatchKey } from '../lib/duplicates';
import { Button, Icon, SectionHeader } from '../components/ui';

const PER_PAGE_OPTIONS = [25, 50, 100];

const PREP_STATUS_OPTIONS = [
  { key: 'not_started', label: 'Not started', variant: 'muted' },
  { key: 'draft',       label: 'Draft',       variant: 'warn' },
  { key: 'prepared',    label: 'Prepared',    variant: 'success' },
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
      <SectionHeader
        title="Merge Prep"
        subtitle={`${data.total.toLocaleString()} confirmed ${data.total === 1 ? 'group' : 'groups'} · non-destructive workspace · choose primary record and merge fields`}
      />

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
        <div
          className="row"
          style={{
            background: 'var(--danger-bg)',
            color: 'var(--danger)',
            padding: '10px 14px',
            borderRadius: 'var(--radius-lg)',
            marginBottom: 16,
            justifyContent: 'space-between',
          }}
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError('')}
            style={{ background: 'transparent', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: 18 }}
          >&times;</button>
        </div>
      )}

      <div className="filters-row">
        <Button
          variant={showFilters ? 'primary' : 'secondary'}
          size="md"
          icon="filter"
          onClick={() => setShowFilters((v) => !v)}
        >
          Filters
          {activeChips.length > 0 && (
            <span
              style={{
                marginLeft: 4,
                background: showFilters ? 'var(--bg-1)' : 'var(--text-0)',
                color: showFilters ? 'var(--text-0)' : 'var(--bg-1)',
                borderRadius: 999,
                padding: '0 6px',
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              {activeChips.length}
            </span>
          )}
        </Button>
        {activeChips.length > 0 && (
          <Button variant="ghost" size="sm" onClick={clearAll}>Clear all</Button>
        )}
      </div>

      {showFilters && (
        <div
          className="card"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 14,
            marginBottom: 16,
            background: 'var(--bg-2)',
          }}
        >
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

      {activeChips.length > 0 && (
        <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
          {activeChips.map(({ key, value }) => (
            <span key={key} className="status-badge sb-info">
              {CHIP_LABELS[key]}: <strong style={{ marginLeft: 2 }}>{renderChipValue(key, value)}</strong>
              <button
                type="button"
                onClick={() => clearFilter(key)}
                style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', marginLeft: 4, opacity: 0.7 }}
                aria-label={`Clear ${CHIP_LABELS[key]} filter`}
              >&times;</button>
            </span>
          ))}
        </div>
      )}

      <div className="tbl-wrap">
        {loading ? (
          <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-2)' }}>
            <div className="vv-spinner" style={{ margin: '0 auto 12px' }}/>
            <p className="tiny">Loading…</p>
          </div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Match type</th>
                <th>Confidence</th>
                <th>Members</th>
                <th>Key</th>
                <th>Prep status</th>
                <th>Preferred primary</th>
                <th>Prepared by</th>
              </tr>
            </thead>
            <tbody>
              {data.groups.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: '60px 20px', textAlign: 'center' }}>
                    <p className="cell-muted">
                      {activeChips.length > 0
                        ? 'No confirmed groups match these filters.'
                        : 'No confirmed duplicate groups yet. Confirm one in Duplicate Review to start prepping it.'}
                    </p>
                    {activeChips.length > 0 && (
                      <div style={{ marginTop: 8 }}>
                        <Button variant="ghost" size="sm" onClick={clearAll}>Clear all filters</Button>
                      </div>
                    )}
                  </td>
                </tr>
              ) : data.groups.map((g) => {
                const typeMeta = MATCH_TYPE_BY_KEY[g.match_type];
                const statusMeta = PREP_STATUS_BY_KEY[g.prep_status] || PREP_STATUS_BY_KEY.not_started;
                return (
                  <tr key={g.duplicate_group_id} onClick={() => setDetailGroupId(g.duplicate_group_id)}>
                    <td className="cell-strong">{typeMeta?.label || g.match_type}</td>
                    <td>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold ${confidenceStyle(g.confidence)}`}>
                        {confidenceLabel(g.confidence)} · {(g.confidence * 100).toFixed(0)}%
                      </span>
                    </td>
                    <td className="cell-strong">{g.member_count}</td>
                    <td className="cell-mono" style={{ maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {formatMatchKey(g.match_type, g.match_key)}
                    </td>
                    <td><span className={`status-badge sb-${statusMeta.variant}`}>{statusMeta.label}</span></td>
                    <td>
                      {g.preferred_primary_name || <span className="cell-muted">—</span>}
                    </td>
                    <td>
                      {g.prepared_by_name ? (
                        <>
                          <div className="cell-strong">{g.prepared_by_name}</div>
                          <div className="cell-muted tiny">{formatDate(g.prepared_at)}</div>
                        </>
                      ) : <span className="cell-muted">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        <div className="tbl-pagination">
          <div className="row" style={{ gap: 8 }}>
            <span>Rows per page:</span>
            <select
              value={perPage}
              onChange={(e) => { setPerPage(Number(e.target.value)); setPage(1); }}
              className="vv-input"
              style={{ width: 'auto', padding: '4px 24px 4px 8px', fontSize: 12 }}
            >
              {PER_PAGE_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <span>·</span>
            <span>
              {data.total === 0 ? '0' : `${(page - 1) * perPage + 1}–${Math.min(page * perPage, data.total)}`} of {data.total.toLocaleString()}
            </span>
          </div>
          <div className="tbl-pag-controls">
            <Button variant="ghost" size="sm" onClick={() => setPage(1)} disabled={page <= 1}>«</Button>
            <Button variant="ghost" size="sm" icon="chevronLeft" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>Prev</Button>
            <span style={{ padding: '0 6px' }}>Page {page} / {totalPages}</span>
            <Button variant="ghost" size="sm" iconAfter="chevronRight" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>Next</Button>
            <Button variant="ghost" size="sm" onClick={() => setPage(totalPages)} disabled={page >= totalPages}>»</Button>
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
    <div>
      <label className="field-label">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="vv-input">
        {children}
      </select>
    </div>
  );
}

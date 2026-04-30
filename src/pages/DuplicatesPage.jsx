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
import { Button, SectionHeader } from '../components/ui';

const PER_PAGE_OPTIONS = [25, 50, 100];

const REVIEW_STATUS_VARIANT = {
  pending: 'warn',
  confirmed_duplicate: 'danger',
  not_duplicate: 'success',
  ignored: 'muted',
};

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
    <div className="page">
      <SectionHeader
        title="Duplicate Review"
        subtitle={`${data.total.toLocaleString()} ${data.total === 1 ? 'group' : 'groups'} detected · confirm or dismiss to keep records clean`}
        actions={isAdmin ? (
          <Button variant="primary" icon="refresh" onClick={runScan} disabled={scanning}>
            {scanning ? 'Scanning…' : 'Run duplicate scan'}
          </Button>
        ) : null}
      />

      {error && <ErrorAlert message={error} onClose={() => setError('')} />}
      {scanError && <ErrorAlert message={scanError} onClose={() => setScanError('')} />}
      {scanSummary && (
        <div
          className="row"
          style={{
            background: 'var(--info-bg)',
            color: 'var(--info)',
            padding: '12px 14px',
            borderRadius: 'var(--radius-lg)',
            marginBottom: 16,
            justifyContent: 'space-between',
            alignItems: 'flex-start',
          }}
        >
          <div>
            <p className="cell-strong" style={{ color: 'var(--info)' }}>Scan complete</p>
            <p className="tiny" style={{ marginTop: 4 }}>
              Scanned {scanSummary.scanned_rows.toLocaleString()} rows · created {scanSummary.created} new groups ·
              updated {scanSummary.updated} · added {scanSummary.members_added} memberships · {scanSummary.total_groups} total groups.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setScanSummary(null)}
            style={{ background: 'transparent', border: 'none', color: 'var(--info)', cursor: 'pointer', fontSize: 18 }}
          >&times;</button>
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
        <span className="spacer"/>
        <SavedViewsMenu
          viewType="duplicates"
          currentFilters={filters}
          activeViewId={activeViewId}
          onApply={applyView}
        />
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
            <p className="tiny">Loading groups…</p>
          </div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Match type</th>
                <th>Confidence</th>
                <th>Members</th>
                <th>Key</th>
                <th>Status</th>
                <th>Last reviewed</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {data.groups.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: '60px 20px', textAlign: 'center' }}>
                    <p className="cell-muted">No duplicate groups match these filters.</p>
                    {activeChips.length > 0 && (
                      <div style={{ marginTop: 8 }}>
                        <Button variant="ghost" size="sm" onClick={clearAll}>Clear all filters</Button>
                      </div>
                    )}
                    {isAdmin && activeChips.length === 0 && (
                      <p className="tiny cell-muted" style={{ marginTop: 8 }}>Run a scan to detect duplicates.</p>
                    )}
                  </td>
                </tr>
              ) : data.groups.map((g) => {
                const typeMeta = MATCH_TYPE_BY_KEY[g.match_type];
                const statusMeta = REVIEW_STATUS_BY_KEY[g.review_status];
                const variant = REVIEW_STATUS_VARIANT[g.review_status] || 'neutral';
                return (
                  <tr key={g.id} onClick={() => setDetailId(g.id)}>
                    <td className="cell-strong">{typeMeta?.label || g.match_type}</td>
                    <td>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold ${confidenceStyle(g.confidence)}`}>
                        {confidenceLabel(g.confidence)} · {(g.confidence * 100).toFixed(0)}%
                      </span>
                    </td>
                    <td className="cell-strong">{g.member_count}</td>
                    <td className="cell-mono" style={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {formatMatchKey(g.match_type, g.match_key)}
                    </td>
                    <td><span className={`status-badge sb-${variant}`}>{statusMeta?.label || g.review_status}</span></td>
                    <td className="tiny cell-muted">
                      {g.reviewed_at ? (
                        <>
                          <div>{formatDate(g.reviewed_at)}</div>
                          {g.reviewed_by_name && <div>by {g.reviewed_by_name}</div>}
                        </>
                      ) : '—'}
                    </td>
                    <td className="tiny cell-muted">{formatDate(g.created_at)}</td>
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

      <DuplicateGroupDrawer groupId={detailId} onClose={() => setDetailId(null)} onChanged={() => { fetchGroups(); fetchSummary(); }} />
    </div>
  );
}

function ErrorAlert({ message, onClose }) {
  return (
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
      <span>{message}</span>
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          style={{ background: 'transparent', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: 18 }}
        >&times;</button>
      )}
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

function FilterInput({ label, value, onChange, type = 'text' }) {
  return (
    <div>
      <label className="field-label">{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} className="vv-input"/>
    </div>
  );
}

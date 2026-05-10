import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import api, { extractApiError } from '../api';
import LeadDetailDrawer from '../components/LeadDetailDrawer';
import SavedViewsMenu from '../components/SavedViewsMenu';
import { BulkActionsBar, BulkActionModal, BulkResultModal } from '../components/LeadBulkActions';
import { useAuth } from '../context/AuthContext';
import {
  LEAD_STATUSES, LEAD_PRIORITIES, LEAD_TEMPERATURES,
  STATUS_BY_KEY, PRIORITY_BY_KEY, TEMPERATURE_BY_KEY,
  LEAD_TIERS, TIER_BY_KEY, computeLeadTier,
  formatPrice, formatPhone,
} from '../lib/crm';
import { Button, Icon } from '../components/ui';

const PER_PAGE_OPTIONS = [25, 50, 100, 200];

const EMPTY_FILTERS = {
  q: '',
  batch_id: '',
  file_id: '',
  vehicle_id: '',
  source_stage: '',
  state: '',
  make: '',
  model: '',
  year: '',
  vin: '',
  phone_primary: '',
  email_primary: '',
  first_name: '',
  last_name: '',
  city: '',
  zip_code: '',
  imported_from: '',
  imported_to: '',
  status: '',
  priority: '',
  lead_temperature: '',
  assigned_user_id: '',
  label_id: '',
  has_open_tasks: '',
  tasks_due_today: '',
  tasks_overdue: '',
  number_of_owners_min: '',
  number_of_owners_max: '',
  in_campaign_id: '',
  tier: '',
};

// Which filters show as removable "chips" above the table.
const CHIP_LABELS = {
  q:             'Search',
  batch_id:      'Batch',
  file_id:       'File',
  vehicle_id:    'Vehicle',
  source_stage:  'Stage',
  state:         'State',
  make:          'Make',
  model:         'Model',
  year:          'Year',
  vin:           'VIN',
  phone_primary: 'Phone',
  email_primary: 'Email',
  first_name:    'First name',
  last_name:     'Last name',
  city:          'City',
  zip_code:      'ZIP',
  imported_from: 'Imported from',
  imported_to:   'Imported to',
  status:           'Status',
  priority:         'Priority',
  lead_temperature: 'Temperature',
  assigned_user_id: 'Agent',
  label_id:         'Label',
  has_open_tasks:   'Open tasks',
  tasks_due_today:  'Due today',
  tasks_overdue:    'Overdue tasks',
  number_of_owners_min: 'Owners ≥',
  number_of_owners_max: 'Owners ≤',
  in_campaign_id: 'In campaign',
  tier: 'Tier',
};

function formatDate(s) {
  if (!s) return '—';
  const d = new Date(String(s).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString();
}

// Title-case a vehicle string while leaving year numbers alone:
// "2002 TOYOTA LAND CRUISER" -> "2002 Toyota Land Cruiser"
function formatVehicle(s) {
  if (!s) return s;
  return String(s)
    .split(' ')
    .map((w) => /^\d/.test(w) ? w : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function normValue(lead, key) {
  return lead?.normalized_payload?.[key] ?? '';
}

/** Single consistent empty-cell marker. */
const EmDash = () => <span className="text-gray-300">—</span>;

/** First-initial avatar + name, with a muted "Unassigned" fallback. */
function AgentCell({ name }) {
  if (!name) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-gray-400">
        <span className="w-5 h-5 rounded-full bg-gray-100 border border-dashed border-gray-300" />
        Unassigned
      </span>
    );
  }
  const initial = String(name).trim().charAt(0).toUpperCase() || '?';
  return (
    <span className="inline-flex items-center gap-2">
      <span className="w-5 h-5 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 text-white text-[10px] font-semibold flex items-center justify-center shrink-0">
        {initial}
      </span>
      <span className="text-[13px] text-gray-700 truncate max-w-[120px]">{name}</span>
    </span>
  );
}

/** Priority shows only a colored dot for the default (`medium`); full badge for the rest. */
function PriorityCell({ priorityKey }) {
  const meta = PRIORITY_BY_KEY[priorityKey] || PRIORITY_BY_KEY.medium;
  if (priorityKey === 'medium' || !priorityKey) {
    return (
      <span
        title="Medium (default)"
        className={`inline-block w-2 h-2 rounded-full ${meta.dot}`}
      />
    );
  }
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold ${meta.bg} ${meta.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />{meta.label}
    </span>
  );
}

/** Compact VIN: small mono, last 6 chars accented, full value on hover. */
function VinCell({ vin }) {
  if (!vin) return <EmDash />;
  const s = String(vin);
  const tail = s.length > 6 ? s.slice(-6) : s;
  const head = s.length > 6 ? s.slice(0, -6) : '';
  return (
    <span title={s} className="text-[11px] font-mono text-gray-500 tabular-nums">
      {head && <span className="text-gray-400">{head}</span>}
      <span className="text-gray-700">{tail}</span>
    </span>
  );
}

// Keys with dedicated hardcoded columns — all other keys surface as "custom" columns.
const HARDCODED_PAYLOAD_KEYS = new Set([
  'vin', 'first_name', 'last_name', 'full_name',
  'phone_primary', 'phone_secondary', 'email_primary',
  'full_address', 'city', 'state', 'zip_code',
  'make', 'model', 'year', 'mileage',
]);

// User-toggleable built-in table columns. "name" is always visible (the row anchor).
// Each entry: [key, label, defaultHidden]
const BUILTIN_COLUMNS = [
  ['tier',        'Tier',        false],
  ['status',      'Status',      false],
  ['priority',    'Priority',    true],
  ['temperature', 'Temperature', true],
  ['agent',       'Agent',       true],
  ['labels',      'Labels',      true],
  ['wanted',      'Wanted',      true],
  ['offered',     'Offered',     true],
  ['vin',         'VIN',         true],
  ['phone',       'Phone',       false],
  ['email',       'Email',       false],
  ['location',    'Location',    true],
  ['vehicle',     'Vehicle',     false],
  ['source_file', 'Source file', true],
  ['batch',       'Batch',       true],
  ['stage',       'Stage',       true],
  ['row_number',  'Row #',       true],
  ['imported',    'Imported',    true],
];
const BUILTIN_COLUMN_KEYS = BUILTIN_COLUMNS.map(([k]) => k);
const BUILTIN_COLUMN_LABELS = Object.fromEntries(BUILTIN_COLUMNS.map(([k, l]) => [k, l]));
const DEFAULT_HIDDEN_BUILTINS = BUILTIN_COLUMNS.filter(([, , h]) => h).map(([k]) => k);

export default function LeadsPage() {
  const { user } = useAuth();
  // Marketers see the full unscoped view (same as admins) because they need
  // cross-portfolio visibility to build campaign segments. Only true agents
  // (carfax/filter/tlo) get the "my leads" treatment.
  const isAdmin = user?.role === 'admin' || user?.role === 'marketer';
  const [searchParams] = useSearchParams();
  const [filters, setFilters] = useState(() => {
    // Honor query-string filters on first mount (used by the "View recipients in CRM"
    // link from a campaign detail page).
    const seeded = { ...EMPTY_FILTERS };
    ['in_campaign_id', 'status'].forEach((k) => {
      const v = searchParams.get(k);
      if (v !== null && v !== '') seeded[k] = v;
    });
    return seeded;
  });
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(50);
  const [data, setData] = useState({ leads: [], total: 0, page: 1, per_page: 50 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [options, setOptions] = useState({ batches: [], files: [], vehicles: [], stages: [], states: [], makes: [], years: [], users: [], labels: [] });
  const [detailId, setDetailId] = useState(null);
  const [summary, setSummary] = useState(null);
  const [selection, setSelection] = useState(() => new Set());
  const [bulkAction, setBulkAction] = useState(null);
  const [hiddenColumns, setHiddenColumns] = useState(() => {
    try {
      const stored = localStorage.getItem('lead_hidden_columns');
      if (stored) return new Set(JSON.parse(stored));
    } catch { /* fall through */ }
    return new Set(DEFAULT_HIDDEN_BUILTINS);
  });
  const [columnsMenuOpen, setColumnsMenuOpen] = useState(false);
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  const [bulkResult, setBulkResult] = useState(null);
  const [activeViewId, setActiveViewId] = useState(null);
  const [defaultApplied, setDefaultApplied] = useState(false);

  // Debounce search input → filters.q
  useEffect(() => {
    const t = setTimeout(() => {
      if (searchInput !== filters.q) {
        setFilters((prev) => ({ ...prev, q: searchInput }));
        setPage(1);
        setActiveViewId(null);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [searchInput, filters.q]);

  const fetchLeads = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const params = { page, per_page: perPage };
      Object.entries(filters).forEach(([k, v]) => {
        if (v !== '' && v !== null && v !== undefined) params[k] = v;
      });
      const res = await api.get('/leads', { params });
      setData(res.data);
    } catch (err) {
      setError(extractApiError(err, 'Failed to load leads'));
    } finally {
      setLoading(false);
    }
  }, [filters, page, perPage]);

  useEffect(() => { fetchLeads(); }, [fetchLeads]);

  useEffect(() => {
    let cancelled = false;
    api.get('/lead_filter_options')
      .then((res) => { if (!cancelled) setOptions(res.data); })
      .catch(() => { /* non-blocking */ });
    return () => { cancelled = true; };
  }, []);

  // Summary cards data.
  const fetchSummary = useCallback(async () => {
    try {
      const res = await api.get('/reports', { params: { type: 'leads' } });
      setSummary(res.data?.leads || null);
    } catch { /* non-blocking; cards just won't render */ }
  }, []);
  useEffect(() => { fetchSummary(); }, [fetchSummary]);

  // Apply default saved view on first load.
  useEffect(() => {
    if (defaultApplied) return;
    let cancelled = false;
    api.get('/saved_views', { params: { view_type: 'leads' } })
      .then((res) => {
        if (cancelled) return;
        const def = (res.data || []).find((v) => v.is_default);
        if (def) {
          setFilters({ ...EMPTY_FILTERS, ...(def.filters_json || {}) });
          setSearchInput(def.filters_json?.q || '');
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
    setSearchInput(view.filters_json?.q || '');
    setActiveViewId(view.id);
    setPage(1);
  };

  useEffect(() => {
    try { localStorage.setItem('lead_hidden_columns', JSON.stringify([...hiddenColumns])); } catch { /* ignore quota */ }
  }, [hiddenColumns]);

  const customColumns = useMemo(() => {
    const order = [];
    const seen = new Set();
    for (const lead of data.leads) {
      const np = lead.normalized_payload || {};
      for (const k of Object.keys(np)) {
        if (HARDCODED_PAYLOAD_KEYS.has(k) || seen.has(k)) continue;
        seen.add(k);
        order.push(k);
      }
    }
    return order;
  }, [data.leads]);

  const visibleCustomColumns = useMemo(
    () => customColumns.filter((k) => !hiddenColumns.has(k)),
    [customColumns, hiddenColumns],
  );

  const toggleColumn = (key) => {
    setHiddenColumns((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const pageIds = useMemo(() => data.leads.map((l) => l.id), [data.leads]);
  const pageSelectedCount = useMemo(
    () => pageIds.reduce((n, id) => n + (selection.has(id) ? 1 : 0), 0),
    [pageIds, selection],
  );
  const allPageSelected = pageIds.length > 0 && pageSelectedCount === pageIds.length;
  const somePageSelected = pageSelectedCount > 0 && !allPageSelected;

  const togglePageSelection = () => {
    setSelection((prev) => {
      const next = new Set(prev);
      if (allPageSelected) {
        pageIds.forEach((id) => next.delete(id));
      } else {
        pageIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const toggleRow = (id) => {
    setSelection((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const clearSelection = () => setSelection(new Set());

  const runBulk = async (payload) => {
    setBulkSubmitting(true);
    try {
      const res = await api.post('/lead_bulk_actions', {
        lead_ids: Array.from(selection),
        action:   bulkAction,
        payload,
      });
      setBulkResult(res.data);
      setBulkAction(null);
      // On any success clear selection; if all-or-some failed the user can reselect.
      if ((res.data?.succeeded ?? 0) > 0) clearSelection();
    } catch (err) {
      setError(extractApiError(err, 'Bulk action failed'));
      setBulkAction(null);
    } finally {
      setBulkSubmitting(false);
    }
  };

  const afterBulkResult = () => {
    setBulkResult(null);
    fetchLeads();
    fetchSummary();
  };

  const exportCsvUrl = useMemo(() => {
    const qs = new URLSearchParams();
    qs.set('format', 'csv');
    Object.entries(filters).forEach(([k, v]) => { if (v !== '' && v !== null && v !== undefined) qs.set(k, String(v)); });
    return `/api/leads?${qs.toString()}`;
  }, [filters]);

  const totalPages = Math.max(1, Math.ceil(data.total / perPage));
  const activeChips = useMemo(() => {
    return Object.entries(filters).filter(([k, v]) => v !== '' && k !== 'q').map(([k, v]) => ({ key: k, value: v }));
  }, [filters]);

  const clearFilter = (key) => {
    setFilters((prev) => ({ ...prev, [key]: '' }));
    setPage(1);
    setActiveViewId(null);
  };
  const clearAll = () => { setFilters(EMPTY_FILTERS); setSearchInput(''); setPage(1); setActiveViewId(null); };
  const updateFilter = (key, value) => { setFilters((prev) => ({ ...prev, [key]: value })); setPage(1); setActiveViewId(null); };

  const [deletingBatch, setDeletingBatch] = useState(false);
  const deleteCurrentBatch = async () => {
    const batchId = filters.batch_id;
    if (!batchId || !isAdmin) return;
    const label = batchLabel(batchId);
    const ok = window.confirm(
      `Delete batch "${label}" and all its leads?\n\n` +
      `This permanently removes the imported leads from this batch and all attached CRM data ` +
      `(notes, tasks, contact logs, labels, marketing recipients). The uploaded source file is kept.\n\n` +
      `This cannot be undone.`
    );
    if (!ok) return;
    setDeletingBatch(true);
    try {
      const res = await api.delete('/lead_imports', { data: { id: Number(batchId) } });
      window.alert(`Deleted batch "${res.data.batch_name}" and ${res.data.deleted_leads} lead${res.data.deleted_leads === 1 ? '' : 's'}.`);
      // Drop the now-stale filter and refresh.
      setFilters((prev) => ({ ...prev, batch_id: '' }));
      setPage(1);
      setActiveViewId(null);
      // Refresh batch options so the deleted batch disappears from the dropdown.
      try {
        const opts = await api.get('/lead_filter_options');
        setOptions(opts.data);
      } catch { /* non-blocking */ }
      fetchLeads();
    } catch (err) {
      window.alert(extractApiError(err, 'Failed to delete batch'));
    } finally {
      setDeletingBatch(false);
    }
  };

  const batchLabel = (id) => {
    const b = options.batches.find((x) => String(x.id) === String(id));
    return b ? b.batch_name : id;
  };
  const fileLabel = (id) => {
    const f = options.files.find((x) => String(x.id) === String(id));
    return f ? f.display_name : id;
  };
  const vehicleLabel = (id) => {
    const v = options.vehicles.find((x) => String(x.id) === String(id));
    return v ? v.name : id;
  };
  const userLabel = (id) => {
    if (id === 'unassigned') return 'Unassigned';
    const u = options.users.find((x) => String(x.id) === String(id));
    return u ? u.name : id;
  };
  const labelName = (id) => {
    const l = options.labels.find((x) => String(x.id) === String(id));
    return l ? l.name : id;
  };

  const renderChipValue = (k, v) => {
    if (k === 'batch_id')         return batchLabel(v);
    if (k === 'file_id')          return fileLabel(v);
    if (k === 'vehicle_id')       return vehicleLabel(v);
    if (k === 'assigned_user_id') return userLabel(v);
    if (k === 'label_id')         return labelName(v);
    if (k === 'status')           return STATUS_BY_KEY[v]?.label || v;
    if (k === 'priority')         return PRIORITY_BY_KEY[v]?.label || v;
    if (k === 'lead_temperature') return v === 'unset' ? 'Not set' : (TEMPERATURE_BY_KEY[v]?.label || v);
    if (k === 'tier') return TIER_BY_KEY[v]?.label || v;
    if (k === 'has_open_tasks')   return v === '1' ? 'Has open tasks' : 'No open tasks';
    if (k === 'tasks_due_today')  return 'Yes';
    if (k === 'tasks_overdue')    return 'Yes';
    return String(v);
  };

  return (
    <div className="page leads-page">
      <div className="leads-header">
        <h1 className="section-title">{isAdmin ? 'CRM Leads' : 'My Leads'}</h1>
        <span className="leads-header-stats">
          <InlineStats
            total={data.total}
            summary={summary}
            isAdmin={isAdmin}
            activeFilters={filters}
            onToggleFilter={(key, value) => updateFilter(
              key,
              filters[key] === value ? '' : value,
            )}
          />
        </span>
      </div>

      {error && (
        <div
          className="row"
          style={{
            background: 'var(--danger-bg)',
            border: '1px solid var(--border-0)',
            color: 'var(--danger)',
            padding: '10px 14px',
            borderRadius: 'var(--radius-lg)',
            marginBottom: 12,
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

      <div className="tbl-wrap" style={{ marginBottom: 16 }}>
        {/* Toolbar: search + filter toggle + saved views + columns + export */}
        <div className="tbl-toolbar">
          <div className="tbl-search">
            <div className="vv-input-wrap">
              <Icon name="search" size={15} className="vv-input-icon"/>
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search VIN, name, phone, email, city…   ( / )"
                className="vv-input has-icon"
              />
            </div>
          </div>
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
          {(activeChips.length > 0 || filters.q) && (
            <Button variant="ghost" size="sm" onClick={clearAll}>Clear all</Button>
          )}
          <span className="spacer"/>
          <SavedViewsMenu
            viewType="leads"
            currentFilters={filters}
            activeViewId={activeViewId}
            onApply={applyView}
          />
          <ColumnsMenu
            open={columnsMenuOpen}
            onOpenChange={setColumnsMenuOpen}
            customColumns={customColumns}
            hiddenColumns={hiddenColumns}
            onToggle={toggleColumn}
            onShowAll={() => setHiddenColumns(new Set())}
            onHideAll={() => setHiddenColumns(new Set([...BUILTIN_COLUMN_KEYS, ...customColumns]))}
          />
          <a
            href={exportCsvUrl}
            className="vv-btn vv-btn-ghost vv-btn-icon"
            title={`Export ${data.total.toLocaleString()} matching leads as CSV`}
            aria-label="Export CSV"
          >
            <Icon name="download" size={16}/>
          </a>
        </div>

        {/* Quick-filter pills — single compact row, horizontally scrollable on narrow screens */}
        <QuickFilterPills
          tier={filters.tier}
          temperature={filters.lead_temperature}
          status={filters.status}
          onTier={(v) => updateFilter('tier', v === filters.tier ? '' : v)}
          onTemp={(v) => updateFilter('lead_temperature', v === filters.lead_temperature ? '' : v)}
          onStatus={(v) => updateFilter('status', v === filters.status ? '' : v)}
        />

        {showFilters && (
          <div
            style={{
              padding: 16,
              borderBottom: '1px solid var(--border-0)',
              background: 'var(--bg-2)',
            }}
          >
            <div
              className="leads-filter-grid"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: 14,
                marginBottom: 14,
              }}
            >
              <FilterSelect label="Vehicle" value={filters.vehicle_id} onChange={(v) => updateFilter('vehicle_id', v)}>
                <option value="">Any vehicle</option>
                {options.vehicles.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </FilterSelect>
              <FilterSelect label="Vehicle · Make" value={filters.make} onChange={(v) => updateFilter('make', v)}>
                <option value="">Any make</option>
                {options.makes.map((m) => <option key={m} value={m}>{m}</option>)}
              </FilterSelect>
              <FilterSelect label="Year" value={filters.year} onChange={(v) => updateFilter('year', v)}>
                <option value="">Any year</option>
                {options.years.map((y) => <option key={y} value={y}>{y}</option>)}
              </FilterSelect>
              <FilterSelect label="State" value={filters.state} onChange={(v) => updateFilter('state', v)}>
                <option value="">Any state</option>
                {options.states.map((s) => <option key={s} value={s}>{s}</option>)}
              </FilterSelect>
              <NumberOfOwnersFilter
                min={filters.number_of_owners_min}
                max={filters.number_of_owners_max}
                onChangeMin={(v) => updateFilter('number_of_owners_min', v)}
                onChangeMax={(v) => updateFilter('number_of_owners_max', v)}
              />

              <FilterSelect label="Priority" value={filters.priority} onChange={(v) => updateFilter('priority', v)}>
                <option value="">Any priority</option>
                {LEAD_PRIORITIES.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
              </FilterSelect>
              {isAdmin && (
                <FilterSelect label="Agent" value={filters.assigned_user_id} onChange={(v) => updateFilter('assigned_user_id', v)}>
                  <option value="">Any assignee</option>
                  <option value="unassigned">Unassigned</option>
                  {options.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </FilterSelect>
              )}
              <FilterSelect label="Label" value={filters.label_id} onChange={(v) => updateFilter('label_id', v)}>
                <option value="">Any label</option>
                {options.labels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </FilterSelect>
              <FilterSelect label="Open tasks" value={filters.has_open_tasks} onChange={(v) => updateFilter('has_open_tasks', v)}>
                <option value="">Any</option>
                <option value="1">Has open tasks</option>
                <option value="0">No open tasks</option>
              </FilterSelect>

              <FilterSelect label="Source stage" value={filters.source_stage} onChange={(v) => updateFilter('source_stage', v)}>
                <option value="">Any stage</option>
                {options.stages.map((s) => <option key={s} value={s}>{s}</option>)}
              </FilterSelect>
              <FilterInput type="date" label="Imported from" value={filters.imported_from} onChange={(v) => updateFilter('imported_from', v)} />
              <FilterInput type="date" label="Imported to"   value={filters.imported_to}   onChange={(v) => updateFilter('imported_to',   v)} />
              <FilterSelect label="Batch" value={filters.batch_id} onChange={(v) => updateFilter('batch_id', v)}>
                <option value="">Any batch</option>
                {options.batches.map((b) => <option key={b.id} value={b.id}>{b.batch_name}</option>)}
              </FilterSelect>
            </div>
            <div className="row" style={{ justifyContent: 'flex-end', gap: 6 }}>
              <Button variant="ghost" size="sm" onClick={clearAll}>Reset</Button>
              <Button variant="primary" size="sm" onClick={() => setShowFilters(false)}>Apply filters</Button>
            </div>
          </div>
        )}

        {activeChips.length > 0 && (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 6,
              padding: '10px 14px',
              borderBottom: '1px solid var(--border-0)',
            }}
          >
            {activeChips.map(({ key, value }) => (
              <span key={key} className="status-badge sb-info" style={{ paddingRight: 4 }}>
                {CHIP_LABELS[key]}: <strong style={{ marginLeft: 2 }}>{renderChipValue(key, value)}</strong>
                <button
                  type="button"
                  onClick={() => clearFilter(key)}
                  style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer', marginLeft: 4, opacity: 0.7 }}
                  aria-label={`Clear ${CHIP_LABELS[key]} filter`}
                >&times;</button>
              </span>
            ))}
            {isAdmin && filters.batch_id !== '' && (
              <button
                type="button"
                onClick={deleteCurrentBatch}
                disabled={deletingBatch}
                style={{
                  marginLeft: 'auto',
                  background: 'transparent',
                  border: '1px solid #fca5a5',
                  color: '#b91c1c',
                  cursor: deletingBatch ? 'not-allowed' : 'pointer',
                  fontSize: 11,
                  fontWeight: 600,
                  padding: '4px 10px',
                  borderRadius: 6,
                  opacity: deletingBatch ? 0.6 : 1,
                }}
                title="Permanently delete this batch and all its imported leads"
              >
                {deletingBatch ? 'Deleting…' : 'Delete this batch'}
              </button>
            )}
          </div>
        )}

        <BulkActionsBar
          selection={selection}
          onClear={clearSelection}
          onAction={(a) => setBulkAction(a)}
          user={user}
        />

        <div>
        {loading ? (
          <div className="flex flex-col items-center justify-center py-16 sm:py-20">
            <div className="w-10 h-10 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin"></div>
            <p className="text-sm text-gray-400 mt-3">Loading leads…</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full leads-table" style={{ minWidth: undefined }}>
              <thead className="leads-thead sticky top-0 z-10">
                <tr>
                  <th className="pl-5 pr-1 py-2 w-8">
                    <input
                      type="checkbox"
                      checked={allPageSelected}
                      ref={(el) => { if (el) el.indeterminate = somePageSelected; }}
                      onChange={togglePageSelection}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      aria-label="Select all on page"
                    />
                  </th>
                  <th className="px-2 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Name</th>
                  {!hiddenColumns.has('tier')        && <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Tier</th>}
                  {!hiddenColumns.has('status')      && <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Status</th>}
                  {!hiddenColumns.has('priority')    && <th className="hidden sm:table-cell px-3 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Priority</th>}
                  {!hiddenColumns.has('temperature') && <th className="hidden sm:table-cell px-3 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Temperature</th>}
                  {!hiddenColumns.has('agent')       && <th className="hidden md:table-cell px-3 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Agent</th>}
                  {!hiddenColumns.has('labels')      && <th className="hidden md:table-cell px-3 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Labels</th>}
                  {!hiddenColumns.has('wanted')      && <th className="hidden xl:table-cell px-3 py-2 text-right text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Wanted</th>}
                  {!hiddenColumns.has('offered')     && <th className="hidden xl:table-cell px-3 py-2 text-right text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Offered</th>}
                  {!hiddenColumns.has('vin')         && <th className="hidden lg:table-cell px-3 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">VIN</th>}
                  {!hiddenColumns.has('phone')       && <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Phone</th>}
                  {!hiddenColumns.has('email')       && <th className="hidden lg:table-cell px-3 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Email</th>}
                  {!hiddenColumns.has('location')    && <th className="hidden md:table-cell px-3 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Location</th>}
                  {!hiddenColumns.has('vehicle')     && <th className="hidden md:table-cell px-3 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Vehicle</th>}
                  {!hiddenColumns.has('source_file') && <th className="hidden lg:table-cell px-3 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Source file</th>}
                  {!hiddenColumns.has('batch')       && <th className="hidden lg:table-cell px-3 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Batch</th>}
                  {!hiddenColumns.has('stage')       && <th className="hidden md:table-cell px-3 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Stage</th>}
                  {!hiddenColumns.has('row_number')  && <th className="hidden xl:table-cell px-3 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Row #</th>}
                  {!hiddenColumns.has('imported')    && <th className="hidden lg:table-cell px-3 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Imported</th>}
                  {visibleCustomColumns.map((k) => (
                    <th key={`h-${k}`} className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap truncate max-w-[200px]" title={k}>
                      {k}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.leads.length === 0 ? (
                  <tr>
                    <td colSpan={2 + BUILTIN_COLUMN_KEYS.filter((k) => !hiddenColumns.has(k)).length + visibleCustomColumns.length} className="py-16 text-center">
                      <p className="text-sm text-gray-400">No leads match these filters.</p>
                      {activeChips.length > 0 && (
                        <button onClick={clearAll} className="text-sm text-blue-600 hover:text-blue-700 font-medium mt-2">Clear all filters</button>
                      )}
                    </td>
                  </tr>
                ) : data.leads.map((lead) => {
                  const np   = lead.normalized_payload || {};
                  const name = np.full_name || [np.first_name, np.last_name].filter(Boolean).join(' ') || '—';
                  const location = [np.city, np.state].filter(Boolean).join(', ') || '—';
                  const vehicle  = [np.year, np.make, np.model].filter(Boolean).join(' ') || '—';
                  const crm      = lead.crm_state || {};
                  const labels   = lead.labels || [];
                  const statusMeta      = STATUS_BY_KEY[crm.status] || STATUS_BY_KEY.new;
                  const temperatureMeta = TEMPERATURE_BY_KEY[crm.lead_temperature] || null;
                  // Tier comes from the API if present; otherwise compute from normalized payload.
                  const tierKey  = lead.tier || computeLeadTier(np);
                  const tierMeta = TIER_BY_KEY[tierKey] || TIER_BY_KEY.tier_3;
                  const isSelected = selection.has(lead.id);
                  return (
                    <tr
                      key={lead.id}
                      onClick={() => setDetailId(lead.id)}
                      className={`leads-row ${isSelected ? 'is-selected' : ''}`}
                    >
                      <td className="pl-5 pr-1 py-2 w-8" onClick={(e) => { e.stopPropagation(); toggleRow(lead.id); }}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleRow(lead.id)}
                          onClick={(e) => e.stopPropagation()}
                          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          aria-label={`Select lead ${lead.id}`}
                        />
                      </td>
                      <td className="px-2 py-2">
                        <div className="text-sm font-semibold text-gray-900 truncate max-w-[220px]" title={name}>{name}</div>
                      </td>
                      {!hiddenColumns.has('tier') && (
                        <td className="px-3 py-2">
                          <span
                            title={tierMeta.hint}
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold ${tierMeta.bg} ${tierMeta.text}`}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full ${tierMeta.dot}`} />{tierMeta.short}
                          </span>
                        </td>
                      )}
                      {!hiddenColumns.has('status') && (
                        <td className="px-3 py-2">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold ${statusMeta.bg} ${statusMeta.text}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${statusMeta.dot}`} />{statusMeta.label}
                          </span>
                        </td>
                      )}
                      {!hiddenColumns.has('priority') && (
                        <td className="hidden sm:table-cell px-3 py-2">
                          <PriorityCell priorityKey={crm.priority} />
                        </td>
                      )}
                      {!hiddenColumns.has('temperature') && (
                        <td className="hidden sm:table-cell px-3 py-2">
                          {temperatureMeta ? (
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold ${temperatureMeta.bg} ${temperatureMeta.text}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${temperatureMeta.dot}`} />{temperatureMeta.label}
                            </span>
                          ) : <EmDash />}
                        </td>
                      )}
                      {!hiddenColumns.has('agent') && (
                        <td className="hidden md:table-cell px-3 py-2">
                          <AgentCell name={crm.assigned_user_name} />
                        </td>
                      )}
                      {!hiddenColumns.has('labels') && (
                        <td className="hidden md:table-cell px-3 py-2">
                          {labels.length === 0 ? <EmDash /> : (
                            <div className="flex flex-wrap items-center gap-1 max-w-[220px]">
                              {labels.slice(0, 3).map((l) => (
                                <span key={l.id} className="inline-flex items-center text-[10px] font-medium text-white px-1.5 py-0.5 rounded" style={{ backgroundColor: l.color }}>
                                  {l.name}
                                </span>
                              ))}
                              {labels.length > 3 && (
                                <span className="text-[10px] text-gray-500">+{labels.length - 3}</span>
                              )}
                            </div>
                          )}
                        </td>
                      )}
                      {!hiddenColumns.has('wanted') && (
                        <td className="hidden xl:table-cell px-3 py-2 text-[13px] text-gray-700 text-right tabular-nums">
                          {crm.price_wanted != null ? formatPrice(crm.price_wanted) : <EmDash />}
                        </td>
                      )}
                      {!hiddenColumns.has('offered') && (
                        <td className="hidden xl:table-cell px-3 py-2 text-[13px] text-gray-700 text-right tabular-nums">
                          {crm.price_offered != null ? formatPrice(crm.price_offered) : <EmDash />}
                        </td>
                      )}
                      {!hiddenColumns.has('vin') && (
                        <td className="hidden lg:table-cell px-3 py-2"><VinCell vin={normValue(lead, 'vin')} /></td>
                      )}
                      {!hiddenColumns.has('phone') && (
                        <td className="px-3 py-2 text-[13px] text-gray-700 tabular-nums whitespace-nowrap">
                          {normValue(lead, 'phone_primary') ? formatPhone(normValue(lead, 'phone_primary')) : <EmDash />}
                        </td>
                      )}
                      {!hiddenColumns.has('email') && (
                        <td className="hidden lg:table-cell px-3 py-2 text-[13px] text-gray-700 truncate max-w-[180px]" title={normValue(lead, 'email_primary') || ''}>
                          {normValue(lead, 'email_primary') || <EmDash />}
                        </td>
                      )}
                      {!hiddenColumns.has('location') && (
                        <td className="hidden md:table-cell px-3 py-2 text-[13px] text-gray-600 whitespace-nowrap">
                          {location && location !== '—' ? location : <EmDash />}
                        </td>
                      )}
                      {!hiddenColumns.has('vehicle') && (
                        <td className="hidden md:table-cell px-3 py-2 text-[13px] text-gray-700 whitespace-nowrap truncate max-w-[200px]" title={vehicle}>
                          {vehicle && vehicle !== '—' ? formatVehicle(vehicle) : <EmDash />}
                        </td>
                      )}
                      {!hiddenColumns.has('source_file') && (
                        <td className="hidden lg:table-cell px-3 py-2 text-[12px] text-gray-500 truncate max-w-[180px]" title={lead.file_display_name || lead.file_name || ''}>
                          {lead.file_display_name || lead.file_name || <EmDash />}
                        </td>
                      )}
                      {!hiddenColumns.has('batch') && (
                        <td className="hidden lg:table-cell px-3 py-2 text-[12px] text-gray-500 truncate max-w-[180px]" title={lead.batch_name || ''}>
                          {lead.batch_name || <EmDash />}
                        </td>
                      )}
                      {!hiddenColumns.has('stage') && (
                        <td className="hidden md:table-cell px-3 py-2">
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-100 uppercase tracking-wide">{lead.source_stage}</span>
                        </td>
                      )}
                      {!hiddenColumns.has('row_number') && (
                        <td className="hidden xl:table-cell px-3 py-2 text-[11px] text-gray-400 tabular-nums">{lead.source_row_number}</td>
                      )}
                      {!hiddenColumns.has('imported') && (
                        <td className="hidden lg:table-cell px-3 py-2 text-[11px] text-gray-400 whitespace-nowrap">{formatDate(lead.imported_at)}</td>
                      )}
                      {visibleCustomColumns.map((k) => {
                        const v = np[k];
                        const display = v === undefined || v === null || v === '' ? null : String(v);
                        return (
                          <td key={`c-${lead.id}-${k}`} className="px-3 py-2.5 text-[13px] text-gray-700 truncate max-w-[200px]" title={display ?? ''}>
                            {display ?? <EmDash />}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        </div>

        {/* Pagination */}
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

      <LeadDetailDrawer leadId={detailId} onClose={() => setDetailId(null)} onChanged={() => { fetchLeads(); fetchSummary(); }} />

      <BulkActionModal
        open={!!bulkAction}
        action={bulkAction}
        count={selection.size}
        options={{ users: options.users || [], labels: options.labels || [] }}
        submitting={bulkSubmitting}
        onClose={() => setBulkAction(null)}
        onSubmit={runBulk}
      />

      <BulkResultModal
        result={bulkResult}
        onClose={() => setBulkResult(null)}
        onRefresh={afterBulkResult}
      />
    </div>
  );
}

function ColumnsMenu({ open, onOpenChange, customColumns, hiddenColumns, onToggle, onShowAll, onHideAll }) {
  const visibleBuiltins = BUILTIN_COLUMN_KEYS.filter((k) => !hiddenColumns.has(k)).length;
  const hiddenBuiltins = BUILTIN_COLUMN_KEYS.length - visibleBuiltins;
  const visibleCount = customColumns.filter((k) => !hiddenColumns.has(k)).length;
  const totalCount = customColumns.length;
  const hasHidden = hiddenBuiltins > 0 || (totalCount > 0 && visibleCount < totalCount);
  return (
    <div className="cm-wrap">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className="vv-btn vv-btn-secondary vv-btn-icon cm-trigger"
        title={`Columns (${visibleBuiltins + visibleCount}/${BUILTIN_COLUMN_KEYS.length + totalCount} shown)`}
        aria-label="Columns"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4" width="6" height="16" rx="1"/>
          <rect x="11" y="4" width="4" height="16" rx="1"/>
          <rect x="17" y="4" width="4" height="16" rx="1"/>
        </svg>
        {hasHidden && <span className="cm-trigger-dot"/>}
      </button>
      {open && (
        <>
          <div className="cm-overlay" onClick={() => onOpenChange(false)} />
          <div className="cm-panel">
            <div className="cm-head">
              <span className="cm-head-title">Columns</span>
              <div className="cm-head-actions">
                <button type="button" onClick={onShowAll} className="cm-link cm-link-accent">Show all</button>
                <span className="cm-head-sep">·</span>
                <button type="button" onClick={onHideAll} className="cm-link">Hide all</button>
              </div>
            </div>
            <div className="cm-body">
              <div className="cm-section-label">
                Built-in {hiddenBuiltins > 0 && <span className="cm-section-count">· {hiddenBuiltins} hidden</span>}
              </div>
              {BUILTIN_COLUMN_KEYS.map((k) => (
                <label key={`b-${k}`} className="cm-item">
                  <input
                    type="checkbox"
                    checked={!hiddenColumns.has(k)}
                    onChange={() => onToggle(k)}
                  />
                  <span className="cm-item-label">{BUILTIN_COLUMN_LABELS[k]}</span>
                </label>
              ))}
              {totalCount > 0 && (
                <>
                  <div className="cm-section-label cm-section-label-divider">
                    Imported {totalCount - visibleCount > 0 && <span className="cm-section-count">· {totalCount - visibleCount} hidden</span>}
                  </div>
                  {customColumns.map((k) => (
                    <label key={`c-${k}`} className="cm-item">
                      <input
                        type="checkbox"
                        checked={!hiddenColumns.has(k)}
                        onChange={() => onToggle(k)}
                      />
                      <span className="cm-item-label" title={k}>{k}</span>
                    </label>
                  ))}
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function FilterSelect({ label, value, onChange, children }) {
  return (
    <div>
      <label className="field-label">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="vv-input"
      >
        {children}
      </select>
    </div>
  );
}

// Handful of statuses people actually filter by day-to-day. Rest live in the
// advanced panel.
const QUICK_STATUS_KEYS = ['new', 'callback', 'interested', 'marketing'];

/**
 * Compact inline stats strip under the page title. Replaces the old five-card
 * summary row. Zero-count stats are hidden so we only show what's actionable.
 * Clicking a stat toggles the corresponding filter.
 */
function InlineStats({ total, summary, isAdmin, activeFilters, onToggleFilter }) {
  const items = [];
  items.push({ key: '__total', label: total === 1 ? 'lead' : 'leads', value: total, dot: 'var(--info)', filterKey: null });

  if (summary) {
    if (isAdmin && summary.unassigned > 0) {
      items.push({
        key: 'unassigned', label: 'unassigned', value: summary.unassigned, dot: 'var(--warm)',
        filterKey: 'assigned_user_id', filterValue: 'unassigned',
      });
    }
    if (summary.open_tasks > 0) {
      items.push({
        key: 'open_tasks', label: 'open tasks', value: summary.open_tasks, dot: 'var(--info)',
        filterKey: 'has_open_tasks', filterValue: '1',
      });
    }
    if (summary.tasks_due_today > 0) {
      items.push({
        key: 'due_today', label: 'due today', value: summary.tasks_due_today, dot: 'var(--warm)',
        filterKey: 'tasks_due_today', filterValue: '1',
      });
    }
    if (summary.tasks_overdue > 0) {
      items.push({
        key: 'overdue', label: 'overdue', value: summary.tasks_overdue, dot: 'var(--hot)',
        filterKey: 'tasks_overdue', filterValue: '1',
      });
    }
    if (summary.confirmed_duplicate_related > 0) {
      items.push({
        key: 'dupes', label: 'in confirmed duplicates', value: summary.confirmed_duplicate_related,
        dot: 'var(--hot)', filterKey: null,
      });
    }
  }

  return (
    <span style={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
      {items.map((it, i) => {
        const isActive = it.filterKey && activeFilters[it.filterKey] === it.filterValue;
        const clickable = !!it.filterKey;
        const content = (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: 999, background: it.dot, display: 'inline-block' }}/>
            <strong style={{ color: 'var(--text-0)' }}>{it.value.toLocaleString()}</strong>
            <span>{it.label}</span>
          </span>
        );
        return (
          <span key={it.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {i > 0 && <span style={{ color: 'var(--text-3)' }}>·</span>}
            {clickable ? (
              <button
                type="button"
                onClick={() => onToggleFilter(it.filterKey, it.filterValue)}
                title={isActive ? 'Click to clear this filter' : 'Click to filter'}
                style={{
                  background: isActive ? 'var(--bg-2)' : 'transparent',
                  border: isActive ? '1px solid var(--border-1)' : '1px solid transparent',
                  padding: '2px 6px',
                  borderRadius: 6,
                  cursor: 'pointer',
                  color: 'inherit',
                  font: 'inherit',
                }}
              >
                {content}
              </button>
            ) : content}
          </span>
        );
      })}
    </span>
  );
}

// Design-system colors per pill group key — chip dots use raw CSS vars,
// not Tailwind utility classes, so we map each meta key to a CSS variable.
const TIER_DOT_VAR = {
  tier_1: 'var(--tier1)',
  tier_2: 'var(--tier2)',
  tier_3: 'var(--tier3)',
};
const TEMP_DOT_VAR = {
  cold: 'var(--cold)',
  warm: 'var(--warm)',
  hot: 'var(--hot)',
  closed: 'var(--success)',
};
const STATUS_DOT_VAR = {
  new: 'var(--info)',
  callback: 'var(--warm)',
  interested: 'var(--success)',
  marketing: 'var(--info)',
};

function ChipGroup({ label, items, active, onToggle, dotVarMap }) {
  return (
    <>
      <span className="chip-group-label">{label}</span>
      {items.map((item) => {
        const isActive = active === item.key;
        const bg = dotVarMap?.[item.key] || 'var(--text-2)';
        return (
          <span
            key={item.key}
            className={`chip ${isActive ? 'active' : ''}`}
            onClick={() => onToggle(item.key)}
            title={item.hint}
            style={{ '--chip-color': bg }}
          >
            <span className="chip-dot" style={{ background: bg }}/>
            {item.label}
          </span>
        );
      })}
    </>
  );
}

function QuickFilterPills({ tier, temperature, status, onTier, onTemp, onStatus }) {
  const statusItems = QUICK_STATUS_KEYS
    .map((k) => LEAD_STATUSES.find((s) => s.key === k))
    .filter(Boolean);
  return (
    <div className="leads-quickfilters">
      <ChipGroup label="Tier" items={LEAD_TIERS} active={tier} onToggle={onTier} dotVarMap={TIER_DOT_VAR}/>
      <span className="leads-qf-sep"/>
      <ChipGroup
        label="Temp"
        items={LEAD_TEMPERATURES.filter((t) => t.key !== 'closed')}
        active={temperature}
        onToggle={onTemp}
        dotVarMap={TEMP_DOT_VAR}
      />
      <span className="leads-qf-sep"/>
      <ChipGroup label="Status" items={statusItems} active={status} onToggle={onStatus} dotVarMap={STATUS_DOT_VAR}/>
    </div>
  );
}

function NumberOfOwnersFilter({ min, max, onChangeMin, onChangeMax }) {
  const opts = ['', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];
  return (
    <div>
      <label className="field-label">Owners</label>
      <div className="row" style={{ gap: 6 }}>
        <select
          value={min}
          onChange={(e) => onChangeMin(e.target.value)}
          className="vv-input"
          style={{ flex: 1 }}
          aria-label="Minimum number of owners"
        >
          {opts.map((n) => <option key={`min-${n}`} value={n}>{n === '' ? 'Min' : n}</option>)}
        </select>
        <span style={{ color: 'var(--text-3)' }}>—</span>
        <select
          value={max}
          onChange={(e) => onChangeMax(e.target.value)}
          className="vv-input"
          style={{ flex: 1 }}
          aria-label="Maximum number of owners"
        >
          {opts.map((n) => <option key={`max-${n}`} value={n}>{n === '' ? 'Max' : n}</option>)}
        </select>
      </div>
    </div>
  );
}

function FilterInput({ label, value, onChange, type = 'text' }) {
  return (
    <div>
      <label className="field-label">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="vv-input"
      />
    </div>
  );
}

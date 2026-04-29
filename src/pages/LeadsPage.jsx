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
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch { return new Set(); }
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
    <div className="page">
      <div style={{ marginBottom: 20 }}>
        <h1 className="section-title">{isAdmin ? 'CRM Leads' : 'My Leads'}</h1>
        <div style={{ marginTop: 4 }}>
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
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-100 text-red-600 px-4 py-3 rounded-xl mb-4 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-red-400 hover:text-red-600 p-1">&times;</button>
        </div>
      )}

      {/* Quick-filter pills — one-click access to the things people actually filter by */}
      <QuickFilterPills
        tier={filters.tier}
        temperature={filters.lead_temperature}
        status={filters.status}
        onTier={(v) => updateFilter('tier', v === filters.tier ? '' : v)}
        onTemp={(v) => updateFilter('lead_temperature', v === filters.lead_temperature ? '' : v)}
        onStatus={(v) => updateFilter('status', v === filters.status ? '' : v)}
      />

      {/* Search + filter toggle */}
      <div className="bg-white rounded-2xl border border-gray-100 p-3 sm:p-4 mb-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search VIN, name, phone, email, city…"
              className="w-full bg-gray-50 border border-gray-200 rounded-lg pl-9 pr-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
            />
          </div>
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
          {(activeChips.length > 0 || filters.q) && (
            <button onClick={clearAll} className="text-xs text-blue-600 hover:text-blue-800 font-medium px-2 py-2">Clear all</button>
          )}
          <div className="ml-auto flex items-center gap-1">
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
              onHideAll={() => setHiddenColumns(new Set(customColumns))}
            />
            <a
              href={exportCsvUrl}
              className="inline-flex items-center justify-center w-9 h-9 rounded-lg border bg-white text-gray-500 border-gray-200 hover:bg-gray-50 hover:text-gray-700"
              title={`Export ${data.total.toLocaleString()} matching leads as CSV`}
              aria-label="Export CSV"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
            </a>
          </div>
        </div>

        {showFilters && (
          <div className="mt-3 pt-3 border-t border-gray-100 space-y-4 text-sm">
            {/* Tip: free-text fields (VIN, phone, email, name, city, state, make, model) are
                all covered by the search box above. Keep these filters focused on the stuff
                the search can't express. */}

            <FilterGroup label="Vehicle">
              <FilterSelect label="Make" value={filters.make} onChange={(v) => updateFilter('make', v)}>
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
            </FilterGroup>

            <FilterGroup label="CRM">
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
            </FilterGroup>

            <FilterGroup label="Tasks">
              <FilterSelect label="Open tasks" value={filters.has_open_tasks} onChange={(v) => updateFilter('has_open_tasks', v)}>
                <option value="">Any</option>
                <option value="1">Has open tasks</option>
                <option value="0">No open tasks</option>
              </FilterSelect>
              <FilterSelect label="Due today" value={filters.tasks_due_today} onChange={(v) => updateFilter('tasks_due_today', v)}>
                <option value="">Any</option>
                <option value="1">Has tasks due today</option>
              </FilterSelect>
              <FilterSelect label="Overdue" value={filters.tasks_overdue} onChange={(v) => updateFilter('tasks_overdue', v)}>
                <option value="">Any</option>
                <option value="1">Has overdue tasks</option>
              </FilterSelect>
            </FilterGroup>

            <FilterGroup label="Source & date">
              <FilterSelect label="Batch" value={filters.batch_id} onChange={(v) => updateFilter('batch_id', v)}>
                <option value="">Any batch</option>
                {options.batches.map((b) => <option key={b.id} value={b.id}>{b.batch_name}</option>)}
              </FilterSelect>
              <FilterSelect label="Source stage" value={filters.source_stage} onChange={(v) => updateFilter('source_stage', v)}>
                <option value="">Any stage</option>
                {options.stages.map((s) => <option key={s} value={s}>{s}</option>)}
              </FilterSelect>
              <FilterInput type="date" label="Imported from" value={filters.imported_from} onChange={(v) => updateFilter('imported_from', v)} />
              <FilterInput type="date" label="Imported to"   value={filters.imported_to}   onChange={(v) => updateFilter('imported_to',   v)} />
            </FilterGroup>
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

      {/* Table */}
      <BulkActionsBar
        selection={selection}
        onClear={clearSelection}
        onAction={(a) => setBulkAction(a)}
        user={user}
      />

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-16 sm:py-20">
            <div className="w-10 h-10 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin"></div>
            <p className="text-sm text-gray-400 mt-3">Loading leads…</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full" style={{ minWidth: `${1540 + visibleCustomColumns.length * 180}px` }}>
              <thead className="bg-gray-50/70 sticky top-0 z-10">
                <tr className="border-b border-gray-200">
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
                  <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Tier</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Priority</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Temperature</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Agent</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Labels</th>
                  <th className="hidden xl:table-cell px-3 py-2 text-right text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Wanted</th>
                  <th className="hidden xl:table-cell px-3 py-2 text-right text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Offered</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">VIN</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Phone</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Email</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Location</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Vehicle</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Source file</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Batch</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Stage</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Row #</th>
                  <th className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Imported</th>
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
                    <td colSpan={20 + visibleCustomColumns.length} className="py-16 text-center">
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
                      className={`border-b border-gray-100 transition-colors cursor-pointer ${isSelected ? 'bg-blue-50/60' : 'hover:bg-blue-50/20'}`}
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
                      <td className="px-2 py-2.5">
                        <div className="text-sm font-semibold text-gray-900 truncate max-w-[220px]" title={name}>{name}</div>
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          title={tierMeta.hint}
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold ${tierMeta.bg} ${tierMeta.text}`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${tierMeta.dot}`} />{tierMeta.short}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold ${statusMeta.bg} ${statusMeta.text}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${statusMeta.dot}`} />{statusMeta.label}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <PriorityCell priorityKey={crm.priority} />
                      </td>
                      <td className="px-3 py-2.5">
                        {temperatureMeta ? (
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold ${temperatureMeta.bg} ${temperatureMeta.text}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${temperatureMeta.dot}`} />{temperatureMeta.label}
                          </span>
                        ) : <EmDash />}
                      </td>
                      <td className="px-3 py-2.5">
                        <AgentCell name={crm.assigned_user_name} />
                      </td>
                      <td className="px-3 py-2.5">
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
                      <td className="hidden xl:table-cell px-3 py-2.5 text-[13px] text-gray-700 text-right tabular-nums">
                        {crm.price_wanted != null ? formatPrice(crm.price_wanted) : <EmDash />}
                      </td>
                      <td className="hidden xl:table-cell px-3 py-2.5 text-[13px] text-gray-700 text-right tabular-nums">
                        {crm.price_offered != null ? formatPrice(crm.price_offered) : <EmDash />}
                      </td>
                      <td className="px-3 py-2.5"><VinCell vin={normValue(lead, 'vin')} /></td>
                      <td className="px-3 py-2.5 text-[13px] text-gray-700 tabular-nums">
                        {normValue(lead, 'phone_primary') ? formatPhone(normValue(lead, 'phone_primary')) : <EmDash />}
                      </td>
                      <td className="px-3 py-2.5 text-[13px] text-gray-700 truncate max-w-[180px]" title={normValue(lead, 'email_primary') || ''}>
                        {normValue(lead, 'email_primary') || <EmDash />}
                      </td>
                      <td className="px-3 py-2.5 text-[13px] text-gray-600">
                        {location && location !== '—' ? location : <EmDash />}
                      </td>
                      <td className="px-3 py-2.5 text-[13px] text-gray-700">
                        {vehicle && vehicle !== '—' ? vehicle : <EmDash />}
                      </td>
                      <td className="px-3 py-2.5 text-[12px] text-gray-500 truncate max-w-[180px]" title={lead.file_display_name || lead.file_name || ''}>
                        {lead.file_display_name || lead.file_name || <EmDash />}
                      </td>
                      <td className="px-3 py-2.5 text-[12px] text-gray-500 truncate max-w-[180px]" title={lead.batch_name || ''}>
                        {lead.batch_name || <EmDash />}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-100 uppercase tracking-wide">{lead.source_stage}</span>
                      </td>
                      <td className="px-3 py-2.5 text-[11px] text-gray-400 tabular-nums">{lead.source_row_number}</td>
                      <td className="px-3 py-2.5 text-[11px] text-gray-400">{formatDate(lead.imported_at)}</td>
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

        {/* Pagination */}
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
            <button
              onClick={() => setPage(1)}
              disabled={page <= 1}
              className="px-2 py-1 text-xs rounded-md border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-40"
            >«</button>
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-2 py-1 text-xs rounded-md border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-40"
            >‹ Prev</button>
            <span className="text-xs text-gray-500 px-2">Page {page} / {totalPages}</span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              className="px-2 py-1 text-xs rounded-md border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-40"
            >Next ›</button>
            <button
              onClick={() => setPage(totalPages)}
              disabled={page >= totalPages}
              className="px-2 py-1 text-xs rounded-md border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-40"
            >»</button>
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
  const visibleCount = customColumns.filter((k) => !hiddenColumns.has(k)).length;
  const totalCount = customColumns.length;
  const hasHidden = totalCount > 0 && visibleCount < totalCount;
  return (
    <div className="relative">
      <button
        onClick={() => onOpenChange(!open)}
        className="relative inline-flex items-center justify-center w-9 h-9 rounded-lg border bg-white text-gray-500 border-gray-200 hover:bg-gray-50 hover:text-gray-700"
        title={totalCount > 0 ? `Columns (${visibleCount}/${totalCount} shown)` : 'Columns'}
        aria-label="Columns"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
        </svg>
        {hasHidden && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-amber-500 ring-2 ring-white" />}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => onOpenChange(false)} />
          <div className="absolute right-0 mt-2 w-72 bg-white rounded-xl shadow-xl border border-gray-100 z-30 max-h-[70vh] flex flex-col">
            <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Imported columns</span>
              <div className="flex items-center gap-2 text-[11px]">
                <button onClick={onShowAll} className="text-blue-600 hover:text-blue-800 font-medium">Show all</button>
                <span className="text-gray-300">·</span>
                <button onClick={onHideAll} className="text-gray-500 hover:text-gray-700 font-medium">Hide all</button>
              </div>
            </div>
            <div className="overflow-y-auto py-1">
              {totalCount === 0 ? (
                <p className="px-3 py-3 text-xs text-gray-500">
                  No imported columns yet. Columns from your next import will appear here.
                </p>
              ) : customColumns.map((k) => (
                <label key={k} className="flex items-center gap-2 px-3 py-1.5 text-sm hover:bg-gray-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!hiddenColumns.has(k)}
                    onChange={() => onToggle(k)}
                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-gray-700 truncate" title={k}>{k}</span>
                </label>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function FilterGroup({ label, children }) {
  return (
    <fieldset className="rounded-xl border border-gray-100 bg-gray-50/40 px-3 py-2.5">
      <legend className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 px-1">{label}</legend>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 mt-1">
        {children}
      </div>
    </fieldset>
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
      >
        {children}
      </select>
    </label>
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
  // Total is informational, not a filter.
  items.push({ key: '__total', label: total === 1 ? 'lead' : 'leads', value: total, dotColor: 'bg-blue-500', filterKey: null });

  if (summary) {
    if (isAdmin && summary.unassigned > 0) {
      items.push({
        key: 'unassigned', label: 'unassigned', value: summary.unassigned, dotColor: 'bg-amber-500',
        filterKey: 'assigned_user_id', filterValue: 'unassigned',
      });
    }
    if (summary.open_tasks > 0) {
      items.push({
        key: 'open_tasks', label: 'open tasks', value: summary.open_tasks, dotColor: 'bg-blue-500',
        filterKey: 'has_open_tasks', filterValue: '1',
      });
    }
    if (summary.tasks_due_today > 0) {
      items.push({
        key: 'due_today', label: 'due today', value: summary.tasks_due_today, dotColor: 'bg-amber-500',
        filterKey: 'tasks_due_today', filterValue: '1',
      });
    }
    if (summary.tasks_overdue > 0) {
      items.push({
        key: 'overdue', label: 'overdue', value: summary.tasks_overdue, dotColor: 'bg-red-500',
        filterKey: 'tasks_overdue', filterValue: '1',
      });
    }
    if (summary.confirmed_duplicate_related > 0) {
      items.push({
        key: 'dupes', label: 'in confirmed duplicates', value: summary.confirmed_duplicate_related,
        dotColor: 'bg-red-500', filterKey: null,
      });
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1 text-xs sm:text-sm text-gray-500">
      {items.map((it, i) => {
        const isActive = it.filterKey && activeFilters[it.filterKey] === it.filterValue;
        const clickable = !!it.filterKey;
        const content = (
          <span className="inline-flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${it.dotColor}`} />
            <span className="tabular-nums font-semibold text-gray-700">{it.value.toLocaleString()}</span>
            <span>{it.label}</span>
          </span>
        );
        return (
          <span key={it.key} className="inline-flex items-center gap-2">
            {i > 0 && <span className="text-gray-300">·</span>}
            {clickable ? (
              <button
                onClick={() => onToggleFilter(it.filterKey, it.filterValue)}
                className={`inline-flex items-center rounded-md px-1.5 py-0.5 -mx-1.5 -my-0.5 transition-colors ${
                  isActive
                    ? 'bg-blue-100 text-blue-800 ring-1 ring-blue-300'
                    : 'hover:bg-gray-100 hover:text-gray-700'
                }`}
                title={isActive ? 'Click to clear this filter' : 'Click to filter'}
              >
                {content}
              </button>
            ) : content}
          </span>
        );
      })}
    </div>
  );
}

function PillGroup({ label, items, active, onToggle }) {
  return (
    <div className="flex items-center gap-1 sm:gap-1.5 flex-wrap">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mr-1 shrink-0">{label}</span>
      {items.map((item) => {
        const isActive = active === item.key;
        return (
          <button
            key={item.key}
            onClick={() => onToggle(item.key)}
            title={item.hint}
            className={`inline-flex items-center gap-1 sm:gap-1.5 text-[11px] sm:text-xs font-medium px-2 sm:px-2.5 py-1 sm:py-1.5 rounded-full border transition-colors ${
              isActive
                ? `${item.bg} ${item.text} border-current`
                : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${item.dot}`} />
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

function QuickFilterPills({ tier, temperature, status, onTier, onTemp, onStatus }) {
  const statusItems = QUICK_STATUS_KEYS
    .map((k) => LEAD_STATUSES.find((s) => s.key === k))
    .filter(Boolean);
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-3">
      <PillGroup label="Tier" items={LEAD_TIERS} active={tier} onToggle={onTier} />
      <div className="h-4 w-px bg-gray-200 hidden sm:block" />
      <PillGroup
        label="Temperature"
        items={LEAD_TEMPERATURES.filter((t) => t.key !== 'closed')}
        active={temperature}
        onToggle={onTemp}
      />
      <div className="h-4 w-px bg-gray-200 hidden sm:block" />
      <PillGroup label="Status" items={statusItems} active={status} onToggle={onStatus} />
    </div>
  );
}

function NumberOfOwnersFilter({ min, max, onChangeMin, onChangeMax }) {
  const opts = ['', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];
  return (
    <label className="block">
      <span className="block text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Number of owners</span>
      <div className="flex items-center gap-2">
        <select
          value={min}
          onChange={(e) => onChangeMin(e.target.value)}
          className="w-full bg-gray-50 border border-gray-200 rounded-lg px-2 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
          aria-label="Minimum number of owners"
        >
          {opts.map((n) => <option key={`min-${n}`} value={n}>{n === '' ? 'Min' : n}</option>)}
        </select>
        <span className="text-xs text-gray-400">to</span>
        <select
          value={max}
          onChange={(e) => onChangeMax(e.target.value)}
          className="w-full bg-gray-50 border border-gray-200 rounded-lg px-2 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
          aria-label="Maximum number of owners"
        >
          {opts.map((n) => <option key={`max-${n}`} value={n}>{n === '' ? 'Max' : n}</option>)}
        </select>
      </div>
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

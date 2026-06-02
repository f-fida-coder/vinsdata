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
  vehicle_id: '',  // legacy hunt-list filter — still URL-honored for old
                   //   bookmarks (e.g. Dashboard's deprecated vehicle-card
                   //   click-throughs), but no longer surfaced in the UI.
  source_stage: '',
  state: '',
  make: '',
  model: '',
  year: '',
  trim: '',
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
  include_archived: '', // '' = live only; '1' = archived only
  // Empty-contact filter: '' (default) hides leads with no phone /
  // email — they're TLO-lookup failures that can't be worked. '1'
  // brings them back for a triage pass (e.g. re-running TLO).
  include_empty: '',
  // Empty / has-value filter (CSV-joined list of column keys).
  // empty_op picks the polarity: '' / 'is_not_empty' = "has value",
  // 'is_empty' = "blank". Each field check uses the indexed norm_*
  // column when available, otherwise falls back to JSON_EXTRACT.
  empty_field: '',
  empty_op: 'is_not_empty',
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
  trim:          'Trim',
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
  empty_field: 'Field check',
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

// Keys with dedicated hardcoded columns — all other keys surface as
// "custom" columns. Includes both the normalized post-mapping keys and
// the raw CarFax / TLO payload keys that now have first-class columns.
const HARDCODED_PAYLOAD_KEYS = new Set([
  'vin', 'first_name', 'last_name', 'full_name',
  'phone_primary', 'phone_secondary', 'email_primary',
  'full_address', 'city', 'state', 'zip_code',
  'make', 'model', 'year', 'mileage',
  // Surfaced as their own first-class columns (CarFax / TLO):
  'Phone Number 3', 'Phone Number3', 'Phone Number 4', 'Phone Number4',
  'Email 2', 'Email2',
  'LastServiceDate', 'LastServiceLocationOnCarFax', 'LastServiceCityOnCarFax',
  'NumberOfOwners', 'DateOfMostRecentRegistration',
  'AccidentHistory', 'TitleStatus', 'Lien Holder (Y/N; If Y, then list out)',
  'ServiceRecordCount',
]);

// Raw payload keys we explicitly never want surfaced as table columns.
// The TLO / CarFax feeds carry workflow scratch columns like
// "1 = Interested" or "1= Hand Dial" — those are flags an analyst sets
// before handoff to the CRM and are noise once a lead lives in here.
// Hidden completely (not even in the Columns menu) so the operator
// can't accidentally re-add them.
const CUSTOM_COLUMN_BLOCKLIST = new Set([
  '1 = Interested', '1= Interested',
  '1 = handcall',   '1= handcall',
  '1 = Hand Dial',  '1= Hand Dial', 'Hand Dial',
]);

// User-toggleable built-in table columns. "name" is always visible (the
// row anchor). The order here drives the on-screen column order. Each
// entry: [key, label, defaultHidden, sortKey?] — sortKey is the value
// sent to the API on header click (default: same as key).
const BUILTIN_COLUMNS = [
  ['tier',                     'Tier',                  false, 'tier'],
  ['status',                   'Status',                false, 'status'],
  // Temperature + Priority sit right after Status — operator wants the
  // qualifying signals next to the workflow state for quick triage. Both
  // shown by default (the localStorage migration v4→v5 below also unhides
  // them for existing operator sessions that had them off).
  ['temperature', 'Temperature', false, 'lead_temperature'],
  ['priority',    'Priority',    false, 'priority'],
  // Assigned-to follows. The underlying column key is still 'agent' so
  // existing localStorage entries and the bulk-action wiring don't need
  // a parallel migration; we just relabel it in the header.
  ['agent',                    'Assigned to',           false, 'assigned_user_id'],
  ['vehicle',                  'Vehicle',               false, 'make'],
  ['miles',                    'Miles',                 false, 'mileage'],
  ['last_service_date',        'Last service date',     false, 'LastServiceDate'],
  ['last_service_location',    'Last service location', false, 'LastServiceLocationOnCarFax'],
  ['last_service_city',        'Last service city',     false, 'LastServiceCityOnCarFax'],
  ['number_of_owners',         '# Owners',              false, 'NumberOfOwners'],
  ['recent_registration_date', 'Most recent reg.',      false, 'DateOfMostRecentRegistration'],
  ['accident_history',         'Accident history',      false, 'AccidentHistory'],
  ['title_status',             'Title status',          false, 'TitleStatus'],
  // The raw header keeps its CarFax shape — parens + semi included.
  // Server allowlist for sort/empty_field tolerates these characters,
  // so clicking the header to sort still flows through.
  ['lien_holder',              'Lien holder',           false, 'Lien Holder (Y/N; If Y, then list out)'],
  ['phone_1',                  'Phone 1',               false, 'phone_primary'],
  ['phone_2',                  'Phone 2',               false, 'phone_secondary'],
  ['phone_3',                  'Phone 3',               false, 'Phone Number 3'],
  ['phone_4',                  'Phone 4',               false, 'Phone Number 4'],
  ['email_1',                  'Email 1',               false, 'email_primary'],
  ['email_2',                  'Email 2',               false, 'Email 2'],
  ['service_record_count',     'Service records',       false, 'ServiceRecordCount'],
  // ---- below: legacy / advanced columns, hidden by default ----
  // (temperature + priority moved up next to status above)
  ['labels',      'Labels',      true,  null],
  ['wanted',      'Wanted',      true,  'price_wanted'],
  ['offered',     'Offered',     true,  'price_offered'],
  ['vin',         'VIN',         true,  'vin'],
  ['location',    'Location',    true,  'state'],
  ['source_file', 'Source file', true,  'source_file'],
  ['batch',       'Batch',       true,  'batch_name'],
  ['stage',       'Stage',       true,  null],
  ['row_number',  'Row #',       true,  'source_row_number'],
  ['imported',    'Imported',    true,  'imported_at'],
];
const BUILTIN_COLUMN_KEYS   = BUILTIN_COLUMNS.map(([k]) => k);
const BUILTIN_COLUMN_LABELS = Object.fromEntries(BUILTIN_COLUMNS.map(([k, l]) => [k, l]));
const BUILTIN_SORT_KEYS     = Object.fromEntries(BUILTIN_COLUMNS.map(([k, , , s]) => [k, s ?? null]));
const DEFAULT_HIDDEN_BUILTINS = BUILTIN_COLUMNS.filter(([, , h]) => h).map(([k]) => k);

// Coalesce raw payload keys whose spelling drifts in the data:
//   "Phone Number 3" vs "Phone Number3", "Email 2" vs "Email2".
// First non-empty wins so a partially-imported row still renders.
const PAYLOAD_READER = {
  phone_1:                  (np) => np.phone_primary,
  phone_2:                  (np) => np.phone_secondary,
  phone_3:                  (np) => np['Phone Number 3'] || np['Phone Number3'],
  phone_4:                  (np) => np['Phone Number 4'] || np['Phone Number4'],
  email_1:                  (np) => np.email_primary,
  email_2:                  (np) => np['Email 2'] || np.Email2,
  miles:                    (np) => np.mileage ?? np.LastReportedMiles,
  last_service_date:        (np) => np.LastServiceDate,
  last_service_location:    (np) => np.LastServiceLocationOnCarFax,
  last_service_city:        (np) => np.LastServiceCityOnCarFax,
  number_of_owners:         (np) => np.NumberOfOwners ?? np.number_of_owners,
  // The CarFax exports use the literal sentence as the column header.
  // Stored verbatim, parens + semi included.
  recent_registration_date: (np) => np.DateOfMostRecentRegistration,
  accident_history:         (np) => np.AccidentHistory,
  title_status:             (np) => np.TitleStatus,
  lien_holder:              (np) => np['Lien Holder (Y/N; If Y, then list out)'],
  service_record_count:     (np) => np.ServiceRecordCount,
};

export default function LeadsPage() {
  const { user } = useAuth();
  // Marketers see the full unscoped view (same as admins) because they need
  // cross-portfolio visibility to build campaign segments. Only true agents
  // (carfax/filter/tlo) get the "my leads" treatment.
  const isAdmin = user?.role === 'admin' || user?.role === 'marketer';
  const [searchParams] = useSearchParams();
  const [filters, setFilters] = useState(() => {
    // Honor query-string filters on first mount. Used by:
    //  - the Marketing detail page's "View recipients in CRM" link
    //    (in_campaign_id, status)
    //  - the Users tab's per-agent lead counts that deep-link to a
    //    pre-filtered view (assigned_user_id)
    const seeded = { ...EMPTY_FILTERS };
    ['in_campaign_id', 'status', 'assigned_user_id'].forEach((k) => {
      const v = searchParams.get(k);
      if (v !== null && v !== '') seeded[k] = v;
    });
    return seeded;
  });
  const [searchInput, setSearchInput] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(50);
  // Click a column header to sort. Two-key max so the user can layer
  // "tier desc + Age desc" or "make asc + Age desc". Plain click sets a
  // single primary key; shift-click adds the field as a secondary (or
  // promotes it if already in the list). Direction defaults to desc on
  // each new field — matches the "highest age first" instinct for
  // numeric columns. Empty array = server-default ordering.
  const [sort, setSort] = useState(/** @type {{field:string,dir:'asc'|'desc'}[]} */ ([]));
  const [data, setData] = useState({ leads: [], total: 0, page: 1, per_page: 50 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [options, setOptions] = useState({ batches: [], files: [], vehicles: [], stages: [], states: [], makes: [], models: [], years: [], trims: [], users: [], labels: [] });
  const [detailId, setDetailId] = useState(null);
  const [summary, setSummary] = useState(null);
  const [selection, setSelection] = useState(() => new Set());
  const [bulkAction, setBulkAction] = useState(null);
  const [hiddenColumns, setHiddenColumns] = useState(() => {
    // localStorage key is versioned (currently v5). Each bump triggers a
    // gentle migration: read the previous version's value, transform it,
    // and write to the new key. v5 unhides Temperature + Priority (now
    // default visible) while preserving whatever other prefs the operator
    // had set in v4.
    try {
      const v5 = localStorage.getItem('lead_hidden_columns_v5');
      if (v5) return new Set(JSON.parse(v5));
      // Migrate v4 → v5: drop temperature + priority from the hidden set
      // (they're shown by default now). Anything else the operator had
      // hidden stays hidden.
      const v4 = localStorage.getItem('lead_hidden_columns_v4');
      if (v4) {
        const migrated = new Set(JSON.parse(v4));
        migrated.delete('temperature');
        migrated.delete('priority');
        return migrated;
      }
    } catch { /* fall through */ }
    return new Set(DEFAULT_HIDDEN_BUILTINS);
  });
  const [columnsMenuOpen, setColumnsMenuOpen] = useState(false);
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  const [bulkResult, setBulkResult] = useState(null);
  const [activeViewId, setActiveViewId] = useState(null);
  const [defaultApplied, setDefaultApplied] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);

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
      // empty_op only matters when empty_field is populated.
      if (!filters.empty_field) delete params.empty_op;
      if (sort.length > 0) {
        params.sort = sort.map((s) => s.field).join(',');
        params.dir  = sort.map((s) => s.dir).join(',');
      }
      const res = await api.get('/leads', { params });
      setData(res.data);
    } catch (err) {
      setError(extractApiError(err, 'Failed to load leads'));
    } finally {
      setLoading(false);
    }
  }, [filters, page, perPage, sort]);

  useEffect(() => { fetchLeads(); }, [fetchLeads]);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      api.get('/lead_filter_options')
        .then((res) => { if (!cancelled) setOptions(res.data); })
        .catch(() => { /* non-blocking */ });
    };
    load();

    // UsersPage fires this after add/edit/delete so any open Leads page
    // picks up the new agent in its dropdowns without a manual refresh.
    // Works same-tab via CustomEvent and cross-tab via BroadcastChannel.
    const onChanged = () => load();
    window.addEventListener('vv:users-changed', onChanged);
    let bc = null;
    if (typeof BroadcastChannel !== 'undefined') {
      bc = new BroadcastChannel('vv-users');
      bc.onmessage = (e) => { if (e?.data?.type === 'users-changed') load(); };
    }

    return () => {
      cancelled = true;
      window.removeEventListener('vv:users-changed', onChanged);
      if (bc) bc.close();
    };
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
    try { localStorage.setItem('lead_hidden_columns_v5', JSON.stringify([...hiddenColumns])); } catch { /* ignore quota */ }
  }, [hiddenColumns]);

  const customColumns = useMemo(() => {
    const order = [];
    const seen = new Set();
    for (const lead of data.leads) {
      const np = lead.normalized_payload || {};
      for (const k of Object.keys(np)) {
        if (HARDCODED_PAYLOAD_KEYS.has(k) || seen.has(k)) continue;
        if (CUSTOM_COLUMN_BLOCKLIST.has(k)) continue;
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
    if (sort.length > 0) {
      qs.set('sort', sort.map((s) => s.field).join(','));
      qs.set('dir',  sort.map((s) => s.dir).join(','));
    }
    return `/api/leads?${qs.toString()}`;
  }, [filters, sort]);

  const totalPages = Math.max(1, Math.ceil(data.total / perPage));
  const activeChips = useMemo(() => {
    // empty_op is a modifier — it renders alongside empty_field, not on
    // its own chip. include_archived + include_empty are toggle buttons
    // in the toolbar; their own chip would be redundant.
    const skip = new Set(['q', 'empty_op', 'include_archived', 'include_empty']);
    return Object.entries(filters)
      .filter(([k, v]) => v !== '' && !skip.has(k))
      // Default empty_op (is_not_empty) doesn't deserve a chip with no
      // selected field, but the field check above already covers that.
      .map(([k, v]) => ({ key: k, value: v }));
  }, [filters]);

  const clearFilter = (key) => {
    setFilters((prev) => {
      const next = { ...prev, [key]: '' };
      // empty_op is a modifier of empty_field — clear it alongside.
      if (key === 'empty_field') next.empty_op = 'is_not_empty';
      return next;
    });
    setPage(1);
    setActiveViewId(null);
  };
  const clearAll = () => { setFilters(EMPTY_FILTERS); setSearchInput(''); setPage(1); setActiveViewId(null); setSort([]); };
  const updateFilter = (key, value) => { setFilters((prev) => ({ ...prev, [key]: value })); setPage(1); setActiveViewId(null); };

  // Click a column header to toggle sort.
  //   plain click → set as the only primary; cycles desc → asc → clear
  //   shift-click → toggle as secondary (max 2 sort keys total):
  //                 not present → add as desc at position 2
  //                 already at position 2, desc → flip to asc
  //                 already at position 2, asc → remove
  //                 already at position 1 → cycle dir
  // Server validates field names against [A-Za-z0-9_ -] before embedding.
  const toggleSort = (field, additive = false) => {
    if (!field) return;
    setPage(1);
    setSort((prev) => {
      const idx = prev.findIndex((s) => s.field === field);
      if (!additive) {
        if (idx === 0 && prev.length === 1) {
          if (prev[0].dir === 'desc') return [{ field, dir: 'asc' }];
          return []; // third click clears
        }
        return [{ field, dir: 'desc' }];
      }
      // additive (shift-click)
      if (idx === -1) {
        // Cap at 2 keys total — drop the oldest secondary if we'd overflow.
        const base = prev.length >= 2 ? prev.slice(0, 1) : prev;
        return [...base, { field, dir: 'desc' }];
      }
      const next = prev.slice();
      const current = next[idx];
      if (current.dir === 'desc') {
        next[idx] = { field, dir: 'asc' };
        return next;
      }
      // asc → remove
      next.splice(idx, 1);
      return next;
    });
  };

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
    if (!b) return id;
    const stamp = b.imported_at ? new Date(String(b.imported_at).replace(' ', 'T')).toLocaleDateString() : '';
    return stamp ? `${b.batch_name} (${stamp})` : b.batch_name;
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
    if (k === 'empty_field')      return `${v} ${(filters.empty_op || 'is_not_empty') === 'is_empty' ? '(empty)' : '(has value)'}`;
    return String(v);
  };

  return (
    <div className="page leads-page">
      <div className="leads-header">
        {/* Title matches the sidebar tab label. The admin/agent
            distinction is conveyed by the scope filter + the stats
            line below, not by changing the page heading. */}
        <h1 className="section-title">Leads</h1>
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
          {/* + New lead — opens a modal that POSTs to /api/lead_manual.
              Lazy-creates a "Manual lead add" file + ongoing batch
              under the hood. Only admins / marketers / acquisition
              agents see the button (the backend enforces the same). */}
          {['admin','marketer','sales_agent'].includes(user?.role) && (
            <Button variant="primary" size="md" icon="plus" onClick={() => setManualOpen(true)}>
              New lead
            </Button>
          )}
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
          {/* Show Archived toggle. Flips the include_archived filter so
              the table swaps from "live leads" → "archived leads" only.
              Open any archived lead → Restore from the drawer. */}
          <button
            type="button"
            onClick={() => updateFilter('include_archived', filters.include_archived === '1' ? '' : '1')}
            className={`vv-btn ${filters.include_archived === '1' ? 'vv-btn-primary' : 'vv-btn-ghost'}`}
            title={filters.include_archived === '1' ? 'Currently showing archived leads — click to return to active' : 'Show archived (soft-deleted) leads'}
          >
            <Icon name={filters.include_archived === '1' ? 'eye' : 'archive'} size={14} />
            <span style={{ marginLeft: 6 }}>{filters.include_archived === '1' ? 'Archived' : 'Archive'}</span>
          </button>
          {/* Empty-contact toggle. By default the server hides leads
              with no phone / email (TLO-lookup failures). Flip on to
              surface them — useful when triaging which files need a
              re-run, but noise in the day-to-day working surface. */}
          <button
            type="button"
            onClick={() => updateFilter('include_empty', filters.include_empty === '1' ? '' : '1')}
            className={`vv-btn ${filters.include_empty === '1' ? 'vv-btn-primary' : 'vv-btn-ghost'}`}
            title={filters.include_empty === '1' ? 'Currently showing leads with no contact info — click to hide them' : 'Include leads with no phone / email (TLO-lookup failures)'}
          >
            <Icon name="eye" size={14} />
            <span style={{ marginLeft: 6 }}>{filters.include_empty === '1' ? 'Empty on' : 'Empty off'}</span>
          </button>
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
              {/* Vehicle identity filters — Year/Make/Model/Trim. The old
                  hunt-list "Vehicle" dropdown was removed alongside the
                  Vehicles tab; operators filter by the actual lead facets
                  the same way the Dashboard's Find-leads-by-vehicle card
                  navigates here. */}
              <FilterSelect label="Year" value={filters.year} onChange={(v) => updateFilter('year', v)}>
                <option value="">Any year</option>
                {options.years.map((y) => <option key={y} value={y}>{y}</option>)}
              </FilterSelect>
              <FilterSelect label="Make" value={filters.make} onChange={(v) => updateFilter('make', v)}>
                <option value="">Any make</option>
                {options.makes.map((m) => <option key={m} value={m}>{m}</option>)}
              </FilterSelect>
              <FilterSelect label="Model" value={filters.model} onChange={(v) => updateFilter('model', v)}>
                <option value="">Any model</option>
                {(options.models || []).map((m) => <option key={m} value={m}>{m}</option>)}
              </FilterSelect>
              <FilterSelect label="Trim" value={filters.trim} onChange={(v) => updateFilter('trim', v)}>
                <option value="">Any trim</option>
                {(options.trims || []).map((t) => <option key={t} value={t}>{t}</option>)}
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

              {/* Status dropdown — surfaces every status from
                  LEAD_STATUSES (not just the QuickFilterPills set),
                  so operators can isolate Closed / Disqualified /
                  Do not call / Nurture / etc. that aren't on the
                  quick row. Selecting the same status as an active
                  quick pill leaves them in sync since both write to
                  the same filters.status field. */}
              <FilterSelect label="Status" value={filters.status} onChange={(v) => updateFilter('status', v)}>
                <option value="">Any status</option>
                {LEAD_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </FilterSelect>
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
                {options.batches.map((b) => {
                  // Several batches can share the same name (same file
                  // uploaded twice), so suffix the import date + row
                  // count to make the choice unambiguous.
                  const stamp = b.imported_at ? new Date(String(b.imported_at).replace(' ', 'T')).toLocaleDateString() : '';
                  const count = b.lead_count != null ? ` · ${b.lead_count} rows` : '';
                  const suffix = stamp || count ? ` (${[stamp, count.trim().replace(/^· /, '')].filter(Boolean).join(' · ')})` : '';
                  return <option key={b.id} value={b.id}>{b.batch_name}{suffix}</option>;
                })}
              </FilterSelect>
              <FilterSelect label="Source file" value={filters.file_id} onChange={(v) => updateFilter('file_id', v)}>
                <option value="">Any file</option>
                {(options.files || []).map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.display_name}{f.vehicle_name ? ` — ${f.vehicle_name}` : ''}
                  </option>
                ))}
              </FilterSelect>
              <EmptyFieldFilter
                field={filters.empty_field}
                op={filters.empty_op || 'is_not_empty'}
                customColumns={customColumns}
                onChange={(field, op) => {
                  // Update both keys in one batch so the chip + the
                  // pending request line up. Empty field clears the op
                  // back to default.
                  setFilters((prev) => ({
                    ...prev,
                    empty_field: field,
                    empty_op:    field ? (op || 'is_not_empty') : 'is_not_empty',
                  }));
                  setPage(1);
                  setActiveViewId(null);
                }}
              />
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
                  <th
                    className="pl-5 pr-1 py-2 w-8"
                    title="Check rows to enable bulk actions: assign agent, change status, add labels, create tasks, send to marketing."
                  >
                    <input
                      type="checkbox"
                      checked={allPageSelected}
                      ref={(el) => { if (el) el.indeterminate = somePageSelected; }}
                      onChange={togglePageSelection}
                      className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      aria-label="Select all on page · enables bulk actions"
                    />
                  </th>
                  <SortableTh label="Name" sortKey="last_name" sort={sort} onSort={toggleSort} className="px-2" />
                  {BUILTIN_COLUMNS.map(([key, label]) => {
                    if (hiddenColumns.has(key)) return null;
                    const sortKey = BUILTIN_SORT_KEYS[key];
                    // Columns without a sortable backing field (agent name,
                    // labels list, stage badge) render as plain headers.
                    if (!sortKey) {
                      return (
                        <th key={`h-${key}`} className="px-3 py-2 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">
                          {label}
                        </th>
                      );
                    }
                    return (
                      <SortableTh
                        key={`h-${key}`}
                        label={label}
                        sortKey={sortKey}
                        sort={sort}
                        onSort={toggleSort}
                      />
                    );
                  })}
                  {visibleCustomColumns.map((k) => (
                    // Custom columns (raw payload keys not yet promoted to
                    // built-ins) keep working — server validates the key
                    // and casts to DECIMAL for numeric ordering.
                    <SortableTh
                      key={`h-${k}`}
                      label={k}
                      sortKey={k}
                      sort={sort}
                      onSort={toggleSort}
                      className="whitespace-nowrap truncate max-w-[200px]"
                      title={k}
                    />
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
                      <td className="px-2 py-2 whitespace-nowrap">
                        <div className="flex items-center gap-1.5 max-w-[260px]">
                          <span className="text-sm font-semibold text-gray-900 truncate" title={name}>{name}</span>
                          {/* Collector indicator. The label was set up as
                              a CarFax convention for high-value contacts
                              (see migration 020) — we surface it inline
                              by the name, no separate column, so it's
                              one glance from the leads list. */}
                          {(labels || []).some((l) => l.name === 'Collector') && (
                            <span
                              title="This lead is flagged Collector"
                              className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-100 text-red-700 whitespace-nowrap"
                            >
                              Collector
                            </span>
                          )}
                          {/* "×N" chip when the same phone shows up on
                              other live leads — clicking the row still
                              opens this lead; the sibling list lives in
                              the drawer banner. */}
                          {lead.related_count > 0 && (
                            <span
                              title={`This person owns ${lead.related_count + 1} vehicles in the CRM (open to see the others)`}
                              className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-violet-100 text-violet-700 whitespace-nowrap"
                            >
                              ×{lead.related_count + 1}
                            </span>
                          )}
                        </div>
                      </td>
                      {BUILTIN_COLUMNS.map(([key]) => {
                        if (hiddenColumns.has(key)) return null;
                        return (
                          <BuiltinCell
                            key={`c-${lead.id}-${key}`}
                            colKey={key}
                            lead={lead}
                            np={np}
                            crm={crm}
                            labels={labels}
                            location={location}
                            vehicle={vehicle}
                            tierMeta={tierMeta}
                            statusMeta={statusMeta}
                            temperatureMeta={temperatureMeta}
                          />
                        );
                      })}
                      {visibleCustomColumns.map((k) => {
                        const v = np[k];
                        const display = v === undefined || v === null || v === '' ? null : String(v);
                        return (
                          <td
                            key={`c-${lead.id}-${k}`}
                            className="px-3 py-2.5 text-[13px] text-gray-700 truncate max-w-[200px] whitespace-nowrap"
                            title={display ?? ''}
                          >
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

      <LeadDetailDrawer
        leadId={detailId}
        onClose={() => setDetailId(null)}
        onChanged={() => { fetchLeads(); fetchSummary(); }}
        onOpenLead={(id) => setDetailId(id)}
      />

      <ManualLeadModal
        open={manualOpen}
        onClose={() => setManualOpen(false)}
        onCreated={(newLeadId) => {
          setManualOpen(false);
          fetchLeads();
          fetchSummary();
          // Open the freshly-created lead in the drawer so the agent
          // can immediately add notes, set status, etc.
          if (newLeadId) setDetailId(newLeadId);
        }}
      />

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

/**
 * One built-in table cell. Centralizes per-column rendering so the row
 * map stays compact and the column-order array in BUILTIN_COLUMNS is the
 * single source of truth for "what shows up where" in the table.
 *
 * Anything not in the explicit switch falls through to a generic
 * payload-key reader (via PAYLOAD_READER) for the new CarFax / TLO
 * columns — keeps the per-column code in one place.
 */
function BuiltinCell({ colKey, lead, np, crm, labels, location, vehicle, tierMeta, statusMeta, temperatureMeta }) {
  // Every built-in cell defaults to whitespace-nowrap so long values
  // ellipsis-truncate instead of pushing the row to two lines. Pair with
  // a max-width on cells that hold free text so they collapse nicely.
  const td = (cls, children) => (
    <td className={`px-3 py-2 whitespace-nowrap ${cls}`}>{children}</td>
  );
  switch (colKey) {
    case 'tier':
      return td('', (
        <span title={tierMeta.hint} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold ${tierMeta.bg} ${tierMeta.text}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${tierMeta.dot}`} />{tierMeta.short}
        </span>
      ));
    case 'status':
      return td('', (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold ${statusMeta.bg} ${statusMeta.text}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${statusMeta.dot}`} />{statusMeta.label}
        </span>
      ));
    case 'priority':
      return <td className="px-3 py-2 whitespace-nowrap"><PriorityCell priorityKey={crm.priority} /></td>;
    case 'temperature':
      return (
        <td className="px-3 py-2 whitespace-nowrap">
          {temperatureMeta ? (
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold ${temperatureMeta.bg} ${temperatureMeta.text} whitespace-nowrap`}>
              <span className={`w-1.5 h-1.5 rounded-full ${temperatureMeta.dot}`} />{temperatureMeta.label}
            </span>
          ) : <EmDash />}
        </td>
      );
    case 'agent':
      return <td className="px-3 py-2 whitespace-nowrap"><AgentCell name={crm.assigned_user_name} /></td>;
    case 'labels':
      // Single horizontal line of chips — overflow hides past the
      // 240px cap, matching the no-wrap directive on every other cell.
      return (
        <td className="px-3 py-2 whitespace-nowrap">
          {labels.length === 0 ? <EmDash /> : (
            <div className="inline-flex items-center gap-1 max-w-[240px] overflow-hidden">
              {labels.slice(0, 3).map((l) => (
                <span
                  key={l.id}
                  className="inline-flex items-center text-[10px] font-medium text-white px-1.5 py-0.5 rounded whitespace-nowrap"
                  style={{ backgroundColor: l.color }}
                >
                  {l.name}
                </span>
              ))}
              {labels.length > 3 && <span className="text-[10px] text-gray-500 shrink-0">+{labels.length - 3}</span>}
            </div>
          )}
        </td>
      );
    case 'wanted':
      return <td className="px-3 py-2 text-[13px] text-gray-700 text-right tabular-nums whitespace-nowrap">{crm.price_wanted != null ? formatPrice(crm.price_wanted) : <EmDash />}</td>;
    case 'offered':
      return <td className="px-3 py-2 text-[13px] text-gray-700 text-right tabular-nums whitespace-nowrap">{crm.price_offered != null ? formatPrice(crm.price_offered) : <EmDash />}</td>;
    case 'vin':
      return <td className="px-3 py-2 whitespace-nowrap"><VinCell vin={np.vin || ''} /></td>;
    case 'phone_1':
    case 'phone_2':
    case 'phone_3':
    case 'phone_4': {
      const v = PAYLOAD_READER[colKey](np);
      // Map the column key (phone_1..phone_4) to the slot enum stored on
      // lead_states.known_phone_slot ('phone_primary' / 'phone_secondary' /
      // 'phone_3' / 'phone_4'). When this cell's phone matches the marked
      // slot, render a small green check after the digits so operators can
      // see at a glance which line has been verified reachable.
      const COL_TO_SLOT = {
        phone_1: 'phone_primary',
        phone_2: 'phone_secondary',
        phone_3: 'phone_3',
        phone_4: 'phone_4',
      };
      const isVerified = v && crm.known_phone_slot === COL_TO_SLOT[colKey];
      return (
        <td className="px-3 py-2 text-[13px] text-gray-700 tabular-nums whitespace-nowrap">
          {v ? (
            <span className="inline-flex items-center gap-1">
              <span>{formatPhone(v)}</span>
              {isVerified && (
                <span
                  className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-bold leading-none"
                  title="Verified — confirmed reachable number"
                  aria-label="verified phone"
                >
                  ✓
                </span>
              )}
            </span>
          ) : (
            <EmDash />
          )}
        </td>
      );
    }
    case 'email_1':
    case 'email_2': {
      const v = PAYLOAD_READER[colKey](np);
      return (
        <td className="px-3 py-2 text-[13px] text-gray-700 truncate max-w-[180px]" title={v || ''}>
          {v || <EmDash />}
        </td>
      );
    }
    case 'location':
      return <td className="px-3 py-2 text-[13px] text-gray-600 whitespace-nowrap">{location && location !== '—' ? location : <EmDash />}</td>;
    case 'vehicle':
      return <td className="px-3 py-2 text-[13px] text-gray-700 whitespace-nowrap" title={vehicle}>{vehicle && vehicle !== '—' ? formatVehicle(vehicle) : <EmDash />}</td>;
    case 'source_file':
      return <td className="px-3 py-2 text-[12px] text-gray-500 whitespace-nowrap truncate max-w-[200px]" title={lead.file_display_name || lead.file_name || ''}>{lead.file_display_name || lead.file_name || <EmDash />}</td>;
    case 'batch':
      return <td className="px-3 py-2 text-[12px] text-gray-500 whitespace-nowrap truncate max-w-[200px]" title={lead.batch_name || ''}>{lead.batch_name || <EmDash />}</td>;
    case 'stage':
      return (
        <td className="px-3 py-2 whitespace-nowrap">
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-100 uppercase tracking-wide">{lead.source_stage}</span>
        </td>
      );
    case 'row_number':
      return <td className="px-3 py-2 text-[11px] text-gray-400 tabular-nums whitespace-nowrap">{lead.source_row_number}</td>;
    case 'imported':
      return <td className="px-3 py-2 text-[11px] text-gray-400 whitespace-nowrap">{formatDate(lead.imported_at)}</td>;
    case 'miles': {
      const v = PAYLOAD_READER.miles(np);
      if (v === null || v === undefined || v === '') return td('text-[13px] text-gray-700 tabular-nums text-right', <EmDash />);
      // Mileage comes in as either a comma-formatted string ("263,354")
      // or a bare number — display with a consistent thousand-sep.
      const n = Number(String(v).replace(/[,\s]/g, ''));
      const display = Number.isFinite(n) ? n.toLocaleString() : String(v);
      return td('text-[13px] text-gray-700 tabular-nums text-right whitespace-nowrap', display);
    }
    case 'number_of_owners':
    case 'service_record_count': {
      const v = PAYLOAD_READER[colKey](np);
      return td('text-[13px] text-gray-700 tabular-nums text-right', v === null || v === undefined || v === '' ? <EmDash /> : String(v));
    }
    default: {
      // Last-service / accident / title / lien / registration / etc.
      const reader = PAYLOAD_READER[colKey];
      const v = reader ? reader(np) : null;
      const txt = v === null || v === undefined || v === '' ? null : String(v);
      return (
        <td className="px-3 py-2 text-[13px] text-gray-700 truncate max-w-[200px] whitespace-nowrap" title={txt || ''}>
          {txt ?? <EmDash />}
        </td>
      );
    }
  }
}

/**
 * Sortable column header. Plain-click cycles desc → asc → off for that
 * field as the only primary sort. Shift-click adds the field as a
 * secondary sort key (max 2). A small "1" / "2" badge next to the
 * arrow shows the position in the multi-sort chain. Server validates
 * the field name, so custom payload keys (e.g. "Age") flow through.
 */
function SortableTh({ label, sortKey, sort, onSort, className = '', align = 'left', title }) {
  const idx = sort.findIndex((s) => s.field === sortKey);
  const isActive = idx !== -1;
  const dir = isActive ? sort[idx].dir : null;
  const arrow = dir === 'asc' ? '↑' : dir === 'desc' ? '↓' : '';
  const justify = align === 'right' ? 'justify-end' : 'justify-start';
  // Hint about shift-click on hover the first time someone notices the
  // sort markers. Tooltip is the only affordance — chip would clutter.
  const tooltip = title || `Sort by ${label}` + (sort.length > 0 ? ' · Shift-click to add as secondary' : '');
  return (
    <th
      onClick={(e) => onSort(sortKey, e.shiftKey)}
      title={tooltip}
      className={`${className} px-3 py-2 text-${align} text-[10px] font-semibold uppercase tracking-wider cursor-pointer select-none whitespace-nowrap ${isActive ? 'text-gray-900' : 'text-gray-500 hover:text-gray-800'}`}
    >
      <span className={`inline-flex items-center gap-1 whitespace-nowrap ${justify}`}>
        <span className="truncate">{label}</span>
        {arrow && <span aria-hidden="true" className="text-[11px] leading-none">{arrow}</span>}
        {isActive && sort.length > 1 && (
          <span
            aria-hidden="true"
            className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-gray-200 text-[9px] font-bold text-gray-700 leading-none"
          >
            {idx + 1}
          </span>
        )}
      </span>
    </th>
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

/**
 * Empty / has-value filter. Operator picks a column then a polarity:
 *   "Has value" → field must be non-empty
 *   "Is empty"  → field must be NULL / ''
 *
 * Covers the promoted norm_* columns (indexed) plus any custom payload
 * key that the current page surfaces — that's the set the table already
 * shows the user, so the dropdown stays in sync. Empty selection clears
 * the filter on the server.
 */
function EmptyFieldFilter({ field, op, customColumns, onChange }) {
  const builtins = [
    { key: 'phone_primary', label: 'Phone (primary)' },
    { key: 'email_primary', label: 'Email' },
    { key: 'vin',           label: 'VIN' },
    { key: 'first_name',    label: 'First name' },
    { key: 'last_name',     label: 'Last name' },
    { key: 'city',          label: 'City' },
    { key: 'state',         label: 'State' },
    { key: 'zip_code',      label: 'ZIP' },
    { key: 'make',          label: 'Make' },
    { key: 'model',         label: 'Model' },
    { key: 'year',          label: 'Year' },
    { key: 'mileage',       label: 'Mileage' },
  ];
  return (
    <div>
      <label className="field-label">Empty / Has value</label>
      <div className="row" style={{ gap: 6 }}>
        <select
          value={field}
          onChange={(e) => onChange(e.target.value, op)}
          className="vv-input"
          style={{ flex: 2 }}
          aria-label="Field to check"
        >
          <option value="">— Any —</option>
          <optgroup label="Built-in">
            {builtins.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
          </optgroup>
          {customColumns.length > 0 && (
            <optgroup label="Imported columns">
              {customColumns.map((k) => <option key={k} value={k}>{k}</option>)}
            </optgroup>
          )}
        </select>
        <select
          value={op}
          onChange={(e) => onChange(field, e.target.value)}
          className="vv-input"
          style={{ flex: 1 }}
          disabled={!field}
          aria-label="Empty or not empty"
        >
          <option value="is_not_empty">Has value</option>
          <option value="is_empty">Is empty</option>
        </select>
      </div>
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

/**
 * Manual lead-add modal. Posts to /api/lead_manual which lazy-creates
 * a "Manual lead add" file + today's batch + the lead row in one
 * transaction. Required: a name (first or last) plus at least one
 * contact channel (phone or email) — without that the lead would be
 * caught by the empty-contact filter on the leads page.
 *
 * Defaults assign_to_self=true so the creator can immediately see
 * their new lead under the agent-only visibility filter.
 */
function ManualLeadModal({ open, onClose, onCreated }) {
  const [form, setForm] = useState({
    first_name: '', last_name: '',
    phone_primary: '', email_primary: '',
    full_address: '', city: '', state: '', zip_code: '',
    vin: '', year: '', make: '', model: '', trim: '', mileage: '',
    notes: '',
    assign_to_self: true,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Reset on open so a stale draft doesn't survive a previous cancel.
  useEffect(() => {
    if (!open) return;
    setForm({
      first_name: '', last_name: '',
      phone_primary: '', email_primary: '',
      full_address: '', city: '', state: '', zip_code: '',
      vin: '', year: '', make: '', model: '', trim: '', mileage: '',
      notes: '',
      assign_to_self: true,
    });
    setError('');
  }, [open]);

  if (!open) return null;

  const canSubmit =
    (form.first_name.trim() || form.last_name.trim()) &&
    (form.phone_primary.trim() || form.email_primary.trim()) &&
    !submitting;

  const submit = async () => {
    setSubmitting(true); setError('');
    try {
      const res = await api.post('/lead_manual', form);
      onCreated?.(res.data?.lead_id);
    } catch (err) {
      setError(extractApiError(err, 'Failed to add lead'));
    } finally {
      setSubmitting(false);
    }
  };

  const set = (k) => (e) => setForm((p) => ({ ...p, [k]: e.target.value }));
  const inputCls = 'w-full bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1.5 text-[13px] focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none';

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-gray-900/60" />
      <div
        className="relative bg-white w-full max-w-xl sm:rounded-2xl rounded-t-2xl shadow-2xl max-h-[92vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Add a lead manually</h2>
            <p className="text-[11px] text-gray-500 mt-0.5">
              Walk-ins, referrals, anything not from a spreadsheet upload. Lands under the <strong>Manual lead add</strong> file.
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100">&times;</button>
        </div>

        <div className="px-5 py-4 overflow-y-auto space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <FieldLabel label="First name" required>
              <input type="text" value={form.first_name} onChange={set('first_name')} className={inputCls} autoFocus />
            </FieldLabel>
            <FieldLabel label="Last name">
              <input type="text" value={form.last_name} onChange={set('last_name')} className={inputCls} />
            </FieldLabel>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <FieldLabel label="Phone" required>
              <input type="tel" value={form.phone_primary} onChange={set('phone_primary')} placeholder="(555) 123-4567" className={inputCls} />
            </FieldLabel>
            <FieldLabel label="Email">
              <input type="email" value={form.email_primary} onChange={set('email_primary')} placeholder="name@domain.com" className={inputCls} />
            </FieldLabel>
          </div>
          <p className="text-[10px] text-gray-500">First/last name + phone <em>or</em> email required.</p>

          <FieldLabel label="Address">
            <input type="text" value={form.full_address} onChange={set('full_address')} className={inputCls} />
          </FieldLabel>
          <div className="grid grid-cols-3 gap-2">
            <FieldLabel label="City">
              <input type="text" value={form.city} onChange={set('city')} className={inputCls} />
            </FieldLabel>
            <FieldLabel label="State">
              <input type="text" value={form.state} onChange={set('state')} maxLength={2} className={inputCls} placeholder="TX" />
            </FieldLabel>
            <FieldLabel label="ZIP">
              <input type="text" value={form.zip_code} onChange={set('zip_code')} className={inputCls} />
            </FieldLabel>
          </div>

          <div className="border-t border-gray-100 pt-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-2">Vehicle</p>
            <FieldLabel label="VIN">
              <input type="text" value={form.vin} onChange={set('vin')} className={inputCls + ' font-mono'} maxLength={17} placeholder="17 chars" />
            </FieldLabel>
            <div className="grid grid-cols-4 gap-2 mt-2">
              <FieldLabel label="Year">
                <input type="number" value={form.year} onChange={set('year')} className={inputCls} placeholder="2008" />
              </FieldLabel>
              <FieldLabel label="Make">
                <input type="text" value={form.make} onChange={set('make')} className={inputCls} placeholder="DODGE" />
              </FieldLabel>
              <FieldLabel label="Model">
                <input type="text" value={form.model} onChange={set('model')} className={inputCls} placeholder="Viper" />
              </FieldLabel>
              <FieldLabel label="Trim">
                <input type="text" value={form.trim} onChange={set('trim')} className={inputCls} placeholder="SRT" />
              </FieldLabel>
            </div>
            <div className="mt-2">
              <FieldLabel label="Miles">
                <input type="text" inputMode="numeric" value={form.mileage} onChange={set('mileage')} className={inputCls} placeholder="87,500" />
              </FieldLabel>
            </div>
          </div>

          <FieldLabel label="Notes">
            <textarea value={form.notes} onChange={set('notes')} rows={2} maxLength={5000} className={inputCls} placeholder="Optional — attached as the first note on the lead." />
          </FieldLabel>

          <label className="flex items-center gap-2 mt-2 text-[12px] text-gray-700 cursor-pointer">
            <input
              type="checkbox"
              checked={form.assign_to_self}
              onChange={(e) => setForm((p) => ({ ...p, assign_to_self: e.target.checked }))}
              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            Assign to me so I can see it immediately
          </label>

          {error && (
            <div className="text-[12px] px-3 py-2 rounded-md bg-red-50 text-red-700 border border-red-100">
              {error}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2 shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-50 hover:bg-gray-100 rounded-lg">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!canSubmit}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow disabled:opacity-40"
          >
            {submitting ? 'Adding…' : 'Add lead'}
          </button>
        </div>
      </div>
    </div>
  );
}

function FieldLabel({ label, required, children }) {
  return (
    <label className="block">
      <span className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">
        {label} {required && <span className="text-red-500">*</span>}
      </span>
      {children}
    </label>
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

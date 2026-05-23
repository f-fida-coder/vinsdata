import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import api, { uploadFile, getDownloadUrl, extractApiError } from '../api';
import FileDetailDrawer from '../components/FileDetailDrawer';
import ImportFinalFileModal from '../components/ImportFinalFileModal';
import DuplicatesPage from './DuplicatesPage';
import MergePrepPage from './MergePrepPage';
import { useAuth } from '../context/AuthContext';
import { SectionHeader, KPI, Button, Icon, Input, StageDots, StatusBadge, EmptyState } from '../components/ui';

const STAGES = ['generated', 'carfax', 'filter', 'tlo'];
const STAGE_META = {
  generated: { label: 'Generated', dot: 'var(--text-3)' },
  carfax:    { label: 'Carfax',    dot: 'var(--warm)' },
  filter:    { label: 'Filter',    dot: 'var(--cold)' },
  tlo:       { label: 'TLO',       dot: 'var(--success)' },
};
const NEXT_STAGE = { generated: 'carfax', carfax: 'filter', filter: 'tlo' };
const STAGE_ROLES = {
  generated: ['admin'],
  carfax:    ['admin', 'carfax'],
  filter:    ['admin', 'filter'],
  tlo:       ['admin', 'tlo'],
};

function VVModal({ open, onClose, title, width = 460, children }) {
  if (!open) return null;
  return (
    <>
      <div className="drawer-overlay" onClick={onClose}/>
      <div style={{
        position: 'fixed',
        top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        width: `min(${width}px, 92vw)`,
        background: 'var(--bg-1)',
        border: '1px solid var(--border-0)',
        borderRadius: 14,
        boxShadow: 'var(--shadow-pop)',
        zIndex: 90,
        maxHeight: '90vh',
        display: 'flex',
        flexDirection: 'column',
      }} onClick={(e) => e.stopPropagation()}>
        <div className="drawer-head">
          <h3 style={{ fontFamily: 'var(--font-sans)', fontSize: 18, fontWeight: 700, letterSpacing: '-0.025em' }}>{title}</h3>
          <Button variant="ghost" size="sm" icon="x" onClick={onClose}/>
        </div>
        <div style={{ padding: 20, overflowY: 'auto' }}>{children}</div>
      </div>
    </>
  );
}

function ActionDropdown({ file, onMove, onReupload, onEdit, onDelete, onNotify, onView, invalid, next, canReupload }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const btnRef = useRef(null);
  const menuRef = useRef(null);

  // Compute fixed-positioning so the menu can escape `overflow:hidden` parents
  // and flip above the trigger when there isn't room below.
  const place = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const menuW = 220;
    const estH = 260;
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    const flipUp = r.bottom + estH + 8 > vh && r.top > estH + 8;
    const top = flipUp ? Math.max(8, r.top - estH - 4) : r.bottom + 4;
    const left = Math.min(vw - menuW - 8, Math.max(8, r.right - menuW));
    setPos({ top, left });
  };

  useEffect(() => {
    if (!open) return;
    place();
    const handler = (e) => {
      if (menuRef.current?.contains(e.target)) return;
      if (btnRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onScroll = () => setOpen(false);
    document.addEventListener('mousedown', handler);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', handler);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  return (
    <div className="dropdown-wrap" ref={btnRef}>
      <Button variant="ghost" size="sm" icon="moreV" onClick={() => setOpen((o) => !o)}/>
      {open && pos && (
        <div
          ref={menuRef}
          className="dropdown-menu"
          style={{ position: 'fixed', top: pos.top, left: pos.left, minWidth: 200, zIndex: 60 }}
        >
          <button className="dd-item" onClick={() => { setOpen(false); onView(); }}><Icon name="eye" size={14}/><span>View details</span></button>
          {!invalid && next && <button className="dd-item" onClick={() => { setOpen(false); onMove(); }}><Icon name="arrowRight" size={14}/><span>Move to {next}</span></button>}
          {canReupload && <button className="dd-item" onClick={() => { setOpen(false); onReupload(); }}><Icon name="refresh" size={14}/><span>Re-upload {file.current_stage}</span></button>}
          <button className="dd-item" onClick={() => { setOpen(false); onEdit(); }}><Icon name="edit" size={14}/><span>Edit details</span></button>
          <button className="dd-item" onClick={() => { setOpen(false); onNotify(); }}><Icon name="phone" size={14}/><span>Notify via WhatsApp</span></button>
          <div className="dd-divider"/>
          <button className="dd-item" onClick={() => { setOpen(false); onDelete(); }} style={{ color: 'var(--danger)' }}><Icon name="trash" size={14}/><span>Delete</span></button>
        </div>
      )}
    </div>
  );
}

/**
 * Find leads by vehicle — Dashboard widget that replaced the Vehicles
 * tab. Operators pick any combination of Year / Make / Model / Trim
 * from the live lead facets (sourced from /api/lead_filter_options),
 * click Search, and land on a /leads view filtered to matching leads.
 *
 * Empty selections aren't sent as filters — pick just a year, or just
 * make + model, or all four. The Leads page reads the same URL params
 * its own filter UI uses, so the round-trip is consistent.
 */
function LeadFinderCard() {
  const navigate = useNavigate();
  const [options, setOptions] = useState({ makes: [], models: [], years: [], trims: [] });
  const [state, setState] = useState({ year: '', make: '', model: '', trim: '' });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api.get('/lead_filter_options')
      .then((res) => {
        if (cancelled) return;
        setOptions({
          makes:  res.data?.makes  ?? [],
          models: res.data?.models ?? [],
          years:  res.data?.years  ?? [],
          trims:  res.data?.trims  ?? [],
        });
      })
      .catch(() => { /* swallow — empty dropdowns still let operator type */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const set = (patch) => setState((s) => ({ ...s, ...patch }));
  const clear = () => setState({ year: '', make: '', model: '', trim: '' });
  const search = () => {
    const params = new URLSearchParams();
    if (state.year)  params.set('year',  state.year);
    if (state.make)  params.set('make',  state.make);
    if (state.model) params.set('model', state.model);
    if (state.trim)  params.set('trim',  state.trim);
    navigate(`/leads${params.toString() ? '?' + params.toString() : ''}`);
  };

  const hasAny = !!(state.year || state.make || state.model || state.trim);

  // Inline selects — keep the styling consistent with the rest of the
  // dashboard tokens rather than introducing a new component.
  const selectStyle = {
    width: '100%',
    padding: '8px 10px',
    background: 'var(--bg-2)',
    border: '1px solid var(--border-0)',
    borderRadius: 8,
    color: 'var(--text-0)',
    fontSize: 13,
    outline: 'none',
    fontFamily: 'inherit',
  };
  const labelStyle = {
    display: 'block',
    fontSize: 10,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    fontWeight: 600,
    color: 'var(--text-2)',
    marginBottom: 4,
  };

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-0)' }}>Find leads by vehicle</div>
          <div style={{ fontSize: 11, color: 'var(--text-2)', marginTop: 2 }}>
            Year, Make, Model, Trim — any combination jumps to a filtered Leads view.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {hasAny && <Button variant="ghost" size="sm" onClick={clear}>Clear</Button>}
          <Button variant="primary" size="sm" icon="search" onClick={search}>Search leads</Button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
        <label>
          <span style={labelStyle}>Year</span>
          <select style={selectStyle} value={state.year} onChange={(e) => set({ year: e.target.value })} disabled={loading}>
            <option value="">Any year</option>
            {options.years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </label>
        <label>
          <span style={labelStyle}>Make</span>
          <select style={selectStyle} value={state.make} onChange={(e) => set({ make: e.target.value })} disabled={loading}>
            <option value="">Any make</option>
            {options.makes.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label>
          <span style={labelStyle}>Model</span>
          <select style={selectStyle} value={state.model} onChange={(e) => set({ model: e.target.value })} disabled={loading}>
            <option value="">Any model</option>
            {options.models.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label>
          <span style={labelStyle}>Trim</span>
          <select style={selectStyle} value={state.trim} onChange={(e) => set({ trim: e.target.value })} disabled={loading}>
            <option value="">Any trim</option>
            {options.trims.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [files, setFiles] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [filters, setFilters] = useState({ vehicle_id: '', stage: '', year: '' });
  const [showModal, setShowModal] = useState(false);
  // Multi-row Add File modal: each entry is one upload. status is per-entry
  // so we can show ✓ / × per row when the bulk submit runs.
  // Each upload row now captures the vehicle by its four facets
  // (make/model/year/trim) instead of forcing the operator to pre-create
  // a vehicle in a separate flow. The server-side /api/files POST
  // resolves these to an existing vehicle_id or inserts one inline.
  const makeEmptyEntry = () => ({
    rid: `r${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    make:       '',
    model:      '',
    trim:       '',
    file_name:  '',
    year:       '',
    version:    'v1',
    file:       null,
    status:     'pending',
    error:      null,
  });
  const [entries, setEntries] = useState(() => [makeEmptyEntry()]);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [stageModal, setStageModal] = useState(null);
  const [stageFile, setStageFile] = useState(null);
  const [stageNotes, setStageNotes] = useState('');
  const [uploading, setUploading] = useState(false);
  const [editModal, setEditModal] = useState(null);
  const [notifyModal, setNotifyModal] = useState(null);
  const [teamMembers, setTeamMembers] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [detailId, setDetailId] = useState(null);
  const [importFile, setImportFile] = useState(null);
  const [marketingStats, setMarketingStats] = useState(null);
  const canSeeMarketingStats = user?.role === 'admin' || user?.role === 'marketer';

  useEffect(() => {
    if (!canSeeMarketingStats) return;
    let cancelled = false;
    api.get('/reports', { params: { type: 'marketing' } })
      .then((r) => { if (!cancelled) setMarketingStats(r.data?.marketing || null); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [canSeeMarketingStats]);

  const fetchFiles = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const params = {};
      if (filters.vehicle_id) params.vehicle_id = filters.vehicle_id;
      if (filters.stage) params.stage = filters.stage;
      if (filters.year) params.year = filters.year;
      const res = await api.get('/files', { params });
      setFiles(res.data); setSelected(new Set());
    } catch { setError('Failed to load files'); }
    finally { setLoading(false); }
  }, [filters]);

  const fetchVehicles = async () => {
    try { const res = await api.get('/vehicles'); setVehicles(res.data); }
    catch { setError('Failed to load vehicles'); }
  };

  useEffect(() => { fetchVehicles(); }, []);
  useEffect(() => { fetchFiles(); }, [fetchFiles]);

  const stageCounts = STAGES.reduce((acc, s) => {
    acc[s] = files.filter((f) => f.current_stage === s && !f.is_invalid).length;
    return acc;
  }, {});
  const invalidCount = files.filter((f) => f.is_invalid).length;

  const toggleSelect = (id) => setSelected((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleSelectAll = () => setSelected(selected.size === files.length ? new Set() : new Set(files.map((f) => f.id)));

  const handleBulkInvalid = async (markInvalid) => {
    if (selected.size === 0) return;
    if (!window.confirm(`${markInvalid ? 'Mark' : 'Unmark'} ${selected.size} file(s) as invalid?`)) return;
    try { await api.patch('/files', { ids: Array.from(selected), is_invalid: markInvalid }); fetchFiles(); }
    catch (err) { setError(extractApiError(err, 'Failed to update files')); }
  };

  const handleBulkDelete = async () => {
    if (!window.confirm(`Delete ${selected.size} file(s)? This cannot be undone.`)) return;
    try {
      await Promise.all(Array.from(selected).map((id) => api.delete('/files', { data: { id } })));
      fetchFiles();
    } catch (err) { setError(extractApiError(err, 'Failed to delete files')); }
  };

  const handleStageChange = (fileId, stage, fileName) => {
    setStageModal({ fileId, stage, fileName, mode: 'advance' });
    setStageFile(null); setStageNotes('');
  };

  const handleReupload = (file, stage) => {
    setStageModal({ fileId: file.id, stage: stage ?? file.current_stage, fileName: file.display_name || file.file_name, mode: 'reupload' });
    setStageFile(null); setStageNotes('');
  };

  const handleStageSubmit = async () => {
    if (!stageModal || !stageFile) { setError('You must select a file to upload'); return; }
    setUploading(true); setError('');
    try {
      await uploadFile(stageModal.fileId, stageModal.stage, stageFile);
      if (stageModal.mode === 'advance') {
        await api.put('/files', { id: stageModal.fileId, stage: stageModal.stage, notes: stageNotes || '' });
      }
      setStageModal(null); setStageFile(null); setStageNotes(''); fetchFiles();
    } catch (err) {
      setError(extractApiError(err, stageModal.mode === 'reupload' ? 'Re-upload failed' : 'Failed to update stage'));
    }
    finally { setUploading(false); }
  };

  const updateEntry = (rid, patch) => setEntries((list) => list.map((e) => e.rid === rid ? { ...e, ...patch } : e));
  const removeEntry = (rid) => setEntries((list) => list.length <= 1 ? list : list.filter((e) => e.rid !== rid));
  const addEntry    = ()    => setEntries((list) => [...list, makeEmptyEntry()]);

  // Multi-file picker: drop N files into N rows (filling empty rows first, then appending).
  const handlePickMultiple = (fileList) => {
    const picked = Array.from(fileList || []);
    if (picked.length === 0) return;
    setEntries((list) => {
      const next = [...list];
      let i = 0;
      // Fill any entry whose file slot is empty first.
      for (let r = 0; r < next.length && i < picked.length; r++) {
        if (!next[r].file) {
          const f = picked[i++];
          next[r] = {
            ...next[r],
            file: f,
            file_name: next[r].file_name || f.name.replace(/\.[^/.]+$/, ''),
          };
        }
      }
      // Any remaining picked files become new rows.
      while (i < picked.length) {
        const f = picked[i++];
        next.push({
          ...makeEmptyEntry(),
          file: f,
          file_name: f.name.replace(/\.[^/.]+$/, ''),
        });
      }
      return next;
    });
  };

  const handleAddFile = async (e) => {
    e.preventDefault();
    setError('');

    // Validate first — surface row-level errors without starting any uploads.
    const validation = entries.map((entry) => {
      // Vehicle is now identified by make/model/year (trim optional).
      // File name auto-fills server-side if omitted, so we no longer block
      // submit on it — the only hard requirement is the vehicle facets.
      const make  = (entry.make  || '').trim();
      const model = (entry.model || '').trim();
      const year  = (entry.year  || '').toString().trim();
      if (!make || !model || !year) {
        return 'Make, Model, and Year are required';
      }
      return null;
    });
    if (validation.some((v) => v)) {
      setEntries((list) => list.map((entry, i) => ({
        ...entry,
        status: validation[i] ? 'error' : entry.status,
        error:  validation[i] || entry.error,
      })));
      setError('Fix the highlighted rows before submitting.');
      return;
    }

    setSubmitting(true);
    setEntries((list) => list.map((entry) => ({ ...entry, status: 'uploading', error: null })));

    let okCount = 0;
    let failCount = 0;
    for (const entry of entries) {
      try {
        const res = await api.post('/files', {
          // Server resolves these to an existing vehicle row or creates
          // a new one. The legacy vehicle_id field is intentionally
          // omitted — the four facets are the new contract.
          make:       (entry.make  || '').trim(),
          model:      (entry.model || '').trim(),
          trim:       (entry.trim  || '').trim(),
          file_name:  (entry.file_name || '').trim(),
          year:       entry.year ? Number(entry.year) : null,
          version:    entry.version || null,
        });
        if (entry.file && res.data?.id) {
          await uploadFile(res.data.id, 'generated', entry.file);
        }
        okCount++;
        updateEntry(entry.rid, { status: 'success', error: null });
      } catch (err) {
        failCount++;
        updateEntry(entry.rid, { status: 'error', error: extractApiError(err, 'Failed') });
      }
    }

    setSubmitting(false);
    fetchFiles();

    if (failCount === 0) {
      // Everything uploaded — close & reset.
      setShowModal(false);
      setEntries([makeEmptyEntry()]);
    } else {
      // Keep the modal open. Successful rows can be cleared away by the user.
      setError(`${okCount} added · ${failCount} failed. Fix the rows marked in red and try again.`);
    }
  };

  // After a partial-success submit, the user may want to remove the green rows
  // so only the failed ones remain for retry.
  const clearSucceeded = () => setEntries((list) => {
    const remaining = list.filter((e) => e.status !== 'success');
    return remaining.length === 0 ? [makeEmptyEntry()] : remaining;
  });

  const handleDelete = async (fileId, fileName) => {
    if (!window.confirm(`Delete "${fileName}"?`)) return;
    try { await api.delete('/files', { data: { id: fileId } }); fetchFiles(); }
    catch (err) { setError(extractApiError(err, 'Failed to delete file')); }
  };

  const handleEdit = async (e) => {
    e.preventDefault();
    try {
      await api.patch('/files', {
        id: editModal.id, file_name: editModal.file_name,
        year: editModal.year, version: editModal.version,
      });
      setEditModal(null);
      fetchFiles();
    } catch (err) { setError(extractApiError(err, 'Failed to update file')); }
  };

  const openNotify = async (fileName, currentStage) => {
    try {
      const res = await api.get('/users');
      setTeamMembers(res.data.filter((u) => u.phone));
    } catch { /* non-blocking */ }
    const nextStage = NEXT_STAGE[currentStage] || 'next';
    setNotifyModal({ fileName, stage: currentStage, nextStage });
  };

  const sendWhatsApp = (phone, fileName, nextStage) => {
    const msg = `Hi! The file "*${fileName}*" has been confirmed and is ready for the *${nextStage}* stage. Please start working on it.`;
    window.open(`https://wa.me/${phone.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(msg)}`, '_blank');
    setNotifyModal(null);
  };

  // Tab routing. /files = files list (default), /files/duplicates =
  // Duplicate Review embedded, /files/merge-prep = Merge Prep embedded.
  // We read pathname directly rather than nested routes so all three
  // share this single component (and its existing state).
  const location = useLocation();
  const activeTab = location.pathname.endsWith('/duplicates') ? 'duplicates'
                  : location.pathname.endsWith('/merge-prep') ? 'merge-prep'
                  : 'files';
  const TabButton = ({ id, label }) => (
    <button
      type="button"
      onClick={() => navigate(id === 'files' ? '/files' : `/files/${id}`)}
      className={`px-3 py-1.5 text-[13px] font-medium border-b-2 -mb-px transition ${
        activeTab === id
          ? 'border-blue-600 text-gray-900'
          : 'border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300'
      }`}
      aria-current={activeTab === id ? 'page' : undefined}
    >
      {label}
    </button>
  );

  return (
    <div className="page">
      {/* Single top header for the whole import workspace. Sub-tabs
          switch the body between the three sub-views below. */}
      <SectionHeader
        title="Files"
        subtitle={
          activeTab === 'files'      ? `${files.length} total files across all stages · last refreshed just now`
          : activeTab === 'duplicates' ? 'Confirm or dismiss duplicate-lead groups so the CRM stays clean.'
          : 'Pick the primary lead and field-merge choices for each confirmed duplicate group.'
        }
        actions={
          // Top-right actions only apply to the Files tab. Sub-tabs
          // bring their own (Duplicates has "Run duplicate scan",
          // Merge Prep has no top action right now).
          activeTab === 'files' ? (
            <>
              <Button variant="ghost" icon="refresh" onClick={fetchFiles}>Refresh</Button>
              <Button variant="primary" icon="plus" onClick={() => setShowModal(true)}>Add File</Button>
            </>
          ) : null
        }
      />

      {/* Sub-tab bar — three views inside the Files workspace. */}
      <div className="flex items-end gap-1 border-b border-gray-200 mb-4" role="tablist">
        <TabButton id="files"      label="Files" />
        <TabButton id="duplicates" label="Duplicate Review" />
        <TabButton id="merge-prep" label="Merge Prep" />
      </div>

      {/* Body. The duplicate / merge-prep tabs render their existing
          page components in embedded mode (no inner SectionHeader, no
          duplicated .page wrapper). The Files tab keeps the original
          KPI strip + file list below. */}
      {activeTab === 'duplicates' && <DuplicatesPage embedded />}
      {activeTab === 'merge-prep' && <MergePrepPage embedded />}
      {activeTab !== 'files' ? null : (
      <>

      {error && (
        <div className="card" style={{ marginBottom: 16, color: 'var(--danger)', borderColor: 'var(--danger)' }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span>{error}</span>
            <Button variant="ghost" size="sm" icon="x" onClick={() => setError('')}/>
          </div>
        </div>
      )}

      <div className="kpi-row">
        {STAGES.map((s) => (
          <KPI
            key={s}
            label={STAGE_META[s].label}
            value={stageCounts[s]}
            dot={STAGE_META[s].dot}
          />
        ))}
        <KPI label="Invalid" value={invalidCount} dot="var(--hot)"/>
      </div>

      <LeadFinderCard />

      {/* Marketing strip moved off the Files page per operator request —
          the same stats now render at the top of the Marketing tab.
          (DashboardPage still fetches marketingStats for the summary
          card surfaced there, but the strip itself is removed here.) */}

      <div className="filters-row">
        <div className="filters-label"><Icon name="filter" size={14}/> Filters</div>
        <select className="vv-input" style={{ minWidth: 160, maxWidth: 220 }} value={filters.vehicle_id} onChange={(e) => setFilters({ ...filters, vehicle_id: e.target.value })}>
          <option value="">All Vehicles</option>
          {vehicles.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
        <select className="vv-input" style={{ minWidth: 140, maxWidth: 200 }} value={filters.stage} onChange={(e) => setFilters({ ...filters, stage: e.target.value })}>
          <option value="">All Stages</option>
          {STAGES.map((s) => <option key={s} value={s}>{STAGE_META[s].label}</option>)}
        </select>
        <input className="vv-input" type="number" style={{ minWidth: 90, maxWidth: 130 }} placeholder="Year" value={filters.year} onChange={(e) => setFilters({ ...filters, year: e.target.value })}/>
        {(filters.vehicle_id || filters.stage || filters.year) && (
          <Button variant="ghost" size="sm" onClick={() => setFilters({ vehicle_id: '', stage: '', year: '' })}>Clear all</Button>
        )}
      </div>

      {selected.size > 0 && (
        <div className="card" style={{ marginBottom: 16, padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <strong>{selected.size} selected</strong>
          <span className="spacer"/>
          <Button variant="ghost" size="sm" onClick={() => handleBulkInvalid(true)}>Mark Invalid</Button>
          <Button variant="ghost" size="sm" onClick={() => handleBulkInvalid(false)}>Mark Valid</Button>
          <Button variant="danger" size="sm" icon="trash" onClick={handleBulkDelete}>Delete</Button>
          <Button variant="ghost" size="sm" icon="x" onClick={() => setSelected(new Set())}/>
        </div>
      )}

      <div className="tbl-wrap">
        {loading ? (
          <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-3)' }}>Loading…</div>
        ) : files.length === 0 ? (
          <EmptyState
            icon="file"
            title="No files found"
            body="Add your first file to begin the enrichment pipeline."
            action={<Button variant="primary" icon="plus" onClick={() => setShowModal(true)}>Add File</Button>}
          />
        ) : (
          <>
            <table className="tbl">
              <thead>
                <tr>
                  <th className="tbl-checkbox">
                    <input type="checkbox" checked={files.length > 0 && selected.size === files.length} onChange={toggleSelectAll}/>
                  </th>
                  <th>File</th>
                  <th>Vehicle</th>
                  <th>Year</th>
                  <th>Status</th>
                  <th>Pipeline</th>
                  <th>Downloads</th>
                  <th>Updated</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {files.map((file) => {
                  const next = NEXT_STAGE[file.current_stage];
                  const uploads = file.uploads || [];
                  const byStage = file.artifacts_by_stage || {};
                  const status = file.status || (file.is_invalid ? 'invalid' : 'active');
                  const invalid = status === 'invalid';
                  const dimmed = invalid || status === 'blocked';
                  const canReupload = !invalid && status === 'active' && user?.role && STAGE_ROLES[file.current_stage]?.includes(user.role);
                  const stages = STAGES.map((s) => (byStage[s]?.length > 0 ? 1 : 0));
                  const statusLabel = status === 'completed' ? 'Complete'
                    : status === 'invalid' ? 'Disqualified'
                    : status === 'blocked' ? 'Callback'
                    : STAGE_META[file.current_stage]?.label || 'Active';

                  return (
                    <tr key={file.id} onClick={() => setDetailId(file.id)} style={dimmed ? { opacity: 0.6 } : undefined}>
                      <td className="tbl-checkbox" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={selected.has(file.id)} onChange={() => toggleSelect(file.id)}/>
                      </td>
                      <td>
                        <div className="row" style={{ flexWrap: 'wrap', gap: 6 }}>
                          <Icon name="file" size={14} style={{ color: 'var(--text-2)' }}/>
                          <span className="cell-strong">{file.display_name || file.file_name}</span>
                          {file.version && <span className="status-badge sb-neutral">{file.version}</span>}
                          {invalid && <span className="status-badge sb-danger">invalid</span>}
                          {file.is_invalid && !invalid && <span className="status-badge sb-warn">flagged</span>}
                          {/* Import-state pill. Two signals here:
                               - "Ready to import" = at TLO with a spreadsheet
                                  but no batch yet → click the row to open
                                  the file drawer and finish the import.
                               - "N leads" = batches exist; the data made
                                  it into the CRM. */}
                          {file.ready_to_import && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setImportFile(file); }}
                              className="status-badge sb-warn"
                              title="The TLO spreadsheet has been uploaded but the leads were never pushed into the CRM. Click to finish the import."
                              style={{ cursor: 'pointer', border: 'none' }}
                            >
                              Ready to import → click to push to CRM
                            </button>
                          )}
                          {!file.ready_to_import && file.lead_count > 0 && (
                            <span className="status-badge sb-success" title={`Imported ${file.lead_count} leads across ${file.lead_batch_count} batch${file.lead_batch_count === 1 ? '' : 'es'}`}>
                              {file.lead_count.toLocaleString()} leads
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="cell-muted">{file.vehicle?.name || file.vehicle_name || '—'}</td>
                      <td className="cell-muted">{file.year || '—'}</td>
                      <td><StatusBadge status={statusLabel}/></td>
                      <td><StageDots stages={stages}/></td>
                      <td>
                        <div className="row" style={{ gap: 4 }}>
                          {uploads.length > 0 ? uploads.map((u) => (
                            <a
                              key={u.stage}
                              href={getDownloadUrl(file.id, u.stage)}
                              className="dl-chip"
                              onClick={(e) => e.stopPropagation()}
                              title={`Download latest ${u.stage}`}
                            >
                              <Icon name="download" size={11}/>
                              {u.stage.slice(0, 3)}
                            </a>
                          )) : <span className="cell-muted">—</span>}
                        </div>
                      </td>
                      <td className="cell-muted">{(file.updated_at || file.created_at || '').slice(0, 10)}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <ActionDropdown
                          file={file}
                          invalid={invalid}
                          next={next}
                          canReupload={canReupload}
                          onView={() => setDetailId(file.id)}
                          onMove={() => handleStageChange(file.id, next, file.display_name || file.file_name)}
                          onReupload={() => handleReupload(file)}
                          onEdit={() => setEditModal({ id: file.id, file_name: file.display_name || file.file_name, year: file.year || '', version: file.version || '' })}
                          onDelete={() => handleDelete(file.id, file.display_name || file.file_name)}
                          onNotify={() => openNotify(file.display_name || file.file_name, file.current_stage)}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="tbl-pagination">
              <span>{files.length} of {files.length} files</span>
              <span></span>
            </div>
          </>
        )}
      </div>

      <VVModal
        open={showModal}
        onClose={() => { if (!submitting) { setShowModal(false); setEntries([makeEmptyEntry()]); setError(''); } }}
        title={entries.length > 1 ? `Add ${entries.length} files` : 'Add New File'}
      >
        <form onSubmit={handleAddFile} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Datalists feed the Make / Model / Trim inputs above. We
              dedupe against the existing vehicles list — operators can
              still type a brand-new value if they're hunting something
              not yet in the catalog. */}
          <datalist id="dash-makes">
            {[...new Set(vehicles.map((v) => v.make).filter(Boolean))].sort().map((m) => <option key={m} value={m} />)}
          </datalist>
          <datalist id="dash-models">
            {[...new Set(vehicles.map((v) => v.model).filter(Boolean))].sort().map((m) => <option key={m} value={m} />)}
          </datalist>
          <datalist id="dash-trims">
            {[...new Set(vehicles.map((v) => v.trim).filter(Boolean))].sort().map((t) => <option key={t} value={t} />)}
          </datalist>

          <div className="row" style={{ justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
            <p style={{ fontSize: 12, color: 'var(--text-2)', margin: 0 }}>
              Each row becomes one file. Pick multiple at once to fill rows in bulk.
            </p>
            <label
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                fontSize: 12, fontWeight: 500, color: 'var(--text-1)',
                cursor: 'pointer', padding: '6px 10px',
                border: '1px solid var(--border-1)', borderRadius: 8, background: 'var(--bg-1)',
              }}
            >
              <Icon name="upload" size={13}/> Pick multiple files
              <input
                type="file"
                multiple
                onChange={(e) => { handlePickMultiple(e.target.files); e.target.value = ''; }}
                style={{ display: 'none' }}
              />
            </label>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: '52vh', overflowY: 'auto' }}>
            {entries.map((entry, idx) => {
              const isError   = entry.status === 'error';
              const isSuccess = entry.status === 'success';
              const isUploading = entry.status === 'uploading';
              const borderColor = isError ? 'var(--danger)' : isSuccess ? 'var(--success)' : 'var(--border-1)';
              const bgColor     = isError ? 'rgba(239, 68, 68, 0.04)'
                                : isSuccess ? 'rgba(16, 185, 129, 0.04)'
                                : 'var(--bg-1)';
              return (
                <div
                  key={entry.rid}
                  style={{
                    border: `1px solid ${borderColor}`,
                    borderRadius: 10,
                    padding: 12,
                    background: bgColor,
                    display: 'flex', flexDirection: 'column', gap: 10,
                  }}
                >
                  <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.5, color: 'var(--text-3)', textTransform: 'uppercase' }}>
                        File {idx + 1}
                      </span>
                      {isUploading && <span style={{ fontSize: 11, color: 'var(--info)' }}>Uploading…</span>}
                      {isSuccess   && <span style={{ fontSize: 11, color: 'var(--success)', fontWeight: 600 }}>✓ Added</span>}
                      {isError     && <span style={{ fontSize: 11, color: 'var(--danger)', fontWeight: 600 }}>× {entry.error || 'Failed'}</span>}
                    </div>
                    {entries.length > 1 && !submitting && (
                      <button
                        type="button"
                        onClick={() => removeEntry(entry.rid)}
                        title="Remove this row"
                        style={{
                          background: 'transparent', border: 'none', cursor: 'pointer',
                          color: 'var(--text-3)', padding: 4, display: 'flex',
                        }}
                      >
                        <Icon name="x" size={14}/>
                      </button>
                    )}
                  </div>

                  {/* Vehicle facets — server resolves these to an
                      existing vehicle row or inserts a new one. The
                      datalists offer recently-imported makes/models/
                      trims as soft autocomplete, but free text is fine
                      so the operator can hunt a brand-new vehicle. */}
                  <div className="grid-2">
                    <div>
                      <label className="field-label">Make</label>
                      <Input
                        list="dash-makes"
                        value={entry.make}
                        onChange={(e) => updateEntry(entry.rid, { make: e.target.value, status: 'pending', error: null })}
                        disabled={isUploading || isSuccess}
                        placeholder="DODGE"
                        required
                      />
                    </div>
                    <div>
                      <label className="field-label">Model</label>
                      <Input
                        list="dash-models"
                        value={entry.model}
                        onChange={(e) => updateEntry(entry.rid, { model: e.target.value, status: 'pending', error: null })}
                        disabled={isUploading || isSuccess}
                        placeholder="Viper"
                        required
                      />
                    </div>
                  </div>

                  <div className="grid-2">
                    <div>
                      <label className="field-label">Year</label>
                      <Input
                        type="number"
                        value={entry.year}
                        onChange={(e) => updateEntry(entry.rid, { year: e.target.value, status: 'pending', error: null })}
                        disabled={isUploading || isSuccess}
                        placeholder="2008"
                        required
                      />
                    </div>
                    <div>
                      <label className="field-label">Trim</label>
                      <Input
                        list="dash-trims"
                        value={entry.trim}
                        onChange={(e) => updateEntry(entry.rid, { trim: e.target.value, status: 'pending', error: null })}
                        disabled={isUploading || isSuccess}
                        placeholder="SRT (optional)"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="field-label">File Name <span style={{ color: 'var(--text-3)', fontWeight: 400 }}>(auto if blank)</span></label>
                    <Input
                      value={entry.file_name}
                      onChange={(e) => updateEntry(entry.rid, { file_name: e.target.value, status: 'pending', error: null })}
                      disabled={isUploading || isSuccess}
                      placeholder="Auto: <Make><Model>_<Year>_<Version>"
                    />
                  </div>

                  <div>
                    <label className="field-label">Version</label>
                    <Input
                      value={entry.version}
                      onChange={(e) => updateEntry(entry.rid, { version: e.target.value })}
                      disabled={isUploading || isSuccess}
                      placeholder="v1"
                    />
                  </div>

                  <div>
                    <label className="field-label">Upload File</label>
                    <div style={{
                      border: '2px dashed var(--border-1)',
                      borderRadius: 10,
                      padding: 12,
                      textAlign: 'center',
                      cursor: (isUploading || isSuccess) ? 'default' : 'pointer',
                      background: 'var(--bg-2)',
                      opacity: (isUploading || isSuccess) ? 0.7 : 1,
                    }}>
                      <input
                        type="file"
                        id={`af-${entry.rid}`}
                        onChange={(e) => {
                          const f = e.target.files[0] || null;
                          updateEntry(entry.rid, {
                            file: f,
                            file_name: entry.file_name || (f ? f.name.replace(/\.[^/.]+$/, '') : ''),
                            status: 'pending',
                            error: null,
                          });
                        }}
                        disabled={isUploading || isSuccess}
                        style={{ display: 'none' }}
                      />
                      <label
                        htmlFor={`af-${entry.rid}`}
                        style={{ cursor: (isUploading || isSuccess) ? 'default' : 'pointer', color: 'var(--text-2)', fontSize: 13 }}
                      >
                        <Icon name="upload" size={22} style={{ display: 'block', margin: '0 auto 4px', color: 'var(--text-3)' }}/>
                        {entry.file ? entry.file.name : 'Click to upload or drag and drop'}
                      </label>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="row" style={{ justifyContent: 'space-between', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={addEntry}
              disabled={submitting}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                background: 'transparent', border: '1px dashed var(--border-1)',
                color: 'var(--text-1)', padding: '8px 12px',
                borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 500,
              }}
            >
              <Icon name="plus" size={13}/> Add another file
            </button>

            {entries.some((e) => e.status === 'success') && (
              <button
                type="button"
                onClick={clearSucceeded}
                disabled={submitting}
                style={{
                  background: 'transparent', border: 'none', color: 'var(--text-2)',
                  fontSize: 12, cursor: 'pointer', textDecoration: 'underline',
                }}
              >
                Clear completed rows
              </button>
            )}
          </div>

          <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 6 }}>
            <Button
              variant="ghost"
              onClick={() => { if (!submitting) { setShowModal(false); setEntries([makeEmptyEntry()]); setError(''); } }}
              disabled={submitting}
            >
              {entries.some((e) => e.status === 'success') ? 'Done' : 'Cancel'}
            </Button>
            <Button variant="primary" type="submit" disabled={submitting || entries.every((e) => e.status === 'success')}>
              {submitting ? 'Uploading…' : entries.length > 1 ? `Add ${entries.filter((e) => e.status !== 'success').length} files` : 'Add File'}
            </Button>
          </div>
        </form>
      </VVModal>

      <VVModal open={!!editModal} onClose={() => setEditModal(null)} title="Edit File">
        {editModal && (
          <form onSubmit={handleEdit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label className="field-label">File Name</label>
              <Input value={editModal.file_name} onChange={(e) => setEditModal({ ...editModal, file_name: e.target.value })} required/>
            </div>
            <div className="grid-2">
              <div>
                <label className="field-label">Year</label>
                <Input type="number" value={editModal.year} onChange={(e) => setEditModal({ ...editModal, year: e.target.value })}/>
              </div>
              <div>
                <label className="field-label">Version</label>
                <Input value={editModal.version} onChange={(e) => setEditModal({ ...editModal, version: e.target.value })}/>
              </div>
            </div>
            <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
              <Button variant="ghost" onClick={() => setEditModal(null)}>Cancel</Button>
              <Button variant="primary" type="submit">Save</Button>
            </div>
          </form>
        )}
      </VVModal>

      <VVModal
        open={!!stageModal}
        onClose={() => { setStageModal(null); setStageFile(null); setStageNotes(''); }}
        title={stageModal ? (stageModal.mode === 'reupload' ? `Re-upload ${STAGE_META[stageModal.stage]?.label}` : `Move to ${STAGE_META[stageModal.stage]?.label}`) : ''}
      >
        {stageModal && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="card" style={{ background: 'var(--bg-2)', padding: 12 }}>
              <p style={{ fontSize: 13 }}>
                {stageModal.mode === 'reupload' ? (
                  <>Re-upload a new version of <strong>{stageModal.stage}</strong> for "<strong>{stageModal.fileName}</strong>". Previous uploads are preserved.</>
                ) : (
                  <>Upload the <strong>{stageModal.stage}</strong> file for "<strong>{stageModal.fileName}</strong>".</>
                )}
              </p>
            </div>
            <div>
              <label className="field-label">File (required)</label>
              <div style={{
                border: `2px dashed ${stageFile ? 'var(--success)' : 'var(--border-1)'}`,
                background: stageFile ? 'var(--success-bg)' : 'var(--bg-2)',
                borderRadius: 10, padding: 16, textAlign: 'center', cursor: 'pointer',
              }}>
                <input type="file" id="stage-file-input" onChange={(e) => setStageFile(e.target.files[0] || null)} style={{ display: 'none' }}/>
                <label htmlFor="stage-file-input" style={{ cursor: 'pointer', fontSize: 13, color: stageFile ? 'var(--success)' : 'var(--text-2)' }}>
                  {stageFile ? stageFile.name : 'Click to select file'}
                </label>
              </div>
            </div>
            {stageModal.mode === 'advance' && (
              <div>
                <label className="field-label">Notes (optional)</label>
                <Input value={stageNotes} onChange={(e) => setStageNotes(e.target.value)}/>
              </div>
            )}
            <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
              <Button variant="ghost" onClick={() => { setStageModal(null); setStageFile(null); setStageNotes(''); }}>Cancel</Button>
              <Button variant="primary" disabled={uploading || !stageFile} onClick={handleStageSubmit}>
                {uploading ? 'Uploading…' : stageModal.mode === 'reupload' ? 'Upload new version' : 'Upload & Move'}
              </Button>
            </div>
          </div>
        )}
      </VVModal>

      <FileDetailDrawer
        file={detailId ? files.find((f) => f.id === detailId) : null}
        onClose={() => setDetailId(null)}
        onReupload={handleReupload}
        onImport={(f) => setImportFile(f)}
        onArtifactDeleted={() => { setDetailId(null); fetchFiles(); }}
      />

      <ImportFinalFileModal
        file={importFile}
        onClose={() => setImportFile(null)}
        onImported={() => { setImportFile(null); fetchFiles(); }}
      />

      <VVModal open={!!notifyModal} onClose={() => setNotifyModal(null)} title="Notify via WhatsApp" width={420}>
        {notifyModal && (
          <div>
            <div className="card" style={{ marginBottom: 12, padding: 12, background: 'var(--success-bg)', color: 'var(--success)', borderColor: 'transparent' }}>
              <p style={{ fontSize: 13 }}>"<strong>{notifyModal.fileName}</strong>" is ready for <strong>{notifyModal.nextStage}</strong></p>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 280, overflowY: 'auto' }}>
              {teamMembers.length === 0 ? (
                <p className="cell-muted" style={{ textAlign: 'center', padding: 24 }}>No team members with phone numbers</p>
              ) : teamMembers.map((m) => (
                <button
                  key={m.id}
                  onClick={() => sendWhatsApp(m.phone, notifyModal.fileName, notifyModal.nextStage)}
                  className="dd-item"
                  style={{ padding: '10px 12px' }}
                >
                  <div className="row">
                    <span className="avatar" style={{ width: 28, height: 28, fontSize: 12, background: '#16794a' }}>{m.name.charAt(0)}</span>
                    <div>
                      <div className="cell-strong">{m.name}</div>
                      <div className="cell-muted" style={{ fontSize: 11 }}>{m.role} · {m.phone}</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
            <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
              <Button variant="ghost" onClick={() => setNotifyModal(null)}>Skip</Button>
            </div>
          </div>
        )}
      </VVModal>
      </>
      )}
    </div>
  );
}

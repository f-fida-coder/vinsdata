import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api, { uploadFile, getDownloadUrl } from '../api';

const STAGES = ['generated', 'carfax', 'filter', 'tlo'];

const STAGE_META = {
  generated: { color: 'blue', icon: '1', label: 'Generated' },
  carfax: { color: 'amber', icon: '2', label: 'Carfax' },
  filter: { color: 'orange', icon: '3', label: 'Filter' },
  tlo: { color: 'emerald', icon: '4', label: 'TLO' },
};

const NEXT_STAGE = { generated: 'carfax', carfax: 'filter', filter: 'tlo' };

// --- Reusable UI Components ---

function Modal({ open, onClose, title, width = 'max-w-md', children }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-gray-900/60 backdrop-blur-sm" />
      <div className={`relative bg-white rounded-2xl shadow-2xl w-full ${width} animate-[fadeIn_0.2s]`} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">&times;</button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

function StatCard({ label, count, color, icon }) {
  const colors = {
    blue: 'from-blue-500 to-blue-600 shadow-blue-500/20',
    amber: 'from-amber-500 to-amber-600 shadow-amber-500/20',
    orange: 'from-orange-500 to-orange-600 shadow-orange-500/20',
    emerald: 'from-emerald-500 to-emerald-600 shadow-emerald-500/20',
    red: 'from-red-500 to-red-600 shadow-red-500/20',
  };
  const bgColors = {
    blue: 'bg-blue-50 text-blue-700 border-blue-100',
    amber: 'bg-amber-50 text-amber-700 border-amber-100',
    orange: 'bg-orange-50 text-orange-700 border-orange-100',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    red: 'bg-red-50 text-red-700 border-red-100',
  };
  return (
    <div className={`bg-white rounded-2xl p-5 border ${bgColors[color].split(' ')[2]} shadow-sm hover:shadow-md transition-shadow`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">{label}</p>
          <p className="text-3xl font-bold mt-1 text-gray-900">{count}</p>
        </div>
        <div className={`w-11 h-11 rounded-xl bg-gradient-to-br ${colors[color]} shadow-lg flex items-center justify-center text-white text-sm font-bold`}>
          {icon}
        </div>
      </div>
    </div>
  );
}

function StagePipeline({ stages, uploads, currentStage, invalid }) {
  return (
    <div className="flex items-center">
      {stages.map((s, i) => {
        const upload = uploads.find((u) => u.stage === s);
        const status = upload?.status;
        const isCurrent = currentStage === s;
        let dotClass, ringClass;
        if (invalid) {
          dotClass = 'bg-red-200'; ringClass = 'ring-red-100';
        } else if (status === 'confirmed') {
          dotClass = 'bg-emerald-500'; ringClass = 'ring-emerald-100';
        } else if (status === 'pending') {
          dotClass = 'bg-amber-400 animate-pulse'; ringClass = 'ring-amber-100';
        } else if (isCurrent) {
          dotClass = 'bg-blue-400'; ringClass = 'ring-blue-100';
        } else {
          dotClass = 'bg-gray-200'; ringClass = 'ring-gray-50';
        }
        const tooltip = status === 'confirmed' ? 'Confirmed' : status === 'pending' ? 'Pending Review' : isCurrent ? 'Current' : 'Waiting';
        return (
          <div key={s} className="flex items-center">
            <div className="relative group">
              <div className={`w-4 h-4 rounded-full ${dotClass} ring-4 ${ringClass} transition-all`} />
              <div className="absolute -top-8 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-[10px] px-2 py-1 rounded-md opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
                {STAGE_META[s].label}: {tooltip}
              </div>
            </div>
            {i < stages.length - 1 && (
              <div className={`w-5 h-0.5 ${status === 'confirmed' && !invalid ? 'bg-emerald-300' : 'bg-gray-200'}`} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function ActionDropdown({ file, onMove, onEdit, onDelete, onNotify, invalid, next }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handleClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
      >
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 16 16"><circle cx="8" cy="3" r="1.5" /><circle cx="8" cy="8" r="1.5" /><circle cx="8" cy="13" r="1.5" /></svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-44 bg-white rounded-xl shadow-xl border border-gray-100 py-1.5 z-30">
          {!invalid && next && (
            <button onClick={() => { setOpen(false); onMove(); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-700 transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>
              Move to {next}
            </button>
          )}
          <button onClick={() => { setOpen(false); onEdit(); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
            Edit details
          </button>
          <button onClick={() => { setOpen(false); onNotify(); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-green-700 hover:bg-green-50 transition-colors">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" /></svg>
            Notify via WhatsApp
          </button>
          <div className="my-1 border-t border-gray-100" />
          <button onClick={() => { setOpen(false); onDelete(); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

// --- Main Component ---

export default function DashboardPage() {
  const navigate = useNavigate();
  const [files, setFiles] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [filters, setFilters] = useState({ vehicle_id: '', stage: '', year: '' });
  const [showModal, setShowModal] = useState(false);
  const [newFile, setNewFile] = useState({ vehicle_id: '', file_name: '', year: '', version: '' });
  const [selectedFile, setSelectedFile] = useState(null);
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

  const stageCounts = STAGES.reduce((acc, s) => { acc[s] = files.filter((f) => f.current_stage === s && !f.is_invalid).length; return acc; }, {});
  const invalidCount = files.filter((f) => f.is_invalid).length;
  const totalFiles = files.length;

  const toggleSelect = (id) => setSelected((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleSelectAll = () => setSelected(selected.size === files.length ? new Set() : new Set(files.map((f) => f.id)));

  const handleBulkInvalid = async (markInvalid) => {
    if (selected.size === 0) return;
    if (!window.confirm(`${markInvalid ? 'Mark' : 'Unmark'} ${selected.size} file(s) as invalid?`)) return;
    try { await api.patch('/files', { ids: Array.from(selected), is_invalid: markInvalid }); fetchFiles(); }
    catch { setError('Failed to update files'); }
  };

  const handleBulkDelete = async () => {
    if (!window.confirm(`Delete ${selected.size} file(s)? This cannot be undone.`)) return;
    try { for (const id of selected) await api.delete('/files', { data: { id } }); fetchFiles(); }
    catch { setError('Failed to delete files'); }
  };

  const handleStageChange = (fileId, stage, fileName) => { setStageModal({ fileId, stage, fileName }); setStageFile(null); setStageNotes(''); };

  const handleStageSubmit = async () => {
    if (!stageModal || !stageFile) { setError('You must upload a file to move to the next stage'); return; }
    setUploading(true); setError('');
    try {
      await api.put('/files', { id: stageModal.fileId, stage: stageModal.stage, notes: stageNotes || '' });
      await uploadFile(stageModal.fileId, stageModal.stage, stageFile);
      setStageModal(null); setStageFile(null); setStageNotes(''); fetchFiles();
    } catch { setError('Failed to update stage'); }
    finally { setUploading(false); }
  };

  const handleAddFile = async (e) => {
    e.preventDefault(); setSubmitting(true); setError('');
    try {
      const res = await api.post('/files', { vehicle_id: Number(newFile.vehicle_id), file_name: newFile.file_name, year: newFile.year ? Number(newFile.year) : null, version: newFile.version || null });
      if (selectedFile && res.data.id) await uploadFile(res.data.id, 'generated', selectedFile);
      setShowModal(false); setNewFile({ vehicle_id: '', file_name: '', year: '', version: '' }); setSelectedFile(null); fetchFiles();
    } catch { setError('Failed to add file'); }
    finally { setSubmitting(false); }
  };

  const handleDelete = async (fileId, fileName) => {
    if (!window.confirm(`Delete "${fileName}"?`)) return;
    try { await api.delete('/files', { data: { id: fileId } }); fetchFiles(); }
    catch { setError('Failed to delete file'); }
  };

  const handleEdit = async (e) => {
    e.preventDefault();
    try { await api.patch('/files', { id: editModal.id, file_name: editModal.file_name, year: editModal.year, version: editModal.version }); setEditModal(null); fetchFiles(); }
    catch { setError('Failed to update file'); }
  };

  const handleConfirm = async (fileId, stage, fileName) => {
    try {
      await api.patch('/upload', { file_id: fileId, stage, status: 'confirmed' }); fetchFiles();
      const nextStage = NEXT_STAGE[stage];
      if (nextStage) {
        try { const res = await api.get('/users'); setTeamMembers(res.data.filter((u) => u.phone)); } catch {}
        setNotifyModal({ fileName, stage, nextStage });
      }
    } catch { setError('Failed to confirm upload'); }
  };

  const openNotify = async (fileName, currentStage) => {
    try {
      const res = await api.get('/users');
      setTeamMembers(res.data.filter((u) => u.phone));
    } catch {}
    const nextStage = NEXT_STAGE[currentStage] || 'next';
    setNotifyModal({ fileName, stage: currentStage, nextStage });
  };

  const sendWhatsApp = (phone, fileName, nextStage) => {
    const msg = `Hi! The file "*${fileName}*" has been confirmed and is ready for the *${nextStage}* stage. Please start working on it.`;
    window.open(`https://wa.me/${phone.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(msg)}`, '_blank');
    setNotifyModal(null);
  };

  const hasFilters = filters.vehicle_id || filters.stage || filters.year;

  return (
    <div className="max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Dashboard</h1>
          <p className="text-sm text-gray-500 mt-0.5">{totalFiles} total files across all stages</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="inline-flex items-center gap-2 bg-gradient-to-r from-blue-600 to-blue-500 text-white px-5 py-2.5 rounded-xl text-sm font-medium shadow-lg shadow-blue-500/25 hover:shadow-xl hover:shadow-blue-500/30 hover:-translate-y-0.5 transition-all duration-200"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
          Add File
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-100 text-red-600 px-4 py-3 rounded-xl mb-6 flex items-center justify-between animate-[fadeIn_0.2s]">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" /></svg>
            {error}
          </div>
          <button onClick={() => setError('')} className="text-red-400 hover:text-red-600 p-1">&times;</button>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
        {STAGES.map((s) => (
          <StatCard key={s} label={STAGE_META[s].label} count={stageCounts[s]} color={STAGE_META[s].color === 'amber' ? 'amber' : STAGE_META[s].color === 'orange' ? 'orange' : STAGE_META[s].color === 'emerald' ? 'emerald' : 'blue'} icon={STAGE_META[s].icon} />
        ))}
        <StatCard label="Invalid" count={invalidCount} color="red" icon="!" />
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-gray-100 p-4 mb-6 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex items-center gap-2 text-gray-400 mr-1">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" /></svg>
            <span className="text-xs font-semibold uppercase tracking-wider">Filters</span>
          </div>
          <select value={filters.vehicle_id} onChange={(e) => setFilters({ ...filters, vehicle_id: e.target.value })} className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none">
            <option value="">All Vehicles</option>
            {vehicles.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
          <select value={filters.stage} onChange={(e) => setFilters({ ...filters, stage: e.target.value })} className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none">
            <option value="">All Stages</option>
            {STAGES.map((s) => <option key={s} value={s}>{STAGE_META[s].label}</option>)}
          </select>
          <input type="number" value={filters.year} onChange={(e) => setFilters({ ...filters, year: e.target.value })} placeholder="Year" className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm w-24 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" />
          {hasFilters && (
            <button onClick={() => setFilters({ vehicle_id: '', stage: '', year: '' })} className="text-xs text-blue-600 hover:text-blue-800 font-medium px-2 py-2">
              Clear all
            </button>
          )}
        </div>
      </div>

      {/* Bulk Actions */}
      {selected.size > 0 && (
        <div className="bg-blue-50 border border-blue-100 rounded-2xl px-5 py-3 mb-4 flex flex-wrap items-center gap-3 animate-[fadeIn_0.2s]">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-md bg-blue-600 text-white flex items-center justify-center text-xs font-bold">{selected.size}</div>
            <span className="text-sm font-medium text-blue-800">selected</span>
          </div>
          <div className="h-5 w-px bg-blue-200" />
          <button onClick={() => handleBulkInvalid(true)} className="inline-flex items-center gap-1.5 text-xs font-medium bg-white border border-red-200 text-red-600 px-3 py-1.5 rounded-lg hover:bg-red-50 transition-colors">Mark Invalid</button>
          <button onClick={() => handleBulkInvalid(false)} className="inline-flex items-center gap-1.5 text-xs font-medium bg-white border border-emerald-200 text-emerald-600 px-3 py-1.5 rounded-lg hover:bg-emerald-50 transition-colors">Mark Valid</button>
          <button onClick={handleBulkDelete} className="inline-flex items-center gap-1.5 text-xs font-medium bg-white border border-red-200 text-red-600 px-3 py-1.5 rounded-lg hover:bg-red-50 transition-colors">Delete</button>
          <button onClick={() => setSelected(new Set())} className="text-xs text-blue-500 hover:text-blue-700 ml-auto">Deselect all</button>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20">
            <div className="w-10 h-10 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin"></div>
            <p className="text-sm text-gray-400 mt-3">Loading files...</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="pl-5 pr-2 py-4 w-10">
                    <input type="checkbox" checked={files.length > 0 && selected.size === files.length} onChange={toggleSelectAll} className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                  </th>
                  <th className="px-4 py-4 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">File</th>
                  <th className="px-4 py-4 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Vehicle</th>
                  <th className="px-4 py-4 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Year</th>
                  <th className="px-4 py-4 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-4 py-4 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Pipeline</th>
                  <th className="px-4 py-4 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Downloads</th>
                  <th className="px-4 py-4 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Updated</th>
                  <th className="px-4 py-4 w-12"></th>
                </tr>
              </thead>
              <tbody>
                {files.length === 0 ? (
                  <tr>
                    <td colSpan="9" className="py-16 text-center">
                      <div className="flex flex-col items-center">
                        <svg className="w-12 h-12 text-gray-200 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
                        <p className="text-sm text-gray-400">No files found</p>
                        <button onClick={() => setShowModal(true)} className="text-sm text-blue-600 hover:text-blue-700 font-medium mt-1">Add your first file</button>
                      </div>
                    </td>
                  </tr>
                ) : files.map((file) => {
                  const next = NEXT_STAGE[file.current_stage];
                  const uploads = file.uploads || [];
                  const invalid = !!file.is_invalid;
                  return (
                    <tr key={file.id} className={`border-b border-gray-50 hover:bg-gray-50/50 transition-colors ${invalid ? 'opacity-50' : ''}`}>
                      <td className="pl-5 pr-2 py-3.5">
                        <input type="checkbox" checked={selected.has(file.id)} onChange={() => toggleSelect(file.id)} className="rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                      </td>
                      <td className="px-4 py-3.5">
                        <button onClick={() => navigate(`/logs?file_id=${file.id}&name=${encodeURIComponent(file.file_name)}`)} className={`text-sm font-medium hover:underline ${invalid ? 'text-gray-400 line-through' : 'text-gray-900 hover:text-blue-600'}`}>
                          {file.file_name}
                        </button>
                        {file.version && <span className="ml-2 text-[10px] font-medium text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">{file.version}</span>}
                      </td>
                      <td className="px-4 py-3.5 text-sm text-gray-600">{file.vehicle_name}</td>
                      <td className="px-4 py-3.5 text-sm text-gray-600">{file.year || '—'}</td>
                      <td className="px-4 py-3.5">
                        {invalid ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-red-50 text-red-600 border border-red-100">
                            <span className="w-1.5 h-1.5 rounded-full bg-red-500"></span> Invalid
                          </span>
                        ) : next ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-blue-50 text-blue-600 border border-blue-100">
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span> {STAGE_META[file.current_stage].label}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-50 text-emerald-600 border border-emerald-100">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> Complete
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3.5">
                        <StagePipeline stages={STAGES} uploads={uploads} currentStage={file.current_stage} invalid={invalid} />
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex flex-wrap gap-1">
                          {uploads.length > 0 ? uploads.map((u) => (
                            <div key={u.stage} className="flex items-center gap-0.5">
                              <a href={getDownloadUrl(file.id, u.stage)} className="inline-flex items-center gap-1 text-[11px] font-medium bg-gray-50 hover:bg-gray-100 text-gray-600 px-2 py-1 rounded-md border border-gray-200 transition-colors" title={`Download ${u.stage}`}>
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                                {u.stage.slice(0, 3)}
                              </a>
                              {u.status === 'pending' ? (
                                <button onClick={() => handleConfirm(file.id, u.stage, file.file_name)} className="w-5 h-5 flex items-center justify-center rounded-md bg-amber-50 hover:bg-amber-100 text-amber-600 border border-amber-200 transition-colors" title="Confirm">
                                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                                </button>
                              ) : (
                                <span className="w-5 h-5 flex items-center justify-center rounded-md bg-emerald-50 text-emerald-500">
                                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                                </span>
                              )}
                            </div>
                          )) : <span className="text-xs text-gray-300">—</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-xs text-gray-400">{(file.updated_at || file.created_at || '').slice(0, 10)}</td>
                      <td className="pr-4 py-3.5">
                        <ActionDropdown file={file} invalid={invalid} next={next} onMove={() => handleStageChange(file.id, next, file.file_name)} onEdit={() => setEditModal({ id: file.id, file_name: file.file_name, year: file.year || '', version: file.version || '' })} onDelete={() => handleDelete(file.id, file.file_name)} onNotify={() => openNotify(file.file_name, file.current_stage)} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* --- Modals --- */}

      <Modal open={showModal} onClose={() => { setShowModal(false); setSelectedFile(null); }} title="Add New File">
        <form onSubmit={handleAddFile} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Vehicle</label>
            <select value={newFile.vehicle_id} onChange={(e) => setNewFile({ ...newFile, vehicle_id: e.target.value })} required className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none">
              <option value="">Select vehicle</option>
              {vehicles.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">File Name</label>
            <input type="text" value={newFile.file_name} onChange={(e) => setNewFile({ ...newFile, file_name: e.target.value })} required placeholder="LandCruiser_2003_VIN_v1" className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Year</label>
              <input type="number" value={newFile.year} onChange={(e) => setNewFile({ ...newFile, year: e.target.value })} placeholder="2003" className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Version</label>
              <input type="text" value={newFile.version} onChange={(e) => setNewFile({ ...newFile, version: e.target.value })} placeholder="v1" className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Upload File</label>
            <div className="border-2 border-dashed border-gray-200 rounded-xl p-4 text-center hover:border-blue-300 transition-colors cursor-pointer">
              <input type="file" onChange={(e) => { const f = e.target.files[0] || null; setSelectedFile(f); if (f) setNewFile((p) => ({ ...p, file_name: p.file_name || f.name.replace(/\.[^/.]+$/, '') })); }} className="hidden" id="add-file-input" />
              <label htmlFor="add-file-input" className="cursor-pointer">
                <svg className="w-8 h-8 text-gray-300 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>
                <p className="text-sm text-gray-500">{selectedFile ? selectedFile.name : 'Click to upload or drag and drop'}</p>
              </label>
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => { setShowModal(false); setSelectedFile(null); }} className="px-4 py-2.5 text-sm font-medium text-gray-600 bg-gray-50 rounded-xl hover:bg-gray-100 transition-colors">Cancel</button>
            <button type="submit" disabled={submitting} className="px-5 py-2.5 text-sm font-medium bg-gradient-to-r from-blue-600 to-blue-500 text-white rounded-xl shadow-lg shadow-blue-500/25 hover:shadow-xl disabled:opacity-50 transition-all">{submitting ? 'Adding...' : 'Add File'}</button>
          </div>
        </form>
      </Modal>

      <Modal open={!!editModal} onClose={() => setEditModal(null)} title="Edit File" width="max-w-sm">
        {editModal && (
          <form onSubmit={handleEdit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">File Name</label>
              <input type="text" value={editModal.file_name} onChange={(e) => setEditModal({ ...editModal, file_name: e.target.value })} required className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Year</label>
                <input type="number" value={editModal.year} onChange={(e) => setEditModal({ ...editModal, year: e.target.value })} className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Version</label>
                <input type="text" value={editModal.version} onChange={(e) => setEditModal({ ...editModal, version: e.target.value })} className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" />
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setEditModal(null)} className="px-4 py-2.5 text-sm font-medium text-gray-600 bg-gray-50 rounded-xl hover:bg-gray-100 transition-colors">Cancel</button>
              <button type="submit" className="px-5 py-2.5 text-sm font-medium bg-gradient-to-r from-blue-600 to-blue-500 text-white rounded-xl shadow-lg shadow-blue-500/25 transition-all">Save</button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={!!stageModal} onClose={() => { setStageModal(null); setStageFile(null); setStageNotes(''); }} title={stageModal ? `Move to ${STAGE_META[stageModal.stage]?.label}` : ''}>
        {stageModal && (
          <div className="space-y-4">
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-3">
              <p className="text-sm text-blue-800">Upload the <strong>{stageModal.stage}</strong> file for "<strong>{stageModal.fileName}</strong>"</p>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">File (required)</label>
              <div className={`border-2 border-dashed rounded-xl p-4 text-center transition-colors cursor-pointer ${stageFile ? 'border-emerald-300 bg-emerald-50' : 'border-gray-200 hover:border-blue-300'}`}>
                <input type="file" onChange={(e) => setStageFile(e.target.files[0] || null)} className="hidden" id="stage-file-input" />
                <label htmlFor="stage-file-input" className="cursor-pointer">
                  {stageFile ? (
                    <p className="text-sm text-emerald-700 font-medium">{stageFile.name}</p>
                  ) : (
                    <p className="text-sm text-gray-500">Click to select file</p>
                  )}
                </label>
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Notes (optional)</label>
              <input type="text" value={stageNotes} onChange={(e) => setStageNotes(e.target.value)} placeholder="Any notes..." className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none" />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button onClick={() => { setStageModal(null); setStageFile(null); setStageNotes(''); }} className="px-4 py-2.5 text-sm font-medium text-gray-600 bg-gray-50 rounded-xl hover:bg-gray-100 transition-colors">Cancel</button>
              <button onClick={handleStageSubmit} disabled={uploading || !stageFile} className="px-5 py-2.5 text-sm font-medium bg-gradient-to-r from-blue-600 to-blue-500 text-white rounded-xl shadow-lg shadow-blue-500/25 disabled:opacity-50 transition-all">{uploading ? 'Uploading...' : `Upload & Move`}</button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!notifyModal} onClose={() => setNotifyModal(null)} title="Notify via WhatsApp" width="max-w-sm">
        {notifyModal && (
          <div>
            <div className="bg-green-50 border border-green-100 rounded-xl p-3 mb-4">
              <p className="text-sm text-green-800">"<strong>{notifyModal.fileName}</strong>" is ready for <strong>{notifyModal.nextStage}</strong></p>
            </div>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {teamMembers.length === 0 ? (
                <p className="text-sm text-gray-400 text-center py-6">No team members with phone numbers</p>
              ) : teamMembers.map((m) => (
                <button key={m.id} onClick={() => sendWhatsApp(m.phone, notifyModal.fileName, notifyModal.nextStage)} className="w-full flex items-center justify-between px-4 py-3 border border-gray-100 rounded-xl hover:bg-green-50 hover:border-green-200 transition-all group">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-green-500 to-green-600 flex items-center justify-center text-white text-xs font-bold">{m.name.charAt(0)}</div>
                    <div className="text-left">
                      <p className="text-sm font-medium text-gray-800">{m.name}</p>
                      <p className="text-[11px] text-gray-400">{m.role} &middot; {m.phone}</p>
                    </div>
                  </div>
                  <svg className="w-5 h-5 text-gray-300 group-hover:text-green-500 transition-colors" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" /></svg>
                </button>
              ))}
            </div>
            <div className="flex justify-end mt-4">
              <button onClick={() => setNotifyModal(null)} className="px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors">Skip</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

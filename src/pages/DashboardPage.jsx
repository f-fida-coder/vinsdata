import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api, { uploadFile, getDownloadUrl } from '../api';

const STAGES = ['generated', 'carfax', 'filter', 'tlo'];

const STAGE_COLORS = {
  generated: { bg: 'bg-blue-100', text: 'text-blue-800', border: 'border-blue-400' },
  carfax: { bg: 'bg-yellow-100', text: 'text-yellow-800', border: 'border-yellow-400' },
  filter: { bg: 'bg-orange-100', text: 'text-orange-800', border: 'border-orange-400' },
  tlo: { bg: 'bg-green-100', text: 'text-green-800', border: 'border-green-400' },
};

const NEXT_STAGE = {
  generated: 'carfax',
  carfax: 'filter',
  filter: 'tlo',
};

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

  // Stage change modal
  const [stageModal, setStageModal] = useState(null); // { fileId, stage, fileName }
  const [stageFile, setStageFile] = useState(null);
  const [stageNotes, setStageNotes] = useState('');
  const [uploading, setUploading] = useState(false);

  const fetchFiles = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = {};
      if (filters.vehicle_id) params.vehicle_id = filters.vehicle_id;
      if (filters.stage) params.stage = filters.stage;
      if (filters.year) params.year = filters.year;
      const res = await api.get('/files', { params });
      setFiles(res.data);
    } catch {
      setError('Failed to load files');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  const fetchVehicles = async () => {
    try {
      const res = await api.get('/vehicles');
      setVehicles(res.data);
    } catch {
      setError('Failed to load vehicles');
    }
  };

  useEffect(() => { fetchVehicles(); }, []);
  useEffect(() => { fetchFiles(); }, [fetchFiles]);

  const stageCounts = STAGES.reduce((acc, stage) => {
    acc[stage] = files.filter((f) => f.current_stage === stage).length;
    return acc;
  }, {});

  // Open stage change modal
  const handleStageChange = (fileId, newStage, fileName) => {
    setStageModal({ fileId, stage: newStage, fileName });
    setStageFile(null);
    setStageNotes('');
  };

  // Submit stage change + file upload
  const handleStageSubmit = async () => {
    if (!stageModal) return;
    setUploading(true);
    setError('');
    try {
      await api.put('/files', {
        id: stageModal.fileId,
        stage: stageModal.stage,
        notes: stageNotes || '',
      });

      if (stageFile) {
        await uploadFile(stageModal.fileId, stageModal.stage, stageFile);
      }

      setStageModal(null);
      setStageFile(null);
      setStageNotes('');
      fetchFiles();
    } catch {
      setError('Failed to update stage');
    } finally {
      setUploading(false);
    }
  };

  const handleAddFile = async (e) => {
    e.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      const res = await api.post('/files', {
        vehicle_id: Number(newFile.vehicle_id),
        file_name: newFile.file_name,
        year: newFile.year ? Number(newFile.year) : null,
        version: newFile.version || null,
      });

      if (selectedFile && res.data.id) {
        await uploadFile(res.data.id, 'generated', selectedFile);
      }

      setShowModal(false);
      setNewFile({ vehicle_id: '', file_name: '', year: '', version: '' });
      setSelectedFile(null);
      fetchFiles();
    } catch {
      setError('Failed to add file');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (fileId, fileName) => {
    if (!window.confirm(`Delete "${fileName}" and all its uploaded files? This cannot be undone.`)) return;
    setError('');
    try {
      await api.delete('/files', { data: { id: fileId } });
      fetchFiles();
    } catch {
      setError('Failed to delete file');
    }
  };

  const clearFilters = () => setFilters({ vehicle_id: '', stage: '', year: '' });

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-800">Dashboard</h1>
        <button
          onClick={() => setShowModal(true)}
          className="bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 transition-colors"
        >
          + Add File
        </button>
      </div>

      {/* Error Toast */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-md mb-6 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError('')} className="text-red-400 hover:text-red-600">&times;</button>
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {STAGES.map((stage) => (
          <div
            key={stage}
            className={`bg-white rounded-lg p-4 border-l-4 ${STAGE_COLORS[stage].border} shadow-sm`}
          >
            <p className="text-sm text-gray-500 capitalize">{stage}</p>
            <p className={`text-3xl font-bold mt-1 ${STAGE_COLORS[stage].text}`}>
              {stageCounts[stage]}
            </p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg p-4 shadow-sm mb-6 flex flex-wrap items-end gap-4">
        <div>
          <label className="block text-sm text-gray-600 mb-1">Vehicle</label>
          <select
            value={filters.vehicle_id}
            onChange={(e) => setFilters({ ...filters, vehicle_id: e.target.value })}
            className="border border-gray-300 rounded-md px-3 py-2 text-sm"
          >
            <option value="">All Vehicles</option>
            {vehicles.map((v) => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm text-gray-600 mb-1">Stage</label>
          <select
            value={filters.stage}
            onChange={(e) => setFilters({ ...filters, stage: e.target.value })}
            className="border border-gray-300 rounded-md px-3 py-2 text-sm"
          >
            <option value="">All Stages</option>
            {STAGES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm text-gray-600 mb-1">Year</label>
          <input
            type="number"
            value={filters.year}
            onChange={(e) => setFilters({ ...filters, year: e.target.value })}
            placeholder="e.g. 2003"
            className="border border-gray-300 rounded-md px-3 py-2 text-sm w-28"
          />
        </div>
        <button
          onClick={clearFilters}
          className="text-sm text-gray-500 hover:text-gray-700 px-3 py-2 border border-gray-300 rounded-md"
        >
          Clear Filters
        </button>
      </div>

      {/* Files Table */}
      <div className="bg-white rounded-lg shadow-sm overflow-x-auto">
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div>
          </div>
        ) : (
          <table className="w-full text-sm text-left">
            <thead className="bg-gray-50 text-gray-600 uppercase text-xs">
              <tr>
                <th className="px-4 py-3">File Name</th>
                <th className="px-4 py-3">Vehicle</th>
                <th className="px-4 py-3">Year</th>
                <th className="px-4 py-3">Version</th>
                <th className="px-4 py-3">Stage Progress</th>
                <th className="px-4 py-3">Downloads</th>
                <th className="px-4 py-3">Last Updated</th>
                <th className="px-4 py-3">Action</th>
              </tr>
            </thead>
            <tbody>
              {files.length === 0 ? (
                <tr>
                  <td colSpan="8" className="px-4 py-8 text-center text-gray-400">
                    No files found.
                  </td>
                </tr>
              ) : (
                files.map((file, i) => {
                  const colors = STAGE_COLORS[file.current_stage] || STAGE_COLORS.generated;
                  const next = NEXT_STAGE[file.current_stage];
                  const uploaded = file.uploaded_stages || [];
                  return (
                    <tr key={file.id} className={`hover:bg-gray-100 ${i % 2 === 1 ? 'bg-gray-50' : ''}`}>
                      <td className="px-4 py-3 font-medium">
                        <button
                          onClick={() => navigate(`/logs?file_id=${file.id}&name=${encodeURIComponent(file.file_name)}`)}
                          className="text-blue-600 hover:text-blue-800 hover:underline"
                        >
                          {file.file_name}
                        </button>
                      </td>
                      <td className="px-4 py-3">{file.vehicle_name}</td>
                      <td className="px-4 py-3">{file.year || '—'}</td>
                      <td className="px-4 py-3">{file.version || '—'}</td>
                      {/* Stage Progress Dots */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          {STAGES.map((s) => {
                            const isUploaded = uploaded.includes(s);
                            const isCurrent = file.current_stage === s;
                            const stageIdx = STAGES.indexOf(s);
                            const currentIdx = STAGES.indexOf(file.current_stage);
                            const isPast = stageIdx < currentIdx;
                            return (
                              <div key={s} className="flex items-center gap-1.5">
                                <div className="flex flex-col items-center">
                                  <span
                                    title={`${s}: ${isUploaded ? 'file uploaded' : isCurrent ? 'current stage' : isPast ? 'no file' : 'pending'}`}
                                    className={`w-3 h-3 rounded-full border-2 ${
                                      isUploaded
                                        ? 'bg-green-500 border-green-500'
                                        : isCurrent
                                          ? 'bg-yellow-400 border-yellow-400'
                                          : 'bg-gray-200 border-gray-300'
                                    }`}
                                  />
                                  <span className="text-[10px] text-gray-400 mt-0.5">{s.slice(0, 3)}</span>
                                </div>
                                {s !== 'tlo' && <div className="w-3 h-0.5 bg-gray-200 mb-3"></div>}
                              </div>
                            );
                          })}
                        </div>
                      </td>
                      {/* Download Links */}
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {uploaded.length > 0 ? uploaded.map((s) => (
                            <a
                              key={s}
                              href={getDownloadUrl(file.id, s)}
                              className="text-xs bg-gray-100 hover:bg-gray-200 text-blue-600 px-2 py-0.5 rounded"
                              title={`Download ${s} file`}
                            >
                              {s}
                            </a>
                          )) : (
                            <span className="text-xs text-gray-400">—</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-500">{file.updated_at || file.created_at}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {next ? (
                            <button
                              onClick={() => handleStageChange(file.id, next, file.file_name)}
                              className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1 rounded-md transition-colors"
                            >
                              Move to {next}
                            </button>
                          ) : (
                            <span className="text-xs text-green-600 font-medium">Done</span>
                          )}
                          <button
                            onClick={() => handleDelete(file.id, file.file_name)}
                            className="text-xs text-red-500 hover:text-red-700 hover:bg-red-50 px-2 py-1 rounded-md transition-colors"
                            title="Delete file"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Add File Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md shadow-lg">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-800">Add New File</h2>
              <button
                onClick={() => { setShowModal(false); setSelectedFile(null); }}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none"
              >
                &times;
              </button>
            </div>
            <form onSubmit={handleAddFile} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Vehicle</label>
                <select
                  value={newFile.vehicle_id}
                  onChange={(e) => setNewFile({ ...newFile, vehicle_id: e.target.value })}
                  required
                  className="w-full border border-gray-300 rounded-md px-3 py-2"
                >
                  <option value="">Select vehicle</option>
                  {vehicles.map((v) => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">File Name</label>
                <input
                  type="text"
                  value={newFile.file_name}
                  onChange={(e) => setNewFile({ ...newFile, file_name: e.target.value })}
                  required
                  className="w-full border border-gray-300 rounded-md px-3 py-2"
                  placeholder="LandCruiser_2003_VIN_v1"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Year</label>
                  <input
                    type="number"
                    value={newFile.year}
                    onChange={(e) => setNewFile({ ...newFile, year: e.target.value })}
                    className="w-full border border-gray-300 rounded-md px-3 py-2"
                    placeholder="2003"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Version</label>
                  <input
                    type="text"
                    value={newFile.version}
                    onChange={(e) => setNewFile({ ...newFile, version: e.target.value })}
                    className="w-full border border-gray-300 rounded-md px-3 py-2"
                    placeholder="v1"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Upload Generated File</label>
                <input
                  type="file"
                  onChange={(e) => setSelectedFile(e.target.files[0] || null)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm file:mr-3 file:py-1 file:px-3 file:rounded-md file:border-0 file:bg-blue-50 file:text-blue-600 file:text-sm"
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => { setShowModal(false); setSelectedFile(null); }}
                  className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                >
                  {submitting ? 'Adding...' : 'Add File'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Stage Change + Upload Modal */}
      {stageModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md shadow-lg">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-800">Move to {stageModal.stage}</h2>
              <button
                onClick={() => { setStageModal(null); setStageFile(null); setStageNotes(''); }}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none"
              >
                &times;
              </button>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              Upload the <span className="font-medium">{stageModal.stage}</span> file for "<span className="font-medium">{stageModal.fileName}</span>"
            </p>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">File</label>
                <input
                  type="file"
                  onChange={(e) => setStageFile(e.target.files[0] || null)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm file:mr-3 file:py-1 file:px-3 file:rounded-md file:border-0 file:bg-blue-50 file:text-blue-600 file:text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes (optional)</label>
                <input
                  type="text"
                  value={stageNotes}
                  onChange={(e) => setStageNotes(e.target.value)}
                  className="w-full border border-gray-300 rounded-md px-3 py-2"
                  placeholder="Any notes about this stage..."
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  onClick={() => { setStageModal(null); setStageFile(null); setStageNotes(''); }}
                  className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleStageSubmit}
                  disabled={uploading}
                  className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
                >
                  {uploading ? 'Uploading...' : `Upload & Move to ${stageModal.stage}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

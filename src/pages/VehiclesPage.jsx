import { useState, useEffect } from 'react';
import api from '../api';
import { useAuth } from '../context/AuthContext';

export default function VehiclesPage() {
  const { user } = useAuth();
  const [vehicles, setVehicles] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchVehicles = async () => {
    setLoading(true);
    try { const res = await api.get('/vehicles'); setVehicles(res.data); }
    catch { setError('Failed to load vehicles'); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchVehicles(); }, []);

  const handleAdd = async (e) => {
    e.preventDefault(); setSubmitting(true); setError('');
    try { await api.post('/vehicles', { name }); setShowModal(false); setName(''); fetchVehicles(); }
    catch { setError('Failed to add vehicle'); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="max-w-[1600px] mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Vehicles</h1>
        {user.role === 'admin' && (
          <button onClick={() => setShowModal(true)} className="inline-flex items-center justify-center gap-2 bg-[var(--vv-bg-dark)] text-white px-4 py-2.5 rounded-xl text-sm font-medium transition-all w-full sm:w-auto">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            Add Vehicle
          </button>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-100 text-red-600 px-4 py-3 rounded-xl mb-6 flex items-center justify-between">
          <span className="text-sm">{error}</span>
          <button onClick={() => setError('')} className="text-red-400 hover:text-red-600">&times;</button>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16"><div className="w-10 h-10 border-4 border-zinc-200 border-t-[var(--vv-bg-dark)] rounded-full animate-spin"></div></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="px-4 sm:px-5 py-4 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">ID</th>
                  <th className="px-4 sm:px-5 py-4 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Name</th>
                  <th className="px-4 sm:px-5 py-4 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Created At</th>
                </tr>
              </thead>
              <tbody>
                {vehicles.length === 0 ? (
                  <tr><td colSpan="3" className="px-4 py-12 text-center text-gray-400 text-sm">No vehicles found.</td></tr>
                ) : vehicles.map((v, i) => (
                  <tr key={v.id} className={`border-b border-gray-50 hover:bg-gray-50/50 ${i % 2 === 1 ? 'bg-gray-50/30' : ''}`}>
                    <td className="px-4 sm:px-5 py-3.5 text-gray-400">{v.id}</td>
                    <td className="px-4 sm:px-5 py-3.5 font-medium text-gray-900">{v.name}</td>
                    <td className="px-4 sm:px-5 py-3.5 text-gray-400 text-xs">{v.created_at || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4" onClick={() => setShowModal(false)}>
          <div className="absolute inset-0 bg-gray-900/60" />
          <div className="relative bg-white w-full max-w-sm sm:rounded-2xl rounded-t-2xl shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 className="text-base sm:text-lg font-semibold text-gray-900">Add Vehicle</h2>
              <button onClick={() => setShowModal(false)} className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100">&times;</button>
            </div>
            <form onSubmit={handleAdd} className="px-5 py-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Vehicle Name</label>
                <input type="text" value={name} onChange={(e) => setName(e.target.value)} required placeholder="LandCruiser" className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-[var(--vv-bg-dark)] focus:border-transparent outline-none" />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2.5 text-sm font-medium text-gray-600 bg-gray-50 rounded-xl hover:bg-gray-100">Cancel</button>
                <button type="submit" disabled={submitting} className="px-5 py-2.5 text-sm font-medium bg-[var(--vv-bg-dark)] text-white rounded-xl disabled:opacity-50">{submitting ? 'Adding...' : 'Add'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

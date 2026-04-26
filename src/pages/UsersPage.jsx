import { useState, useEffect } from 'react';
import api from '../api';
import { useAuth } from '../context/AuthContext';

const ROLE_COLORS = {
  admin:    'bg-purple-50 text-purple-700 border-purple-100',
  carfax:   'bg-amber-50 text-amber-700 border-amber-100',
  filter:   'bg-orange-50 text-orange-700 border-orange-100',
  tlo:      'bg-emerald-50 text-emerald-700 border-emerald-100',
  marketer: 'bg-fuchsia-50 text-fuchsia-700 border-fuchsia-100',
};

const ROLES = ['admin', 'carfax', 'filter', 'tlo', 'marketer'];

function UserModal({ title, open, onClose, children }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-gray-900/60" />
      <div className="relative bg-white w-full max-w-md sm:rounded-2xl rounded-t-2xl shadow-2xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-gray-100 shrink-0">
          <h2 className="text-base sm:text-lg font-semibold text-gray-900">{title}</h2>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100">&times;</button>
        </div>
        <div className="px-5 sm:px-6 py-5 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

export default function UsersPage() {
  const { user } = useAuth();
  const [users, setUsers] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '', role: '' });
  const [editModal, setEditModal] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchUsers = async () => {
    setLoading(true);
    try { const res = await api.get('/users'); setUsers(res.data); }
    catch { setError('Failed to load users'); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchUsers(); }, []);

  if (user.role !== 'admin') {
    return (<div className="flex items-center justify-center min-h-[60vh]"><p className="text-lg text-red-600 font-medium">Access Denied</p></div>);
  }

  const handleAdd = async (e) => {
    e.preventDefault(); setSubmitting(true); setError('');
    try { await api.post('/users', form); setShowModal(false); setForm({ name: '', email: '', phone: '', password: '', role: '' }); fetchUsers(); }
    catch { setError('Failed to add user'); }
    finally { setSubmitting(false); }
  };

  const handleEdit = async (e) => {
    e.preventDefault(); setError('');
    try { await api.patch('/users', { id: editModal.id, name: editModal.name, email: editModal.email, phone: editModal.phone || null, role: editModal.role }); setEditModal(null); fetchUsers(); }
    catch { setError('Failed to update user'); }
  };

  const inputClass = "w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-[var(--vv-bg-dark)] focus:border-transparent outline-none";

  return (
    <div className="max-w-[1600px] mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">Users</h1>
        <button onClick={() => setShowModal(true)} className="inline-flex items-center justify-center gap-2 bg-[var(--vv-bg-dark)] text-white px-4 py-2.5 rounded-xl text-sm font-medium transition-all w-full sm:w-auto">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
          Add User
        </button>
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
            <table className="w-full text-sm min-w-[600px]">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="px-4 sm:px-5 py-4 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Name</th>
                  <th className="px-4 sm:px-5 py-4 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Email</th>
                  <th className="px-4 sm:px-5 py-4 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Phone</th>
                  <th className="px-4 sm:px-5 py-4 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Role</th>
                  <th className="px-4 sm:px-5 py-4 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Created</th>
                  <th className="px-4 sm:px-5 py-4 w-16"></th>
                </tr>
              </thead>
              <tbody>
                {users.length === 0 ? (
                  <tr><td colSpan="6" className="px-4 py-12 text-center text-gray-400 text-sm">No users found.</td></tr>
                ) : users.map((u, i) => (
                  <tr key={u.id} className={`border-b border-gray-50 hover:bg-gray-50/50 ${i % 2 === 1 ? 'bg-gray-50/30' : ''}`}>
                    <td className="px-4 sm:px-5 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-lg bg-[var(--vv-bg-dark)] flex items-center justify-center text-white text-xs font-bold shrink-0">{u.name.charAt(0)}</div>
                        <span className="font-medium text-gray-900">{u.name}</span>
                      </div>
                    </td>
                    <td className="px-4 sm:px-5 py-3.5 text-gray-500">{u.email}</td>
                    <td className="px-4 sm:px-5 py-3.5 text-gray-500 text-xs">{u.phone || '—'}</td>
                    <td className="px-4 sm:px-5 py-3.5">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-semibold border ${ROLE_COLORS[u.role] || 'bg-gray-50 text-gray-700 border-gray-100'}`}>{u.role}</span>
                    </td>
                    <td className="px-4 sm:px-5 py-3.5 text-gray-400 text-xs">{(u.created_at || '').slice(0, 10)}</td>
                    <td className="px-4 sm:px-5 py-3.5">
                      <button onClick={() => setEditModal({ id: u.id, name: u.name, email: u.email, phone: u.phone || '', role: u.role })} className="text-xs font-medium text-[var(--vv-text)] hover:underline hover:bg-zinc-100 px-2.5 py-1.5 rounded-lg transition-colors">Edit</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <UserModal title="Add User" open={showModal} onClose={() => setShowModal(false)}>
        <form onSubmit={handleAdd} className="space-y-4">
          <div><label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Name</label><input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required className={inputClass} /></div>
          <div><label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Email</label><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required className={inputClass} /></div>
          <div><label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Phone (WhatsApp)</label><input type="text" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+923213531295" className={inputClass} /></div>
          <div><label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Password</label><input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required className={inputClass} /></div>
          <div><label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Role</label><select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} required className={inputClass}><option value="">Select role</option>{ROLES.map((r) => <option key={r} value={r}>{r}</option>)}</select></div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2.5 text-sm font-medium text-gray-600 bg-gray-50 rounded-xl hover:bg-gray-100">Cancel</button>
            <button type="submit" disabled={submitting} className="px-5 py-2.5 text-sm font-medium bg-[var(--vv-bg-dark)] text-white rounded-xl disabled:opacity-50">{submitting ? 'Adding...' : 'Add User'}</button>
          </div>
        </form>
      </UserModal>

      <UserModal title="Edit User" open={!!editModal} onClose={() => setEditModal(null)}>
        {editModal && (
          <form onSubmit={handleEdit} className="space-y-4">
            <div><label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Name</label><input type="text" value={editModal.name} onChange={(e) => setEditModal({ ...editModal, name: e.target.value })} required className={inputClass} /></div>
            <div><label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Email</label><input type="email" value={editModal.email} onChange={(e) => setEditModal({ ...editModal, email: e.target.value })} required className={inputClass} /></div>
            <div><label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Phone (WhatsApp)</label><input type="text" value={editModal.phone} onChange={(e) => setEditModal({ ...editModal, phone: e.target.value })} placeholder="+923213531295" className={inputClass} /></div>
            <div><label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Role</label><select value={editModal.role} onChange={(e) => setEditModal({ ...editModal, role: e.target.value })} required className={inputClass}>{ROLES.map((r) => <option key={r} value={r}>{r}</option>)}</select></div>
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setEditModal(null)} className="px-4 py-2.5 text-sm font-medium text-gray-600 bg-gray-50 rounded-xl hover:bg-gray-100">Cancel</button>
              <button type="submit" className="px-5 py-2.5 text-sm font-medium bg-[var(--vv-bg-dark)] text-white rounded-xl">Save</button>
            </div>
          </form>
        )}
      </UserModal>
    </div>
  );
}

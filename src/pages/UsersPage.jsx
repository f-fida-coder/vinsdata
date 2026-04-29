import { useState, useEffect } from 'react';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import { SectionHeader, KPI, Button, Avatar, EmptyState } from '../components/ui';

const ROLES = ['admin', 'carfax', 'filter', 'tlo', 'marketer'];
const ROLE_VARIANT = {
  admin:    'sb-info',
  carfax:   'sb-warn',
  filter:   'sb-warn',
  tlo:      'sb-success',
  marketer: 'sb-info',
};

function UserModal({ title, open, onClose, children }) {
  if (!open) return null;
  return (
    <>
      <div className="drawer-overlay" onClick={onClose}/>
      <div style={{
        position: 'fixed',
        top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        width: 'min(460px, 92vw)',
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
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 400, letterSpacing: '-0.02em' }}>
            {title}
          </h3>
          <Button variant="ghost" size="sm" icon="x" onClick={onClose}/>
        </div>
        <div style={{ padding: 20, overflowY: 'auto' }}>{children}</div>
      </div>
    </>
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
    return (
      <div className="page">
        <EmptyState icon="info" title="Access Denied" body="This page is restricted to admins."/>
      </div>
    );
  }

  const handleAdd = async (e) => {
    e.preventDefault(); setSubmitting(true); setError('');
    try {
      await api.post('/users', form);
      setShowModal(false);
      setForm({ name: '', email: '', phone: '', password: '', role: '' });
      fetchUsers();
    } catch { setError('Failed to add user'); }
    finally { setSubmitting(false); }
  };

  const handleEdit = async (e) => {
    e.preventDefault(); setError('');
    try {
      await api.patch('/users', {
        id: editModal.id, name: editModal.name, email: editModal.email,
        phone: editModal.phone || null, role: editModal.role,
      });
      setEditModal(null);
      fetchUsers();
    } catch { setError('Failed to update user'); }
  };

  return (
    <div className="page">
      <SectionHeader
        title="Users"
        subtitle="Team members and their roles · admins can manage everything · agents see only their leads"
        actions={<Button variant="primary" icon="plus" onClick={() => setShowModal(true)}>Add user</Button>}
      />

      {error && (
        <div className="card" style={{ marginBottom: 16, color: 'var(--danger)', borderColor: 'var(--danger)' }}>
          {error}
        </div>
      )}

      <div className="kpi-row" style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
        <KPI label="Total" value={users.length}/>
        <KPI label="Admins" value={users.filter((u) => u.role === 'admin').length}/>
        <KPI label="Carfax" value={users.filter((u) => u.role === 'carfax').length}/>
        <KPI label="Filter" value={users.filter((u) => u.role === 'filter').length}/>
        <KPI label="TLO" value={users.filter((u) => u.role === 'tlo').length}/>
      </div>

      <div className="tbl-wrap">
        {loading ? (
          <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-3)' }}>Loading…</div>
        ) : users.length === 0 ? (
          <EmptyState icon="users" title="No users" body="Add your first team member."/>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Phone</th>
                <th>Role</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <div className="row">
                      <Avatar name={u.name} size={26}/>
                      <span className="cell-strong">{u.name}</span>
                    </div>
                  </td>
                  <td className="cell-muted">{u.email}</td>
                  <td className="cell-mono">{u.phone || '—'}</td>
                  <td><span className={`status-badge ${ROLE_VARIANT[u.role] || 'sb-neutral'}`}>{u.role}</span></td>
                  <td className="cell-muted">{(u.created_at || '').slice(0, 10)}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <Button variant="ghost" size="sm" icon="edit" onClick={() => setEditModal({
                      id: u.id, name: u.name, email: u.email, phone: u.phone || '', role: u.role,
                    })}>Edit</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <UserModal title="Add User" open={showModal} onClose={() => setShowModal(false)}>
        <form onSubmit={handleAdd} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label className="field-label">Name</label>
            <input className="vv-input" type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required/>
          </div>
          <div>
            <label className="field-label">Email</label>
            <input className="vv-input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required/>
          </div>
          <div>
            <label className="field-label">Phone (WhatsApp)</label>
            <input className="vv-input" type="text" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+923213531295"/>
          </div>
          <div>
            <label className="field-label">Password</label>
            <input className="vv-input" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required/>
          </div>
          <div>
            <label className="field-label">Role</label>
            <select className="vv-input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} required>
              <option value="">Select role</option>
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
            <Button variant="ghost" onClick={() => setShowModal(false)}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={submitting}>{submitting ? 'Adding…' : 'Add User'}</Button>
          </div>
        </form>
      </UserModal>

      <UserModal title="Edit User" open={!!editModal} onClose={() => setEditModal(null)}>
        {editModal && (
          <form onSubmit={handleEdit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label className="field-label">Name</label>
              <input className="vv-input" type="text" value={editModal.name} onChange={(e) => setEditModal({ ...editModal, name: e.target.value })} required/>
            </div>
            <div>
              <label className="field-label">Email</label>
              <input className="vv-input" type="email" value={editModal.email} onChange={(e) => setEditModal({ ...editModal, email: e.target.value })} required/>
            </div>
            <div>
              <label className="field-label">Phone (WhatsApp)</label>
              <input className="vv-input" type="text" value={editModal.phone} onChange={(e) => setEditModal({ ...editModal, phone: e.target.value })}/>
            </div>
            <div>
              <label className="field-label">Role</label>
              <select className="vv-input" value={editModal.role} onChange={(e) => setEditModal({ ...editModal, role: e.target.value })} required>
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
              <Button variant="ghost" onClick={() => setEditModal(null)}>Cancel</Button>
              <Button variant="primary" type="submit">Save</Button>
            </div>
          </form>
        )}
      </UserModal>
    </div>
  );
}

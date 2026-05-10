import { useState, useEffect, useRef } from 'react';
import api, { extractApiError } from '../api';
import { useAuth } from '../context/AuthContext';
import { SectionHeader, KPI, Button, Icon, Input, EmptyState } from '../components/ui';

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

  const handleRename = async (v) => {
    const next = window.prompt('New name for this vehicle:', v.name);
    if (next === null) return;
    const trimmed = next.trim();
    if (trimmed === '' || trimmed === v.name) return;
    try {
      await api.put('/vehicles', { id: v.id, name: trimmed });
      fetchVehicles();
    } catch (err) {
      window.alert(extractApiError(err, 'Failed to rename vehicle'));
    }
  };

  const handleDelete = async (v) => {
    const ok = window.confirm(`Delete vehicle "${v.name}"?\n\nThis only works if no files are attached to it.`);
    if (!ok) return;
    try {
      await api.delete('/vehicles', { data: { id: v.id } });
      fetchVehicles();
    } catch (err) {
      window.alert(extractApiError(err, 'Failed to delete vehicle'));
    }
  };

  return (
    <div className="page">
      <SectionHeader
        title="Vehicles"
        subtitle="One row per vehicle the team is hunting · files are assigned to vehicles · leads carry year, make, model"
        actions={user.role === 'admin' && (
          <Button variant="primary" icon="plus" onClick={() => setShowModal(true)}>New vehicle</Button>
        )}
      />

      {error && (
        <div className="card" style={{ marginBottom: 16, color: 'var(--danger)', borderColor: 'var(--danger)' }}>{error}</div>
      )}

      <div className="kpi-row" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <KPI label="Vehicles" value={vehicles.length}/>
        <KPI label="Active" value={vehicles.length}/>
        <KPI label="Newest" value={vehicles[0]?.name || '—'}/>
      </div>

      <div className="tbl-wrap">
        {loading ? (
          <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-3)' }}>Loading…</div>
        ) : vehicles.length === 0 ? (
          <EmptyState icon="car" title="No vehicles yet" body="Add a vehicle to start tracking files and leads against it."/>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>ID</th>
                <th>Name</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {vehicles.map((v) => (
                <tr key={v.id}>
                  <td className="cell-mono">{v.id}</td>
                  <td className="cell-strong">{v.name}</td>
                  <td className="cell-muted">{(v.created_at || '').slice(0, 10) || '—'}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    {user.role === 'admin' ? (
                      <RowMenu
                        onRename={() => handleRename(v)}
                        onDelete={() => handleDelete(v)}
                      />
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showModal && (
        <>
          <div className="drawer-overlay" onClick={() => setShowModal(false)}/>
          <div style={{
            position: 'fixed',
            top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)',
            width: 'min(420px, 92vw)',
            background: 'var(--bg-1)',
            border: '1px solid var(--border-0)',
            borderRadius: 14,
            boxShadow: 'var(--shadow-pop)',
            zIndex: 90,
            overflow: 'hidden',
          }} onClick={(e) => e.stopPropagation()}>
            <div className="drawer-head">
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 400, letterSpacing: '-0.02em' }}>
                Add Vehicle
              </h3>
              <Button variant="ghost" size="sm" icon="x" onClick={() => setShowModal(false)}/>
            </div>
            <form onSubmit={handleAdd}>
              <div style={{ padding: 20 }}>
                <label className="field-label">Vehicle Name</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} required placeholder="LandCruiser"/>
              </div>
              <div className="drawer-foot">
                <Button variant="ghost" onClick={() => setShowModal(false)}>Cancel</Button>
                <Button variant="primary" type="submit" disabled={submitting}>{submitting ? 'Adding…' : 'Add Vehicle'}</Button>
              </div>
            </form>
          </div>
        </>
      )}
    </div>
  );
}

function RowMenu({ onRename, onDelete }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <span ref={wrapRef} style={{ position: 'relative', display: 'inline-block' }}>
      <Button
        variant="ghost"
        size="sm"
        icon="moreV"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
      />
      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            right: 0,
            top: 'calc(100% + 4px)',
            background: 'var(--surface, #fff)',
            border: '1px solid var(--border-0, #e5e7eb)',
            borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
            minWidth: 140,
            zIndex: 20,
            padding: 4,
          }}
        >
          <MenuItem onClick={() => { setOpen(false); onRename(); }}>Rename</MenuItem>
          <MenuItem onClick={() => { setOpen(false); onDelete(); }} danger>Delete</MenuItem>
        </div>
      )}
    </span>
  );
}

function MenuItem({ children, onClick, danger }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      style={{
        display: 'block',
        width: '100%',
        textAlign: 'left',
        padding: '6px 10px',
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        fontSize: 13,
        color: danger ? '#b91c1c' : 'inherit',
        borderRadius: 6,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = danger ? '#fee2e2' : 'rgba(0,0,0,0.05)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      {children}
    </button>
  );
}

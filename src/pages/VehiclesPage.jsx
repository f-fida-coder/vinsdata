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
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef(null);
  const menuRef = useRef(null);

  const MENU_WIDTH = 160;
  const MENU_HEIGHT = 76;

  const placeMenu = () => {
    const btn = btnRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const margin = 6;
    let top = r.bottom + 4;
    if (top + MENU_HEIGHT > window.innerHeight - margin) {
      top = Math.max(margin, r.top - MENU_HEIGHT - 4);
    }
    let left = r.right - MENU_WIDTH;
    if (left < margin) left = margin;
    if (left + MENU_WIDTH > window.innerWidth - margin) {
      left = window.innerWidth - MENU_WIDTH - margin;
    }
    setPos({ top, left });
  };

  useEffect(() => {
    if (!open) return;
    placeMenu();
    const onDoc = (e) => {
      if (menuRef.current && menuRef.current.contains(e.target)) return;
      if (btnRef.current && btnRef.current.contains(e.target)) return;
      setOpen(false);
    };
    const onScroll = () => setOpen(false);
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  return (
    <>
      <span ref={btnRef} style={{ display: 'inline-block' }}>
        <Button
          variant="ghost"
          size="sm"
          icon="moreV"
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={open}
        />
      </span>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          style={{
            position: 'fixed',
            top: pos.top,
            left: pos.left,
            width: MENU_WIDTH,
            background: 'var(--bg-1, #fff)',
            border: '1px solid var(--border-0, #e5e7eb)',
            borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
            zIndex: 1000,
            padding: 4,
          }}
        >
          <MenuItem onClick={() => { setOpen(false); onRename(); }}>Rename</MenuItem>
          <MenuItem onClick={() => { setOpen(false); onDelete(); }} danger>Delete</MenuItem>
        </div>
      )}
    </>
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

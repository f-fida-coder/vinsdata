import { useState, useEffect, useRef, useMemo } from 'react';
import api, { extractApiError } from '../api';
import { useAuth } from '../context/AuthContext';
import { SectionHeader, KPI, Button, Icon, Input, EmptyState } from '../components/ui';

// Body type suggestions — the user can type anything, but a datalist gives
// quick picks for the common ones the team hunts.
const BODY_TYPE_SUGGESTIONS = ['Coupe', 'Sedan', 'SUV', 'Truck', 'Pickup', 'Van', 'Hatchback', 'Convertible', 'Wagon'];

const emptyDraft = () => ({
  id: null,
  name: '',
  make: '',
  model: '',
  year: '',
  body_type: '',
  trim: '',
  notes: '',
  is_active: true,
});

function buildAutoName(d) {
  return [d.year, d.make, d.model, d.trim].map((x) => (x ?? '').toString().trim()).filter(Boolean).join(' ');
}

export default function VehiclesPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [vehicles, setVehicles]   = useState([]);
  const [search, setSearch]       = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [modal, setModal]         = useState(null); // null | 'add' | vehicleObj (edit)
  const [draft, setDraft]         = useState(emptyDraft());
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [modalError, setModalError] = useState('');

  const fetchVehicles = async () => {
    setLoading(true);
    try {
      const res = await api.get('/vehicles', { params: { include_inactive: 1 } });
      setVehicles(res.data);
      setError('');
    } catch (err) {
      setError(extractApiError(err, 'Failed to load vehicles'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchVehicles(); }, []);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return vehicles.filter((v) => {
      if (!showInactive && !v.is_active) return false;
      if (!q) return true;
      return [v.name, v.make, v.model, v.year, v.body_type, v.trim]
        .map((x) => (x ?? '').toString().toLowerCase())
        .some((s) => s.includes(q));
    });
  }, [vehicles, search, showInactive]);

  const activeCount = vehicles.filter((v) => v.is_active).length;
  const fileCount   = vehicles.reduce((s, v) => s + (v.file_count || 0), 0);
  const newestActive = [...vehicles].filter((v) => v.is_active).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))[0];

  const openAdd  = () => { setDraft(emptyDraft());        setModalError(''); setModal('add'); };
  const openEdit = (v) => { setDraft({
    id: v.id, name: v.name || '', make: v.make || '', model: v.model || '',
    year: v.year ?? '', body_type: v.body_type || '', trim: v.trim || '',
    notes: v.notes || '', is_active: v.is_active !== false,
  }); setModalError(''); setModal(v); };
  const close = () => { if (!submitting) { setModal(null); setModalError(''); } };

  const save = async (e) => {
    e?.preventDefault?.();
    setSubmitting(true); setModalError('');

    // If name is blank but make/model/year present, auto-build it.
    const payload = { ...draft };
    if (!payload.name?.trim()) payload.name = buildAutoName(payload);

    try {
      if (modal === 'add') {
        await api.post('/vehicles', payload);
      } else {
        await api.put('/vehicles', { ...payload, id: draft.id });
      }
      setModal(null);
      fetchVehicles();
    } catch (err) {
      setModalError(extractApiError(err, 'Failed to save vehicle'));
    } finally {
      setSubmitting(false);
    }
  };

  const toggleActive = async (v) => {
    try {
      await api.put('/vehicles', { id: v.id, is_active: !v.is_active });
      fetchVehicles();
    } catch (err) {
      window.alert(extractApiError(err, 'Failed to update'));
    }
  };

  const remove = async (v) => {
    if (!window.confirm(`Delete vehicle "${v.name}"?\n\nOnly works if no files are attached.`)) return;
    try {
      await api.delete('/vehicles', { data: { id: v.id } });
      fetchVehicles();
    } catch (err) {
      window.alert(extractApiError(err, 'Failed to delete'));
    }
  };

  const autoName = buildAutoName(draft);

  return (
    <div className="page">
      <SectionHeader
        title="Vehicles"
        subtitle="One row per vehicle the team is hunting · files and leads are assigned to vehicles"
        actions={isAdmin && (
          <Button variant="primary" icon="plus" onClick={openAdd}>New vehicle</Button>
        )}
      />

      {error && (
        <div className="card" style={{ marginBottom: 16, color: 'var(--danger)', borderColor: 'var(--danger)' }}>{error}</div>
      )}

      <div className="kpi-row" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <KPI label="Vehicles"  value={vehicles.length}/>
        <KPI label="Active"    value={activeCount}/>
        <KPI label="Files attached" value={fileCount} hint={newestActive ? `Newest: ${newestActive.name}` : ''}/>
      </div>

      {/* Toolbar */}
      <div className="card" style={{ marginBottom: 16, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: 10 }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <Icon name="search" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-3)' }}/>
          <input
            type="text"
            placeholder="Search by name, make, model, year…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="vv-input"
            style={{ paddingLeft: 36 }}
          />
        </div>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--text-2)' }}>
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Show inactive
        </label>
      </div>

      <div className="tbl-wrap">
        {loading ? (
          <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-3)' }}>Loading…</div>
        ) : visible.length === 0 ? (
          <EmptyState
            icon="car"
            title={search ? 'No vehicles match' : 'No vehicles yet'}
            body={search ? 'Try a different search term.' : 'Add a vehicle to start tracking files and leads against it.'}
          />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Name</th>
                <th>Year</th>
                <th>Make / Model</th>
                <th>Body / Trim</th>
                <th>Files</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((v) => (
                <tr key={v.id} style={!v.is_active ? { opacity: 0.55 } : undefined}>
                  <td>
                    <div className="cell-strong">{v.name}</div>
                    {v.notes && <div className="cell-muted" style={{ fontSize: 11, marginTop: 2, lineHeight: 1.3, maxWidth: 280, whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{v.notes}</div>}
                  </td>
                  <td className="cell-mono">{v.year || '—'}</td>
                  <td>
                    {v.make || v.model ? (
                      <>
                        <div>{v.make || '—'}</div>
                        <div className="cell-muted" style={{ fontSize: 12 }}>{v.model || ''}</div>
                      </>
                    ) : <span className="cell-muted">—</span>}
                  </td>
                  <td>
                    {v.body_type || v.trim ? (
                      <>
                        <div>{v.body_type || '—'}</div>
                        <div className="cell-muted" style={{ fontSize: 12 }}>{v.trim || ''}</div>
                      </>
                    ) : <span className="cell-muted">—</span>}
                  </td>
                  <td className="cell-mono">{v.file_count || 0}</td>
                  <td>
                    {v.is_active ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, padding: '2px 8px', borderRadius: 999, background: 'rgba(16,185,129,0.12)', color: 'var(--success)', fontWeight: 600 }}>
                        <span style={{ width: 5, height: 5, borderRadius: 999, background: 'var(--success)' }}/>Active
                      </span>
                    ) : (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, padding: '2px 8px', borderRadius: 999, background: 'rgba(107,114,128,0.12)', color: 'var(--text-3)' }}>
                        Inactive
                      </span>
                    )}
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    {isAdmin && (
                      <RowMenu
                        onEdit={() => openEdit(v)}
                        onToggle={() => toggleActive(v)}
                        isActive={v.is_active}
                        onDelete={() => remove(v)}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {modal && (
        <>
          <div className="drawer-overlay" onClick={close}/>
          <div style={{
            position: 'fixed', top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)',
            width: 'min(560px, 94vw)', maxHeight: '90vh',
            background: 'var(--bg-1)',
            border: '1px solid var(--border-0)',
            borderRadius: 14,
            boxShadow: 'var(--shadow-pop)',
            zIndex: 90, overflow: 'hidden',
            display: 'flex', flexDirection: 'column',
          }} onClick={(e) => e.stopPropagation()}>
            <div className="drawer-head">
              <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 22, fontWeight: 400, letterSpacing: '-0.02em' }}>
                {modal === 'add' ? 'Add Vehicle' : `Edit ${modal.name}`}
              </h3>
              <Button variant="ghost" size="sm" icon="x" onClick={close}/>
            </div>
            <form onSubmit={save} style={{ flex: 1, overflowY: 'auto' }}>
              <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <label className="field-label">Display name</label>
                  <Input
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    placeholder={autoName || 'e.g. 2003 Toyota Land Cruiser'}
                  />
                  {!draft.name && autoName && (
                    <p style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 4 }}>
                      Leave blank to auto-name as "<b>{autoName}</b>".
                    </p>
                  )}
                </div>

                <div className="grid-2">
                  <div>
                    <label className="field-label">Make</label>
                    <Input
                      value={draft.make}
                      onChange={(e) => setDraft({ ...draft, make: e.target.value })}
                      placeholder="Toyota"
                    />
                  </div>
                  <div>
                    <label className="field-label">Model</label>
                    <Input
                      value={draft.model}
                      onChange={(e) => setDraft({ ...draft, model: e.target.value })}
                      placeholder="Land Cruiser"
                    />
                  </div>
                </div>

                <div className="grid-2">
                  <div>
                    <label className="field-label">Year</label>
                    <Input
                      type="number"
                      min="1900" max="2100"
                      value={draft.year}
                      onChange={(e) => setDraft({ ...draft, year: e.target.value })}
                      placeholder="2003"
                    />
                  </div>
                  <div>
                    <label className="field-label">Trim</label>
                    <Input
                      value={draft.trim}
                      onChange={(e) => setDraft({ ...draft, trim: e.target.value })}
                      placeholder="VX, Sport, Turbo S…"
                    />
                  </div>
                </div>

                <div>
                  <label className="field-label">Body type</label>
                  <Input
                    list="body-type-options"
                    value={draft.body_type}
                    onChange={(e) => setDraft({ ...draft, body_type: e.target.value })}
                    placeholder="SUV / Coupe / Truck …"
                  />
                  <datalist id="body-type-options">
                    {BODY_TYPE_SUGGESTIONS.map((b) => <option key={b} value={b}/>)}
                  </datalist>
                </div>

                <div>
                  <label className="field-label">Notes</label>
                  <textarea
                    className="vv-input"
                    rows={3}
                    value={draft.notes}
                    onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                    placeholder="Anything the team should know about this vehicle target — mileage limits, color preferences, region…"
                  />
                </div>

                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-1)', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={!!draft.is_active}
                    onChange={(e) => setDraft({ ...draft, is_active: e.target.checked })}
                  />
                  <span>Active — appears in dropdowns and filters across the app</span>
                </label>

                {modalError && (
                  <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', color: 'var(--danger)', padding: '8px 10px', borderRadius: 8, fontSize: 12 }}>
                    {modalError}
                  </div>
                )}
              </div>

              <div className="drawer-foot">
                <Button variant="ghost" onClick={close} disabled={submitting}>Cancel</Button>
                <Button variant="primary" type="submit" disabled={submitting}>
                  {submitting ? 'Saving…' : (modal === 'add' ? 'Add Vehicle' : 'Save Changes')}
                </Button>
              </div>
            </form>
          </div>
        </>
      )}
    </div>
  );
}

function RowMenu({ onEdit, onToggle, isActive, onDelete }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef(null);
  const menuRef = useRef(null);

  const MENU_WIDTH = 180;
  const MENU_HEIGHT = 116;

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
            top: pos.top, left: pos.left,
            width: MENU_WIDTH,
            background: 'var(--bg-1, #fff)',
            border: '1px solid var(--border-0, #e5e7eb)',
            borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
            zIndex: 1000,
            padding: 4,
          }}
        >
          <MenuItem onClick={() => { setOpen(false); onEdit(); }}>Edit</MenuItem>
          <MenuItem onClick={() => { setOpen(false); onToggle(); }}>
            {isActive ? 'Set inactive' : 'Set active'}
          </MenuItem>
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

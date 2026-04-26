import { useState, useEffect, useCallback } from 'react';
import api, { extractApiError } from '../api';
import { useAuth } from '../context/AuthContext';

const EMPTY_FORM = { name: '', make: '', model: '', year: '' };

function formatVehicleTitle(v) {
  const ymm = [v.year, v.make, v.model].filter(Boolean).join(' ');
  if (ymm && v.name) return `${ymm} — ${v.name}`;
  return ymm || v.name || '—';
}

function Modal({ open, title, onClose, children }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="relative w-full max-w-md flex flex-col"
        style={{
          backgroundColor: 'var(--vv-bg-surface)',
          border: '1px solid var(--vv-border)',
          borderRadius: 'var(--vv-radius-lg)',
          boxShadow: '0 10px 40px rgba(9,9,11,0.16)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: '1px solid var(--vv-border)' }}>
          <h2 className="text-[14px] font-semibold">{title}</h2>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-[var(--vv-bg-surface-muted)]">&times;</button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

function VehicleForm({ initial, onCancel, onSubmit, submitting }) {
  const [form, setForm] = useState(() => ({
    name:  initial?.name  ?? '',
    make:  initial?.make  ?? '',
    model: initial?.model ?? '',
    year:  initial?.year  ?? '',
  }));

  const inputStyle = {
    backgroundColor: 'var(--vv-bg-surface-muted)',
    border: '1px solid var(--vv-border)',
    borderRadius: 'var(--vv-radius-md)',
  };

  const labelStyle = {
    color: 'var(--vv-text-subtle)',
    letterSpacing: 'var(--vv-tracking-label)',
  };

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSubmit(form); }}
      className="space-y-3 text-[13px]"
    >
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="block mb-1.5 text-[10px] uppercase font-semibold" style={labelStyle}>Name</label>
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="LFA hunt list"
            required
            className="w-full px-3 py-2 outline-none focus:ring-2 focus:ring-[var(--vv-bg-dark)]"
            style={inputStyle}
          />
        </div>
        <div>
          <label className="block mb-1.5 text-[10px] uppercase font-semibold" style={labelStyle}>Make</label>
          <input
            value={form.make}
            onChange={(e) => setForm({ ...form, make: e.target.value })}
            placeholder="Lexus"
            className="w-full px-3 py-2 outline-none focus:ring-2 focus:ring-[var(--vv-bg-dark)]"
            style={inputStyle}
          />
        </div>
        <div>
          <label className="block mb-1.5 text-[10px] uppercase font-semibold" style={labelStyle}>Model</label>
          <input
            value={form.model}
            onChange={(e) => setForm({ ...form, model: e.target.value })}
            placeholder="LFA"
            className="w-full px-3 py-2 outline-none focus:ring-2 focus:ring-[var(--vv-bg-dark)]"
            style={inputStyle}
          />
        </div>
        <div className="col-span-2">
          <label className="block mb-1.5 text-[10px] uppercase font-semibold" style={labelStyle}>Year</label>
          <input
            type="number" min={1900} max={2100}
            value={form.year}
            onChange={(e) => setForm({ ...form, year: e.target.value })}
            placeholder="2014"
            className="w-32 px-3 py-2 outline-none focus:ring-2 focus:ring-[var(--vv-bg-dark)] tabular-nums"
            style={inputStyle}
          />
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={onCancel} className="px-3 py-1.5 text-[13px] rounded-md" style={{ border: '1px solid var(--vv-border)' }}>Cancel</button>
        <button type="submit" disabled={submitting} className="px-3 py-1.5 text-[13px] rounded-md text-white disabled:opacity-60" style={{ backgroundColor: 'var(--vv-bg-dark)' }}>
          {submitting ? 'Saving…' : (initial ? 'Save' : 'Add vehicle')}
        </button>
      </div>
    </form>
  );
}

export default function VehiclesPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');
  const [editing, setEditing]   = useState(null); // null | 'new' | vehicleObject
  const [submitting, setSubmit] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await api.get('/vehicles');
      setVehicles(res.data || []);
    } catch (err) {
      setError(extractApiError(err, 'Failed to load vehicles'));
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const submit = async (form) => {
    setSubmit(true); setError('');
    try {
      const payload = {
        name:  form.name.trim(),
        make:  form.make.trim()  || null,
        model: form.model.trim() || null,
        year:  form.year === '' ? null : Number(form.year),
      };
      if (editing === 'new') {
        await api.post('/vehicles', payload);
      } else if (editing && editing.id) {
        await api.patch('/vehicles', { id: editing.id, ...payload });
      }
      setEditing(null);
      load();
    } catch (err) {
      setError(extractApiError(err, 'Save failed'));
    } finally { setSubmit(false); }
  };

  return (
    <div className="max-w-[1600px] mx-auto">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Vehicles</h1>
          <p className="text-[12px] mt-0.5" style={{ color: 'var(--vv-text-muted)' }}>
            One row per vehicle the team is hunting. Files are assigned to vehicles; lists carry year, make, model.
          </p>
        </div>
        {isAdmin && (
          <button
            onClick={() => setEditing('new')}
            className="px-3 py-1.5 text-[13px] rounded-md text-white shrink-0"
            style={{ backgroundColor: 'var(--vv-bg-dark)' }}
          >
            + New vehicle
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 px-4 py-2 rounded-md text-[13px]" style={{ backgroundColor: '#FEE2E2', color: 'var(--vv-status-danger)', border: '1px solid #FECACA' }}>
          {error}
        </div>
      )}

      <div
        className="overflow-hidden"
        style={{ backgroundColor: 'var(--vv-bg-surface)', border: '1px solid var(--vv-border)', borderRadius: 'var(--vv-radius-lg)' }}
      >
        {loading ? (
          <div className="py-10 text-center text-[13px]" style={{ color: 'var(--vv-text-muted)' }}>Loading…</div>
        ) : vehicles.length === 0 ? (
          <div className="py-10 text-center text-[13px]" style={{ color: 'var(--vv-text-muted)' }}>
            No vehicles yet.
            {isAdmin && <> Click <span className="font-medium" style={{ color: 'var(--vv-text)' }}>+ New vehicle</span> to add one.</>}
          </div>
        ) : (
          <table className="w-full text-[13px]">
            <thead style={{ backgroundColor: 'var(--vv-bg-surface-muted)' }}>
              <tr style={{ borderBottom: '1px solid var(--vv-border)' }}>
                <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tabular-nums" style={{ color: 'var(--vv-text-muted)', letterSpacing: 'var(--vv-tracking-label)' }}>ID</th>
                <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase" style={{ color: 'var(--vv-text-muted)', letterSpacing: 'var(--vv-tracking-label)' }}>Vehicle</th>
                <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase" style={{ color: 'var(--vv-text-muted)', letterSpacing: 'var(--vv-tracking-label)' }}>Year</th>
                <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase" style={{ color: 'var(--vv-text-muted)', letterSpacing: 'var(--vv-tracking-label)' }}>Make</th>
                <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase" style={{ color: 'var(--vv-text-muted)', letterSpacing: 'var(--vv-tracking-label)' }}>Model</th>
                <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase" style={{ color: 'var(--vv-text-muted)', letterSpacing: 'var(--vv-tracking-label)' }}>Created</th>
                {isAdmin && <th className="px-4 py-2" />}
              </tr>
            </thead>
            <tbody>
              {vehicles.map((v) => (
                <tr key={v.id} style={{ borderBottom: '1px solid var(--vv-border)' }}>
                  <td className="px-4 py-2 tabular-nums" style={{ color: 'var(--vv-text-subtle)' }}>{v.id}</td>
                  <td className="px-4 py-2">
                    <div className="font-medium">{formatVehicleTitle(v)}</div>
                    {(v.make || v.model || v.year) && v.name && (
                      <div className="text-[11px]" style={{ color: 'var(--vv-text-muted)' }}>{v.name}</div>
                    )}
                  </td>
                  <td className="px-4 py-2 tabular-nums" style={{ color: v.year ? 'var(--vv-text)' : 'var(--vv-text-subtle)' }}>
                    {v.year ?? '—'}
                  </td>
                  <td className="px-4 py-2" style={{ color: v.make ? 'var(--vv-text)' : 'var(--vv-text-subtle)' }}>
                    {v.make ?? '—'}
                  </td>
                  <td className="px-4 py-2" style={{ color: v.model ? 'var(--vv-text)' : 'var(--vv-text-subtle)' }}>
                    {v.model ?? '—'}
                  </td>
                  <td className="px-4 py-2 text-[11px]" style={{ color: 'var(--vv-text-subtle)' }}>{v.created_at || '—'}</td>
                  {isAdmin && (
                    <td className="px-4 py-2 text-right">
                      <button onClick={() => setEditing(v)} className="text-[12px] px-2 py-1 rounded" style={{ color: 'var(--vv-text)' }}>Edit</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Modal
        open={!!editing}
        title={editing === 'new' ? 'New vehicle' : `Edit: ${editing?.name ?? ''}`}
        onClose={() => setEditing(null)}
      >
        <VehicleForm
          initial={editing === 'new' ? null : editing}
          onCancel={() => setEditing(null)}
          onSubmit={submit}
          submitting={submitting}
        />
      </Modal>
    </div>
  );
}

import { useState, useEffect, useCallback } from 'react';
import api, { extractApiError } from '../api';
import { TRANSPORT_STATUSES, TRANSPORT_STATUS_BY_KEY } from '../lib/crm';
import TransportNotifyModal from './TransportNotifyModal';

function TransportStatusPill({ statusKey }) {
  const s = TRANSPORT_STATUS_BY_KEY[statusKey] || TRANSPORT_STATUS_BY_KEY.new;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-semibold ${s.bg} ${s.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />{s.label}
    </span>
  );
}

// (Inline NotifyModal previously defined here; now lives in TransportNotifyModal.jsx)

export default function LeadTransportSection({ leadId, normalizedPayload, onChanged }) {
  const [transport, setTransport]       = useState(null);
  const [loading, setLoading]           = useState(true);
  const [saving, setSaving]             = useState(false);
  const [error, setError]               = useState('');
  const [transporters, setTransporters] = useState([]);
  const [editing, setEditing]           = useState(false);
  const [notifyOpen, setNotifyOpen]     = useState(false);
  const [draft, setDraft]               = useState({
    transport_date: '', transport_time: '', time_window: '',
    pickup_location: '', delivery_location: '', vehicle_info: '',
    status: 'new', assigned_transporter_id: '', notes: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [tr, tx] = await Promise.all([
        api.get('/lead_transport', { params: { lead_id: leadId } }),
        api.get('/transporters'),
      ]);
      setTransport(tr.data || null);
      setTransporters(tx.data || []);
      setError('');
    } catch (err) {
      setError(extractApiError(err, 'Failed to load transport'));
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => { load(); }, [load]);

  const startEdit = () => {
    const np = normalizedPayload || {};
    const defaultVehicle = transport?.vehicle_info
      || [np.year, np.make, np.model].filter(Boolean).join(' ')
      || '';
    const defaultPickup = transport?.pickup_location
      || np.full_address
      || [np.city, np.state, np.zip_code].filter(Boolean).join(', ')
      || '';
    setDraft({
      transport_date:          transport?.transport_date    || '',
      transport_time:          transport?.transport_time    || '',
      time_window:             transport?.time_window       || '',
      pickup_location:         defaultPickup,
      delivery_location:       transport?.delivery_location || '',
      vehicle_info:            defaultVehicle,
      status:                  transport?.status            || 'new',
      assigned_transporter_id: transport?.assigned_transporter_id ?? '',
      notes:                   transport?.notes             || '',
    });
    setEditing(true);
  };

  const save = async () => {
    setSaving(true); setError('');
    try {
      const payload = { lead_id: leadId, ...draft };
      payload.assigned_transporter_id = draft.assigned_transporter_id === '' ? null : Number(draft.assigned_transporter_id);
      if (payload.transport_time === '') delete payload.transport_time;
      const res = await api.put('/lead_transport', payload);
      setTransport(res.data.transport || null);
      setEditing(false);
      onChanged?.();
    } catch (err) {
      setError(extractApiError(err, 'Failed to save transport'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!window.confirm('Remove this transport assignment?')) return;
    setSaving(true); setError('');
    try {
      await api.delete('/lead_transport', { data: { lead_id: leadId } });
      setTransport(null);
      onChanged?.();
    } catch (err) {
      setError(extractApiError(err, 'Failed to remove transport'));
    } finally {
      setSaving(false);
    }
  };

  // One-click status change — matches the DispatchPage detail panel
  // affordance so operators don't need to enter Edit mode just to
  // flip status. PUTs the same /lead_transport endpoint the editor
  // does, but with only the status field.
  const setStatusQuick = async (nextStatus) => {
    if (!transport || transport.status === nextStatus) return;
    setSaving(true); setError('');
    try {
      const res = await api.put('/lead_transport', { lead_id: leadId, status: nextStatus });
      setTransport(res.data?.transport || { ...transport, status: nextStatus });
      onChanged?.();
    } catch (err) {
      setError(extractApiError(err, 'Failed to update status'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="text-xs text-gray-400">Loading transport…</p>;

  if (!transport && !editing) {
    return (
      <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/40 p-4 text-center">
        <p className="text-sm text-gray-600 mb-2">No transport scheduled for this lead.</p>
        <button
          onClick={startEdit}
          className="px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          + Schedule transport
        </button>
        {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
      </div>
    );
  }

  if (editing) {
    return (
      <div className="rounded-xl border border-blue-200 bg-blue-50/30 p-3 space-y-2">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <label className="block">
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Date</span>
            <input type="date" value={draft.transport_date} onChange={(e) => setDraft({ ...draft, transport_date: e.target.value })}
              className="w-full bg-white border border-gray-200 rounded-lg px-2 py-1.5 text-xs" />
          </label>
          <label className="block">
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Time</span>
            <input type="time" value={draft.transport_time || ''} onChange={(e) => setDraft({ ...draft, transport_time: e.target.value })}
              className="w-full bg-white border border-gray-200 rounded-lg px-2 py-1.5 text-xs" />
          </label>
          <label className="block">
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Window (optional)</span>
            <input type="text" placeholder="e.g. 9 AM – 12 PM" value={draft.time_window} onChange={(e) => setDraft({ ...draft, time_window: e.target.value })}
              className="w-full bg-white border border-gray-200 rounded-lg px-2 py-1.5 text-xs" />
          </label>
        </div>

        <label className="block">
          <span className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Pickup location</span>
          <textarea rows={2} value={draft.pickup_location} onChange={(e) => setDraft({ ...draft, pickup_location: e.target.value })}
            className="w-full bg-white border border-gray-200 rounded-lg px-2 py-1.5 text-xs" />
        </label>
        <label className="block">
          <span className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Delivery location</span>
          <textarea rows={2} value={draft.delivery_location} onChange={(e) => setDraft({ ...draft, delivery_location: e.target.value })}
            className="w-full bg-white border border-gray-200 rounded-lg px-2 py-1.5 text-xs" />
        </label>
        <label className="block">
          <span className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Vehicle info</span>
          <input type="text" value={draft.vehicle_info} onChange={(e) => setDraft({ ...draft, vehicle_info: e.target.value })}
            className="w-full bg-white border border-gray-200 rounded-lg px-2 py-1.5 text-xs" />
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <label className="block">
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Status</span>
            <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}
              className="w-full bg-white border border-gray-200 rounded-lg px-2 py-1.5 text-xs">
              {TRANSPORT_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Transporter</span>
            <select value={draft.assigned_transporter_id ?? ''} onChange={(e) => setDraft({ ...draft, assigned_transporter_id: e.target.value })}
              className="w-full bg-white border border-gray-200 rounded-lg px-2 py-1.5 text-xs">
              <option value="">Unassigned</option>
              {transporters.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
        </div>

        <label className="block">
          <span className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Notes</span>
          <textarea rows={2} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            className="w-full bg-white border border-gray-200 rounded-lg px-2 py-1.5 text-xs" />
        </label>

        {error && <p className="text-xs text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={() => setEditing(false)} className="text-xs text-gray-500 hover:text-gray-800 px-2 py-1">Cancel</button>
          <button onClick={save} disabled={saving}
            className="px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40">
            {saving ? 'Saving…' : 'Save transport'}
          </button>
        </div>
      </div>
    );
  }

  const t = transport;
  const when = t.transport_date + (t.transport_time ? ` at ${t.transport_time}` : '') + (t.time_window ? ` (${t.time_window})` : '');

  return (
    <>
      <div className="rounded-xl border border-gray-100 bg-white">
        <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100">
          {/* Clickable status pills — operator can flip status in one
              click without entering Edit mode. Current status is the
              filled pill. Same UX as the DispatchPage detail panel. */}
          <div className="flex items-center gap-1 flex-wrap">
            {TRANSPORT_STATUSES.map((s) => {
              const active = t.status === s.key;
              return (
                <button
                  key={s.key}
                  onClick={() => setStatusQuick(s.key)}
                  disabled={saving || active}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold border transition ${
                    active
                      ? `${s.bg} ${s.text} border-transparent`
                      : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50 hover:text-gray-800'
                  }`}
                  title={active ? `Currently ${s.label}` : `Change to ${s.label}`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${active ? s.dot : 'bg-gray-300'}`} />
                  {s.label}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={startEdit} className="text-[11px] text-blue-600 hover:text-blue-800 px-2 py-1">Edit</button>
            <button onClick={() => setNotifyOpen(true)} className="text-[11px] text-emerald-700 hover:text-emerald-900 px-2 py-1 font-medium">Notify →</button>
            <button onClick={remove} className="text-[11px] text-red-600 hover:text-red-800 px-2 py-1">Remove</button>
          </div>
        </div>
        <table className="w-full text-xs">
          <tbody>
            <tr><td className="px-3 py-1.5 font-medium text-gray-600 w-2/5">When</td><td className="px-3 py-1.5 text-gray-900">{when || <span className="text-gray-300">—</span>}</td></tr>
            <tr className="bg-gray-50/40"><td className="px-3 py-1.5 font-medium text-gray-600">Pickup</td><td className="px-3 py-1.5 text-gray-900 whitespace-pre-wrap">{t.pickup_location || <span className="text-gray-300">—</span>}</td></tr>
            <tr><td className="px-3 py-1.5 font-medium text-gray-600">Delivery</td><td className="px-3 py-1.5 text-gray-900 whitespace-pre-wrap">{t.delivery_location || <span className="text-gray-300">—</span>}</td></tr>
            <tr className="bg-gray-50/40"><td className="px-3 py-1.5 font-medium text-gray-600">Vehicle</td><td className="px-3 py-1.5 text-gray-900">{t.vehicle_info || <span className="text-gray-300">—</span>}</td></tr>
            <tr><td className="px-3 py-1.5 font-medium text-gray-600">Transporter</td><td className="px-3 py-1.5 text-gray-900">
              {t.transporter_name ? (
                <span>{t.transporter_name}{t.transporter_phone ? ` · ${t.transporter_phone}` : ''}{t.transporter_email ? ` · ${t.transporter_email}` : ''}</span>
              ) : <span className="text-gray-300">Unassigned</span>}
            </td></tr>
            {t.notes && <tr className="bg-gray-50/40"><td className="px-3 py-1.5 font-medium text-gray-600">Notes</td><td className="px-3 py-1.5 text-gray-900 whitespace-pre-wrap">{t.notes}</td></tr>}
          </tbody>
        </table>
        {error && <p className="text-xs text-red-600 px-3 py-2">{error}</p>}
      </div>

      {notifyOpen && (
        <TransportNotifyModal
          transportId={t.id}
          transporters={transporters.filter((tr) => tr.is_active)}
          onClose={() => setNotifyOpen(false)}
          onSent={() => { setNotifyOpen(false); load(); onChanged?.(); }}
        />
      )}
    </>
  );
}

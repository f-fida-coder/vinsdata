import { useState, useEffect, useCallback } from 'react';
import api, { extractApiError } from '../api';
import { TRANSPORT_STATUSES, TRANSPORT_STATUS_BY_KEY } from '../lib/crm';

function TransportStatusPill({ statusKey }) {
  const s = TRANSPORT_STATUS_BY_KEY[statusKey] || TRANSPORT_STATUS_BY_KEY.new;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-semibold ${s.bg} ${s.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />{s.label}
    </span>
  );
}

function NotifyModal({ transportId, transporters, onClose, onSent }) {
  const [selected, setSelected] = useState(() => new Set(transporters.filter((t) => t.email).slice(0, 1).map((t) => t.id)));
  const [channel, setChannel]   = useState('email');
  const [subject, setSubject]   = useState('');
  const [body, setBody]         = useState('');
  const [sending, setSending]   = useState(false);
  const [error, setError]       = useState('');
  const [result, setResult]     = useState(null);
  // Past sends so operators can see what's already been delivered +
  // resend any row with a single click. Loaded once on mount; refreshes
  // after each new send so the row appears immediately.
  const [history, setHistory]   = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await api.get('/transport_notify', { params: { transport_id: transportId } });
      setHistory(Array.isArray(res.data) ? res.data : []);
    } catch { /* silent — history is nice-to-have, not blocking */ }
    finally { setHistoryLoading(false); }
  }, [transportId]);
  useEffect(() => { loadHistory(); }, [loadHistory]);

  const toggle = (id) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const send = async () => {
    if (selected.size === 0) { setError('Pick at least one transporter'); return; }
    setSending(true); setError('');
    try {
      const res = await api.post('/transport_notify', {
        transport_id:    transportId,
        transporter_ids: [...selected],
        channel,
        subject: subject || undefined,
        body:    body    || undefined,
      });
      setResult(res.data);
      loadHistory();
      onSent?.(res.data);
    } catch (err) {
      setError(extractApiError(err, 'Failed to send notifications'));
    } finally {
      setSending(false);
    }
  };

  // Re-fire a past notification with the exact same channel + subject + body
  // to the same transporter. Useful when the first send failed, or when the
  // operator wants to nudge the same transporter again.
  const resend = async (h) => {
    if (!h.transporter_id) return;
    setSending(true); setError('');
    try {
      const res = await api.post('/transport_notify', {
        transport_id:    transportId,
        transporter_ids: [h.transporter_id],
        channel:         h.channel,
        subject:         h.subject || undefined,
        body:            h.body    || undefined,
      });
      setResult(res.data);
      loadHistory();
      onSent?.(res.data);
    } catch (err) {
      setError(extractApiError(err, 'Failed to resend'));
    } finally {
      setSending(false);
    }
  };

  const fmtSentAt = (s) => {
    if (!s) return '';
    const d = new Date(String(s).replace(' ', 'T'));
    return Number.isNaN(d.getTime()) ? s : d.toLocaleString();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-gray-900/50" />
      <div className="relative bg-white w-full max-w-2xl rounded-2xl shadow-2xl m-4 flex flex-col max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900">Notify transporters</h3>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100">&times;</button>
        </div>
        <div className="px-5 py-4 space-y-4 overflow-y-auto">
          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Channel</label>
            <div className="flex gap-2">
              {['email','sms','manual'].map((c) => (
                <button
                  key={c}
                  onClick={() => setChannel(c)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg border ${channel === c ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'}`}
                >
                  {c === 'email' ? 'Email' : c === 'sms' ? 'SMS' : 'Manual / copy'}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Recipients</label>
            {transporters.length === 0 ? (
              <p className="text-xs text-gray-400 italic">No active transporters. Add one from the Dispatch page first.</p>
            ) : (
              <ul className="border border-gray-100 rounded-xl divide-y divide-gray-100 max-h-56 overflow-y-auto">
                {transporters.map((t) => {
                  const reachable = channel === 'email' ? !!t.email : channel === 'sms' ? !!t.phone : true;
                  return (
                    <li key={t.id} className={`flex items-center justify-between px-3 py-2 ${reachable ? '' : 'opacity-50'}`}>
                      <label className="flex items-center gap-2 cursor-pointer flex-1 min-w-0">
                        <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggle(t.id)} disabled={!reachable} />
                        <span className="text-sm text-gray-900 truncate">{t.name}</span>
                        <span className="text-[11px] text-gray-500 truncate">
                          {channel === 'email' ? (t.email || 'no email') : channel === 'sms' ? (t.phone || 'no phone') : (t.email || t.phone || 'no contact')}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {channel === 'email' && (
            <div>
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Subject (leave blank for default)</label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Auto-generated from vehicle + VIN"
                className="w-full bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 text-sm"
              />
            </div>
          )}

          <div>
            <label className="block text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Message (leave blank for default)</label>
            <textarea
              rows={5}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Default includes vehicle, pickup, delivery, and time."
              className="w-full bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 text-sm font-mono text-xs"
            />
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}
          {result && (
            <div className="rounded-lg bg-emerald-50 border border-emerald-100 px-3 py-2 text-xs text-emerald-800">
              Sent: {result.sent} / {result.attempted}. Lead transport marked as <b>notified</b>.
            </div>
          )}

          {/* Notification history — every past send (success or failed)
              with a per-row Resend button. Lets the operator see what
              went out, who got it, and re-fire a specific send (same
              transporter, channel, subject, body) if needed. */}
          <div className="pt-2">
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">History</p>
              {historyLoading && <span className="text-[10px] text-gray-400">loading…</span>}
            </div>
            {!historyLoading && history.length === 0 && (
              <p className="text-[11px] text-gray-400 italic">No notifications sent yet.</p>
            )}
            {history.length > 0 && (
              <ul className="rounded-lg border border-gray-100 divide-y divide-gray-100 bg-white max-h-48 overflow-y-auto">
                {history.map((h) => (
                  <li key={h.id} className="flex items-center justify-between gap-2 px-2.5 py-1.5">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 text-[11px]">
                        <span
                          className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                            h.status === 'sent'   ? 'bg-emerald-50 text-emerald-700'
                            : h.status === 'failed' ? 'bg-red-50 text-red-700'
                            : 'bg-gray-100 text-gray-600'
                          }`}
                        >
                          {h.status}
                        </span>
                        <span className="text-gray-700 truncate font-medium">{h.transporter_name || 'Unknown'}</span>
                        <span className="text-gray-400">·</span>
                        <span className="text-gray-500 uppercase">{h.channel}</span>
                        <span className="text-gray-300 ml-auto">{fmtSentAt(h.sent_at)}</span>
                      </div>
                      {h.recipient && (
                        <div className="text-[10px] text-gray-500 truncate mt-0.5">→ {h.recipient}</div>
                      )}
                      {h.error_message && (
                        <div className="text-[10px] text-red-600 truncate mt-0.5" title={h.error_message}>
                          {h.error_message}
                        </div>
                      )}
                    </div>
                    {h.transporter_id && (
                      <button
                        onClick={() => resend(h)}
                        disabled={sending}
                        className="shrink-0 px-2 py-0.5 text-[11px] font-medium text-blue-700 hover:bg-blue-50 rounded border border-blue-200 disabled:opacity-40"
                        title="Resend the same message to this transporter"
                      >
                        Resend
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-900">Close</button>
          <button
            onClick={send}
            disabled={sending || selected.size === 0}
            className="px-4 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40"
          >
            {sending ? 'Sending…' : `Send to ${selected.size}`}
          </button>
        </div>
      </div>
    </div>
  );
}

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
        <NotifyModal
          transportId={t.id}
          transporters={transporters.filter((tr) => tr.is_active)}
          onClose={() => setNotifyOpen(false)}
          onSent={() => { setNotifyOpen(false); load(); onChanged?.(); }}
        />
      )}
    </>
  );
}

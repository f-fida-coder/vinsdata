import { useState, useEffect, useCallback } from 'react';
import api, { extractApiError } from '../api';

/**
 * Send the transporter an SMS / email confirming the dispatch.
 *
 * Both the Dispatch page's event panel and the Lead drawer's Transport
 * section mount this; consolidating here keeps the two surfaces from
 * drifting (history view, resend button, default-message rules).
 *
 * Channel mapping:
 *   email   → Gmail SMTP / SendGrid (server picks based on configured
 *             env vars). Subject + body pre-filled from the lead +
 *             transport row on the server when left blank.
 *   sms     → OpenPhone via dispatchOpenPhoneJob. Same E.164
 *             canonicalization as the rest of the CRM's outbound SMS.
 *   manual  → Logged only; for "I called them" / "copy-pasted" cases.
 *
 * Props:
 *   transportId   number   — lead_transport.id, required
 *   transporters  array    — visible in the recipients list; the
 *                            parent should pre-filter to is_active
 *   onClose       fn       — close handler
 *   onSent        fn       — called after each successful send, so
 *                            the parent can refresh its row
 */
export default function TransportNotifyModal({ transportId, transporters, onClose, onSent }) {
  // Pre-select the first transporter that's reachable by email (the
  // initial channel default). If nobody has an email we just leave the
  // selection empty — the operator picks.
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
          <div>
            <h3 className="text-base font-semibold text-gray-900">Notify transporter</h3>
            <p className="text-[11px] text-gray-500 mt-0.5">
              Sends through OpenPhone (SMS) or Gmail/SendGrid (email). Leave subject &amp; message blank
              for an auto-generated note containing vehicle, pickup, delivery, and time slot.
            </p>
          </div>
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

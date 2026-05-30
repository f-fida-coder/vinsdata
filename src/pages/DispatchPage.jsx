import { Fragment, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import api, { extractApiError } from '../api';
import { SectionHeader, Button, Icon } from '../components/ui';
import { TRANSPORT_STATUSES, TRANSPORT_STATUS_BY_KEY } from '../lib/crm';
import TransportNotifyModal from '../components/TransportNotifyModal';
import '../styles/bos-calendar.css';

function StatusCards({ summary, activeStatus, onSelect }) {
  // Phones get a single column so the count + label aren't squeezed; the
  // grid widens as the viewport allows up to all 6 cards on one row.
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
      {TRANSPORT_STATUSES.map((s) => {
        const active = activeStatus === s.key;
        return (
          <button
            key={s.key}
            onClick={() => onSelect(active ? '' : s.key)}
            className={`flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl border text-left transition ${
              active
                ? `${s.bg} border-current ${s.text} shadow-sm`
                : 'bg-white border-gray-100 hover:border-gray-200 hover:shadow-sm'
            }`}
            style={active ? { borderColor: s.hex } : undefined}
          >
            <div className="min-w-0">
              <p className={`text-[10px] font-semibold uppercase tracking-wider ${active ? s.text : 'text-gray-500'}`}>{s.label}</p>
              <p className={`text-xl font-semibold leading-tight mt-0.5 ${active ? s.text : 'text-gray-900'}`}>
                {summary?.[s.key] || 0}
              </p>
            </div>
            <span
              className={`w-2.5 h-2.5 rounded-full shrink-0 ${active ? '' : s.dot}`}
              style={active ? { background: s.hex } : undefined}
            />
          </button>
        );
      })}
    </div>
  );
}

function TransporterPanel({ transporters, onChanged }) {
  const [creating, setCreating]   = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft]         = useState({ name: '', phone: '', email: '', notes: '' });
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState('');

  const startCreate = () => { setEditingId(null); setDraft({ name: '', phone: '', email: '', notes: '' }); setCreating(true); };
  const startEdit = (t) => { setCreating(false); setEditingId(t.id); setDraft({ name: t.name || '', phone: t.phone || '', email: t.email || '', notes: t.notes || '' }); };
  const cancel = () => { setCreating(false); setEditingId(null); setError(''); };

  const save = async () => {
    if (!draft.name.trim()) { setError('Name is required'); return; }
    setSaving(true); setError('');
    try {
      if (editingId) {
        await api.put('/transporters', { id: editingId, ...draft });
      } else {
        await api.post('/transporters', draft);
      }
      cancel();
      onChanged?.();
    } catch (err) {
      setError(extractApiError(err, 'Failed to save'));
    } finally {
      setSaving(false);
    }
  };

  const deactivate = async (t) => {
    if (!window.confirm(`Deactivate ${t.name}? Existing assignments will keep showing the name.`)) return;
    try { await api.delete('/transporters', { data: { id: t.id } }); onChanged?.(); }
    catch (err) { window.alert(extractApiError(err, 'Failed to deactivate')); }
  };

  const reactivate = async (t) => {
    try { await api.put('/transporters', { id: t.id, is_active: true }); onChanged?.(); }
    catch (err) { window.alert(extractApiError(err, 'Failed to reactivate')); }
  };

  const activeCount = transporters.filter((t) => t.is_active).length;
  const inputCls = 'w-full bg-white border border-gray-200 rounded-md px-2 py-1.5 text-xs focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none';

  return (
    <aside className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden flex flex-col">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon name="users" className="text-gray-400" />
          <h3 className="text-base font-semibold text-gray-900">Transporters</h3>
          {activeCount > 0 && (
            <span className="text-[11px] font-medium bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
              {activeCount} active
            </span>
          )}
        </div>
        <button
          onClick={startCreate}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-600 hover:text-blue-800"
        >
          <Icon name="plus" size={12}/> Add
        </button>
      </div>

      <div className="flex-1 px-3 py-3 space-y-2 overflow-y-auto" style={{ minHeight: 200, maxHeight: 'calc(100vh - 360px)' }}>
        {(creating || editingId) && (
          <div className="rounded-lg border border-blue-200 bg-blue-50/30 p-2.5 space-y-1.5">
            <input className={inputCls} placeholder="Name" value={draft.name}  onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            <input className={inputCls} placeholder="Phone" value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />
            <input className={inputCls} placeholder="Email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} />
            <textarea rows={2} className={inputCls} placeholder="Notes" value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
            {error && <p className="text-xs text-red-600">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={cancel} className="text-xs text-gray-500 hover:text-gray-800 px-2 py-1">Cancel</button>
              <button onClick={save} disabled={saving} className="px-3 py-1 text-xs font-medium bg-blue-600 text-white rounded-md disabled:opacity-40">
                {saving ? 'Saving…' : (editingId ? 'Save' : 'Add')}
              </button>
            </div>
          </div>
        )}

        {transporters.length === 0 && !creating ? (
          <div className="text-center py-8 px-2">
            <div className="w-10 h-10 mx-auto rounded-full bg-gray-100 flex items-center justify-center mb-2">
              <Icon name="truck" size={18} className="text-gray-400"/>
            </div>
            <p className="text-sm font-medium text-gray-700">No transporters yet</p>
            <p className="text-[11px] text-gray-500 mt-0.5 mb-3">Add a carrier so you can assign sales to them and notify by email.</p>
            <button
              onClick={startCreate}
              className="text-xs font-medium text-blue-600 hover:text-blue-800"
            >
              + Add your first transporter
            </button>
          </div>
        ) : (
          transporters.map((t) => (
            <div key={t.id} className={`group rounded-lg border px-2.5 py-2 transition ${t.is_active ? 'border-gray-100 bg-white hover:border-gray-200' : 'border-gray-100 bg-gray-50/60 opacity-70'}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900 truncate">
                    {t.name}
                    {!t.is_active && <span className="text-[10px] text-gray-500 ml-1.5 font-normal">(inactive)</span>}
                  </p>
                  {(t.phone || t.email) && (
                    <div className="flex flex-col gap-0.5 mt-0.5">
                      {t.phone && <p className="text-[11px] text-gray-500 truncate flex items-center gap-1"><Icon name="phone" size={10}/>{t.phone}</p>}
                      {t.email && <p className="text-[11px] text-gray-500 truncate flex items-center gap-1"><Icon name="mail"  size={10}/>{t.email}</p>}
                    </div>
                  )}
                  {t.notes && <p className="text-[11px] text-gray-600 mt-1 line-clamp-2">{t.notes}</p>}
                </div>
                <div className="flex flex-col items-end gap-0.5 text-[10px] opacity-0 group-hover:opacity-100 transition">
                  <button onClick={() => startEdit(t)} className="text-blue-600 hover:text-blue-800">Edit</button>
                  {t.is_active
                    ? <button onClick={() => deactivate(t)} className="text-red-600 hover:text-red-800">Deactivate</button>
                    : <button onClick={() => reactivate(t)} className="text-emerald-700 hover:text-emerald-900">Reactivate</button>}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}

// Compact address renderer with a map-pin link to Google Maps. The
// pin sits inline-block to the right so it doesn't break the
// whitespace-pre-wrap formatting of multi-line addresses. No API key
// or embed — just google.com/maps?q=<encoded> opens in a new tab.
function AddressWithMap({ address }) {
  return (
    <span>
      <span className="whitespace-pre-wrap">{address}</span>
      <a
        href={`https://www.google.com/maps?q=${encodeURIComponent(address)}`}
        target="_blank"
        rel="noreferrer"
        title="Open in Google Maps"
        className="ml-1.5 text-blue-600 hover:text-blue-800 no-underline"
      >
        📍
      </a>
    </span>
  );
}

// Pre-written message templates the operator can drop into the comm
// section without retyping the same boilerplate. Variables in the
// {{name}} form are filled from the dispatch row (vehicle, pickup,
// delivery, date, time). Unused variables stay as literal "{{var}}"
// so the operator knows what to fill in by hand.
//
// SMS templates aim for ~160 chars (single GSM-7 segment); email
// templates can be longer and may set a subject.
const TRANSPORT_TEMPLATES = [
  {
    key:     'pickup_confirm',
    label:   '✅ Confirm pickup',
    subject: 'Pickup confirmed — {{vehicle}}',
    body:    'Hi, confirming pickup of {{vehicle}} on {{date}}{{time_clause}}. Pickup at: {{pickup}}. Please reply to confirm. Thanks!',
  },
  {
    key:     'on_the_way',
    label:   '🚛 On the way',
    subject: 'On the way — {{vehicle}}',
    body:    'On my way to pick up the {{vehicle}}. ETA shortly — will text on arrival.',
  },
  {
    key:     'vehicle_ready',
    label:   '🔑 Vehicle ready',
    subject: 'Vehicle ready — {{vehicle}}',
    body:    'The {{vehicle}} is ready for pickup at {{pickup}}. Let me know when you\'re on the way.',
  },
  {
    key:     'reschedule',
    label:   '🔁 Need to reschedule',
    subject: 'Reschedule needed — {{vehicle}}',
    body:    'Need to reschedule the {{vehicle}} pickup originally set for {{date}}{{time_clause}}. Please reply with a new time that works.',
  },
  {
    key:     'delivered',
    label:   '📦 Delivered',
    subject: 'Delivered — {{vehicle}}',
    body:    'The {{vehicle}} has been delivered to {{delivery}}. Please reply to confirm receipt. Thank you.',
  },
];

function renderTransportTemplate(template, event) {
  const vehicle  = event?.vehicle_info || 'the vehicle';
  const pickup   = event?.pickup_location   || '{{pickup}}';
  const delivery = event?.delivery_location || '{{delivery}}';
  const date     = event?.transport_date    || '{{date}}';
  // Build "at HH:MM" / "(window)" if either is set, else empty so the
  // sentence reads cleanly with no awkward placeholders.
  let timeClause = '';
  if (event?.transport_time) timeClause += ` at ${event.transport_time}`;
  if (event?.time_window)    timeClause += ` (${event.time_window})`;
  const vars = { vehicle, pickup, delivery, date, time_clause: timeClause };
  const sub = (s) => String(s || '').replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (m, k) => vars[k.toLowerCase()] ?? m);
  return { subject: sub(template.subject), body: sub(template.body) };
}

// Communication log + inline quick-send (SMS or Email). Lives inside
// the dispatch side panel. Reads /api/transport_notify history (the
// same endpoint the Notify modal uses), and POSTs a single-channel
// single-recipient send. Failures bubble inline.
function TransportCommSection({ transportId, assignedTransporter, refreshKey, event }) {
  const [history, setHistory]     = useState([]);
  const [loading, setLoading]     = useState(true);
  const [channel, setChannel]     = useState('sms'); // sms | email
  const [subject, setSubject]     = useState('');
  const [body, setBody]           = useState('');
  const [sending, setSending]     = useState(false);
  const [sendError, setSendError] = useState('');
  const [sendInfo,  setSendInfo]  = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/transport_notify', { params: { transport_id: transportId } });
      setHistory(Array.isArray(res.data) ? res.data : []);
    } catch {
      /* nice-to-have, ignore */
    } finally {
      setLoading(false);
    }
  }, [transportId]);

  // Reload on mount, on transport switch, and after the parent's
  // auto-notification banner fires (refreshKey changes).
  useEffect(() => { load(); }, [load, refreshKey]);

  // Reachability check per channel — used to disable Send + show why.
  const reachableOn = (ch) =>
    !!assignedTransporter && (ch === 'sms' ? !!assignedTransporter.phone : !!assignedTransporter.email);

  // Apply a template into the channel-appropriate fields. Subject is
  // only used for email; on SMS we drop it.
  const applyTemplate = (key) => {
    const t = TRANSPORT_TEMPLATES.find((x) => x.key === key);
    if (!t) return;
    const r = renderTransportTemplate(t, event);
    setBody(r.body);
    if (channel === 'email') setSubject(r.subject);
  };

  const send = async () => {
    if (!assignedTransporter) {
      setSendError('Assign a transporter first.');
      return;
    }
    if (!reachableOn(channel)) {
      setSendError(`${assignedTransporter.name} has no ${channel === 'sms' ? 'phone' : 'email'} on file.`);
      return;
    }
    const trimmed = body.trim();
    if (!trimmed) {
      setSendError('Type a message before sending.');
      return;
    }
    setSending(true); setSendError(''); setSendInfo('');
    try {
      const payload = {
        transport_id:    transportId,
        transporter_ids: [assignedTransporter.id],
        channel,
        body:            trimmed,
      };
      if (channel === 'email' && subject.trim()) payload.subject = subject.trim();
      const res = await api.post('/transport_notify', payload);
      const sentCount = res.data?.sent ?? 0;
      const attempted = res.data?.attempted ?? 0;
      if (sentCount > 0) {
        setSendInfo(`${channel === 'sms' ? 'Text' : 'Email'} sent (${sentCount}/${attempted}).`);
        setBody('');
        if (channel === 'email') setSubject('');
      } else {
        const fr = res.data?.results?.[0]?.error || 'send failed';
        setSendError(fr);
      }
      load();
    } catch (err) {
      setSendError(extractApiError(err, 'Failed to send'));
    } finally {
      setSending(false);
    }
  };

  const fmtTime = (s) => {
    if (!s) return '';
    const d = new Date(String(s).replace(' ', 'T'));
    if (Number.isNaN(d.getTime())) return s;
    const diffSec = Math.floor((Date.now() - d.getTime()) / 1000);
    if (diffSec < 60) return 'just now';
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
    if (diffSec < 86400 * 7) return `${Math.floor(diffSec / 86400)}d ago`;
    return d.toLocaleDateString();
  };

  const recent = history.slice(0, 8);

  return (
    <div className="rounded-xl border border-gray-100 bg-white overflow-hidden">
      <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
          Communication
        </div>
        <div className="text-[10px] text-gray-400">
          {loading ? 'loading…' : history.length === 0 ? 'no sends yet' : `${history.length} total`}
        </div>
      </div>

      {/* History list */}
      {!loading && recent.length > 0 && (
        <ul className="divide-y divide-gray-100 max-h-44 overflow-y-auto">
          {recent.map((h) => (
            <li key={h.id} className="px-3 py-1.5 text-[11px]">
              <div className="flex items-center gap-1.5">
                <span
                  className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                    h.status === 'sent'   ? 'bg-emerald-50 text-emerald-700'
                    : h.status === 'failed' ? 'bg-red-50 text-red-700'
                    : 'bg-gray-100 text-gray-600'
                  }`}
                >
                  {h.status === 'sent' ? '✓' : h.status === 'failed' ? '✗' : '•'} {h.channel.toUpperCase()}
                </span>
                <span className="text-gray-700 truncate font-medium">{h.transporter_name || 'Unknown'}</span>
                <span className="text-gray-300 ml-auto whitespace-nowrap">{fmtTime(h.sent_at)}</span>
              </div>
              {h.recipient && (
                <div className="text-[10px] text-gray-500 truncate mt-0.5 ml-[1px]">→ {h.recipient}</div>
              )}
              {h.error_message && (
                <div className="text-[10px] text-red-600 truncate mt-0.5" title={h.error_message}>
                  {h.error_message}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Inline quick-send (SMS or Email) */}
      <div className="border-t border-gray-100 px-3 py-2.5 bg-gray-50/40 space-y-2">
        {/* Channel toggle. Both buttons render so the operator can see
            which methods are even possible, but each disables when the
            transporter doesn't have the corresponding contact info. */}
        <div className="flex items-center gap-1.5">
          {['sms', 'email'].map((c) => {
            const ok = reachableOn(c);
            const active = channel === c;
            return (
              <button
                key={c}
                onClick={() => { setChannel(c); setSendError(''); setSendInfo(''); }}
                disabled={!ok}
                title={!ok && assignedTransporter ? `${assignedTransporter.name} has no ${c === 'sms' ? 'phone' : 'email'} on file` : undefined}
                className={`px-2 py-1 text-[11px] font-semibold rounded-md border transition ${
                  active
                    ? 'bg-emerald-600 text-white border-emerald-600'
                    : ok
                      ? 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                      : 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
                }`}
              >
                {c === 'sms' ? '✆ Text' : '✉ Email'}
              </button>
            );
          })}
          <div className="text-[10px] text-gray-500 ml-auto truncate min-w-0">
            {assignedTransporter ? (
              <>To <b>{assignedTransporter.name}</b>
                {channel === 'sms'
                  ? (assignedTransporter.phone ? ` · ${assignedTransporter.phone}` : '')
                  : (assignedTransporter.email ? ` · ${assignedTransporter.email}` : '')}
              </>
            ) : <span className="text-gray-400 italic">Assign a transporter to enable.</span>}
          </div>
        </div>

        {/* Template picker — pre-fills body (and subject on email). */}
        {assignedTransporter && (
          <select
            value=""
            onChange={(e) => { applyTemplate(e.target.value); e.target.value = ''; }}
            className="w-full bg-white border border-gray-200 rounded-md px-2 py-1 text-xs text-gray-700"
          >
            <option value="">Use a template…</option>
            {TRANSPORT_TEMPLATES.map((t) => (
              <option key={t.key} value={t.key}>{t.label}</option>
            ))}
          </select>
        )}

        {/* Subject (email only) */}
        {channel === 'email' && (
          <input
            type="text"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Subject (optional — defaults to vehicle + VIN)"
            disabled={!reachableOn('email') || sending}
            className="w-full bg-white border border-gray-200 rounded-md px-2 py-1.5 text-xs disabled:bg-gray-50 disabled:text-gray-400"
          />
        )}

        <textarea
          rows={channel === 'email' ? 4 : 2}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={channel === 'sms'
            ? 'Quick text — e.g. Confirming pickup tomorrow 9 AM, please confirm.'
            : 'Email body — leave blank to use the default with vehicle + pickup + delivery + time.'}
          disabled={!reachableOn(channel) || sending}
          className="w-full bg-white border border-gray-200 rounded-md px-2 py-1.5 text-xs disabled:bg-gray-50 disabled:text-gray-400"
        />
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] text-gray-400">{body.length} chars</span>
          {sendError && <span className="text-[10px] text-red-600 truncate" title={sendError}>{sendError}</span>}
          {sendInfo  && <span className="text-[10px] text-emerald-700">{sendInfo}</span>}
          <button
            onClick={send}
            disabled={sending || !reachableOn(channel) || !body.trim()}
            className="ml-auto px-3 py-1 text-[11px] font-semibold text-white bg-emerald-600 rounded-md hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {sending ? 'Sending…' : (channel === 'sms' ? 'Send text' : 'Send email')}
          </button>
        </div>
      </div>
    </div>
  );
}

function EventSidePanel({ event, transporters, onClose, onChanged }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState('');
  const [notifyOpen, setNotifyOpen] = useState(false);
  // Banner shown for ~6s after the save endpoint reports auto-notifications
  // (i.e. transporter was assigned for the first time). Tells the
  // operator that SMS + email went out so they don't double-notify.
  const [autoNotice, setAutoNotice] = useState(null);
  const [draft, setDraft]     = useState({
    transport_date:          event.transport_date,
    transport_time:          event.transport_time || '',
    time_window:             event.time_window    || '',
    pickup_location:         event.pickup_location || '',
    delivery_location:       event.delivery_location || '',
    vehicle_info:            event.vehicle_info || '',
    status:                  event.status,
    assigned_transporter_id: event.assigned_transporter_id ?? '',
    notes:                   event.notes || '',
  });

  const save = async () => {
    setSaving(true); setError('');
    try {
      const res = await api.put('/lead_transport', {
        lead_id: event.lead_id,
        ...draft,
        assigned_transporter_id: draft.assigned_transporter_id === '' ? null : Number(draft.assigned_transporter_id),
      });
      const autos = res.data?.auto_notifications || [];
      if (autos.length > 0) setAutoNotice(autos);
      setEditing(false);
      onChanged?.();
    } catch (err) {
      setError(extractApiError(err, 'Failed to save'));
    } finally {
      setSaving(false);
    }
  };

  const setStatusQuick = async (status) => {
    if (status === event.status) return;
    // Cancellation is destructive enough that operators should confirm
    // — once cancelled the row is hidden from active calendar views.
    if (status === 'cancelled' && !window.confirm('Mark this dispatch as cancelled? You can still edit it afterwards, but it will be hidden from active views.')) {
      return;
    }
    setSaving(true); setError('');
    try {
      await api.put('/lead_transport', { lead_id: event.lead_id, status });
      onChanged?.();
    } catch (err) {
      setError(extractApiError(err, 'Failed to update status'));
    } finally {
      setSaving(false);
    }
  };

  // Auto-clear the auto-notification banner after 8s so it doesn't
  // hang around forever.
  useEffect(() => {
    if (!autoNotice) return undefined;
    const t = setTimeout(() => setAutoNotice(null), 8000);
    return () => clearTimeout(t);
  }, [autoNotice]);

  const inputCls = 'w-full bg-white border border-gray-200 rounded-md px-2 py-1.5 text-xs';

  return (
    <div className="fixed inset-0 z-30 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-gray-900/40" />
      <aside className="relative bg-white w-full sm:w-[460px] h-full shadow-2xl flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="shrink-0 border-b border-gray-100 px-5 py-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold">Bill of Sale</p>
              <h2 className="text-base font-semibold text-gray-900 truncate mt-0.5">{event.title}</h2>
              {event.vehicle_vin && <p className="text-[11px] text-gray-500 mt-1 font-mono">VIN {event.vehicle_vin}</p>}
            </div>
            <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100">&times;</button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Auto-notification banner — shows up after the operator
              assigns a transporter for the first time. Lists what
              channels actually went out (and which failed) so they
              don't double-fire from the manual Notify modal. */}
          {autoNotice && autoNotice.length > 0 && (
            <div
              className={`text-[12px] rounded-lg px-3 py-2 border ${
                autoNotice.every((n) => n.status === 'sent')
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-amber-50 border-amber-200 text-amber-800'
              }`}
            >
              <div className="font-semibold mb-1">Transporter auto-notified</div>
              <ul className="space-y-0.5">
                {autoNotice.map((n, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span className="uppercase text-[10px] font-bold tracking-wider w-10">{n.channel}</span>
                    <span>{n.status === 'sent' ? '✓ delivered' : `✗ ${n.error || 'failed'}`}</span>
                    {n.recipient && <span className="text-[10px] opacity-70">→ {n.recipient}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Dispatch status workflow. Renders the linear forward flow
              (new → notified → assigned → in_transit → delivered) as
              connected pills with the current step highlighted +
              previous steps shown as completed. Cancelled lives off to
              the side with its own confirm. Each pill is clickable so
              the operator can jump to any state — there's no enforced
              forward-only progression, just visual sugar. */}
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1.5">Dispatch status</div>
            <div className="flex items-center gap-0">
              {(() => {
                const flow = TRANSPORT_STATUSES.filter((s) => s.key !== 'cancelled');
                const currentIdx = flow.findIndex((s) => s.key === event.status);
                return flow.map((s, idx) => {
                  const isCurrent  = event.status === s.key;
                  const isPast     = currentIdx >= 0 && idx < currentIdx;
                  const isFuture   = currentIdx >= 0 && idx > currentIdx;
                  return (
                    <Fragment key={s.key}>
                      <button
                        onClick={() => setStatusQuick(s.key)}
                        disabled={saving}
                        className={`px-2 py-1 text-[11px] font-medium rounded-md border transition whitespace-nowrap ${
                          isCurrent  ? `${s.bg} ${s.text} border-transparent shadow-sm` :
                          isPast     ? 'bg-emerald-50 text-emerald-700 border-transparent' :
                          isFuture   ? 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50 hover:text-gray-800' :
                                       'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                        }`}
                        title={isCurrent ? `Currently ${s.label}` : `Set to ${s.label}`}
                      >
                        {isPast && '✓ '}{s.label}
                      </button>
                      {idx < flow.length - 1 && (
                        <span className={`mx-1 text-[10px] ${isPast || isCurrent ? 'text-emerald-500' : 'text-gray-300'}`}>→</span>
                      )}
                    </Fragment>
                  );
                });
              })()}
              <span className="mx-1.5 text-[10px] text-gray-300">·</span>
              <button
                onClick={() => setStatusQuick('cancelled')}
                disabled={saving || event.status === 'cancelled'}
                className={`px-2 py-1 text-[11px] font-medium rounded-md border transition ${
                  event.status === 'cancelled'
                    ? 'bg-rose-50 text-rose-700 border-transparent shadow-sm'
                    : 'bg-white text-rose-600 border-rose-200 hover:bg-rose-50'
                }`}
                title="Cancel this dispatch"
              >
                ✕ Cancel
              </button>
            </div>
          </div>

          {!editing ? (
            <div className="rounded-xl border border-gray-100 bg-white">
              <table className="w-full text-xs">
                <tbody>
                  <tr><td className="px-3 py-1.5 font-medium text-gray-600 w-2/5">Date</td><td className="px-3 py-1.5 text-gray-900">{event.transport_date}{event.transport_time ? ` at ${event.transport_time}` : ''}{event.time_window ? ` (${event.time_window})` : ''}</td></tr>
                  <tr className="bg-gray-50/40">
                    <td className="px-3 py-1.5 font-medium text-gray-600">Pickup</td>
                    <td className="px-3 py-1.5 text-gray-900 whitespace-pre-wrap">
                      {event.pickup_location
                        ? <AddressWithMap address={event.pickup_location}/>
                        : '—'}
                    </td>
                  </tr>
                  <tr>
                    <td className="px-3 py-1.5 font-medium text-gray-600">Delivery</td>
                    <td className="px-3 py-1.5 text-gray-900 whitespace-pre-wrap">
                      {event.delivery_location
                        ? <AddressWithMap address={event.delivery_location}/>
                        : '—'}
                    </td>
                  </tr>
                  <tr className="bg-gray-50/40"><td className="px-3 py-1.5 font-medium text-gray-600">Vehicle</td><td className="px-3 py-1.5 text-gray-900">{event.vehicle_info || '—'}</td></tr>
                  <tr><td className="px-3 py-1.5 font-medium text-gray-600">Transporter</td><td className="px-3 py-1.5 text-gray-900">{event.transporter_name || <span className="text-gray-400">Unassigned</span>}</td></tr>
                  {/* If both pickup + delivery are set, surface a single
                      "Directions" link that opens the route in Google
                      Maps so the operator can eyeball mileage / time. */}
                  {event.pickup_location && event.delivery_location && (
                    <tr className="bg-gray-50/40">
                      <td className="px-3 py-1.5 font-medium text-gray-600">Route</td>
                      <td className="px-3 py-1.5 text-gray-900">
                        <a
                          href={`https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(event.pickup_location)}&destination=${encodeURIComponent(event.delivery_location)}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 hover:underline"
                          title="Open driving directions in Google Maps"
                        >
                          🗺 Directions →
                        </a>
                      </td>
                    </tr>
                  )}
                  {event.notes && <tr className="bg-gray-50/40"><td className="px-3 py-1.5 font-medium text-gray-600">Notes</td><td className="px-3 py-1.5 text-gray-900 whitespace-pre-wrap">{event.notes}</td></tr>}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <input type="date" className={inputCls} value={draft.transport_date} onChange={(e) => setDraft({ ...draft, transport_date: e.target.value })} />
                <input type="time" className={inputCls} value={draft.transport_time || ''} onChange={(e) => setDraft({ ...draft, transport_time: e.target.value })} />
                <input type="text" placeholder="Window" className={inputCls} value={draft.time_window} onChange={(e) => setDraft({ ...draft, time_window: e.target.value })} />
              </div>
              <textarea rows={2} placeholder="Pickup location" className={inputCls} value={draft.pickup_location} onChange={(e) => setDraft({ ...draft, pickup_location: e.target.value })} />
              <textarea rows={2} placeholder="Delivery location" className={inputCls} value={draft.delivery_location} onChange={(e) => setDraft({ ...draft, delivery_location: e.target.value })} />
              <input className={inputCls} placeholder="Vehicle info" value={draft.vehicle_info} onChange={(e) => setDraft({ ...draft, vehicle_info: e.target.value })} />
              <select className={inputCls} value={draft.assigned_transporter_id ?? ''} onChange={(e) => setDraft({ ...draft, assigned_transporter_id: e.target.value })}>
                <option value="">Unassigned</option>
                {transporters.filter((t) => t.is_active).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <textarea rows={2} placeholder="Notes" className={inputCls} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
            </div>
          )}

          {/* Communication log + quick SMS send. Pinned inside the
              side panel (not behind a modal) so the operator can
              glance at past sends and shoot a quick text without
              clicking through. The full Notify modal is still
              available via the footer button for multi-channel or
              multi-recipient blasts. */}
          {event.id && (
            <TransportCommSection
              transportId={event.id}
              assignedTransporter={transporters.find((t) => t.id === event.assigned_transporter_id) || null}
              refreshKey={autoNotice ? Date.now() : 0}
              event={event}
            />
          )}

          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>

        <div className="shrink-0 border-t border-gray-100 px-5 py-3 flex justify-between items-center gap-2 flex-wrap">
          <div className="flex gap-3 text-[11px]">
            <a href={`/leads?lead_id=${event.lead_id}`} className="text-blue-600 hover:text-blue-800">Open lead →</a>
            <a href={`/api/bill_of_sale?lead_id=${event.lead_id}&format=pdf`} target="_blank" rel="noreferrer" className="text-emerald-700 hover:text-emerald-900 font-medium">Download Bill of Sale PDF</a>
          </div>
          {!editing ? (
            <div className="flex gap-2 flex-wrap justify-end">
              <button
                onClick={async () => {
                  if (!window.confirm('Delete this dispatch event? The lead and BoS stay; only the transport entry is removed.')) return;
                  try {
                    await api.delete('/lead_transport', { data: { lead_id: event.lead_id } });
                    onChanged?.();
                    onClose?.();
                  } catch (err) {
                    setError(extractApiError(err, 'Failed to delete'));
                  }
                }}
                className="px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 rounded-md"
              >
                Delete
              </button>
              <button onClick={() => setEditing(true)} className="px-3 py-1.5 text-xs font-medium bg-white border border-gray-200 text-gray-800 rounded-md hover:bg-gray-50">
                Edit
              </button>
              {/* Primary CTA — the operator's main job on this panel is
                  to confirm the dispatch to the transporter. Opening the
                  notify modal pre-fills body with vehicle + pickup +
                  delivery + time from this row server-side; the operator
                  picks channel (SMS/email/manual) + recipients and sends. */}
              <button
                onClick={() => setNotifyOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-emerald-600 text-white rounded-md hover:bg-emerald-700"
                title="Send the transporter a text or email confirming the dispatch"
              >
                <Icon name="mail" size={12}/> Notify transporter
              </button>
            </div>
          ) : (
            <div className="flex gap-2">
              <button onClick={() => setEditing(false)} className="text-xs text-gray-500 hover:text-gray-800 px-2 py-1">Cancel</button>
              <button onClick={save} disabled={saving} className="px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-md disabled:opacity-40">
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          )}
        </div>

        {notifyOpen && (
          <TransportNotifyModal
            transportId={event.id}
            transporters={transporters.filter((t) => t.is_active)}
            onClose={() => setNotifyOpen(false)}
            onSent={() => { setNotifyOpen(false); onChanged?.(); }}
          />
        )}
      </aside>
    </div>
  );
}

export default function DispatchPage() {
  const calendarRef                 = useRef(null);
  const [events, setEvents]         = useState([]);
  const [summary, setSummary]       = useState({});
  const [transporters, setTransporters] = useState([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState('');
  const [statusFilter, setStatusFilter]           = useState('');
  const [transporterFilter, setTransporterFilter] = useState('');
  const [search, setSearch]         = useState('');
  const [openEvent, setOpenEvent]   = useState(null);
  const [range, setRange]           = useState({ start: null, end: null });
  const [addOpen, setAddOpen]       = useState(false);

  const loadTransporters = useCallback(async () => {
    try {
      const res = await api.get('/transporters', { params: { include_inactive: 1 } });
      setTransporters(res.data || []);
    } catch (err) {
      setError(extractApiError(err, 'Failed to load transporters'));
    }
  }, []);

  const loadEvents = useCallback(async () => {
    if (!range.start || !range.end) return;
    setLoading(true);
    try {
      const params = { start: range.start, end: range.end };
      if (statusFilter) params.status = statusFilter;
      if (transporterFilter) params.transporter_id = transporterFilter;
      const res = await api.get('/dispatch_calendar', { params });
      setEvents(res.data.events || []);
      setSummary(res.data.summary || {});
      setError('');
    } catch (err) {
      setError(extractApiError(err, 'Failed to load dispatch data'));
    } finally {
      setLoading(false);
    }
  }, [range.start, range.end, statusFilter, transporterFilter]);

  useEffect(() => { loadTransporters(); }, [loadTransporters]);
  useEffect(() => { loadEvents(); }, [loadEvents]);

  const filteredEvents = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return events;
    return events.filter((e) =>
      (e.title || '').toLowerCase().includes(q)
      || (e.vehicle_vin || '').toLowerCase().includes(q)
      || (e.lead_name || '').toLowerCase().includes(q)
      || (e.transporter_name || '').toLowerCase().includes(q)
    );
  }, [events, search]);

  // Calendar events were rendering with a saturated background + the
  // default white text — on the blue/violet/rose statuses that combo
  // was nearly unreadable. Switch to a pastel background (`bgSoft`)
  // with the saturated hex kept on the LEFT BORDER as a status
  // stripe, and force black-leaning text so titles are legible.
  const BG_SOFT = {
    '#6b7280': '#f3f4f6', // new        → gray-100
    '#f59e0b': '#fef3c7', // notified   → amber-100
    '#3b82f6': '#dbeafe', // assigned   → blue-100
    '#8b5cf6': '#ede9fe', // in_transit → violet-100
    '#10b981': '#d1fae5', // delivered  → emerald-100
    '#f43f5e': '#ffe4e6', // cancelled  → rose-100
  };
  const fcEvents = filteredEvents.map((e) => {
    const meta = TRANSPORT_STATUS_BY_KEY[e.status] || TRANSPORT_STATUS_BY_KEY.new;
    const bgSoft = BG_SOFT[meta.hex] || '#f3f4f6';
    return {
      id:           String(e.id),
      title:        e.title,
      start:        e.start,
      allDay:       e.all_day,
      backgroundColor: bgSoft,
      borderColor:     meta.hex,
      textColor:       '#111827', // gray-900 — readable on every pastel
      extendedProps:   e,
    };
  });

  const handleEventDrop = async (info) => {
    const e = info.event.extendedProps;
    const newDate = info.event.start;
    if (!newDate) return;
    const yyyy = newDate.getFullYear();
    const mm   = String(newDate.getMonth() + 1).padStart(2, '0');
    const dd   = String(newDate.getDate()).padStart(2, '0');
    const dateStr = `${yyyy}-${mm}-${dd}`;
    try {
      await api.put('/lead_transport', { lead_id: e.lead_id, transport_date: dateStr });
      loadEvents();
    } catch (err) {
      info.revert();
      window.alert(extractApiError(err, 'Failed to move event'));
    }
  };

  const datesSet = (arg) => {
    const fmt = (d) => {
      const yyyy = d.getFullYear();
      const mm   = String(d.getMonth() + 1).padStart(2, '0');
      const dd   = String(d.getDate()).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    };
    setRange({ start: fmt(arg.start), end: fmt(arg.end) });
  };

  const csvHref = useMemo(() => {
    const params = new URLSearchParams();
    if (range.start) params.set('start', range.start);
    if (range.end)   params.set('end',   range.end);
    if (statusFilter)      params.set('status',         statusFilter);
    if (transporterFilter) params.set('transporter_id', transporterFilter);
    params.set('format', 'csv');
    return `/api/dispatch_calendar?${params.toString()}`;
  }, [range.start, range.end, statusFilter, transporterFilter]);

  const hasFilters = !!(statusFilter || transporterFilter || search);
  const visibleCount = filteredEvents.length;
  const totalInRange = events.length;

  return (
    // .page = global wrapper (1600px max + 24/32 padding, centered) so
    // the title aligns with every other tab. Keep the per-section vertical
    // rhythm via space-y-4 on an inner stack.
    <div className="page">
      <div className="space-y-4">
      <SectionHeader
        title="Dispatch"
        subtitle="Vehicle pickups + deliveries scheduled across the calendar — drag a card to reschedule, click for full details."
        actions={(
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="primary" icon="plus" onClick={() => setAddOpen(true)}>Add to Dispatch</Button>
            <a
              href={csvHref}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-white border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 hover:border-gray-300 transition"
            >
              <Icon name="download"/> Export CSV
            </a>
            <Button variant="ghost" icon="refresh" onClick={() => { loadEvents(); loadTransporters(); }}>Refresh</Button>
          </div>
        )}
      />

      {/* Clickable KPI cards — each is a filter chip with its count */}
      <StatusCards summary={summary} activeStatus={statusFilter} onSelect={setStatusFilter} />

      {/* Toolbar — search + remaining filters */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm px-3 py-2.5 flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search by lead, VIN, transporter…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-gray-50 border border-gray-200 rounded-lg pl-9 pr-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
          />
        </div>
        <select
          value={transporterFilter}
          onChange={(e) => setTransporterFilter(e.target.value)}
          className="bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm min-w-[180px]"
        >
          <option value="">All transporters</option>
          {transporters.filter((t) => t.is_active).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        {hasFilters && (
          <button
            onClick={() => { setStatusFilter(''); setTransporterFilter(''); setSearch(''); }}
            className="text-xs text-gray-500 hover:text-gray-800 px-2 py-1"
          >
            Clear
          </button>
        )}
        <div className="text-[11px] text-gray-500 ml-auto">
          {loading ? 'Loading…' : (
            hasFilters
              ? `${visibleCount} of ${totalInRange} match`
              : `${totalInRange} in view`
          )}
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-100 text-red-700 rounded-xl p-3 text-sm">{error}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 bos-cal relative">
          {events.length === 0 && !loading && (
            <div className="absolute inset-x-0 top-[150px] flex flex-col items-center justify-center pointer-events-none z-[1]">
              <div className="bg-white/80 backdrop-blur-sm border border-gray-100 rounded-2xl px-6 py-4 shadow-sm text-center max-w-sm pointer-events-auto">
                <div className="w-10 h-10 mx-auto rounded-full bg-blue-50 flex items-center justify-center mb-2">
                  <Icon name="calendar" size={18} className="text-blue-500"/>
                </div>
                <p className="text-sm font-semibold text-gray-900">No sales scheduled in this range</p>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  Open a lead and set a delivery date in the <b>Bill of Sale</b> section to see it here.
                </p>
              </div>
            </div>
          )}

          <FullCalendar
            ref={calendarRef}
            plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
            initialView="dayGridMonth"
            headerToolbar={{
              left: 'prev,next today',
              center: 'title',
              right: 'dayGridMonth,timeGridWeek,timeGridDay',
            }}
            height="auto"
            datesSet={datesSet}
            events={fcEvents}
            editable={true}
            eventDrop={handleEventDrop}
            eventClick={(info) => setOpenEvent(info.event.extendedProps)}
            dayMaxEvents={4}
            eventTimeFormat={{ hour: 'numeric', minute: '2-digit', meridiem: 'short' }}
            fixedWeekCount={false}
          />
        </div>

        <TransporterPanel transporters={transporters} onChanged={loadTransporters} />
      </div>

      {openEvent && (
        <EventSidePanel
          event={openEvent}
          transporters={transporters}
          onClose={() => setOpenEvent(null)}
          onChanged={() => { loadEvents(); }}
        />
      )}

      {addOpen && (
        <AddToDispatchModal
          transporters={transporters}
          onClose={() => setAddOpen(false)}
          onScheduled={() => { setAddOpen(false); loadEvents(); }}
        />
      )}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// AddToDispatchModal — pick a lead, then fill in transport date / pickup /
// delivery / transporter. PUTs lead_transport, which inserts a row when
// the lead doesn't already have a transport plan; subsequent edits go
// through the lead drawer's Transport section like any other.
// -----------------------------------------------------------------------------
function AddToDispatchModal({ transporters, onClose, onScheduled }) {
  const [step, setStep]         = useState('pick'); // 'pick' | 'schedule'
  const [picked, setPicked]     = useState(null);   // selected lead
  const [q, setQ]               = useState('');
  const [results, setResults]   = useState([]);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');

  // Lead search — same /api/leads?q endpoint, debounced.
  useEffect(() => {
    if (step !== 'pick') return;
    let cancelled = false;
    const handle = setTimeout(() => {
      setLoading(true); setError('');
      const params = { per_page: 10, page: 1 };
      if (q.trim() !== '') params.q = q.trim();
      api.get('/leads', { params })
        .then((res) => { if (!cancelled) setResults(res.data?.leads || []); })
        .catch((err) => { if (!cancelled) setError(extractApiError(err, 'Lead search failed')); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 200);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [q, step]);

  const fmtLead = (lead) => {
    const np = lead.normalized_payload || {};
    const name = np.full_name
      || [np.first_name, np.last_name].filter(Boolean).join(' ')
      || `Lead #${lead.id}`;
    const vehicle = [np.year, np.make, np.model].filter(Boolean).join(' ');
    return { name, vehicle, vin: np.vin };
  };

  // Sensible defaults sourced from the lead — operator can override in step 2.
  const initialDraft = (lead) => {
    const np = lead?.normalized_payload || {};
    const vehicle = [np.year, np.make, np.model].filter(Boolean).join(' ');
    return {
      transport_date:    new Date().toISOString().slice(0, 10),
      transport_time:    '',
      time_window:       '',
      pickup_location:   np.full_address || '',
      delivery_location: '',
      vehicle_info:      vehicle,
      assigned_transporter_id: '',
      notes:             '',
    };
  };

  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);

  const pickLead = (lead) => {
    setPicked(lead);
    setDraft(initialDraft(lead));
    setStep('schedule');
  };

  const schedule = async () => {
    if (!picked || !draft) return;
    setSaving(true); setError('');
    try {
      const payload = { lead_id: picked.id };
      Object.entries(draft).forEach(([k, v]) => {
        if (v === '' || v === null) return;
        payload[k] = k === 'assigned_transporter_id' ? Number(v) : v;
      });
      await api.put('/lead_transport', payload);
      onScheduled?.();
    } catch (err) {
      setError(extractApiError(err, 'Failed to schedule dispatch'));
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'w-full bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-2 text-[13px] focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none';
  const labelCls = 'block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div className="relative bg-white max-w-xl w-full rounded-2xl shadow-2xl flex flex-col max-h-[85vh]" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-gray-900">
              {step === 'pick' ? 'Add to Dispatch' : `Schedule pickup — ${fmtLead(picked).name}`}
            </h3>
            <p className="text-[11px] text-gray-500 mt-0.5">
              {step === 'pick'
                ? 'Pick the lead whose vehicle is being transported. Pickup location and vehicle info pre-fill from the lead.'
                : 'Edit anything as needed. Defaults pulled from the lead.'}
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100">&times;</button>
        </div>

        {step === 'pick' && (
          <>
            <div className="px-5 pt-4 pb-3">
              <input
                type="text"
                autoFocus
                placeholder="Search by name, VIN, phone, email, vehicle…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className={inputCls}
              />
            </div>
            <div className="px-5 pb-4 overflow-y-auto flex-1">
              {error && <div className="text-[12px] text-red-700 bg-red-50 border border-red-100 rounded-md px-3 py-2 mb-2">{error}</div>}
              {loading ? (
                <p className="text-[12px] text-gray-400 italic py-4">Searching…</p>
              ) : results.length === 0 ? (
                <p className="text-[12px] text-gray-400 italic py-4">No leads match.</p>
              ) : (
                <ul className="space-y-1">
                  {results.map((lead) => {
                    const f = fmtLead(lead);
                    return (
                      <li key={lead.id}>
                        <button
                          onClick={() => pickLead(lead)}
                          className="w-full text-left px-3 py-2 rounded-lg border border-gray-100 hover:border-gray-300 hover:bg-gray-50 transition-colors flex items-center justify-between gap-3"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="text-[13px] font-medium text-gray-900 truncate">{f.name}</div>
                            <div className="text-[11px] text-gray-500 truncate">
                              {f.vehicle || <span className="text-gray-300">No vehicle on file</span>}
                              {f.vin && <span className="ml-2 font-mono text-gray-400">VIN {f.vin}</span>}
                            </div>
                          </div>
                          <span className="text-[11px] font-medium text-blue-700 shrink-0">Schedule &rarr;</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </>
        )}

        {step === 'schedule' && draft && (
          <>
            <div className="px-5 py-4 overflow-y-auto flex-1 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <label>
                  <span className={labelCls}>Date</span>
                  <input type="date" className={inputCls} value={draft.transport_date} onChange={(e) => setDraft({ ...draft, transport_date: e.target.value })} />
                </label>
                <label>
                  <span className={labelCls}>Time</span>
                  <input type="time" className={inputCls} value={draft.transport_time} onChange={(e) => setDraft({ ...draft, transport_time: e.target.value })} />
                </label>
                <label>
                  <span className={labelCls}>Window</span>
                  <input type="text" className={inputCls} placeholder="9am–noon" value={draft.time_window} onChange={(e) => setDraft({ ...draft, time_window: e.target.value })} />
                </label>
              </div>

              <label className="block">
                <span className={labelCls}>Vehicle</span>
                <input className={inputCls} value={draft.vehicle_info} onChange={(e) => setDraft({ ...draft, vehicle_info: e.target.value })} />
              </label>

              <label className="block">
                <span className={labelCls}>Pickup location</span>
                <textarea rows={2} className={inputCls} value={draft.pickup_location} onChange={(e) => setDraft({ ...draft, pickup_location: e.target.value })} placeholder="Where to pick up the vehicle" />
              </label>

              <label className="block">
                <span className={labelCls}>Delivery location</span>
                <textarea rows={2} className={inputCls} value={draft.delivery_location} onChange={(e) => setDraft({ ...draft, delivery_location: e.target.value })} placeholder="Where it's going (your yard, etc.)" />
              </label>

              <label className="block">
                <span className={labelCls}>Transporter <span className="text-[9px] normal-case text-gray-400">(optional — can assign later)</span></span>
                <select className={inputCls} value={draft.assigned_transporter_id} onChange={(e) => setDraft({ ...draft, assigned_transporter_id: e.target.value })}>
                  <option value="">Unassigned</option>
                  {(transporters || []).filter((t) => t.is_active).map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className={labelCls}>Notes</span>
                <textarea rows={2} className={inputCls} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
              </label>

              {error && <div className="text-[12px] text-red-700 bg-red-50 border border-red-100 rounded-md px-3 py-2">{error}</div>}
            </div>

            <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between">
              <button
                onClick={() => { setStep('pick'); setPicked(null); setDraft(null); }}
                className="text-[12px] text-gray-500 hover:text-gray-900"
              >
                &larr; Pick a different lead
              </button>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={onClose}>Cancel</Button>
                <button
                  onClick={schedule}
                  disabled={saving || !draft.transport_date}
                  className="px-4 py-2 text-[12px] font-semibold rounded-md text-white bg-gray-900 hover:bg-gray-800 disabled:opacity-50"
                >
                  {saving ? 'Scheduling…' : 'Schedule pickup'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

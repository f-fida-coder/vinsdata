import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import interactionPlugin from '@fullcalendar/interaction';
import api, { extractApiError } from '../api';
import { SectionHeader, Button, Icon } from '../components/ui';
import { TRANSPORT_STATUSES, TRANSPORT_STATUS_BY_KEY } from '../lib/crm';
import '../styles/bos-calendar.css';

function StatusCards({ summary, activeStatus, onSelect }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
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
          <h3 className="text-sm font-semibold text-gray-900">Transporters</h3>
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

function EventSidePanel({ event, transporters, onClose, onChanged }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState('');
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
      await api.put('/lead_transport', {
        lead_id: event.lead_id,
        ...draft,
        assigned_transporter_id: draft.assigned_transporter_id === '' ? null : Number(draft.assigned_transporter_id),
      });
      setEditing(false);
      onChanged?.();
    } catch (err) {
      setError(extractApiError(err, 'Failed to save'));
    } finally {
      setSaving(false);
    }
  };

  const setStatusQuick = async (status) => {
    setSaving(true);
    try {
      await api.put('/lead_transport', { lead_id: event.lead_id, status });
      onChanged?.();
    } catch (err) {
      setError(extractApiError(err, 'Failed to update status'));
    } finally {
      setSaving(false);
    }
  };

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
          <div className="flex flex-wrap gap-1.5">
            {TRANSPORT_STATUSES.map((s) => (
              <button
                key={s.key}
                onClick={() => setStatusQuick(s.key)}
                disabled={saving || event.status === s.key}
                className={`px-2 py-1 text-[11px] font-medium rounded-md border transition ${event.status === s.key ? `${s.bg} ${s.text} border-transparent` : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}
              >
                {s.label}
              </button>
            ))}
          </div>

          {!editing ? (
            <div className="rounded-xl border border-gray-100 bg-white">
              <table className="w-full text-xs">
                <tbody>
                  <tr><td className="px-3 py-1.5 font-medium text-gray-600 w-2/5">Date</td><td className="px-3 py-1.5 text-gray-900">{event.transport_date}{event.transport_time ? ` at ${event.transport_time}` : ''}{event.time_window ? ` (${event.time_window})` : ''}</td></tr>
                  <tr className="bg-gray-50/40"><td className="px-3 py-1.5 font-medium text-gray-600">Pickup</td><td className="px-3 py-1.5 text-gray-900 whitespace-pre-wrap">{event.pickup_location || '—'}</td></tr>
                  <tr><td className="px-3 py-1.5 font-medium text-gray-600">Delivery</td><td className="px-3 py-1.5 text-gray-900 whitespace-pre-wrap">{event.delivery_location || '—'}</td></tr>
                  <tr className="bg-gray-50/40"><td className="px-3 py-1.5 font-medium text-gray-600">Vehicle</td><td className="px-3 py-1.5 text-gray-900">{event.vehicle_info || '—'}</td></tr>
                  <tr><td className="px-3 py-1.5 font-medium text-gray-600">Transporter</td><td className="px-3 py-1.5 text-gray-900">{event.transporter_name || <span className="text-gray-400">Unassigned</span>}</td></tr>
                  {event.notes && <tr className="bg-gray-50/40"><td className="px-3 py-1.5 font-medium text-gray-600">Notes</td><td className="px-3 py-1.5 text-gray-900 whitespace-pre-wrap">{event.notes}</td></tr>}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-3 gap-2">
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

          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>

        <div className="shrink-0 border-t border-gray-100 px-5 py-3 flex justify-between items-center gap-2 flex-wrap">
          <div className="flex gap-3 text-[11px]">
            <a href={`/leads?lead_id=${event.lead_id}`} className="text-blue-600 hover:text-blue-800">Open lead →</a>
            <a href={`/api/bill_of_sale?lead_id=${event.lead_id}&format=pdf`} target="_blank" rel="noreferrer" className="text-emerald-700 hover:text-emerald-900 font-medium">Download Bill of Sale PDF</a>
          </div>
          {!editing ? (
            <button onClick={() => setEditing(true)} className="px-3 py-1.5 text-xs font-medium bg-gray-900 text-white rounded-md hover:bg-gray-800">Edit</button>
          ) : (
            <div className="flex gap-2">
              <button onClick={() => setEditing(false)} className="text-xs text-gray-500 hover:text-gray-800 px-2 py-1">Cancel</button>
              <button onClick={save} disabled={saving} className="px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-md disabled:opacity-40">
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          )}
        </div>
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
      setError(extractApiError(err, 'Failed to load Bill of Sale data'));
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

  const fcEvents = filteredEvents.map((e) => {
    const meta = TRANSPORT_STATUS_BY_KEY[e.status] || TRANSPORT_STATUS_BY_KEY.new;
    return {
      id:           String(e.id),
      title:        e.title,
      start:        e.start,
      allDay:       e.all_day,
      backgroundColor: meta.hex,
      borderColor:     meta.hex,
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
    <div className="p-6 space-y-4">
      <SectionHeader
        title="Bill of Sale"
        subtitle="Sales scheduled across the calendar — drag a card to reschedule, click for full details"
        actions={(
          <div style={{ display: 'flex', gap: 8 }}>
            <a
              href={csvHref}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium bg-white border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 hover:border-gray-300 transition"
            >
              <Icon name="download"/> Export CSV
            </a>
            <Button variant="primary" icon="refresh" onClick={() => { loadEvents(); loadTransporters(); }}>Refresh</Button>
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
    </div>
  );
}

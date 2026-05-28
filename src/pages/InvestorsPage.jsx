import { useState, useEffect, useCallback, useMemo } from 'react';
import api, { extractApiError } from '../api';
import { SectionHeader, Button, Icon, EmptyState } from '../components/ui';
import LeadDetailDrawer from '../components/LeadDetailDrawer';

/**
 * Investors tab — admin-only. Each investor can be linked to multiple
 * cars (leads); each car can carry multiple investors (joint venture).
 * Per-linkage terms: investment_amount + share_pct + JV status.
 *
 * Three nested affordances:
 *   • Investor directory list      → add/edit investor
 *   • Click an investor row        → drawer with their linked cars
 *   • Inside the drawer:
 *       - "Apply to car" picks a lead + sets terms
 *       - Per-linkage row shows JV status + Send JV button
 *
 * The JV send flow hits /api/jv_agreement which renders the PDF
 * (pre-signed by Mitchell Briggs in DancingScript), uploads it to
 * OpenSign, creates a signature placeholder for the investor, and
 * emails the signing link via Gmail SMTP. Same plumbing as the BoS.
 */

function formatMoney(n) {
  if (n === null || n === undefined || n === '') return '—';
  const v = Number(n);
  if (Number.isNaN(v)) return String(n);
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function formatPct(n) {
  if (n === null || n === undefined || n === '') return '—';
  const v = Number(n);
  if (Number.isNaN(v)) return String(n);
  return `${v}%`;
}

function formatDate(s) {
  if (!s) return '—';
  const d = new Date(String(s).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString();
}

function JvStatusPill({ status }) {
  const meta = {
    draft:     { label: 'Draft',     bg: 'bg-gray-100',   text: 'text-gray-700',    dot: 'bg-gray-400' },
    sent:      { label: 'Sent',      bg: 'bg-blue-50',    text: 'text-blue-700',    dot: 'bg-blue-500' },
    signed:    { label: 'Signed',    bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },
    cancelled: { label: 'Cancelled', bg: 'bg-rose-50',    text: 'text-rose-700',    dot: 'bg-rose-400' },
  }[status] || { label: status, bg: 'bg-gray-100', text: 'text-gray-700', dot: 'bg-gray-400' };
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-semibold ${meta.bg} ${meta.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />{meta.label}
    </span>
  );
}

export default function InvestorsPage() {
  const [investors, setInvestors] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState('');
  const [search, setSearch]       = useState('');
  const [addOpen, setAddOpen]     = useState(false);
  const [editInvestor, setEditInvestor] = useState(null); // pass investor row
  const [openInvestorId, setOpenInvestorId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await api.get('/investors');
      setInvestors(res.data?.investors || []);
    } catch (err) {
      setError(extractApiError(err, 'Failed to load investors'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return investors;
    return investors.filter((i) => (
      (i.name || '').toLowerCase().includes(q)
      || (i.email || '').toLowerCase().includes(q)
      || (i.entity_name || '').toLowerCase().includes(q)
      || (i.phone || '').toLowerCase().includes(q)
    ));
  }, [investors, search]);

  return (
    <div className="page">
      <SectionHeader
        title="Investors"
        subtitle={`${investors.length} ${investors.length === 1 ? 'investor' : 'investors'} on file. Each can fund one or more cars; JV agreements live here.`}
        actions={
          <Button variant="primary" icon="plus" onClick={() => setAddOpen(true)}>
            New investor
          </Button>
        }
      />

      {error && (
        <div className="bg-red-50 border border-red-100 text-red-700 rounded-xl p-3 text-sm mb-3">{error}</div>
      )}

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-3 py-2.5 border-b border-gray-100 flex items-center gap-2">
          <div className="relative flex-1 min-w-[200px]">
            <Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search by name, entity, email, phone…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 rounded-lg pl-9 pr-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
            />
          </div>
          <span className="text-[11px] text-gray-500">
            {loading ? 'Loading…' : `${filtered.length} ${filtered.length === 1 ? 'match' : 'matches'}`}
          </span>
        </div>

        {loading ? (
          <div className="py-12 text-center text-sm text-gray-400">Loading investors…</div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon="users"
            title={investors.length === 0 ? 'No investors yet' : 'No matches'}
            body={investors.length === 0 ? 'Add an investor, then apply them to a car to start a JV.' : 'Try a different search term.'}
          />
        ) : (
          <table className="w-full text-[13px]">
            <thead className="bg-gray-50/60">
              <tr className="border-b border-gray-200">
                <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Investor</th>
                <th className="hidden sm:table-cell px-4 py-2.5 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Contact</th>
                <th className="px-4 py-2.5 text-right text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Cars</th>
                <th className="hidden md:table-cell px-4 py-2.5 text-right text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Total invested</th>
                <th className="px-4 py-2.5 text-right text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((inv) => (
                <tr key={inv.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                  <td className="px-4 py-3">
                    <button
                      onClick={() => setOpenInvestorId(inv.id)}
                      className="text-gray-900 font-medium hover:underline text-left block"
                    >
                      {inv.name}
                    </button>
                    {inv.entity_name && <p className="text-[11px] text-gray-500 mt-0.5">{inv.entity_name}</p>}
                  </td>
                  <td className="hidden sm:table-cell px-4 py-3 text-gray-700 text-[12px]">
                    {inv.email && <div>{inv.email}</div>}
                    {inv.phone && <div className="text-gray-500">{inv.phone}</div>}
                    {!inv.email && !inv.phone && <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {inv.cars_count > 0 ? (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold bg-blue-50 text-blue-700">
                        {inv.cars_count}
                      </span>
                    ) : <span className="text-gray-300">0</span>}
                  </td>
                  <td className="hidden md:table-cell px-4 py-3 text-right tabular-nums text-gray-900">
                    {formatMoney(inv.total_invested)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex items-center gap-1">
                      <button
                        onClick={() => setOpenInvestorId(inv.id)}
                        className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-blue-700 hover:bg-blue-50 rounded"
                      >
                        <Icon name="chevronRight" size={12} /> Open
                      </button>
                      <button
                        onClick={() => setEditInvestor(inv)}
                        className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-100 rounded"
                      >
                        <Icon name="pencil" size={12} /> Edit
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {addOpen && (
        <InvestorFormModal
          onClose={() => setAddOpen(false)}
          onSaved={() => { setAddOpen(false); load(); }}
        />
      )}
      {editInvestor && (
        <InvestorFormModal
          investor={editInvestor}
          onClose={() => setEditInvestor(null)}
          onSaved={() => { setEditInvestor(null); load(); }}
        />
      )}
      {openInvestorId && (
        <InvestorDrawer
          investorId={openInvestorId}
          onClose={() => setOpenInvestorId(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}

// ---- Investor add/edit modal ---------------------------------------------
function InvestorFormModal({ investor, onClose, onSaved }) {
  const isEdit = !!investor;
  const [name, setName]               = useState(investor?.name || '');
  const [email, setEmail]             = useState(investor?.email || '');
  const [phone, setPhone]             = useState(investor?.phone || '');
  const [entityName, setEntityName]   = useState(investor?.entity_name || '');
  const [address, setAddress]         = useState(investor?.address || '');
  const [notes, setNotes]             = useState(investor?.notes || '');
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState('');

  const inputCls = 'w-full bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-2 text-[13px] focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none';
  const labelCls = 'block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1';

  const save = async () => {
    if (!name.trim()) { setError('Name is required.'); return; }
    setSaving(true); setError('');
    try {
      const payload = {
        name:        name.trim(),
        email:       email.trim(),
        phone:       phone.trim(),
        entity_name: entityName.trim(),
        address:     address.trim(),
        notes:       notes.trim(),
      };
      if (isEdit) {
        await api.put('/investors', { id: investor.id, ...payload });
      } else {
        await api.post('/investors', payload);
      }
      onSaved?.();
    } catch (err) {
      setError(extractApiError(err, isEdit ? 'Failed to update investor' : 'Failed to create investor'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-gray-900/50" />
      <div className="relative bg-white w-full max-w-lg rounded-2xl shadow-2xl flex flex-col max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900">{isEdit ? 'Edit investor' : 'New investor'}</h3>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100">&times;</button>
        </div>
        <div className="px-5 py-4 overflow-y-auto space-y-3">
          {error && <div className="bg-red-50 border border-red-100 text-red-700 rounded-lg p-2 text-xs">{error}</div>}
          <div>
            <label className={labelCls}>Name <span className="text-red-500 normal-case tracking-normal">*</span></label>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="e.g. John Smith" maxLength={160} />
          </div>
          <div>
            <label className={labelCls}>Entity (LLC / Inc.)</label>
            <input value={entityName} onChange={(e) => setEntityName(e.target.value)} className={inputCls} placeholder="e.g. Smith Investments LLC" maxLength={200} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelCls}>Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} placeholder="john@example.com" />
            </div>
            <div>
              <label className={labelCls}>Phone</label>
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={inputCls} placeholder="(817) 555-1234" />
            </div>
          </div>
          <div>
            <label className={labelCls}>Address (for JV signature)</label>
            <textarea rows={2} value={address} onChange={(e) => setAddress(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Notes</label>
            <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} placeholder="Anything to remember about this investor" />
          </div>
        </div>
        <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-900 rounded">Cancel</button>
          <button
            onClick={save}
            disabled={saving || !name.trim()}
            className="px-4 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40"
          >
            {saving ? 'Saving…' : (isEdit ? 'Save changes' : 'Create investor')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Investor drawer (linked cars + apply-to-car + send JV) --------------
function InvestorDrawer({ investorId, onClose, onChanged }) {
  const [investor, setInvestor]     = useState(null);
  const [rows, setRows]             = useState([]); // investor_leads
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState('');
  const [applyOpen, setApplyOpen]   = useState(false);
  const [openLeadId, setOpenLeadId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [invRes, rowsRes] = await Promise.all([
        api.get('/investors', { params: { id: investorId } }),
        api.get('/investor_leads', { params: { investor_id: investorId } }),
      ]);
      setInvestor(invRes.data?.investor || null);
      setRows(rowsRes.data?.rows || []);
    } catch (err) {
      setError(extractApiError(err, 'Failed to load investor'));
    } finally {
      setLoading(false);
    }
  }, [investorId]);

  useEffect(() => { load(); }, [load]);

  const unlink = async (id) => {
    if (!window.confirm('Remove this investor from this car?')) return;
    try {
      await api.delete('/investor_leads', { data: { id } });
      load();
      onChanged?.();
    } catch (err) {
      setError(extractApiError(err, 'Failed to unlink'));
    }
  };

  const sendJv = async (id) => {
    // Pre-flight: confirm we have an investor email on file before
    // hitting the endpoint. The server falls back to investor.email
    // when the body omits `to`, but surfacing this client-side is
    // friendlier than the 400 response.
    const target = (investor?.email || '').trim();
    if (!target) {
      setError('Add an email to this investor before sending the JV.');
      return;
    }
    if (!window.confirm(
      `Send JV agreement to ${target}?\n\n`
      + 'A PDF will be generated, the Vin Vault side will be pre-signed by Mitchell Briggs, '
      + 'and the investor will receive an OpenSign link to countersign.'
    )) return;
    try {
      const res = await api.post('/jv_agreement', { investor_lead_id: id });
      const { email_delivered, signing_url, reason } = res.data || {};
      if (email_delivered === false && signing_url) {
        // Email failed (or SMTP not configured) — surface the signing
        // link so the operator can copy it manually instead of the row
        // looking sent but the investor never hearing about it.
        window.prompt(
          `JV created but email did not send (${reason || 'unknown'}).\n`
          + 'Copy this signing link and send it to the investor manually:',
          signing_url
        );
      }
      load();
      onChanged?.();
    } catch (err) {
      setError(extractApiError(err, 'Failed to send JV'));
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-gray-900/40" />
      <aside className="relative bg-white w-full sm:w-[640px] h-full shadow-2xl flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="shrink-0 border-b border-gray-100 px-5 py-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold">Investor</p>
            <h2 className="text-base font-semibold text-gray-900 truncate mt-0.5">
              {loading ? 'Loading…' : (investor?.name || `Investor #${investorId}`)}
            </h2>
            {investor?.entity_name && <p className="text-[11px] text-gray-500 mt-0.5">{investor.entity_name}</p>}
            <div className="text-[11px] text-gray-500 mt-1 flex flex-wrap gap-x-3">
              {investor?.email && <span>{investor.email}</span>}
              {investor?.phone && <span>{investor.phone}</span>}
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100">&times;</button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {error && <div className="bg-red-50 border border-red-100 text-red-700 rounded-lg p-2 text-xs">{error}</div>}

          <div className="flex items-center justify-between">
            <p className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold">
              Cars ({rows.length})
            </p>
            <Button variant="primary" size="sm" icon="plus" onClick={() => setApplyOpen(true)}>
              Apply to car
            </Button>
          </div>

          {rows.length === 0 ? (
            <p className="text-xs text-gray-400 italic">Not applied to any cars yet. Click "Apply to car" to link this investor to a lead.</p>
          ) : (
            <ul className="rounded-xl border border-gray-100 divide-y divide-gray-100">
              {rows.map((r) => (
                <li key={r.id} className="px-3 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <button
                        onClick={() => setOpenLeadId(r.imported_lead_id)}
                        className="text-sm font-medium text-gray-900 hover:underline text-left block truncate"
                      >
                        {r.lead_vehicle?.trim() || `Lead #${r.imported_lead_id}`}
                      </button>
                      <div className="text-[11px] text-gray-500 truncate">
                        {r.lead_name && <span>{r.lead_name}</span>}
                        {r.lead_vin && <span> · VIN {r.lead_vin}</span>}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 mt-1.5 text-[11px]">
                        <span className="text-gray-500">Invested</span>
                        <span className="font-medium text-gray-900 tabular-nums">{formatMoney(r.investment_amount)}</span>
                        <span className="text-gray-300">·</span>
                        <span className="text-gray-500">Share</span>
                        <span className="font-medium text-gray-900 tabular-nums">{formatPct(r.share_pct)}</span>
                        <span className="text-gray-300">·</span>
                        <JvStatusPill status={r.jv_status} />
                        {r.jv_sent_at && (
                          <span className="text-[10px] text-gray-400">sent {formatDate(r.jv_sent_at)}</span>
                        )}
                      </div>
                    </div>
                    <div className="shrink-0 flex flex-col items-end gap-1">
                      {r.jv_status === 'draft' && (
                        <button
                          onClick={() => sendJv(r.id)}
                          className="px-2 py-1 text-[11px] font-medium bg-emerald-600 text-white rounded hover:bg-emerald-700"
                          title="Send JV agreement for this car"
                        >
                          Send JV
                        </button>
                      )}
                      {r.jv_status === 'sent' && (
                        <>
                          <span className="px-2 py-1 text-[11px] text-emerald-700">Awaiting signature</span>
                          <button
                            onClick={() => sendJv(r.id)}
                            className="px-2 py-1 text-[11px] font-medium text-blue-700 hover:bg-blue-50 rounded"
                            title="Re-generate the PDF and re-send the signing link"
                          >
                            Resend
                          </button>
                        </>
                      )}
                      {r.jv_pdf_path && (
                        <a
                          href={`/${r.jv_pdf_path}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-2 py-1 text-[11px] text-gray-600 hover:bg-gray-100 rounded"
                          title="Open the generated JV PDF in a new tab"
                        >
                          View PDF
                        </a>
                      )}
                      <button
                        onClick={() => unlink(r.id)}
                        className="px-2 py-1 text-[11px] text-red-600 hover:bg-red-50 rounded"
                      >
                        Unlink
                      </button>
                    </div>
                  </div>
                  {r.notes && <p className="text-[11px] text-gray-500 italic mt-1.5">{r.notes}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>

        {applyOpen && (
          <ApplyToCarModal
            investorId={investorId}
            onClose={() => setApplyOpen(false)}
            onApplied={() => { setApplyOpen(false); load(); onChanged?.(); }}
          />
        )}

        <LeadDetailDrawer
          leadId={openLeadId}
          onClose={() => setOpenLeadId(null)}
          onChanged={load}
        />
      </aside>
    </div>
  );
}

// ---- Apply-to-car modal (lead picker + terms) -----------------------------
function ApplyToCarModal({ investorId, onClose, onApplied }) {
  // 'search' = pick from the leads list. 'manual' = the operator is
  // entering a car that never went through the upload pipeline (private
  // acquisition, auction buy, etc.). After a manual save we drop the
  // operator straight into the terms view with the freshly-created
  // lead pre-picked so they don't have to re-find it.
  const [mode, setMode]       = useState('search');
  const [q, setQ]             = useState('');
  const [results, setResults] = useState([]);
  const [picked, setPicked]   = useState(null);
  const [amount, setAmount]   = useState('');
  const [share, setShare]     = useState('');
  const [notes, setNotes]     = useState('');
  const [saving, setSaving]   = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  // Manual-car form state. Kept separate so toggling back to search
  // doesn't wipe what the operator typed.
  const [manual, setManual] = useState({
    year: '', make: '', model: '', vin: '',
    owner_name: '', owner_phone: '', owner_email: '',
    target_purchase_price: '',
  });

  // Debounced lead search. Skips when the operator is on the manual
  // form (no point hammering /leads while they're typing a VIN).
  useEffect(() => {
    if (picked || mode === 'manual') return;
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
  }, [q, picked, mode]);

  // POST /api/investor_manual_car → creates the underlying lead row,
  // then we slot the returned lead_id into `picked` as if the search
  // had surfaced it. Operator lands on the terms screen with the new
  // car already selected.
  const saveManual = async () => {
    if (!manual.vin.trim())                                                  { setError('VIN is required'); return; }
    if (!manual.year.trim() && !manual.make.trim() && !manual.model.trim())  { setError('Enter at least year, make, or model'); return; }
    setSaving(true); setError('');
    try {
      const body = {
        vin:                   manual.vin.trim(),
        year:                  manual.year.trim()  || null,
        make:                  manual.make.trim()  || null,
        model:                 manual.model.trim() || null,
        owner_name:            manual.owner_name.trim()  || null,
        owner_phone:           manual.owner_phone.trim() || null,
        owner_email:           manual.owner_email.trim() || null,
        target_purchase_price: manual.target_purchase_price === '' ? null : Number(manual.target_purchase_price),
      };
      const res = await api.post('/investor_manual_car', body);
      const newLeadId = res.data?.lead_id;
      if (!newLeadId) throw new Error('Server did not return a lead id');
      // Synthesize a lead row shaped like /api/leads results so fmtLead
      // can render it without refetching.
      setPicked({
        id: newLeadId,
        normalized_payload: {
          vin:   body.vin,
          year:  body.year,
          make:  body.make,
          model: body.model,
          full_name: body.owner_name || '(Manual entry)',
        },
      });
      // Carry target purchase price into the JV via lead_states (server
      // already stamped price_offered). Pre-fill investment amount with
      // the target so the operator doesn't retype it.
      if (body.target_purchase_price !== null && amount === '') {
        setAmount(String(body.target_purchase_price));
      }
      setMode('search'); // collapse manual form once picked
    } catch (err) {
      setError(extractApiError(err, 'Failed to add manual car'));
    } finally {
      setSaving(false);
    }
  };

  const fmtLead = (lead) => {
    const np = lead.normalized_payload || {};
    const name = np.full_name
      || [np.first_name, np.last_name].filter(Boolean).join(' ')
      || `Lead #${lead.id}`;
    const vehicle = [np.year, np.make, np.model].filter(Boolean).join(' ');
    return { name, vehicle, vin: np.vin };
  };

  const apply = async () => {
    if (!picked) { setError('Pick a car first'); return; }
    setSaving(true); setError('');
    try {
      await api.post('/investor_leads', {
        investor_id:       investorId,
        lead_id:           picked.id,
        investment_amount: amount === '' ? null : Number(amount),
        share_pct:         share  === '' ? null : Number(share),
        notes:             notes.trim() || null,
      });
      onApplied?.();
    } catch (err) {
      setError(extractApiError(err, 'Failed to apply investor to car'));
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'w-full bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-2 text-[13px] focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none';
  const labelCls = 'block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-gray-900/50" />
      <div className="relative bg-white w-full max-w-lg rounded-2xl shadow-2xl flex flex-col max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-gray-900">Apply investor to a car</h3>
            <p className="text-[11px] text-gray-500 mt-0.5">Vehicle data pre-populates from the lead.</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100">&times;</button>
        </div>

        <div className="px-5 py-4 overflow-y-auto space-y-3">
          {error && <div className="bg-red-50 border border-red-100 text-red-700 rounded-lg p-2 text-xs">{error}</div>}

          {!picked && mode === 'search' ? (
            <>
              <div>
                <label className={labelCls}>Pick a car</label>
                <input
                  autoFocus
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search by name, VIN, phone, email, vehicle…"
                  className={inputCls}
                />
              </div>
              <div className="max-h-56 overflow-y-auto">
                {loading ? (
                  <p className="text-xs text-gray-400 py-4 text-center">Searching…</p>
                ) : results.length === 0 ? (
                  <div className="py-4 text-center space-y-2">
                    <p className="text-xs text-gray-400">No leads match.</p>
                    <button
                      onClick={() => setMode('manual')}
                      className="px-3 py-1.5 text-[11px] font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg"
                    >
                      + Add the car manually
                    </button>
                  </div>
                ) : (
                  <ul className="space-y-1">
                    {results.map((lead) => {
                      const meta = fmtLead(lead);
                      return (
                        <li key={lead.id}>
                          <button
                            onClick={() => setPicked(lead)}
                            className="w-full text-left px-3 py-2 rounded-lg hover:bg-gray-50 border border-transparent hover:border-gray-200"
                          >
                            <div className="text-[13px] font-medium text-gray-900">{meta.name}</div>
                            <div className="text-[11px] text-gray-500 mt-0.5">
                              {meta.vehicle || '—'}{meta.vin ? ` · ${meta.vin}` : ''}
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
              {/* Always-available escape hatch — even with hits, the
                  operator may want a brand-new manual entry. */}
              {results.length > 0 && (
                <div className="pt-1 border-t border-gray-100">
                  <button
                    onClick={() => setMode('manual')}
                    className="w-full px-3 py-1.5 text-[11px] font-medium text-blue-700 hover:bg-blue-50 rounded-lg"
                  >
                    Not in the list? Add the car manually
                  </button>
                </div>
              )}
            </>
          ) : !picked && mode === 'manual' ? (
            <>
              <div className="flex items-center justify-between">
                <p className="text-[11px] uppercase tracking-wider text-gray-500 font-semibold">Add a car manually</p>
                <button
                  onClick={() => setMode('search')}
                  className="text-[11px] text-gray-600 hover:text-gray-900 underline"
                >
                  Back to search
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className={labelCls}>Year</label>
                  <input value={manual.year} onChange={(e) => setManual({ ...manual, year: e.target.value })} className={inputCls} placeholder="2008" />
                </div>
                <div className="col-span-2">
                  <label className={labelCls}>Make</label>
                  <input value={manual.make} onChange={(e) => setManual({ ...manual, make: e.target.value })} className={inputCls} placeholder="Dodge" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={labelCls}>Model</label>
                  <input value={manual.model} onChange={(e) => setManual({ ...manual, model: e.target.value })} className={inputCls} placeholder="Viper" />
                </div>
                <div>
                  <label className={labelCls}>VIN <span className="text-red-500">*</span></label>
                  <input
                    value={manual.vin}
                    onChange={(e) => setManual({ ...manual, vin: e.target.value.toUpperCase() })}
                    className={inputCls}
                    placeholder="1B3JZ69Z78V200288"
                    maxLength={17}
                  />
                </div>
              </div>
              <div>
                <label className={labelCls}>Target purchase price ($)</label>
                <input
                  type="number" min="0" step="100"
                  value={manual.target_purchase_price}
                  onChange={(e) => setManual({ ...manual, target_purchase_price: e.target.value })}
                  className={inputCls}
                  placeholder="e.g. 82000"
                />
                <p className="text-[10px] text-gray-400 mt-0.5">Pre-fills the JV agreement&rsquo;s &ldquo;Target Purchase Price&rdquo; line.</p>
              </div>
              <details className="text-[11px]">
                <summary className="cursor-pointer text-gray-600 hover:text-gray-900 py-1">Owner contact (optional)</summary>
                <div className="space-y-2 mt-2">
                  <div>
                    <label className={labelCls}>Owner name</label>
                    <input value={manual.owner_name} onChange={(e) => setManual({ ...manual, owner_name: e.target.value })} className={inputCls} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className={labelCls}>Phone</label>
                      <input value={manual.owner_phone} onChange={(e) => setManual({ ...manual, owner_phone: e.target.value })} className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>Email</label>
                      <input value={manual.owner_email} onChange={(e) => setManual({ ...manual, owner_email: e.target.value })} className={inputCls} />
                    </div>
                  </div>
                </div>
              </details>
            </>
          ) : (
            <>
              <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-gray-900 truncate">{fmtLead(picked).vehicle || `Lead #${picked.id}`}</div>
                    <div className="text-[11px] text-gray-500 truncate">
                      {fmtLead(picked).name}
                      {fmtLead(picked).vin && <> · VIN {fmtLead(picked).vin}</>}
                    </div>
                  </div>
                  <button onClick={() => setPicked(null)} className="text-[11px] text-gray-600 hover:text-gray-900 underline">Change</button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={labelCls}>Investment amount ($)</label>
                  <input type="number" min="0" step="100" value={amount} onChange={(e) => setAmount(e.target.value)} className={inputCls} placeholder="e.g. 50000" />
                </div>
                <div>
                  <label className={labelCls}>Profit share (%)</label>
                  <input type="number" min="0" max="100" step="0.5" value={share} onChange={(e) => setShare(e.target.value)} className={inputCls} placeholder="e.g. 25" />
                </div>
              </div>
              <div>
                <label className={labelCls}>Notes</label>
                <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className={inputCls} placeholder="Optional — anything specific to this JV" />
              </div>
            </>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-100 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-900 rounded">Cancel</button>
          {!picked && mode === 'manual' && (
            <button
              onClick={saveManual}
              disabled={saving}
              className="px-4 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40"
            >
              {saving ? 'Saving…' : 'Save car & continue'}
            </button>
          )}
          {picked && (
            <button
              onClick={apply}
              disabled={saving}
              className="px-4 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40"
            >
              {saving ? 'Applying…' : 'Apply investor'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

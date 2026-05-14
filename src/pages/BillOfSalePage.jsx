import { useState, useEffect, useCallback, useMemo } from 'react';
import api, { extractApiError, getBillOfSalePdfUrl } from '../api';
import { SectionHeader, Button, Icon, Input, EmptyState, KPI } from '../components/ui';
import LeadDetailDrawer from '../components/LeadDetailDrawer';
import { BoSEditor, STANDALONE_BOS_DEFAULTS, EmailBoSModal } from '../components/LeadBillOfSaleSection';

// --- Status metadata ---------------------------------------------------------
// Status is derived server-side from the BoS row's signature_* + buyer/payment
// completeness, so the FE just renders pills.
const STATUS_META = {
  draft:              { label: 'Draft',              bg: '#f4f4f5', text: '#52525b', dot: '#a1a1aa' },
  ready_to_send:      { label: 'Ready to send',      bg: '#dbeafe', text: '#1d4ed8', dot: '#3b82f6' },
  awaiting_signature: { label: 'Awaiting signature', bg: '#fef3c7', text: '#a16207', dot: '#eab308' },
  signed:             { label: 'Signed',             bg: '#d1fae5', text: '#047857', dot: '#10b981' },
};
const STATUS_ORDER = ['draft', 'ready_to_send', 'awaiting_signature', 'signed'];

function StatusPill({ status }) {
  const m = STATUS_META[status] || { label: status, bg: '#f4f4f5', text: '#52525b', dot: '#a1a1aa' };
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-semibold"
      style={{ backgroundColor: m.bg, color: m.text }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: m.dot }} />
      {m.label}
    </span>
  );
}

function formatDate(s) {
  if (!s) return '—';
  const d = new Date(String(s).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString();
}

function formatMoney(n) {
  if (n === null || n === undefined || n === '') return '—';
  const v = Number(n);
  if (Number.isNaN(v)) return String(n);
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

/**
 * Bill of Sale tab — list view of every BoS document generated across
 * leads. Each row is a draft / sent / signed BoS with the lead context.
 * Click a row to open that lead's drawer (where the BoS section lives
 * for editing); the "Download PDF" link bypasses the drawer entirely.
 *
 * The "Send for signature" button is stubbed for v2 — clicking it just
 * surfaces a message explaining that the OpenSign integration is
 * pending. The button shape is in place so the v2 work can wire it
 * without UI changes.
 */
export default function BillOfSalePage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [openLeadId, setOpenLeadId] = useState(null);
  // Lead-attached editor for a new BoS, opened from the lead picker.
  // Contains the prefilled defaults from /api/bill_of_sale?lead_id=X.
  const [leadEditor, setLeadEditor] = useState(null); // null | { leadId, initial }
  // Standalone editor: open with `null` to create a brand-new lead-less
  // BoS, or with an existing row to edit it without going through a lead.
  const [standaloneEditor, setStandaloneEditor] = useState(null); // null | 'new' | row object
  // Lead picker: when set, the modal that lets the operator pick which
  // lead to generate the new BoS from (or fall through to standalone).
  const [pickerOpen, setPickerOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await api.get('/bill_of_sale', { params: { list: 1 } });
      setRows(res.data || []);
    } catch (err) {
      setError(extractApiError(err, 'Failed to load bills of sale'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openStandalone = async (row) => {
    // Pull the full row by id (the list view only has a subset of fields).
    try {
      const res = await api.get('/bill_of_sale', { params: { id: row.id } });
      setStandaloneEditor(res.data);
    } catch (err) {
      setError(extractApiError(err, 'Failed to load Bill of Sale'));
    }
  };

  const openRow = (row) => {
    if (row.imported_lead_id) {
      setOpenLeadId(row.imported_lead_id);
    } else {
      openStandalone(row);
    }
  };

  const counts = useMemo(() => {
    const out = { all: rows.length };
    STATUS_ORDER.forEach((s) => { out[s] = 0; });
    rows.forEach((r) => { if (out[r.status] !== undefined) out[r.status] += 1; });
    return out;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter && r.status !== statusFilter) return false;
      if (q) {
        const hay = [
          r.lead_name, r.buyer_name, r.vehicle_vin,
          r.vehicle_make, r.vehicle_model, r.vehicle_year,
        ].map((x) => (x ?? '').toString().toLowerCase()).join(' ');
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, search, statusFilter]);

  return (
    <div className="max-w-[1400px] mx-auto">
      <SectionHeader
        title="Bill of Sale"
        subtitle="Every Texas motor vehicle bill of sale — generated from a lead or created standalone. Edit, download, or send for e-signature."
        actions={
          <Button
            variant="primary"
            icon="plus"
            onClick={() => setPickerOpen(true)}
          >
            New Bill of Sale
          </Button>
        }
      />

      {error && (
        <div className="mb-4 px-3 py-2 rounded-md text-[13px] bg-red-50 border border-red-100 text-red-700">{error}</div>
      )}

      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-5">
        <KPI
          label="Total"
          value={counts.all}
          large
          onClick={() => setStatusFilter('')}
        />
        {STATUS_ORDER.map((s) => (
          <KPI
            key={s}
            label={STATUS_META[s].label}
            value={counts[s]}
            dot={STATUS_META[s].dot}
            onClick={() => setStatusFilter(statusFilter === s ? '' : s)}
          />
        ))}
      </div>

      {/* Search bar */}
      <div className="mb-4 flex gap-2 items-center">
        <Input
          icon="search"
          placeholder="Search by name, VIN, or vehicle…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1"
        />
        {(search || statusFilter) && (
          <Button variant="ghost" onClick={() => { setSearch(''); setStatusFilter(''); }}>
            Clear filters
          </Button>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="py-12 text-center text-[13px] text-gray-400">Loading…</div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon="file"
            title={rows.length === 0 ? 'No bills of sale yet' : 'No matches'}
            body={rows.length === 0
              ? 'Generate a Bill of Sale from a lead drawer — it shows up here once it has buyer + payment details.'
              : 'Try a different search or clear the status filter.'}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="bg-gray-50/60">
                <tr className="border-b border-gray-200">
                  <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Lead</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Vehicle</th>
                  <th className="hidden md:table-cell px-4 py-2.5 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider font-mono">VIN</th>
                  <th className="hidden lg:table-cell px-4 py-2.5 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Buyer</th>
                  <th className="hidden sm:table-cell px-4 py-2.5 text-right text-[10px] font-semibold text-gray-500 uppercase tracking-wider tabular-nums">Amount</th>
                  <th className="hidden xl:table-cell px-4 py-2.5 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Updated</th>
                  <th className="px-4 py-2.5 text-right text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                    <td className="px-4 py-2.5"><StatusPill status={r.status} /></td>
                    <td className="px-4 py-2.5">
                      <button
                        onClick={() => openRow(r)}
                        className="text-gray-900 font-medium hover:underline text-left"
                      >
                        {r.lead_name || (r.imported_lead_id ? `Lead #${r.imported_lead_id}` : <span className="italic text-gray-500">Standalone</span>)}
                      </button>
                    </td>
                    <td className="px-4 py-2.5 text-gray-700">
                      {[r.vehicle_year, r.vehicle_make, r.vehicle_model].filter(Boolean).join(' ') || <span className="text-gray-300">—</span>}
                    </td>
                    <td className="hidden md:table-cell px-4 py-2.5 text-[11px] font-mono text-gray-500">
                      {r.vehicle_vin || <span className="text-gray-300">—</span>}
                    </td>
                    <td className="hidden lg:table-cell px-4 py-2.5 text-gray-700">
                      {r.buyer_name || <span className="text-gray-300">—</span>}
                    </td>
                    <td className="hidden sm:table-cell px-4 py-2.5 text-right tabular-nums text-gray-900">
                      {formatMoney(r.payment_amount)}
                    </td>
                    <td className="hidden xl:table-cell px-4 py-2.5 text-[11px] text-gray-500">{formatDate(r.updated_at)}</td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="inline-flex gap-1">
                        <a
                          href={r.imported_lead_id
                            ? getBillOfSalePdfUrl(r.imported_lead_id)
                            : `/api/bill_of_sale?id=${r.id}&format=pdf`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-blue-700 hover:bg-blue-50 rounded"
                          title="Download PDF"
                        >
                          <Icon name="download" size={12} /> PDF
                        </a>
                        <button
                          onClick={() => openRow(r)}
                          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-100 rounded"
                          title={r.imported_lead_id ? 'Open lead drawer to edit fields' : 'Edit standalone Bill of Sale'}
                        >
                          <Icon name="edit" size={12} /> Edit
                        </button>
                        <SendForSignatureButton bos={r} onSent={load} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <LeadDetailDrawer
        leadId={openLeadId}
        onClose={() => setOpenLeadId(null)}
        onChanged={load}
      />

      {standaloneEditor && (
        <BoSEditor
          leadId={null}
          initial={standaloneEditor === 'new' ? STANDALONE_BOS_DEFAULTS : standaloneEditor}
          onSaved={() => { setStandaloneEditor(null); load(); }}
          onClose={() => setStandaloneEditor(null)}
        />
      )}

      {leadEditor && (
        <BoSEditor
          leadId={leadEditor.leadId}
          initial={leadEditor.initial}
          onSaved={() => { setLeadEditor(null); load(); }}
          onClose={() => setLeadEditor(null)}
        />
      )}

      {pickerOpen && (
        <NewBoSPicker
          onClose={() => setPickerOpen(false)}
          onPickLead={async (lead) => {
            // Pull the lead-prefilled defaults from the BoS endpoint so the
            // editor opens with buyer/vehicle/VIN already populated.
            try {
              const res = await api.get('/bill_of_sale', { params: { lead_id: lead.id } });
              setPickerOpen(false);
              setLeadEditor({ leadId: lead.id, initial: res.data });
            } catch (err) {
              setError(extractApiError(err, 'Failed to load Bill of Sale defaults'));
              setPickerOpen(false);
            }
          }}
          onUseStandalone={() => {
            setPickerOpen(false);
            setStandaloneEditor('new');
          }}
        />
      )}
    </div>
  );
}

/**
 * NewBoSPicker — modal that opens when the operator clicks
 * "New Bill of Sale" from the BoS list page. Default action is to
 * generate from an existing lead (the normal path); standalone is a
 * de-emphasized fallback for walk-in sellers / no-lead scenarios.
 *
 * Lead search uses the existing /api/leads?q endpoint (same one the
 * Leads page itself drives), so anything a lead can be found by — name,
 * VIN, phone, email, address, notes, label, attached BoS buyer name —
 * resolves to that lead here too.
 */
function NewBoSPicker({ onClose, onPickLead, onUseStandalone }) {
  const [q, setQ]             = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');

  // Debounced lead search. Empty query → fetch latest 10 leads so the
  // operator sees something on open without typing.
  useEffect(() => {
    let cancelled = false;
    const handle = setTimeout(() => {
      setLoading(true); setError('');
      const params = { per_page: 10, page: 1 };
      if (q.trim() !== '') params.q = q.trim();
      api.get('/leads', { params })
        .then((res) => {
          if (cancelled) return;
          setResults(res.data?.leads || []);
        })
        .catch((err) => { if (!cancelled) setError(extractApiError(err, 'Lead search failed')); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 200);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [q]);

  const fmtLead = (lead) => {
    const np = lead.normalized_payload || {};
    const name = np.full_name
      || [np.first_name, np.last_name].filter(Boolean).join(' ')
      || `Lead #${lead.id}`;
    const vehicle = [np.year, np.make, np.model].filter(Boolean).join(' ');
    const vin     = np.vin;
    return { name, vehicle, vin };
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div className="relative bg-white max-w-xl w-full rounded-2xl shadow-2xl flex flex-col max-h-[85vh]" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-gray-900">New Bill of Sale</h3>
            <p className="text-[11px] text-gray-500 mt-0.5">Pick the lead to generate it from. Buyer + vehicle fields prefill from the lead; you can edit anything before saving.</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100">&times;</button>
        </div>

        <div className="px-5 pt-4 pb-3">
          <Input
            icon="search"
            placeholder="Search by name, VIN, phone, email, vehicle…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
          />
        </div>

        <div className="px-5 pb-4 overflow-y-auto flex-1">
          {error && (
            <div className="text-[12px] text-red-700 bg-red-50 border border-red-100 rounded-md px-3 py-2 mb-2">{error}</div>
          )}
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
                      onClick={() => onPickLead(lead)}
                      className="w-full text-left px-3 py-2 rounded-lg border border-gray-100 hover:border-gray-300 hover:bg-gray-50 transition-colors flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-medium text-gray-900 truncate">{f.name}</div>
                        <div className="text-[11px] text-gray-500 truncate">
                          {f.vehicle || <span className="text-gray-300">No vehicle on file</span>}
                          {f.vin && <span className="ml-2 font-mono text-gray-400">VIN {f.vin}</span>}
                        </div>
                      </div>
                      <span className="text-[11px] font-medium text-blue-700 shrink-0">
                        Generate &rarr;
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between">
          <button
            onClick={onUseStandalone}
            className="text-[12px] text-gray-500 hover:text-gray-900 underline-offset-2 hover:underline"
            title="Create a Bill of Sale not tied to any lead — for walk-in sellers"
          >
            Or create a standalone Bill of Sale (no lead)
          </button>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}

/**
 * E-signature send button — stubbed until v2 OpenSign integration lands.
 * Clicking it just surfaces an alert explaining the v2 status; nothing
 * touches the DB or sends anything. The shape is in place so v2 swap
 * is a contained one-file change.
 */
/**
 * Per-row Email button: opens EmailBoSModal with the BoS row + buyer
 * defaults. Posts to /api/bos_email which renders the PDF, sends via
 * Gmail SMTP with attachment, and marks the row signature_status='sent'.
 * Re-loads the page list on success so the row's status pill updates.
 */
function SendForSignatureButton({ bos, onSent }) {
  const [open, setOpen] = useState(false);
  if (bos.status === 'signed') {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 text-[11px] text-gray-400" title="Signed">
        <Icon name="check" size={12} /> Signed
      </span>
    );
  }
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-emerald-700 hover:bg-emerald-50 rounded"
        title="Email the PDF to the buyer"
      >
        <Icon name="mail" size={12} /> Email
      </button>
      {open && (
        <EmailBoSModal
          bos={bos}
          onClose={() => setOpen(false)}
          onSent={() => { onSent?.(); }}
        />
      )}
    </>
  );
}

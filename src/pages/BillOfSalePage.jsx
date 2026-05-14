import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import api, { extractApiError, getBillOfSalePdfUrl } from '../api';
import { SectionHeader, Button, Icon, Input, EmptyState, KPI } from '../components/ui';
import LeadDetailDrawer from '../components/LeadDetailDrawer';

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
        subtitle="Every Texas motor vehicle bill of sale generated from a lead. Edit, download, or send for e-signature."
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
                        onClick={() => setOpenLeadId(r.imported_lead_id)}
                        className="text-gray-900 font-medium hover:underline text-left"
                      >
                        {r.lead_name || `Lead #${r.imported_lead_id}`}
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
                          href={getBillOfSalePdfUrl(r.imported_lead_id)}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-blue-700 hover:bg-blue-50 rounded"
                          title="Download PDF"
                        >
                          <Icon name="download" size={12} /> PDF
                        </a>
                        <button
                          onClick={() => setOpenLeadId(r.imported_lead_id)}
                          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-100 rounded"
                          title="Open lead drawer to edit fields"
                        >
                          <Icon name="edit" size={12} /> Edit
                        </button>
                        <SendForSignatureButton bos={r} />
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
    </div>
  );
}

/**
 * E-signature send button — stubbed until v2 OpenSign integration lands.
 * Clicking it just surfaces an alert explaining the v2 status; nothing
 * touches the DB or sends anything. The shape is in place so v2 swap
 * is a contained one-file change.
 */
function SendForSignatureButton({ bos }) {
  const [open, setOpen] = useState(false);
  // Already signed → no action available.
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
        title="Send to buyer for e-signature (coming soon)"
      >
        <Icon name="mail" size={12} /> Sign
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div className="relative bg-white max-w-md w-full mx-4 rounded-2xl shadow-2xl p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-gray-900 mb-2">E-signature is coming in v2</h3>
            <p className="text-sm text-gray-600 mb-4">
              We're going to integrate self-hosted <strong>OpenSign</strong> here — the operator
              clicks <em>Sign</em>, the buyer gets an email with a signing link, and the signed PDF
              lands back in this row automatically (status flips to <em>Signed</em>).
            </p>
            <p className="text-sm text-gray-600 mb-4">
              For now you can download the PDF and email it manually. The composer in the lead
              drawer's Outreach section can attach it.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>Close</Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

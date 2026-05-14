import { useState, useEffect, useCallback } from 'react';
import api, { extractApiError, getBillOfSalePdfUrl } from '../api';
import { BOS_PAYMENT_TYPES } from '../lib/crm';

function BoSEditor({ leadId, initial, onSaved, onClose }) {
  const [d, setD]         = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  const set = (patch) => setD((prev) => ({ ...prev, ...patch }));

  const save = async () => {
    setSaving(true); setError('');
    try {
      const payload = { lead_id: leadId, ...d };
      const res = await api.put('/bill_of_sale', payload);
      onSaved?.(res.data.bill_of_sale);
    } catch (err) {
      setError(extractApiError(err, 'Failed to save Bill of Sale'));
    } finally {
      setSaving(false);
    }
  };

  const labelCls = 'block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1';
  const inputCls = 'w-full bg-gray-50 border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-gray-900/50" />
      <div className="relative bg-white w-full max-w-4xl rounded-2xl shadow-2xl m-4 flex flex-col max-h-[92vh]" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-gray-900">Bill of Sale</h3>
            <p className="text-[11px] text-gray-500 mt-0.5">Fields prefilled from lead data. Edit then save or download as PDF.</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100">&times;</button>
        </div>

        <div className="px-5 py-4 overflow-y-auto space-y-5">
          {/* 1. THE PARTIES */}
          <section>
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-gray-700 mb-2">1. The parties</h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <label><span className={labelCls}>County</span><input className={inputCls} value={d.sale_county ?? ''} onChange={(e) => set({ sale_county: e.target.value })} /></label>
              <label><span className={labelCls}>State</span><input className={inputCls} value={d.sale_state ?? ''} onChange={(e) => set({ sale_state: e.target.value })} /></label>
              <label><span className={labelCls}>Sale date</span><input type="date" className={inputCls} value={d.sale_date ?? ''} onChange={(e) => set({ sale_date: e.target.value })} /></label>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2">
              <label><span className={labelCls}>Buyer name</span><input className={inputCls} value={d.buyer_name ?? ''} onChange={(e) => set({ buyer_name: e.target.value })} /></label>
              <label><span className={labelCls}>Buyer mailing address</span><input className={inputCls} value={d.buyer_address ?? ''} onChange={(e) => set({ buyer_address: e.target.value })} /></label>
              <label><span className={labelCls}>Seller name</span><input className={inputCls} value={d.seller_name ?? ''} onChange={(e) => set({ seller_name: e.target.value })} /></label>
              <label><span className={labelCls}>Seller mailing address</span><input className={inputCls} value={d.seller_address ?? ''} onChange={(e) => set({ seller_address: e.target.value })} /></label>
            </div>
          </section>

          {/* 2. VEHICLE DESCRIPTION */}
          <section>
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-gray-700 mb-2">2. Vehicle description</h4>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <label><span className={labelCls}>Make</span><input className={inputCls} value={d.vehicle_make ?? ''} onChange={(e) => set({ vehicle_make: e.target.value })} /></label>
              <label><span className={labelCls}>Model</span><input className={inputCls} value={d.vehicle_model ?? ''} onChange={(e) => set({ vehicle_model: e.target.value })} /></label>
              <label><span className={labelCls}>Body type</span><input className={inputCls} value={d.vehicle_body_type ?? ''} onChange={(e) => set({ vehicle_body_type: e.target.value })} /></label>
              <label><span className={labelCls}>Year</span><input className={inputCls} value={d.vehicle_year ?? ''} onChange={(e) => set({ vehicle_year: e.target.value })} /></label>
              <label><span className={labelCls}>Color</span><input className={inputCls} value={d.vehicle_color ?? ''} onChange={(e) => set({ vehicle_color: e.target.value })} /></label>
              <label><span className={labelCls}>Odometer (miles)</span><input className={inputCls} value={d.vehicle_odometer ?? ''} onChange={(e) => set({ vehicle_odometer: e.target.value })} /></label>
            </div>
            <label className="block mt-2"><span className={labelCls}>VIN</span><input className={inputCls + ' font-mono'} value={d.vehicle_vin ?? ''} onChange={(e) => set({ vehicle_vin: e.target.value })} /></label>
          </section>

          {/* 3. EXCHANGE */}
          <section>
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-gray-700 mb-2">3. The exchange</h4>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
              {BOS_PAYMENT_TYPES.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => set({ payment_type: p.key })}
                  className={`px-3 py-2 text-xs font-medium rounded-lg border ${d.payment_type === p.key ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'}`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            {d.payment_type === 'cash' && (
              <label><span className={labelCls}>Cash amount ($)</span><input type="number" step="0.01" className={inputCls} value={d.payment_amount ?? ''} onChange={(e) => set({ payment_amount: e.target.value })} /></label>
            )}

            {d.payment_type === 'trade' && (
              <div className="space-y-2">
                <label><span className={labelCls}>Cash portion ($)</span><input type="number" step="0.01" className={inputCls} value={d.trade_amount ?? ''} onChange={(e) => set({ trade_amount: e.target.value })} /></label>
                <div className="rounded-lg border border-gray-100 bg-gray-50/50 p-2.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-2">Trade-in vehicle</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <label><span className={labelCls}>Make</span><input className={inputCls} value={d.trade_make ?? ''} onChange={(e) => set({ trade_make: e.target.value })} /></label>
                    <label><span className={labelCls}>Model</span><input className={inputCls} value={d.trade_model ?? ''} onChange={(e) => set({ trade_model: e.target.value })} /></label>
                    <label><span className={labelCls}>Body type</span><input className={inputCls} value={d.trade_body_type ?? ''} onChange={(e) => set({ trade_body_type: e.target.value })} /></label>
                    <label><span className={labelCls}>Year</span><input className={inputCls} value={d.trade_year ?? ''} onChange={(e) => set({ trade_year: e.target.value })} /></label>
                    <label><span className={labelCls}>Color</span><input className={inputCls} value={d.trade_color ?? ''} onChange={(e) => set({ trade_color: e.target.value })} /></label>
                    <label><span className={labelCls}>Odometer (miles)</span><input className={inputCls} value={d.trade_odometer ?? ''} onChange={(e) => set({ trade_odometer: e.target.value })} /></label>
                  </div>
                </div>
              </div>
            )}

            {d.payment_type === 'gift' && (
              <label><span className={labelCls}>Vehicle value ($)</span><input type="number" step="0.01" className={inputCls} value={d.gift_value ?? ''} onChange={(e) => set({ gift_value: e.target.value })} /></label>
            )}

            {d.payment_type === 'other' && (
              <label><span className={labelCls}>Describe other terms</span><textarea rows={2} className={inputCls} value={d.other_terms ?? ''} onChange={(e) => set({ other_terms: e.target.value })} /></label>
            )}
          </section>

          {/* 4. TAXES */}
          <section>
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-gray-700 mb-2">4. Taxes</h4>
            <div className="flex gap-2">
              {[['buyer','Buyer pays (not included)'], ['seller','Seller pays (included)']].map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => set({ taxes_paid_by: k })}
                  className={`flex-1 px-3 py-2 text-xs font-medium rounded-lg border ${d.taxes_paid_by === k ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </section>

          {/* ODOMETER DISCLOSURE */}
          <section>
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-gray-700 mb-2">Odometer disclosure</h4>
            <p className="text-[11px] text-gray-500 mb-2">By default the odometer reading is certified accurate. Check a box only if it&apos;s not.</p>
            <label className="flex items-start gap-2 text-xs text-gray-800 mb-1.5">
              <input type="checkbox" checked={!!d.odometer_exceeds_limits} onChange={(e) => set({ odometer_exceeds_limits: e.target.checked, odometer_accurate: e.target.checked ? false : !d.odometer_not_actual })} className="mt-0.5" />
              <span>The odometer reading reflects the amount of mileage <b>in excess</b> of its mechanical limits.</span>
            </label>
            <label className="flex items-start gap-2 text-xs text-gray-800">
              <input type="checkbox" checked={!!d.odometer_not_actual} onChange={(e) => set({ odometer_not_actual: e.target.checked, odometer_accurate: e.target.checked ? false : !d.odometer_exceeds_limits })} className="mt-0.5" />
              <span>The odometer reading is <b>not</b> the actual mileage. <span className="text-red-700 font-semibold">WARNING — ODOMETER DISCREPANCY</span></span>
            </label>
          </section>

          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>

        <div className="px-5 py-3 border-t border-gray-100 flex flex-wrap justify-between items-center gap-2">
          <a
            href={getBillOfSalePdfUrl(leadId)}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-gray-600 hover:text-gray-900 underline"
          >
            Preview / download with current saved data
          </a>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-3 py-1.5 text-xs text-gray-600 hover:text-gray-900">Cancel</button>
            <button onClick={save} disabled={saving}
              className="px-4 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40">
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LeadBillOfSaleSection({ leadId, onChanged }) {
  const [bos, setBos]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  const [open, setOpen]       = useState(false);
  const [signOpen, setSignOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // GET returns either the saved record OR the defaults derived from lead+company_settings.
      const res = await api.get('/bill_of_sale', { params: { lead_id: leadId } });
      setBos(res.data);
      setError('');
    } catch (err) {
      setError(extractApiError(err, 'Failed to load Bill of Sale'));
    } finally {
      setLoading(false);
    }
  }, [leadId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <p className="text-xs text-gray-400">Loading bill of sale…</p>;

  const saved = bos && bos.id;
  const readyToSign = saved && bos.buyer_name && bos.payment_amount;

  return (
    <>
      <div className="rounded-xl border border-gray-100 bg-white p-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-900">Motor Vehicle Bill of Sale</p>
            <p className="text-[11px] text-gray-500 mt-0.5">
              {saved
                ? <>Saved · Payment: <b>{bos.payment_type}</b>{bos.payment_amount ? ` · $${Number(bos.payment_amount).toFixed(2)}` : ''} · Buyer: {bos.buyer_name || '—'}</>
                : <>Not saved yet — fields will be prefilled from this lead.</>}
            </p>
          </div>
          <div className="flex gap-2 flex-shrink-0 flex-wrap">
            <button onClick={() => setOpen(true)} className="px-3 py-1.5 text-xs font-medium bg-gray-900 hover:bg-gray-800 text-white rounded-lg">
              {saved ? 'Edit fields' : 'Fill out form'}
            </button>
            <a
              href={getBillOfSalePdfUrl(leadId)}
              target="_blank"
              rel="noreferrer"
              className="px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white rounded-lg"
            >
              Download PDF
            </a>
            {readyToSign && (
              <button
                onClick={() => setSignOpen(true)}
                className="px-3 py-1.5 text-xs font-medium bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg"
                title="Send to buyer for e-signature (v2 — coming soon)"
              >
                Send for signature
              </button>
            )}
          </div>
        </div>
        {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
      </div>

      {open && bos && (
        <BoSEditor
          leadId={leadId}
          initial={bos}
          onSaved={(saved) => { if (saved) setBos(saved); setOpen(false); onChanged?.(); }}
          onClose={() => setOpen(false)}
        />
      )}

      {signOpen && (
        <SignatureV2Modal onClose={() => setSignOpen(false)} buyerName={bos?.buyer_name} />
      )}
    </>
  );
}

/**
 * E-signature stub — v2 will wire this to OpenSign (self-hosted). For
 * now it just explains the plan so operators know to download + send
 * the PDF manually in the meantime.
 */
function SignatureV2Modal({ onClose, buyerName }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative bg-white max-w-md w-full rounded-2xl shadow-2xl p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-gray-900 mb-2">E-signature is coming in v2</h3>
        <p className="text-sm text-gray-600 mb-3">
          We're integrating self-hosted <strong>OpenSign</strong> here. When it ships:
        </p>
        <ul className="text-sm text-gray-600 list-disc pl-5 space-y-1 mb-4">
          <li>One click sends {buyerName ? <b>{buyerName}</b> : 'the buyer'} an email with a signing link.</li>
          <li>Buyer signs on a clean web page (no app install).</li>
          <li>Signed PDF lands back on this lead automatically — status flips to <em>Signed</em>.</li>
          <li>Full audit trail (timestamp, IP, signer info) attached to the PDF.</li>
        </ul>
        <p className="text-sm text-gray-600 mb-4">
          Until then: download the PDF and email it manually via the
          <strong> Outreach </strong> section above. It pre-fills a greeting
          for {buyerName ? buyerName.split(' ')[0] : 'the buyer'}.
        </p>
        <div className="flex justify-end">
          <button onClick={onClose} className="px-4 py-2 text-xs font-medium bg-gray-900 text-white rounded-lg">Close</button>
        </div>
      </div>
    </div>
  );
}

import { useState, useEffect, useCallback, useMemo } from 'react';
import api, { extractApiError } from '../api';
import { SectionHeader, Button, Icon, Input, EmptyState, KPI } from '../components/ui';
import LeadDetailDrawer from '../components/LeadDetailDrawer';

// 5-stage post-close pipeline. The order here is the order they render
// in the row tracker, left to right. `done` is set by the API based on
// derived state (BoS signed_at, funded_at, transport status).
const STAGES = [
  { key: 'closed',              label: 'Closed',              short: 'Closed' },
  { key: 'bos_signed',          label: 'Bill of Sale signed', short: 'BoS' },
  { key: 'funded',              label: 'Funded',              short: 'Funded' },
  { key: 'transport_scheduled', label: 'Transport scheduled', short: 'Dispatch' },
  { key: 'delivered',           label: 'Delivered',           short: 'Delivered' },
];

const STAGE_COLOR = {
  closed:              { dot: '#a1a1aa', bg: '#f4f4f5', text: '#52525b' },
  bos_signed:          { dot: '#3b82f6', bg: '#dbeafe', text: '#1d4ed8' },
  funded:              { dot: '#8b5cf6', bg: '#ede9fe', text: '#6d28d9' },
  transport_scheduled: { dot: '#f59e0b', bg: '#fef3c7', text: '#a16207' },
  delivered:           { dot: '#10b981', bg: '#d1fae5', text: '#047857' },
};

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
 * Funding tab — post-close pipeline view. Every lead with
 * lead_temperature='closed' is here, plotted across 5 derived stages:
 * Closed → BoS signed → Funded → Transport scheduled → Delivered.
 *
 * Stage status is derived server-side from existing data (bill_of_sale,
 * lead_transport), so most stages flip automatically as operators do
 * their normal work in those tabs. The one stage that needs explicit
 * marking is "Funded" — clicking the funded stage opens a small modal
 * to capture amount + notes.
 *
 * Click anywhere else on a row to open the lead drawer.
 */
export default function FundingPage() {
  const [rows, setRows] = useState([]);
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [stageFilter, setStageFilter] = useState('');
  const [search, setSearch] = useState('');
  const [openLeadId, setOpenLeadId] = useState(null);
  const [fundModal, setFundModal] = useState(null); // row being marked funded

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const res = await api.get('/funding');
      setRows(res.data?.rows || []);
      setCounts(res.data?.counts || {});
    } catch (err) {
      setError(extractApiError(err, 'Failed to load funding pipeline'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (stageFilter && r.current_stage !== stageFilter) return false;
      if (q) {
        const hay = [r.lead_name, r.buyer_name, r.vin, r.vehicle]
          .map((x) => (x ?? '').toString().toLowerCase()).join(' ');
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, search, stageFilter]);

  return (
    <div className="max-w-[1400px] mx-auto">
      <SectionHeader
        title="Funding"
        subtitle="Closed deals moving through the post-close pipeline. Every stage except Funded auto-flips from BoS + Dispatch."
      />

      {error && (
        <div className="mb-4 px-3 py-2 rounded-md text-[13px] bg-red-50 border border-red-100 text-red-700">{error}</div>
      )}

      {/* KPI strip — click to filter by current stage. */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-5">
        {STAGES.map((s) => (
          <KPI
            key={s.key}
            label={s.label}
            value={counts[s.key] ?? 0}
            dot={STAGE_COLOR[s.key].dot}
            onClick={() => setStageFilter(stageFilter === s.key ? '' : s.key)}
          />
        ))}
      </div>

      {/* Search */}
      <div className="mb-4 flex gap-2 items-center">
        <Input
          icon="search"
          placeholder="Search by name, VIN, or vehicle…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1"
        />
        {(search || stageFilter) && (
          <Button variant="ghost" onClick={() => { setSearch(''); setStageFilter(''); }}>
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
            icon="check"
            title={rows.length === 0 ? 'No closed deals yet' : 'No matches'}
            body={rows.length === 0
              ? 'Once a lead is set to temperature "Closed", it shows up here with its post-close stages.'
              : 'Try a different search or clear the stage filter.'}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="bg-gray-50/60">
                <tr className="border-b border-gray-200">
                  <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Lead</th>
                  <th className="hidden md:table-cell px-4 py-2.5 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Vehicle</th>
                  <th className="hidden sm:table-cell px-4 py-2.5 text-right text-[10px] font-semibold text-gray-500 uppercase tracking-wider tabular-nums">Offer</th>
                  <th className="px-4 py-2.5 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Pipeline stages</th>
                  <th className="hidden lg:table-cell px-4 py-2.5 text-left text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Assigned</th>
                  <th className="px-4 py-2.5 text-right text-[10px] font-semibold text-gray-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.lead_id} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
                    <td className="px-4 py-3">
                      <button
                        onClick={() => setOpenLeadId(r.lead_id)}
                        className="text-gray-900 font-medium hover:underline text-left block"
                      >
                        {r.lead_name || `Lead #${r.lead_id}`}
                      </button>
                      {r.vin && <p className="text-[10px] font-mono text-gray-400 mt-0.5">VIN {r.vin}</p>}
                    </td>
                    <td className="hidden md:table-cell px-4 py-3 text-gray-700">
                      {r.vehicle || <span className="text-gray-300">—</span>}
                    </td>
                    <td className="hidden sm:table-cell px-4 py-3 text-right tabular-nums text-gray-900">
                      {formatMoney(r.price_offered)}
                    </td>
                    <td className="px-4 py-3">
                      <StageTracker row={r} onMarkFunded={() => setFundModal(r)} />
                    </td>
                    <td className="hidden lg:table-cell px-4 py-3 text-[12px] text-gray-700">
                      {r.assigned_user_name || <span className="text-gray-400">Unassigned</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => setOpenLeadId(r.lead_id)}
                        className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-100 rounded"
                      >
                        <Icon name="chevronRight" size={12} /> Open
                      </button>
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

      {fundModal && (
        <MarkFundedModal row={fundModal} onClose={() => setFundModal(null)} onSaved={() => { setFundModal(null); load(); }} />
      )}
    </div>
  );
}

/**
 * 5-step horizontal stage tracker. Completed stages are filled with
 * their stage color; future stages are outlined grey. Hovering shows
 * the underlying date / amount where applicable.
 *
 * The "Funded" pill is clickable when reachable (BoS signed but not yet
 * funded) so the operator can record the funding event without leaving
 * the row.
 */
function StageTracker({ row, onMarkFunded }) {
  return (
    <div className="flex items-center gap-0.5">
      {STAGES.map((s, i) => {
        const done = row.stages?.[s.key];
        const color = STAGE_COLOR[s.key];
        const detail = stageDetailText(s.key, row);
        const canMarkFunded = s.key === 'funded' && !done && row.stages?.bos_signed;
        const clickable = canMarkFunded;

        return (
          <div key={s.key} className="flex items-center">
            <button
              onClick={clickable ? (e) => { e.stopPropagation(); onMarkFunded?.(); } : undefined}
              disabled={!clickable}
              title={detail || s.label}
              className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium transition-all
                ${done ? '' : 'opacity-40'}
                ${clickable ? 'hover:ring-2 hover:ring-offset-1 cursor-pointer' : 'cursor-default'}
              `}
              style={{
                backgroundColor: done ? color.bg : '#fafafa',
                color: done ? color.text : '#a1a1aa',
                border: `1px solid ${done ? color.dot : '#e4e4e7'}`,
              }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: done ? color.dot : '#d4d4d8' }}
              />
              {s.short}
            </button>
            {i < STAGES.length - 1 && (
              <span
                className="w-3 h-px"
                style={{ background: row.stages?.[STAGES[i + 1].key] ? color.dot : '#e4e4e7' }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function stageDetailText(key, row) {
  if (key === 'closed')              return `Closed`;
  if (key === 'bos_signed')          return row.bos_signed_at ? `BoS signed ${formatDate(row.bos_signed_at)}` : 'Bill of Sale not yet signed';
  if (key === 'funded')              return row.funded_at ? `Funded ${formatDate(row.funded_at)}${row.funded_amount ? ` · ${formatMoney(row.funded_amount)}` : ''}${row.funded_by_name ? ` by ${row.funded_by_name}` : ''}` : 'Click to mark funded';
  if (key === 'transport_scheduled') return row.transport_date ? `Pickup ${formatDate(row.transport_date)}${row.transporter_name ? ` · ${row.transporter_name}` : ''}` : 'Transport not scheduled';
  if (key === 'delivered')           return row.transport_status === 'delivered' ? 'Delivered' : 'Not delivered yet';
  return '';
}

/**
 * Inline modal for capturing the funding event. Defaults the amount to
 * the BoS payment_amount when present so operators can confirm with
 * one click in the common case.
 */
function MarkFundedModal({ row, onClose, onSaved }) {
  const [amount, setAmount] = useState(row.payment_amount ?? '');
  const [notes, setNotes]   = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  const save = async () => {
    setSaving(true); setError('');
    try {
      await api.put('/funding', {
        lead_id: row.lead_id,
        funded_amount: amount === '' ? null : Number(amount),
        funding_notes: notes,
      });
      onSaved?.();
    } catch (err) {
      setError(extractApiError(err, 'Failed to mark funded'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative bg-white max-w-md w-full rounded-2xl shadow-2xl p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-gray-900 mb-1">Mark funded</h3>
        <p className="text-[11px] text-gray-500 mb-4">
          {row.lead_name || `Lead #${row.lead_id}`}
          {row.vehicle ? ` · ${row.vehicle}` : ''}
        </p>

        <div className="space-y-3">
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Funded amount</label>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="w-full bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-2 text-[13px] focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none tabular-nums"
              placeholder="0"
              step="0.01"
            />
            {row.payment_amount !== null && (
              <p className="text-[10px] text-gray-400 mt-1">
                Default is the Bill of Sale payment amount ({formatMoney(row.payment_amount)}).
              </p>
            )}
          </div>

          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Notes <span className="text-[9px] normal-case text-gray-400">(optional)</span></label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-2 text-[13px] focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
              placeholder="Wire confirmation, check #, anything you'd want to find later…"
            />
          </div>

          {error && <p className="text-[12px] text-red-600">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
            <button
              onClick={save}
              disabled={saving}
              className="px-4 py-2 text-[12px] font-semibold rounded-md text-white bg-violet-600 hover:bg-violet-700 disabled:opacity-50"
            >
              {saving ? 'Saving…' : 'Mark funded'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

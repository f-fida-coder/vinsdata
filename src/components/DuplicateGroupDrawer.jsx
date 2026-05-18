import { useState, useEffect, useCallback } from 'react';
import api, { extractApiError } from '../api';
import { useAuth } from '../context/AuthContext';
import LeadDetailDrawer from './LeadDetailDrawer';
import {
  MATCH_TYPE_BY_KEY, REVIEW_STATUS_BY_KEY, REVIEW_STATUSES,
  confidenceLabel, confidenceStyle, formatMatchKey,
} from '../lib/duplicates';
import { STATUS_BY_KEY, PRIORITY_BY_KEY } from '../lib/crm';

function formatDate(s) {
  if (!s) return '—';
  const d = new Date(String(s).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString();
}

function memberTitle(m) {
  const np = m.normalized_payload || {};
  const name = np.full_name || [np.first_name, np.last_name].filter(Boolean).join(' ');
  return name || np.vin || `Row #${m.source_row_number}`;
}

function ReviewStatusPill({ status }) {
  const s = REVIEW_STATUS_BY_KEY[status] || REVIEW_STATUS_BY_KEY.pending;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-semibold ${s.bg} ${s.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />{s.label}
    </span>
  );
}

function ConfidencePill({ value }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold ${confidenceStyle(value)}`}>
      {confidenceLabel(value)} · {(value * 100).toFixed(0)}%
    </span>
  );
}

function MemberCard({ m, onOpen }) {
  const np = m.normalized_payload || {};
  const status = m.crm_status || 'new';
  const priority = m.crm_priority || 'medium';
  const statusMeta = STATUS_BY_KEY[status];
  const priorityMeta = PRIORITY_BY_KEY[priority];
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">{memberTitle(m)}</p>
          {np.vin && <p className="text-[11px] font-mono text-gray-500 mt-0.5">VIN {np.vin}</p>}
        </div>
        <button
          onClick={() => onOpen(m.imported_lead_id)}
          className="text-[11px] text-blue-600 hover:text-blue-800 font-medium shrink-0"
        >
          Open in CRM →
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 mt-2">
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold ${statusMeta.bg} ${statusMeta.text}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${statusMeta.dot}`} />{statusMeta.label}
        </span>
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold ${priorityMeta.bg} ${priorityMeta.text}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${priorityMeta.dot}`} />{priorityMeta.label}
        </span>
        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-gray-50 text-gray-700 border border-gray-100">
          {m.assigned_user_name || 'Unassigned'}
        </span>
        {(m.labels || []).slice(0, 4).map((l) => (
          <span key={l.id} className="inline-flex items-center text-[10px] font-medium text-white px-1.5 py-0.5 rounded" style={{ backgroundColor: l.color }}>
            {l.name}
          </span>
        ))}
      </div>

      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
        <Field label="Phone">{np.phone_primary}</Field>
        <Field label="Email">{np.email_primary}</Field>
        <Field label="Address">{np.full_address}</Field>
        <Field label="City / State">{[np.city, np.state].filter(Boolean).join(', ')}</Field>
        <Field label="Vehicle">{[np.year, np.make, np.model].filter(Boolean).join(' ')}</Field>
        <Field label="Mileage">{np.mileage}</Field>
      </dl>

      <div className="mt-2 pt-2 border-t border-gray-100 text-[11px] text-gray-500">
        <p><span className="text-gray-400">Batch:</span> {m.batch_name}</p>
        <p className="truncate"><span className="text-gray-400">File:</span> {m.file_display_name || m.file_name}</p>
        <p><span className="text-gray-400">Row:</span> #{m.source_row_number} · <span className="text-gray-400">Stage:</span> {m.source_stage} · <span className="text-gray-400">Imported:</span> {formatDate(m.imported_at)}</p>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  const value = children;
  return (
    <>
      <dt className="text-gray-400 truncate">{label}</dt>
      <dd className="text-gray-800 truncate">{value ? String(value) : <span className="text-gray-300">—</span>}</dd>
    </>
  );
}

function DuplicateGroupInner({ groupId, onClose, onChanged }) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reviewNotes, setReviewNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [reviewError, setReviewError] = useState('');
  const [openLeadId, setOpenLeadId] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get('/duplicate_groups', { params: { id: groupId } });
      setData(res.data);
      setError('');
    } catch (err) {
      setError(extractApiError(err, 'Failed to load duplicate group'));
    } finally {
      setLoading(false);
    }
  }, [groupId]);

  useEffect(() => { load(); }, [load]);

  const submitReview = async (decision) => {
    setSubmitting(true); setReviewError('');
    try {
      await api.post('/duplicate_reviews', {
        group_id: groupId,
        decision,
        notes: reviewNotes.trim() || null,
      });
      setReviewNotes('');
      await load();
      onChanged?.();
    } catch (err) {
      setReviewError(extractApiError(err, 'Failed to save review'));
    } finally {
      setSubmitting(false);
    }
  };

  const group = data?.group;
  const members = data?.members || [];
  const reviews = data?.reviews || [];
  const typeMeta = group ? MATCH_TYPE_BY_KEY[group.match_type] : null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-gray-900/50" />
      <aside
        className="relative bg-white w-full sm:w-[640px] h-full shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="shrink-0 border-b border-gray-100 px-5 sm:px-6 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold">Duplicate group</p>
              <h2 className="text-base sm:text-lg font-semibold text-gray-900 mt-0.5">Group #{groupId}</h2>
              {group && (
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  {typeMeta && (
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold ${typeMeta.bg} ${typeMeta.text}`}>
                      {typeMeta.label}
                    </span>
                  )}
                  <ConfidencePill value={group.confidence} />
                  <ReviewStatusPill status={group.review_status} />
                  <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold bg-gray-50 text-gray-700 border border-gray-100">
                    {group.member_count} leads
                  </span>
                </div>
              )}
            </div>
            <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100">&times;</button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-4 space-y-5">
          {loading && !data && (
            <div className="py-10 text-center">
              <div className="w-8 h-8 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin mx-auto" />
              <p className="text-xs text-gray-400 mt-2">Loading group…</p>
            </div>
          )}

          {error && (
            <div className="bg-red-50 border border-red-100 text-red-700 rounded-xl p-3 text-sm">{error}</div>
          )}

          {group && (
            <>
              <section className="rounded-xl border border-amber-100 bg-amber-50/50 p-3 text-xs">
                <p className="font-semibold uppercase tracking-wider text-amber-700 mb-1">Why flagged</p>
                <p className="text-sm text-amber-900">
                  {members.length} leads share the same <strong>{typeMeta?.label || group.match_type}</strong>.
                </p>
                <p className="text-xs text-amber-800 mt-1 font-mono break-all">
                  Key: {formatMatchKey(group.match_type, group.match_key)}
                </p>
              </section>

              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">Members ({members.length})</h3>
                <div className="space-y-2.5">
                  {members.map((m) => (
                    <MemberCard key={m.imported_lead_id} m={m} onOpen={setOpenLeadId} />
                  ))}
                </div>
              </section>

              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">Review decision</h3>
                {!isAdmin ? (
                  <p className="text-xs text-gray-500 italic">Only an admin can record review decisions.</p>
                ) : (
                  <>
                    <textarea
                      value={reviewNotes}
                      onChange={(e) => setReviewNotes(e.target.value)}
                      rows={2}
                      maxLength={2000}
                      placeholder="Optional notes for this decision…"
                      className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                    />
                    {reviewError && <p className="text-xs text-red-600 mt-2">{reviewError}</p>}
                    <div className="flex flex-wrap gap-2 mt-2">
                      {REVIEW_STATUSES.map((s) => (
                        <button
                          key={s.key}
                          onClick={() => submitReview(s.key)}
                          disabled={submitting}
                          className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors disabled:opacity-40 ${
                            group.review_status === s.key
                              ? 'bg-blue-600 text-white border-blue-600'
                              : 'bg-white hover:bg-gray-50 text-gray-700 border-gray-200'
                          }`}
                        >
                          {s.key === 'pending' ? 'Reset to pending'
                            : s.key === 'confirmed_duplicate' ? 'Confirm duplicate'
                            : s.key === 'not_duplicate' ? 'Not a duplicate'
                            : 'Ignore'}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </section>

              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">
                  Review history ({reviews.length})
                </h3>
                {reviews.length === 0 ? (
                  <p className="text-xs text-gray-400 italic">No decisions recorded yet.</p>
                ) : (
                  <ol className="space-y-2">
                    {reviews.map((r) => (
                      <li key={r.id} className="rounded-lg border border-gray-100 bg-gray-50/50 p-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <ReviewStatusPill status={r.decision} />
                          <p className="text-[11px] text-gray-500">{formatDate(r.reviewed_at || r.created_at)}</p>
                        </div>
                        <p className="text-[11px] text-gray-500 mt-1">
                          by <span className="font-medium text-gray-700">{r.reviewed_by_name}</span>
                        </p>
                        {r.notes && (
                          <p className="text-xs text-gray-700 mt-1 whitespace-pre-wrap break-words">&ldquo;{r.notes}&rdquo;</p>
                        )}
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            </>
          )}
        </div>
      </aside>

      {/* Nested lead drawer, rendered above the group drawer */}
      <LeadDetailDrawer leadId={openLeadId} onClose={() => setOpenLeadId(null)} />
    </div>
  );
}

export default function DuplicateGroupDrawer({ groupId, onClose, onChanged }) {
  if (!groupId) return null;
  return <DuplicateGroupInner key={groupId} groupId={groupId} onClose={onClose} onChanged={onChanged} />;
}

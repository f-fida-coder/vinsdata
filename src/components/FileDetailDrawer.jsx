import { useState, useEffect, useMemo } from 'react';
import api, { getArtifactDownloadUrl, extractApiError } from '../api';
import { useAuth } from '../context/AuthContext';

const STAGES = ['generated', 'carfax', 'filter', 'tlo'];
const NEXT_STAGE = { generated: 'carfax', carfax: 'filter', filter: 'tlo', tlo: null };
const STAGE_LABEL = { generated: 'Generated', carfax: 'Carfax', filter: 'Filter', tlo: 'TLO' };

// Mirrors the backend's STAGE_ROLES. Client-side gating only — backend is authoritative.
const STAGE_ROLES = {
  generated: ['admin'],
  carfax:    ['admin', 'carfax'],
  filter:    ['admin', 'filter'],
  tlo:       ['admin', 'tlo'],
};

const STATUS_STYLES = {
  active:    { bg: 'bg-blue-50',    text: 'text-blue-700',    dot: 'bg-blue-500',    label: 'Active' },
  completed: { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500', label: 'Completed' },
  blocked:   { bg: 'bg-amber-50',   text: 'text-amber-700',   dot: 'bg-amber-500',   label: 'Blocked' },
  invalid:   { bg: 'bg-red-50',     text: 'text-red-700',     dot: 'bg-red-500',     label: 'Invalid' },
};

const ACTION_META = {
  create:     { label: 'Created',     dot: 'bg-blue-500' },
  upload:     { label: 'Upload',      dot: 'bg-sky-500' },
  advance:    { label: 'Advanced',    dot: 'bg-emerald-500' },
  complete:   { label: 'Completed',   dot: 'bg-emerald-600' },
  block:      { label: 'Blocked',     dot: 'bg-amber-500' },
  invalidate: { label: 'Invalidated', dot: 'bg-red-500' },
  reactivate: { label: 'Reactivated', dot: 'bg-blue-400' },
};

function formatDate(s) {
  if (!s) return '—';
  const d = new Date(s.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString();
}

function StatusPill({ status }) {
  const s = STATUS_STYLES[status] ?? STATUS_STYLES.active;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold ${s.bg} ${s.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

function StageCard({ stage, artifacts, isCurrent, fileStatus, canReupload, onReupload }) {
  const [expanded, setExpanded] = useState(false);
  const sorted = useMemo(() => [...artifacts].sort((a, b) => b.id - a.id), [artifacts]);
  const latest = sorted[0];
  const historic = sorted.slice(1);

  const isDone = artifacts.length > 0 && !isCurrent;
  const dotClass = artifacts.length === 0
    ? (isCurrent ? 'bg-blue-400 ring-blue-100' : 'bg-gray-200 ring-gray-100')
    : 'bg-emerald-500 ring-emerald-100';

  return (
    <div className={`rounded-xl border ${isCurrent ? 'border-zinc-200 bg-blue-50/30' : 'border-gray-100 bg-white'} p-4`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className={`w-3 h-3 rounded-full ring-4 ${dotClass}`} />
          <h4 className="text-sm font-semibold text-gray-800">{STAGE_LABEL[stage]}</h4>
          {isCurrent && <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--vv-text)] bg-blue-100 px-1.5 py-0.5 rounded">Current</span>}
          {isDone && <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-600 bg-emerald-100 px-1.5 py-0.5 rounded">Done</span>}
        </div>
        <span className="text-[11px] text-gray-400">{artifacts.length} {artifacts.length === 1 ? 'version' : 'versions'}</span>
      </div>

      {latest ? (
        <div className="mt-3">
          <div className="flex items-center justify-between gap-2 rounded-lg border border-gray-100 bg-white p-2.5">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">Latest</span>
                <p className="text-sm font-medium text-gray-800 truncate">{latest.original_filename}</p>
              </div>
              <p className="text-[11px] text-gray-400 mt-0.5">{formatDate(latest.uploaded_at)} · {latest.uploaded_by_name}</p>
            </div>
            <a
              href={getArtifactDownloadUrl(latest.id)}
              className="shrink-0 inline-flex items-center gap-1 text-xs font-medium bg-gray-50 hover:bg-gray-100 text-gray-700 px-2.5 py-1.5 rounded-md border border-gray-200 transition-colors"
              title="Download"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
              Download
            </a>
          </div>

          {historic.length > 0 && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="mt-2 text-xs font-medium text-[var(--vv-text)] hover:underline"
            >
              {expanded ? 'Hide' : `Show ${historic.length} older ${historic.length === 1 ? 'version' : 'versions'}`}
            </button>
          )}

          {expanded && historic.length > 0 && (
            <div className="mt-2 space-y-1.5">
              {historic.map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-2 rounded-lg border border-gray-100 bg-gray-50/60 p-2.5">
                  <div className="min-w-0">
                    <p className="text-sm text-gray-700 truncate">{a.original_filename}</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">{formatDate(a.uploaded_at)} · {a.uploaded_by_name}</p>
                  </div>
                  <a
                    href={getArtifactDownloadUrl(a.id)}
                    className="shrink-0 inline-flex items-center gap-1 text-[11px] font-medium bg-white hover:bg-gray-50 text-gray-600 px-2 py-1 rounded-md border border-gray-200"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                    Download
                  </a>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <p className="mt-3 text-xs text-gray-400 italic">No artifacts uploaded for this stage yet.</p>
      )}

      {isCurrent && fileStatus === 'active' && canReupload && (
        <button
          onClick={onReupload}
          className="mt-3 w-full inline-flex items-center justify-center gap-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 px-3 py-2 rounded-lg border border-zinc-200 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
          Re-upload {STAGE_LABEL[stage]} (new version)
        </button>
      )}
    </div>
  );
}

function Timeline({ events, loading }) {
  if (loading) {
    return <p className="text-xs text-gray-400">Loading timeline...</p>;
  }
  if (events.length === 0) {
    return <p className="text-xs text-gray-400 italic">No history yet.</p>;
  }
  return (
    <ol className="space-y-3">
      {events.map((e) => {
        const meta = ACTION_META[e.action_type] ?? { label: e.action_type, dot: 'bg-gray-400' };
        const stageChange = e.from_stage && e.from_stage !== e.to_stage
          ? `${STAGE_LABEL[e.from_stage]} → ${STAGE_LABEL[e.to_stage]}`
          : STAGE_LABEL[e.to_stage];
        return (
          <li key={e.id} className="flex gap-3">
            <div className={`mt-1 w-2 h-2 rounded-full ${meta.dot} shrink-0`} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-gray-800">{meta.label}</span>
                <span className="text-xs text-gray-500">{stageChange}</span>
              </div>
              <p className="text-[11px] text-gray-400 mt-0.5">{formatDate(e.created_at)} · {e.performed_by_name}</p>
              {e.artifact_name && (
                <p className="text-[11px] text-gray-500 mt-0.5">Artifact: {e.artifact_name}</p>
              )}
              {e.remarks && (
                <p className="text-xs text-gray-600 mt-1 italic">&ldquo;{e.remarks}&rdquo;</p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

const SPREADSHEET_EXTS = ['xlsx', 'xls', 'csv'];
function hasSpreadsheetArtifact(file) {
  const tlo = file?.artifacts_by_stage?.tlo || [];
  return tlo.some((a) => {
    const name = String(a.original_filename || '').toLowerCase();
    return SPREADSHEET_EXTS.some((e) => name.endsWith('.' + e));
  });
}

function FileDetailDrawerInner({ file, onClose, onReupload, onImport }) {
  const { user } = useAuth();
  const [events, setEvents] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState('');

  useEffect(() => {
    let cancelled = false;
    api.get('/file_history', { params: { file_id: file.id } })
      .then((res) => { if (!cancelled) setEvents(res.data || []); })
      .catch((err) => { if (!cancelled) setHistoryError(extractApiError(err, 'Failed to load history')); })
      .finally(() => { if (!cancelled) setHistoryLoading(false); });
    return () => { cancelled = true; };
  }, [file.id]);

  const role = user?.role;
  const canReuploadCurrent = role && STAGE_ROLES[file.current_stage]?.includes(role);
  const nextStage = file.next_stage ?? NEXT_STAGE[file.current_stage];
  const byStage = file.artifacts_by_stage || { generated: [], carfax: [], filter: [], tlo: [] };

  const importEligible = role === 'admin'
    && file.current_stage === 'tlo'
    && ['completed', 'active'].includes(file.status)
    && hasSpreadsheetArtifact(file);
  const importReason = !importEligible
    ? (role !== 'admin' ? 'Admin role required'
      : file.current_stage !== 'tlo' ? 'File must be at TLO stage'
      : !['completed', 'active'].includes(file.status) ? 'File is not importable'
      : 'Upload a spreadsheet (xlsx/xls/csv) to the TLO stage first')
    : null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-gray-900/50" />
      <aside
        className="relative bg-white w-full sm:w-[520px] h-full shadow-2xl flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="shrink-0 border-b border-gray-100 px-5 sm:px-6 py-4 bg-white">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base sm:text-lg font-semibold text-gray-900 truncate">{file.display_name || file.file_name}</h2>
                {file.version && <span className="text-[10px] font-medium text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">{file.version}</span>}
              </div>
              <p className="text-xs text-gray-500 mt-1">
                {file.vehicle?.name || file.vehicle_name}{file.year ? ` · ${file.year}` : ''}
              </p>
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <StatusPill status={file.status} />
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-gray-50 text-gray-700 border border-gray-100">
                  Stage: {STAGE_LABEL[file.current_stage]}
                </span>
                {file.next_upload_missing && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-100">
                    Waiting for {STAGE_LABEL[nextStage]} upload
                  </span>
                )}
              </div>
              {role === 'admin' && file.current_stage === 'tlo' && (
                <button
                  onClick={() => importEligible && onImport?.(file)}
                  disabled={!importEligible}
                  title={importReason || 'Import this final file into lead staging'}
                  className={`mt-3 inline-flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-lg border transition-colors ${
                    importEligible
                      ? 'bg-blue-600 hover:bg-blue-700 text-white border-blue-600'
                      : 'bg-gray-50 text-gray-400 border-gray-200 cursor-not-allowed'
                  }`}
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1M16 12l-4 4m0 0l-4-4m4 4V4" /></svg>
                  Import final file
                </button>
              )}
            </div>
            <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100">&times;</button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-4 space-y-5">
          {/* Summary */}
          <section className="rounded-xl border border-gray-100 bg-gray-50/60 p-4 text-xs">
            <div className="grid grid-cols-2 gap-y-2 gap-x-4">
              <div>
                <p className="font-semibold uppercase tracking-wider text-gray-400">Created by</p>
                <p className="text-sm text-gray-700 mt-0.5">{file.created_by_user?.name || '—'}</p>
              </div>
              <div>
                <p className="font-semibold uppercase tracking-wider text-gray-400">Assigned to</p>
                <p className="text-sm text-gray-700 mt-0.5">{file.assigned_to_user?.name || '—'}</p>
              </div>
              <div>
                <p className="font-semibold uppercase tracking-wider text-gray-400">Created at</p>
                <p className="text-sm text-gray-700 mt-0.5">{formatDate(file.created_at)}</p>
              </div>
              <div>
                <p className="font-semibold uppercase tracking-wider text-gray-400">Updated at</p>
                <p className="text-sm text-gray-700 mt-0.5">{formatDate(file.updated_at)}</p>
              </div>
            </div>
          </section>

          {/* Stages */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">Stages</h3>
            <div className="space-y-2.5">
              {STAGES.map((s) => (
                <StageCard
                  key={s}
                  stage={s}
                  artifacts={byStage[s] || []}
                  isCurrent={file.current_stage === s}
                  fileStatus={file.status}
                  canReupload={canReuploadCurrent}
                  onReupload={() => onReupload?.(file, s)}
                />
              ))}
            </div>
          </section>

          {/* Timeline */}
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">Timeline</h3>
            {historyError
              ? <p className="text-xs text-red-600">{historyError}</p>
              : <Timeline events={events} loading={historyLoading} />
            }
          </section>
        </div>
      </aside>
    </div>
  );
}

export default function FileDetailDrawer({ file, onClose, onReupload, onImport }) {
  if (!file) return null;
  return <FileDetailDrawerInner key={file.id} file={file} onClose={onClose} onReupload={onReupload} onImport={onImport} />;
}

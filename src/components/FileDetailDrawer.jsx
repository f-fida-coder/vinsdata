import { useState, useEffect, useMemo } from 'react';
import api, { getArtifactDownloadUrl, extractApiError } from '../api';
import { useAuth } from '../context/AuthContext';
import { Button, Icon, StatusBadge } from './ui';

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

const FILE_STATUS_LABEL = {
  active:    'Active',
  completed: 'Complete',
  blocked:   'Blocked',
  invalid:   'Invalid',
};

const ACTION_META = {
  create:     { label: 'Created' },
  upload:     { label: 'Upload' },
  advance:    { label: 'Advanced' },
  complete:   { label: 'Completed' },
  block:      { label: 'Blocked' },
  invalidate: { label: 'Invalidated' },
  reactivate: { label: 'Reactivated' },
};

const TIMELINE_DOT = {
  create:     'current',
  upload:     'current',
  advance:    'done',
  complete:   'done',
  block:      '',
  invalidate: '',
  reactivate: 'done',
};

function formatDate(s) {
  if (!s) return '—';
  const d = new Date(String(s).replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString();
}

function StageCard({ stage, artifacts, isCurrent, fileStatus, canReupload, onReupload, fileVersion }) {
  const [expanded, setExpanded] = useState(false);
  const sorted = useMemo(() => [...artifacts].sort((a, b) => b.id - a.id), [artifacts]);
  const latest = sorted[0];
  const historic = sorted.slice(1);

  const isDone = artifacts.length > 0 && !isCurrent;
  const isCurrentDone = isCurrent && artifacts.length > 0;
  const dotColor = artifacts.length === 0
    ? (isCurrent ? 'var(--info)' : 'var(--bg-3)')
    : 'var(--success)';

  let statusBadge = null;
  if (isDone || isCurrentDone) {
    statusBadge = <span className="status-badge sb-success">DONE</span>;
  } else if (isCurrent) {
    statusBadge = <span className="status-badge sb-info">CURRENT</span>;
  }

  const cardStyle = isCurrent
    ? { marginBottom: 8, padding: 12, borderColor: 'var(--info)', background: 'var(--info-bg)' }
    : { marginBottom: 8, padding: 12 };

  return (
    <div className="card" style={cardStyle}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="row">
          <span
            style={{
              width: 8, height: 8, borderRadius: 999, background: dotColor,
              boxShadow: `0 0 0 4px ${dotColor === 'var(--success)' ? 'var(--success-bg)' : (dotColor === 'var(--info)' ? 'var(--info-bg)' : 'var(--bg-2)')}`,
            }}
          />
          <strong style={{ fontSize: 13 }}>{STAGE_LABEL[stage]}</strong>
          {statusBadge}
        </div>
        {fileVersion && <span className="cell-muted tiny">{fileVersion}</span>}
      </div>

      {latest ? (
        <>
          <div
            style={{
              marginTop: 10,
              padding: '8px 10px',
              background: 'var(--bg-2)',
              borderRadius: 6,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="row" style={{ gap: 6 }}>
                <span className="status-badge sb-neutral">LATEST</span>
                <span className="cell-mono" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {latest.original_filename}
                </span>
              </div>
              <div className="cell-muted tiny" style={{ marginTop: 4 }}>
                {formatDate(latest.uploaded_at)} · {latest.uploaded_by_name}
              </div>
            </div>
            <a
              href={getArtifactDownloadUrl(latest.id)}
              className="vv-btn vv-btn-secondary vv-btn-sm"
              title="Download"
              style={{ flexShrink: 0 }}
            >
              <Icon name="download" size={14}/>
              Download
            </a>
          </div>

          {historic.length > 0 && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="vv-btn vv-btn-ghost vv-btn-sm"
              style={{ marginTop: 8, padding: '4px 6px' }}
            >
              {expanded ? 'Hide' : `Show ${historic.length} older ${historic.length === 1 ? 'version' : 'versions'}`}
            </button>
          )}

          {expanded && historic.length > 0 && (
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {historic.map((a) => (
                <div
                  key={a.id}
                  style={{
                    padding: '6px 10px',
                    background: 'var(--bg-1)',
                    border: '1px solid var(--border-0)',
                    borderRadius: 6,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="cell-mono" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {a.original_filename}
                    </div>
                    <div className="cell-muted tiny" style={{ marginTop: 2 }}>
                      {formatDate(a.uploaded_at)} · {a.uploaded_by_name}
                    </div>
                  </div>
                  <a
                    href={getArtifactDownloadUrl(a.id)}
                    className="vv-btn vv-btn-ghost vv-btn-sm"
                    style={{ flexShrink: 0 }}
                  >
                    <Icon name="download" size={12}/>
                    Download
                  </a>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <p className="cell-muted tiny" style={{ marginTop: 10, fontStyle: 'italic' }}>
          No artifacts uploaded for this stage yet.
        </p>
      )}

      {isCurrent && fileStatus === 'active' && canReupload && (
        <button
          type="button"
          onClick={onReupload}
          className="vv-btn vv-btn-secondary vv-btn-sm"
          style={{ marginTop: 10, width: '100%', justifyContent: 'center' }}
        >
          <Icon name="refresh" size={14}/>
          Re-upload {STAGE_LABEL[stage]} (new version)
        </button>
      )}
    </div>
  );
}

function Timeline({ events, loading }) {
  if (loading) {
    return <p className="cell-muted tiny">Loading timeline…</p>;
  }
  if (events.length === 0) {
    return <p className="cell-muted tiny" style={{ fontStyle: 'italic' }}>No history yet.</p>;
  }
  return (
    <div className="timeline">
      {events.map((e) => {
        const meta = ACTION_META[e.action_type] ?? { label: e.action_type };
        const dotClass = TIMELINE_DOT[e.action_type] ?? 'done';
        const stageChange = e.from_stage && e.from_stage !== e.to_stage
          ? `${STAGE_LABEL[e.from_stage]} → ${STAGE_LABEL[e.to_stage]}`
          : STAGE_LABEL[e.to_stage];
        const title = stageChange ? `${meta.label} · ${stageChange}` : meta.label;
        return (
          <div key={e.id} className="timeline-item">
            <span className={`timeline-dot ${dotClass}`}/>
            <div>
              <div className="timeline-title">{title}</div>
              <div className="timeline-meta">{formatDate(e.created_at)} · {e.performed_by_name}</div>
              {e.artifact_name && (
                <div className="timeline-meta">Artifact: {e.artifact_name}</div>
              )}
              {e.remarks && (
                <div className="timeline-meta" style={{ fontStyle: 'italic' }}>&ldquo;{e.remarks}&rdquo;</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const SPREADSHEET_EXTS = ['xlsx', 'xls', 'csv'];
function hasSpreadsheetArtifact(file) {
  const tlo = file?.artifacts_by_stage?.tlo || [];
  return tlo.some((a) => {
    const name = String(a.original_filename || '').toLowerCase();
    return SPREADSHEET_EXTS.some((ext) => name.endsWith('.' + ext));
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

  const showImport = role === 'admin' && file.current_stage === 'tlo';
  const statusLabel = FILE_STATUS_LABEL[file.status] || file.status;
  const titleText = file.display_name || file.file_name;

  return (
    <>
      <div className="drawer-overlay" onClick={onClose}/>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="drawer-head">
          <div style={{ minWidth: 0, flex: 1 }}>
            <h3
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 22,
                fontWeight: 400,
                letterSpacing: '-0.02em',
                color: 'var(--text-0)',
                lineHeight: 1.15,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={titleText}
            >
              {titleText}
            </h3>
            <div className="cell-muted tiny" style={{ marginTop: 4 }}>
              {file.vehicle?.name || file.vehicle_name}
              {file.year ? ` · ${file.year}` : ''}
              {file.version ? ` · ${file.version}` : ''}
            </div>
            <div className="row" style={{ marginTop: 10, flexWrap: 'wrap', gap: 8 }}>
              <StatusBadge status={statusLabel}/>
              <span className="cell-muted tiny">Stage: {STAGE_LABEL[file.current_stage]}</span>
              {file.next_upload_missing && nextStage && (
                <span className="status-badge sb-warn">Waiting for {STAGE_LABEL[nextStage]} upload</span>
              )}
            </div>
          </div>
          <Button variant="ghost" size="sm" icon="x" onClick={onClose} aria-label="Close"/>
        </div>

        {/* Body */}
        <div className="drawer-body">
          {showImport && (
            <Button
              variant="primary"
              icon="upload"
              onClick={() => importEligible && onImport?.(file)}
              disabled={!importEligible}
              title={importReason || 'Import this final file into lead staging'}
              style={{ marginBottom: 16 }}
            >
              Import final file
            </Button>
          )}

          {/* Metadata */}
          <div className="drawer-section">
            <div className="kv-grid">
              <div>
                <div className="kv-key">Created by</div>
                <div className="kv-val">{file.created_by_user?.name || '—'}</div>
              </div>
              <div>
                <div className="kv-key">Assigned to</div>
                <div className="kv-val">{file.assigned_to_user?.name || '—'}</div>
              </div>
              <div>
                <div className="kv-key">Created at</div>
                <div className="kv-val">{formatDate(file.created_at)}</div>
              </div>
              <div>
                <div className="kv-key">Updated at</div>
                <div className="kv-val">{formatDate(file.updated_at)}</div>
              </div>
            </div>
          </div>

          {/* Stages */}
          <div className="drawer-section">
            <div className="drawer-section-label">Stages</div>
            {STAGES.map((s) => (
              <StageCard
                key={s}
                stage={s}
                artifacts={byStage[s] || []}
                isCurrent={file.current_stage === s}
                fileStatus={file.status}
                canReupload={canReuploadCurrent}
                onReupload={() => onReupload?.(file, s)}
                fileVersion={file.version}
              />
            ))}
          </div>

          {/* Timeline */}
          <div className="drawer-section">
            <div className="drawer-section-label">Timeline</div>
            {historyError
              ? <p style={{ fontSize: 12, color: 'var(--danger)' }}>{historyError}</p>
              : <Timeline events={events} loading={historyLoading}/>
            }
          </div>
        </div>
      </div>
    </>
  );
}

export default function FileDetailDrawer({ file, onClose, onReupload, onImport }) {
  if (!file) return null;
  return <FileDetailDrawerInner key={file.id} file={file} onClose={onClose} onReupload={onReupload} onImport={onImport}/>;
}

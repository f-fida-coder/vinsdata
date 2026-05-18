import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import api from '../api';
import { SectionHeader, Button, EmptyState, StatusBadge } from '../components/ui';

export default function LogsPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const fileId = searchParams.get('file_id');
  const fileName = searchParams.get('name') || 'Unknown File';
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!fileId) return;
    setLoading(true);
    api.get('/logs', { params: { file_id: fileId } })
      .then((res) => setLogs(res.data))
      .catch(() => setError('Failed to load logs'))
      .finally(() => setLoading(false));
  }, [fileId]);

  return (
    <div className="page" style={{ maxWidth: 800 }}>
      <SectionHeader
        title="Activity Logs"
        subtitle={fileName}
        actions={<Button variant="ghost" icon="chevronLeft" onClick={() => navigate(-1)}>Back</Button>}
      />

      {loading ? (
        <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-3)' }}>Loading…</div>
      ) : error ? (
        <div className="card" style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}>{error}</div>
      ) : logs.length === 0 ? (
        <EmptyState icon="clock" title="No logs found" body="No activity has been recorded for this file yet."/>
      ) : (
        <div className="timeline">
          {logs.map((log) => (
            <div key={log.id} className="timeline-item">
              <span className="timeline-dot done"/>
              <div className="card" style={{ padding: 12, marginBottom: 0 }}>
                <div className="row" style={{ flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
                  {log.from_stage && (
                    <>
                      <StatusBadge status={log.from_stage}/>
                      <span style={{ color: 'var(--text-3)' }}>→</span>
                    </>
                  )}
                  <StatusBadge status={log.to_stage}/>
                </div>
                <div className="row">
                  <span className="cell-strong">{log.user_name}</span>
                  <span className="cell-muted" style={{ fontSize: 11 }}>{log.timestamp}</span>
                </div>
                {log.notes && (
                  <div style={{ marginTop: 6, padding: '6px 10px', background: 'var(--bg-2)', borderRadius: 6, fontSize: 12, color: 'var(--text-2)', fontStyle: 'italic' }}>
                    "{log.notes}"
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

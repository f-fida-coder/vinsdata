import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import api from '../api';

const STAGE_COLORS = {
  generated: 'bg-zinc-100 text-zinc-700 border-zinc-200',
  carfax: 'bg-amber-50 text-amber-700 border-amber-100',
  filter: 'bg-orange-50 text-orange-700 border-orange-100',
  tlo: 'bg-emerald-50 text-emerald-700 border-emerald-100',
};

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
    <div className="max-w-[800px] mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-6">
        <button
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 bg-white border border-gray-200 px-3 py-1.5 rounded-xl w-fit transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          Back
        </button>
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 truncate">Logs</h1>
          <p className="text-sm text-gray-500 truncate">{fileName}</p>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><div className="w-10 h-10 border-4 border-zinc-200 border-t-[var(--vv-bg-dark)] rounded-full animate-spin"></div></div>
      ) : error ? (
        <div className="bg-red-50 border border-red-100 text-red-600 px-4 py-3 rounded-xl text-sm">{error}</div>
      ) : logs.length === 0 ? (
        <div className="text-center py-16">
          <svg className="w-12 h-12 text-gray-200 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
          <p className="text-sm text-gray-400">No logs found for this file.</p>
        </div>
      ) : (
        <div>
          {logs.map((log, i) => (
            <div key={log.id} className="flex gap-3 sm:gap-4">
              <div className="flex flex-col items-center shrink-0">
                <div className="w-3 h-3 rounded-full bg-[var(--vv-bg-dark)] mt-2 ring-4 ring-zinc-100"></div>
                {i < logs.length - 1 && <div className="w-0.5 flex-1 bg-gray-100 mt-1"></div>}
              </div>
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-3 sm:p-4 mb-3 flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 mb-1.5">
                  {log.from_stage && (
                    <>
                      <span className={`px-2 py-0.5 rounded-lg text-[11px] font-semibold border ${STAGE_COLORS[log.from_stage] || 'bg-gray-50 text-gray-700 border-gray-100'}`}>{log.from_stage}</span>
                      <svg className="w-3 h-3 text-gray-300 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                    </>
                  )}
                  <span className={`px-2 py-0.5 rounded-lg text-[11px] font-semibold border ${STAGE_COLORS[log.to_stage] || 'bg-gray-50 text-gray-700 border-gray-100'}`}>{log.to_stage}</span>
                </div>
                <p className="text-sm text-gray-600">
                  <span className="font-medium text-gray-900">{log.user_name}</span>
                  <span className="text-gray-400 ml-2 text-xs">{log.timestamp}</span>
                </p>
                {log.notes && (
                  <p className="text-xs text-gray-500 mt-1.5 bg-gray-50 rounded-lg px-2.5 py-1.5 italic">"{log.notes}"</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

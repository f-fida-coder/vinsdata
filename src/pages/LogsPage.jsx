import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import api from '../api';

const STAGE_COLORS = {
  generated: 'bg-blue-100 text-blue-800',
  carfax: 'bg-yellow-100 text-yellow-800',
  filter: 'bg-orange-100 text-orange-800',
  tlo: 'bg-green-100 text-green-800',
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
    <div>
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={() => navigate(-1)}
          className="text-sm text-gray-500 hover:text-gray-700 border border-gray-300 px-3 py-1.5 rounded-md"
        >
          &larr; Back
        </button>
        <h1 className="text-2xl font-bold text-gray-800">Logs: {fileName}</h1>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div>
        </div>
      ) : error ? (
        <div className="bg-red-50 text-red-600 px-4 py-3 rounded-md">{error}</div>
      ) : logs.length === 0 ? (
        <p className="text-gray-400 text-center py-12">No logs found for this file.</p>
      ) : (
        <div className="space-y-0">
          {logs.map((log, i) => (
            <div key={log.id} className="flex gap-4">
              {/* Timeline line */}
              <div className="flex flex-col items-center">
                <div className="w-3 h-3 rounded-full bg-blue-500 mt-1.5 shrink-0"></div>
                {i < logs.length - 1 && <div className="w-0.5 flex-1 bg-gray-200"></div>}
              </div>

              {/* Card */}
              <div className="bg-white rounded-lg shadow-sm p-4 mb-4 flex-1">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  {log.from_stage ? (
                    <>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STAGE_COLORS[log.from_stage] || 'bg-gray-100 text-gray-800'}`}>
                        {log.from_stage}
                      </span>
                      <span className="text-gray-400">&rarr;</span>
                    </>
                  ) : null}
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STAGE_COLORS[log.to_stage] || 'bg-gray-100 text-gray-800'}`}>
                    {log.to_stage}
                  </span>
                </div>
                <p className="text-sm text-gray-600">
                  <span className="font-medium text-gray-800">{log.user_name}</span>
                  <span className="text-gray-400 ml-2">{log.timestamp}</span>
                </p>
                {log.notes && (
                  <p className="text-sm text-gray-500 mt-1 italic">"{log.notes}"</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

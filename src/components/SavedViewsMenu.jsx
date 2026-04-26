import { useState, useEffect, useRef, useCallback } from 'react';
import api, { extractApiError } from '../api';

/**
 * Dropdown that lists a user's saved views for a given view_type and lets them
 * apply / save / update / delete / set default. Entirely self-contained apart
 * from the current-filters snapshot that the parent passes in.
 *
 * Props:
 *   viewType: 'leads' | 'duplicates'
 *   currentFilters: object            // filters snapshot for "Save current view"
 *   activeViewId: number | null       // id of the currently-applied view (for highlighting)
 *   onApply: (view) => void           // apply a saved view's filters to the page
 *   onChanged?: () => void            // optional: called when views list changes
 */
export default function SavedViewsMenu({ viewType, currentFilters, activeViewId, onApply, onChanged }) {
  const [open, setOpen] = useState(false);
  const [views, setViews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saveMode, setSaveMode] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [saveDefault, setSaveDefault] = useState(false);
  const [saving, setSaving] = useState(false);
  const wrapperRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get('/saved_views', { params: { view_type: viewType } });
      setViews(res.data || []);
      setError('');
    } catch (err) {
      setError(extractApiError(err, 'Failed to load views'));
    } finally {
      setLoading(false);
    }
  }, [viewType]);

  useEffect(() => { load(); }, [load]);

  // Close menu on outside click.
  useEffect(() => {
    const handler = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false); setSaveMode(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const activeView = views.find((v) => v.id === activeViewId);

  const createView = async () => {
    if (!saveName.trim()) return;
    if (saveName.trim().length > 100) { setError('View name must be 100 characters or fewer'); return; }
    setSaving(true); setError('');
    try {
      const res = await api.post('/saved_views', {
        view_type:    viewType,
        name:         saveName.trim(),
        filters_json: currentFilters,
        is_default:   saveDefault,
      });
      setSaveName(''); setSaveDefault(false); setSaveMode(false);
      await load();
      onChanged?.();
      onApply?.(res.data?.view);
    } catch (err) {
      setError(extractApiError(err, 'Failed to save view'));
    } finally {
      setSaving(false);
    }
  };

  const updateToCurrent = async (view) => {
    setError('');
    try {
      await api.patch('/saved_views', { id: view.id, filters_json: currentFilters });
      await load();
      onChanged?.();
    } catch (err) {
      setError(extractApiError(err, 'Failed to update view'));
    }
  };

  const setDefault = async (view) => {
    setError('');
    try {
      await api.patch('/saved_views', { id: view.id, is_default: true });
      await load();
      onChanged?.();
    } catch (err) {
      setError(extractApiError(err, 'Failed to set default'));
    }
  };

  const clearDefault = async (view) => {
    setError('');
    try {
      await api.patch('/saved_views', { id: view.id, is_default: false });
      await load();
      onChanged?.();
    } catch (err) {
      setError(extractApiError(err, 'Failed to clear default'));
    }
  };

  const remove = async (view) => {
    if (!window.confirm(`Delete view "${view.name}"?`)) return;
    setError('');
    try {
      await api.delete('/saved_views', { data: { id: view.id } });
      await load();
      onChanged?.();
      if (activeViewId === view.id) onApply?.(null);
    } catch (err) {
      setError(extractApiError(err, 'Failed to delete view'));
    }
  };

  return (
    <div className="relative" ref={wrapperRef}>
      <button
        onClick={() => { setOpen((v) => !v); setSaveMode(false); }}
        title={activeView ? `View: ${activeView.name}` : 'Saved views'}
        aria-label={activeView ? `Saved view: ${activeView.name}` : 'Saved views'}
        className={`relative inline-flex items-center justify-center w-9 h-9 rounded-lg border transition-colors ${
          activeView
            ? 'bg-zinc-100 text-zinc-700 border-zinc-200'
            : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50 hover:text-gray-700'
        }`}
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" /></svg>
        {activeView && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-[var(--vv-bg-dark)] ring-2 ring-white" />}
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 w-80 bg-white rounded-xl shadow-xl border border-gray-100 z-30 max-h-[70vh] overflow-y-auto">
          {loading ? (
            <p className="text-xs text-gray-400 p-4">Loading…</p>
          ) : (
            <>
              {views.length === 0 && !saveMode && (
                <p className="text-xs text-gray-500 px-4 py-3">No saved views yet.</p>
              )}
              {views.length > 0 && (
                <ul className="py-1">
                  {views.map((v) => {
                    const isActive = v.id === activeViewId;
                    return (
                      <li key={v.id} className="group">
                        <div className={`flex items-center justify-between gap-2 px-3 py-2 ${isActive ? 'bg-zinc-50' : 'hover:bg-gray-50'}`}>
                          <button
                            onClick={() => { onApply(v); setOpen(false); }}
                            className="flex-1 text-left min-w-0"
                          >
                            <div className="flex items-center gap-1.5">
                              <span className={`text-sm font-medium truncate ${isActive ? 'text-[var(--vv-text)]' : 'text-gray-800'}`}>{v.name}</span>
                              {v.is_default && (
                                <span className="shrink-0 text-[9px] font-bold uppercase tracking-wider text-amber-700 bg-amber-100 px-1 py-0.5 rounded">default</span>
                              )}
                            </div>
                            <p className="text-[10px] text-gray-400 mt-0.5">
                              {Object.keys(v.filters_json || {}).filter((k) => v.filters_json[k] !== '' && v.filters_json[k] !== null).length} filter(s)
                            </p>
                          </button>
                          <div className="flex items-center gap-0.5 opacity-60 group-hover:opacity-100">
                            <button
                              onClick={(e) => { e.stopPropagation(); updateToCurrent(v); }}
                              title="Update this view to current filters"
                              className="p-1 text-gray-400 hover:text-[var(--vv-text)]"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); v.is_default ? clearDefault(v) : setDefault(v); }}
                              title={v.is_default ? 'Remove default' : 'Set as default'}
                              className={`p-1 ${v.is_default ? 'text-amber-500 hover:text-amber-700' : 'text-gray-400 hover:text-amber-600'}`}
                            >
                              <svg className="w-3.5 h-3.5" fill={v.is_default ? 'currentColor' : 'none'} stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.196-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.783-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" /></svg>
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); remove(v); }}
                              title="Delete"
                              className="p-1 text-gray-400 hover:text-red-600"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                            </button>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}

              <div className="border-t border-gray-100 p-2">
                {!saveMode ? (
                  <button
                    onClick={() => setSaveMode(true)}
                    className="w-full text-left text-sm font-medium text-[var(--vv-text)] hover:underline px-2 py-1.5"
                  >
                    + Save current view…
                  </button>
                ) : (
                  <div className="px-2 py-1.5 space-y-2">
                    <input
                      type="text"
                      value={saveName}
                      onChange={(e) => setSaveName(e.target.value)}
                      placeholder="View name"
                      maxLength={128}
                      className="w-full bg-gray-50 border border-gray-200 rounded-md px-2 py-1.5 text-sm focus:ring-2 focus:ring-[var(--vv-bg-dark)] focus:border-transparent outline-none"
                      autoFocus
                    />
                    <label className="flex items-center gap-2 text-xs text-gray-700">
                      <input type="checkbox" checked={saveDefault} onChange={(e) => setSaveDefault(e.target.checked)} className="rounded" />
                      Set as default
                    </label>
                    <div className="flex justify-end gap-2">
                      <button onClick={() => { setSaveMode(false); setSaveName(''); setSaveDefault(false); }} className="text-xs text-gray-500 hover:text-gray-800 px-2 py-1">Cancel</button>
                      <button onClick={createView} disabled={!saveName.trim() || saving} className="px-3 py-1 text-xs font-medium bg-[var(--vv-bg-dark)] text-white rounded-md hover:bg-black disabled:opacity-40">
                        {saving ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {error && <p className="text-xs text-red-600 px-4 pb-3">{error}</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

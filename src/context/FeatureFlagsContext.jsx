import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import api from '../api';
import { useAuth } from './AuthContext';

/**
 * Admin-toggleable feature flags. Hydrated once when a user signs in,
 * exposed to the whole app via context. Components that gate behavior
 * (RingingCallToast, transporter SMS, etc.) read from useFeatureFlag()
 * instead of hard-coded constants.
 *
 * Refresh-after-toggle: when the admin flips a flag in Company
 * Settings, that page calls `reload()` from this context so the
 * change shows up immediately across the rest of the running app
 * without a full reload.
 */

const FeatureFlagsContext = createContext({
  flags:    {},        // { KEY: boolean }
  rows:     [],        // [{ key, enabled, label, description, updated_at }]
  loading:  false,
  reload:   () => {},
});

export function FeatureFlagsProvider({ children }) {
  const { user } = useAuth();
  const [flags, setFlags]     = useState({});
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const res = await api.get('/feature_flags');
      const list = res.data?.flags || [];
      const map = {};
      for (const f of list) map[f.key] = !!f.enabled;
      setRows(list);
      setFlags(map);
    } catch {
      // Best-effort: keep whatever flags we already have so a transient
      // 503 doesn't blow away the live state and disable features.
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { reload(); }, [reload]);

  // The Company Settings flag-toggle UI fires this so any page
  // currently subscribed to a flag (e.g., RingingCallToast) picks up
  // the new value without a refresh.
  useEffect(() => {
    const onChanged = () => reload();
    window.addEventListener('vv:feature-flags-changed', onChanged);
    return () => window.removeEventListener('vv:feature-flags-changed', onChanged);
  }, [reload]);

  return (
    <FeatureFlagsContext.Provider value={{ flags, rows, loading, reload }}>
      {children}
    </FeatureFlagsContext.Provider>
  );
}

/** Returns the boolean state of a single flag. Defaults to `false`
 *  when the flag hasn't loaded yet so features stay opt-in. */
export function useFeatureFlag(key) {
  const { flags } = useContext(FeatureFlagsContext);
  return !!flags[key];
}

/** Full registry — for the admin UI that lists every known flag
 *  with its label, description, and last-modified timestamp. */
export function useFeatureFlags() {
  return useContext(FeatureFlagsContext);
}

import { useState, useEffect } from 'react';
import api, { extractApiError } from '../api';
import { useAuth } from '../context/AuthContext';
import { SectionHeader, Button } from '../components/ui';

export default function CompanySettingsPage() {
  const { user } = useAuth();
  const isAdmin  = user?.role === 'admin';
  const [data, setData]       = useState(null);
  const [draft, setDraft]     = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState('');
  const [saved, setSaved]     = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.get('/company_settings')
      .then((res) => {
        if (cancelled) return;
        setData(res.data);
        setDraft({
          company_name:    res.data.company_name    ?? '',
          company_address: res.data.company_address ?? '',
          company_phone:   res.data.company_phone   ?? '',
          company_email:   res.data.company_email   ?? '',
          default_state:   res.data.default_state   ?? '',
          default_county:  res.data.default_county  ?? '',
        });
      })
      .catch((err) => { if (!cancelled) setError(extractApiError(err, 'Failed to load settings')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const save = async () => {
    setSaving(true); setError(''); setSaved(false);
    try {
      await api.put('/company_settings', draft);
      setData({ ...data, ...draft });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(extractApiError(err, 'Failed to save'));
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none disabled:bg-gray-100 disabled:text-gray-500';
  const labelCls = 'block text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-1';

  if (loading) return <div className="p-6 text-sm text-gray-500">Loading…</div>;

  return (
    <div className="p-6 space-y-4 max-w-3xl">
      <SectionHeader
        title="Company settings"
        subtitle="Used as the Seller on every Bill of Sale and as defaults for new dispatch jobs."
      />

      {!isAdmin && (
        <div className="bg-amber-50 border border-amber-100 text-amber-800 rounded-xl px-3 py-2 text-sm">
          Only admins can edit these settings. The fields below are read-only for you.
        </div>
      )}
      {error && <div className="bg-red-50 border border-red-100 text-red-700 rounded-xl p-3 text-sm">{error}</div>}
      {saved && <div className="bg-emerald-50 border border-emerald-100 text-emerald-800 rounded-xl p-3 text-sm">Settings saved.</div>}

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="block">
            <span className={labelCls}>Company name (used as Seller)</span>
            <input className={inputCls} disabled={!isAdmin} value={draft.company_name} onChange={(e) => setDraft({ ...draft, company_name: e.target.value })} />
          </label>
          <label className="block">
            <span className={labelCls}>Company phone</span>
            <input className={inputCls} disabled={!isAdmin} value={draft.company_phone} onChange={(e) => setDraft({ ...draft, company_phone: e.target.value })} />
          </label>
          <label className="block sm:col-span-2">
            <span className={labelCls}>Company mailing address</span>
            <textarea rows={2} className={inputCls} disabled={!isAdmin} value={draft.company_address} onChange={(e) => setDraft({ ...draft, company_address: e.target.value })} />
          </label>
          <label className="block">
            <span className={labelCls}>Company email</span>
            <input className={inputCls} disabled={!isAdmin} value={draft.company_email} onChange={(e) => setDraft({ ...draft, company_email: e.target.value })} />
          </label>
        </div>

        <div className="border-t border-gray-100 pt-4">
          <p className="text-xs text-gray-500 mb-2">Defaults for the Bill of Sale form (per-sale fields can still be overridden):</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block">
              <span className={labelCls}>Default state</span>
              <input className={inputCls} disabled={!isAdmin} value={draft.default_state} onChange={(e) => setDraft({ ...draft, default_state: e.target.value })} placeholder="e.g. Texas" />
            </label>
            <label className="block">
              <span className={labelCls}>Default county</span>
              <input className={inputCls} disabled={!isAdmin} value={draft.default_county} onChange={(e) => setDraft({ ...draft, default_county: e.target.value })} />
            </label>
          </div>
        </div>

        {isAdmin && (
          <div className="flex justify-end">
            <Button variant="primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</Button>
          </div>
        )}
      </div>
    </div>
  );
}

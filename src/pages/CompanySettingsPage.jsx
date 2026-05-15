import { useState, useEffect, useCallback } from 'react';
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

      {isAdmin && <OutboundIntegrationsSection />}
    </div>
  );
}

// -----------------------------------------------------------------------------
// Outbound integrations — credential management for Gmail SMTP + OpenPhone.
// Values are stored in the app_secrets DB table; getEnvValue() reads them
// via the same lookup that handles .env / process-env. Admins can rotate
// keys here without touching the server.
// -----------------------------------------------------------------------------

const INTEGRATION_GROUPS = [
  {
    title: 'Email — Gmail SMTP',
    description: (
      <>
        Sends per-lead emails through a Gmail / Google Workspace inbox.
        Requires a <a className="text-blue-600 hover:underline" href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer">Google App Password</a> on
        an account with 2FA enabled.
      </>
    ),
    fields: [
      { key: 'GMAIL_SMTP_USER', label: 'Sender email',  placeholder: 'crm@vinvault.us' },
      { key: 'GMAIL_SMTP_PASS', label: 'App password',  placeholder: '16-char password',  password: true },
      { key: 'GMAIL_FROM_NAME', label: 'Display name',  placeholder: 'Vin Vault',         optional: true },
    ],
  },
  {
    title: 'SMS — OpenPhone',
    description: (
      <>
        Sends per-lead texts and receives inbound replies via OpenPhone.
        Generate keys in the <a className="text-blue-600 hover:underline" href="https://my.openphone.com" target="_blank" rel="noreferrer">OpenPhone web app</a> → Settings.
      </>
    ),
    fields: [
      { key: 'OPENPHONE_API_KEY',         label: 'API key',                   placeholder: 'ophonek_…',                                password: true },
      { key: 'OPENPHONE_PHONE_NUMBER_ID', label: 'Phone-number ID',           placeholder: 'PNxxxxxxxxxx' },
      { key: 'OPENPHONE_WEBHOOK_SECRET',  label: 'Webhook signing secret',    placeholder: 'base64 string from webhook setup',         password: true },
    ],
  },
];

function OutboundIntegrationsSection() {
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  const load = useCallback(() => {
    setLoading(true); setError('');
    api.get('/app_secrets')
      .then((res) => setRows(res.data || []))
      .catch((err) => setError(extractApiError(err, 'Failed to load integration settings')))
      .finally(() => setLoading(false));
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const rowByKey = Object.fromEntries(rows.map((r) => [r.key, r]));

  if (loading) return <div className="text-sm text-gray-500">Loading integrations…</div>;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-gray-900">Outbound integrations</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Credentials for email + SMS sending. Stored encrypted-at-rest in the database.
          Changes take effect on the next send — no deploy required.
        </p>
      </div>

      {error && <div className="bg-red-50 border border-red-100 text-red-700 rounded-xl p-3 text-sm">{error}</div>}

      {INTEGRATION_GROUPS.map((g) => (
        <div key={g.title} className="border-t border-gray-100 pt-4 first:border-0 first:pt-0">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">{g.title}</h3>
              <p className="text-xs text-gray-500 mt-0.5">{g.description}</p>
            </div>
            <ProviderStatusBadge fields={g.fields} rowByKey={rowByKey} />
          </div>

          <div className="space-y-2">
            {g.fields.map((f) => (
              <SecretRow key={f.key} field={f} row={rowByKey[f.key]} onChanged={load} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ProviderStatusBadge({ fields, rowByKey }) {
  // "Configured" = every non-optional field has a value set.
  const required = fields.filter((f) => !f.optional);
  const allSet   = required.every((f) => rowByKey[f.key]?.is_set);
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-semibold shrink-0"
      style={{
        backgroundColor: allSet ? '#d1fae5' : '#f4f4f5',
        color:           allSet ? '#047857' : '#71717a',
      }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={{ background: allSet ? '#10b981' : '#a1a1aa' }}
      />
      {allSet ? 'Configured' : 'Not configured'}
    </span>
  );
}

function SecretRow({ field, row, onChanged }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue]     = useState('');
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState('');

  const isSet  = !!row?.is_set;
  const masked = row?.masked ?? '';

  const startEdit = () => { setEditing(true); setValue(''); setError(''); };
  const cancel    = () => { setEditing(false); setValue(''); setError(''); };

  const save = async () => {
    setSaving(true); setError('');
    try {
      await api.put('/app_secrets', { key: field.key, value });
      onChanged?.();
      setEditing(false);
      setValue('');
    } catch (err) {
      setError(extractApiError(err, 'Failed to save'));
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    if (!window.confirm(`Clear ${field.label}? This will disable sends that depend on it.`)) return;
    setSaving(true); setError('');
    try {
      await api.put('/app_secrets', { key: field.key, value: '' });
      onChanged?.();
    } catch (err) {
      setError(extractApiError(err, 'Failed to clear'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-[12px] font-medium text-gray-700">{field.label}</span>
          {field.optional && <span className="text-[10px] text-gray-400">optional</span>}
        </div>
        {!editing && (
          <p className="text-[11px] mt-0.5 font-mono text-gray-500 truncate">
            {isSet ? masked : <span className="text-gray-300 not-italic">Not set</span>}
          </p>
        )}
      </div>

      {editing ? (
        <div className="flex items-center gap-2 shrink-0">
          <input
            type={field.password ? 'password' : 'text'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={field.placeholder}
            className="bg-gray-50 border border-gray-200 rounded-md px-2 py-1.5 text-[12px] focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none w-64"
            autoFocus
          />
          <button onClick={cancel} className="text-[11px] text-gray-500 hover:text-gray-800 px-2 py-1">Cancel</button>
          <button
            onClick={save}
            disabled={saving || value === ''}
            className="px-3 py-1.5 text-[11px] font-semibold rounded-md text-white bg-gray-900 hover:bg-gray-800 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={startEdit}
            className="px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-100 rounded"
          >
            {isSet ? 'Replace' : 'Set'}
          </button>
          {isSet && (
            <button
              onClick={clear}
              className="px-2 py-1 text-[11px] font-medium text-red-600 hover:bg-red-50 rounded"
            >
              Clear
            </button>
          )}
        </div>
      )}
      {error && <p className="text-[11px] text-red-600">{error}</p>}
    </div>
  );
}

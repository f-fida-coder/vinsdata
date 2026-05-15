import { useState, useEffect, useCallback } from 'react';
import api, { extractApiError } from '../api';

/**
 * In-drawer Email + Text composer.
 *
 * Drives /api/lead_send for the actual transmit — the dispatcher there
 * auto-picks gmail / openphone / stub based on what's in .env, so this
 * UI doesn't need to know about providers. Just pick a tab, type, hit
 * send. The send history below the composer pulls from the same
 * endpoint (GET ?lead_id=X) so operators can audit what's been sent.
 */
export default function LeadOutreachSection({ leadId, normalizedPayload, onChanged, focusKind, onFocusConsumed }) {
  const np = normalizedPayload || {};
  const phones = ['phone_primary', 'phone_secondary', 'phone_3', 'phone_4']
    .map((k) => np[k]).filter(Boolean);
  const email = np.email_primary || '';
  const ymm = [np.year, np.make, np.model].filter(Boolean).join(' ');
  const vin = np.vin || '';
  const greeting = np.first_name ? `Hi ${np.first_name},` : 'Hello,';

  const defaultSubject = ymm
    ? `Quick question about your ${ymm}`
    : 'Quick question about your vehicle';

  const defaultEmailBody = ymm
    ? `${greeting}\n\nI'm reaching out about your ${ymm}${vin ? ` (VIN ${vin})` : ''}. We're actively buying vehicles like yours and would love to make you an offer.\n\nIs there a good time to chat?`
    : `${greeting}\n\nReaching out from Vin Vault. We're actively buying vehicles in your area and would love to chat.`;

  const defaultSmsBody = ymm
    ? `${greeting} reaching out from Vin Vault about your ${ymm}. We'd love to make you an offer — got a minute to chat?`
    : `${greeting} reaching out from Vin Vault. We'd love to chat about your vehicle.`;

  const [tab, setTab] = useState(email ? 'email' : phones.length > 0 ? 'sms' : 'email');
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);

  const loadHistory = useCallback(() => {
    setHistoryLoading(true);
    api.get('/lead_send', { params: { lead_id: leadId } })
      .then((res) => setHistory(res.data?.jobs || []))
      .catch(() => setHistory([]))
      .finally(() => setHistoryLoading(false));
  }, [leadId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadHistory(); }, [loadHistory]);

  useEffect(() => {
    if (focusKind === 'email' || focusKind === 'sms') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTab(focusKind);
      onFocusConsumed?.();
    }
  }, [focusKind, onFocusConsumed]);

  const onSent = () => { loadHistory(); onChanged?.(); };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1 text-[12px] border-b border-gray-200">
        <OutreachTab active={tab === 'email'} onClick={() => setTab('email')} disabled={!email}>
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
          Email
        </OutreachTab>
        <OutreachTab active={tab === 'sms'} onClick={() => setTab('sms')} disabled={phones.length === 0}>
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
          Text
        </OutreachTab>
        <span className="ml-auto text-[10px] text-gray-400">
          {tab === 'email' ? 'via Gmail' : 'via OpenPhone'}
        </span>
      </div>

      {tab === 'email' && (
        email
          ? <Composer kind="email" leadId={leadId} initialTo={email} initialSubject={defaultSubject} initialBody={defaultEmailBody} onSent={onSent} />
          : <p className="text-xs text-gray-400 italic py-2">No email on file for this lead.</p>
      )}

      {tab === 'sms' && (
        phones.length > 0
          ? <Composer kind="sms" leadId={leadId} initialTo={phones[0]} phones={phones} initialBody={defaultSmsBody} onSent={onSent} />
          : <p className="text-xs text-gray-400 italic py-2">No phone on file for this lead.</p>
      )}

      <OutreachHistoryList items={history} loading={historyLoading} />
    </div>
  );
}

function OutreachTab({ active, onClick, disabled, children }) {
  const base = 'inline-flex items-center gap-1.5 px-3 py-2 font-medium border-b-2 transition-colors';
  if (disabled) {
    return (
      <span className={`${base} opacity-40 cursor-not-allowed`} style={{ borderColor: 'transparent', color: '#9ca3af' }}>
        {children}
      </span>
    );
  }
  return (
    <button
      onClick={onClick}
      className={base}
      style={{
        borderColor: active ? '#111827' : 'transparent',
        color: active ? '#111827' : '#6b7280',
        marginBottom: '-1px',
        background: 'transparent',
      }}
    >
      {children}
    </button>
  );
}

function Composer({ kind, leadId, initialTo, initialSubject, initialBody, phones, onSent }) {
  const [to, setTo] = useState(initialTo || '');
  const [subject, setSubject] = useState(initialSubject || '');
  const [body, setBody] = useState(initialBody || '');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);

  // Reset composer fields when the parent swaps leads or tabs.
  useEffect(() => { setTo(initialTo || ''); }, [initialTo]);
  useEffect(() => {
    if (initialSubject !== undefined) setSubject(initialSubject);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId, kind]);
  useEffect(() => {
    if (initialBody !== undefined) setBody(initialBody);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId, kind]);

  const inputCls = 'w-full bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-2 text-[13px] focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none';

  const send = async () => {
    setSending(true); setResult(null);
    try {
      const payload = { kind, lead_id: leadId, to, body };
      if (kind === 'email') payload.subject = subject;
      const res = await api.post('/lead_send', payload);
      const ok = res.data?.result?.ok ?? res.data?.success;
      if (ok) {
        const provider = res.data?.job?.provider || 'unknown';
        const stubbed = provider === 'stub';
        setResult({
          ok: true,
          message: stubbed
            ? 'Logged (stub mode — provider not configured on this server).'
            : kind === 'email' ? 'Email sent.' : 'Text sent.',
        });
        setBody('');
        onSent?.();
      } else {
        const reason = res.data?.result?.fail_reason
                    ?? res.data?.result?.reason
                    ?? 'Send failed.';
        setResult({ ok: false, message: String(reason) });
      }
    } catch (err) {
      setResult({ ok: false, message: extractApiError(err, 'Send failed.') });
    } finally {
      setSending(false);
    }
  };

  const smsLength = body.length;
  const smsParts = smsLength === 0 ? 0 : Math.ceil(smsLength / 160);
  const canSend = !sending && to.trim() !== '' && body.trim() !== '' && (kind !== 'email' || subject.trim() !== '');

  return (
    <div className="space-y-2 pt-2">
      <div>
        <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">To</label>
        {kind === 'sms' && phones && phones.length > 1 ? (
          <select value={to} onChange={(e) => setTo(e.target.value)} className={inputCls}>
            {phones.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        ) : (
          <input
            type={kind === 'email' ? 'email' : 'tel'}
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className={inputCls}
            placeholder={kind === 'email' ? 'name@domain.com' : '+1 555 123 4567'}
          />
        )}
      </div>

      {kind === 'email' && (
        <div>
          <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Subject</label>
          <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} className={inputCls} />
        </div>
      )}

      <div>
        <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Message</label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={kind === 'sms' ? 4 : 8}
          className={inputCls}
          style={{ resize: 'vertical', fontFamily: 'inherit' }}
          placeholder={kind === 'email' ? 'Write your email…' : 'Write your text message…'}
        />
        {kind === 'sms' && (
          <p className="text-[10px] text-gray-400 mt-1">
            {smsLength} chars{smsParts > 1 ? ` · ${smsParts} segments` : ''}
          </p>
        )}
        {kind === 'email' && (
          <p className="text-[10px] text-gray-400 mt-1">Branded signature is appended automatically.</p>
        )}
      </div>

      {result && (
        <div
          className={`text-[12px] px-3 py-2 rounded-md ${
            result.ok ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-red-50 text-red-700 border border-red-100'
          }`}
        >
          {result.message}
        </div>
      )}

      <div className="flex justify-end pt-1">
        <button
          disabled={!canSend}
          onClick={send}
          className="px-4 py-2 text-[12px] font-semibold rounded-md text-white disabled:opacity-50 transition-colors bg-gray-900 hover:bg-gray-800"
        >
          {sending ? 'Sending…' : `Send ${kind === 'email' ? 'email' : 'text'}`}
        </button>
      </div>
    </div>
  );
}

function OutreachHistoryList({ items, loading }) {
  if (loading && items.length === 0) {
    return <p className="text-[11px] text-gray-400 italic mt-3">Loading send history…</p>;
  }
  if (items.length === 0) {
    return <p className="text-[11px] text-gray-400 italic mt-3">No sends yet.</p>;
  }
  return (
    <div className="mt-3 space-y-1.5">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">Recent sends</p>
      <ul className="space-y-1">
        {items.slice(0, 10).map((j) => (
          <li
            key={j.id}
            className="flex items-center justify-between text-[12px] py-1.5 px-2 rounded border border-gray-100 bg-gray-50"
          >
            <span className="flex items-center gap-2 min-w-0">
              <OutreachKindBadge kind={j.kind} />
              <span className="truncate text-gray-900">
                {j.kind === 'email' ? (j.subject || j.to_address) : j.to_address}
              </span>
            </span>
            <span className="flex items-center gap-2 shrink-0 ml-2">
              <OutreachStatusPill status={j.status} />
              <span className="text-[10px] text-gray-400">
                {(() => {
                  const s = j.sent_at || j.created_at;
                  if (!s) return '—';
                  const d = new Date(String(s).replace(' ', 'T'));
                  return Number.isNaN(d.getTime()) ? s : d.toLocaleString();
                })()}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function OutreachKindBadge({ kind }) {
  const isEmail = kind === 'email';
  return (
    <span
      className="inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold"
      style={{
        backgroundColor: isEmail ? '#dbeafe' : '#fae8ff',
        color: isEmail ? '#1e40af' : '#a21caf',
      }}
      title={isEmail ? 'Email' : 'Text'}
    >
      {isEmail ? '@' : '#'}
    </span>
  );
}

function OutreachStatusPill({ status }) {
  const META = {
    pending: { label: 'pending', bg: '#fef3c7', text: '#a16207' },
    sending: { label: 'sending', bg: '#dbeafe', text: '#1d4ed8' },
    sent:    { label: 'sent',    bg: '#d1fae5', text: '#047857' },
    failed:  { label: 'failed',  bg: '#fee2e2', text: '#b91c1c' },
    bounced: { label: 'bounced', bg: '#fee2e2', text: '#b91c1c' },
  };
  const m = META[status] || { label: status, bg: '#f4f4f5', text: '#52525b' };
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold"
      style={{ backgroundColor: m.bg, color: m.text }}
    >
      {m.label}
    </span>
  );
}

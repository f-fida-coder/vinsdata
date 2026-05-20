import { useState, useEffect, useCallback } from 'react';
import api, { extractApiError } from '../api';
import { useAuth } from '../context/AuthContext';

// VinVault's shared callback number — same line that's printed on the
// signed Bills of Sale + the auto-text in the outreach signoff. Living
// here as a constant so we have one place to swap it if it moves.
const VINVAULT_CALLBACK_PHONE = '469-971-2609';

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
  const { user } = useAuth();
  const np = normalizedPayload || {};
  const phones = ['phone_primary', 'phone_secondary', 'phone_3', 'phone_4']
    .map((k) => np[k]).filter(Boolean);
  // Two email slots on the lead: email_primary ("Email 1") and the
  // CarFax-side "Email 2" (stored as either "Email 2" with space or
  // "Email2" depending on the source spreadsheet). Operator picks
  // which one to send to via the composer dropdown when both exist.
  const emails = [
    np.email_primary,
    np['Email 2'] || np.Email2,
  ].filter(Boolean);
  const email = emails[0] || '';
  const ymm = [np.year, np.make, np.model].filter(Boolean).join(' ');
  // Agent name comes from the signed-in user. Falls back to "Vin Vault"
  // so the templates still read sensibly if user context is missing.
  const agentName = (user?.name || '').trim() || 'Vin Vault';
  const firstName = (np.first_name || '').trim();
  const greetingName = firstName || 'there';

  // Subject + body templates match the dream-car cold-outreach script the
  // team is running. Year/make/model + first name interpolate so the
  // operator can fire it as-is or tweak before sending.
  const defaultSubject = ymm
    ? `Hey ${greetingName} — call me about your ${ymm}`
    : `Hey ${greetingName} — call me about your vehicle`;

  const ymmPhrase = ymm || 'vehicle';
  const defaultEmailBody =
    `Hi ${greetingName}, my name is ${agentName}\n`
    + `\n`
    + `I tried texting/calling you earlier today…\n`
    + `\n`
    + `I'm in search of a ${ymmPhrase} (my dream car).\n`
    + `\n`
    + `It may be a long shot, but I'm reaching out to see if you still have yours by chance?\n`
    + `\n`
    + `Please text, call, or email me back when you have time.\n`
    + `\n`
    + `- ${agentName}\n`
    + `${VINVAULT_CALLBACK_PHONE}`;

  // SMS — the voicemail follow-up script the team is running. Keeps
  // the same dream-car pitch but explicitly references the voicemail
  // that was just left, which converts better than a cold text.
  const defaultSmsBody =
    `Hi ${greetingName}, I just left you a voicemail about your ${ymmPhrase}. `
    + `Not sure if you still have yours, but, I'm a cash buyer and I'm looking to add one to my personal collection. `
    + `Call or txt me back when you can please.\n`
    + `- ${agentName}`;

  // Call tab is the default when there's a phone on file — calling is
  // the highest-converting touch for cold acquisitions and we want it
  // one click in.
  const [tab, setTab] = useState(phones.length > 0 ? 'call' : email ? 'email' : 'sms');
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
        <OutreachTab active={tab === 'call'} onClick={() => setTab('call')} disabled={phones.length === 0}>
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 5a2 2 0 012-2h2.28a2 2 0 011.94 1.515l.66 2.64a2 2 0 01-.45 1.949L7.91 11.09a16 16 0 005 5l1.986-1.52a2 2 0 011.95-.45l2.64.66A2 2 0 0121 16.72V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/></svg>
          Call
        </OutreachTab>
        <OutreachTab active={tab === 'email'} onClick={() => setTab('email')} disabled={!email}>
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
          Email
        </OutreachTab>
        <OutreachTab active={tab === 'sms'} onClick={() => setTab('sms')} disabled={phones.length === 0}>
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" /></svg>
          Text
        </OutreachTab>
        <span className="ml-auto text-[10px] text-gray-400">
          {tab === 'email' ? 'via Gmail' : tab === 'sms' ? 'via OpenPhone' : 'via OpenPhone'}
        </span>
      </div>

      {tab === 'call' && (
        phones.length > 0
          ? <CallPanel leadId={leadId} phones={phones} agentName={agentName} onLogged={onSent} />
          : <p className="text-xs text-gray-400 italic py-2">No phone on file for this lead.</p>
      )}

      {tab === 'email' && (
        email
          ? <Composer kind="email" leadId={leadId} initialTo={email} emails={emails} initialSubject={defaultSubject} initialBody={defaultEmailBody} onSent={onSent} />
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

/**
 * Call panel — pick a phone number, hit "Call". Primary path opens
 * OpenPhone desktop via the `openphone://call/<phone>` deep link so
 * the agent's softphone takes over (rings the agent's connected
 * device, then bridges to the lead's number). A fallback "Use
 * system dialer" link sits underneath for cases where OpenPhone
 * desktop isn't installed — that one is the original tel:.
 *
 * Right after launching the call we offer to log the outcome in the
 * Contact log (attempted / vm / connected). Cancels out cleanly if
 * the agent backs out.
 */
function CallPanel({ leadId, phones, agentName, onLogged }) {
  const [to, setTo] = useState(phones[0] || '');
  const [showLog, setShowLog] = useState(false);
  const [outcome, setOutcome] = useState('voicemail');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState(null);

  // E.164-ish form for the URL — strip everything that isn't digits
  // or a leading +. OpenPhone's deep link works best with the +
  // prefix in front of the country code.
  const toE164 = (raw) => {
    const cleaned = String(raw || '').replace(/[^0-9+]/g, '');
    if (cleaned === '') return '';
    if (cleaned.startsWith('+')) return cleaned;
    // 10-digit US numbers → prepend +1 so OpenPhone routes correctly.
    if (cleaned.length === 10) return '+1' + cleaned;
    if (cleaned.length === 11 && cleaned.startsWith('1')) return '+' + cleaned;
    return '+' + cleaned;
  };

  // Reliable OpenPhone hand-off: open my.openphone.com in a new tab
  // *and* drop the E.164 number on the clipboard so the agent can
  // paste it into the OpenPhone dialer with one keystroke. Works
  // regardless of whether OP desktop is installed, whether the
  // openphone:// protocol is registered, or whether the OpenPhone
  // Chrome extension is in play. The browser tab keeps OpenPhone
  // authenticated across calls, so subsequent clicks just focus
  // the existing tab.
  const dialOpenPhone = async () => {
    if (!to) return;
    const e164 = toE164(to);
    try {
      // Async clipboard API is the supported path on modern Chrome /
      // Edge / Safari. Failures are silent — the new-tab still opens.
      await navigator.clipboard.writeText(e164);
    } catch { /* clipboard denied; the URL still opens */ }
    // Open in a new tab with a stable target name so repeat clicks
    // reuse the same OpenPhone tab instead of stacking new ones.
    window.open('https://my.openphone.com/', 'vv-openphone');
    setShowLog(true);
  };

  // Fallback: hand off to the OS-level tel: handler. If the agent
  // has OpenPhone desktop installed AND set as default tel: handler
  // — or has the OpenPhone Chrome extension installed — this opens
  // OpenPhone directly. Otherwise it goes to the OS dialer.
  const dialSystem = () => {
    if (!to) return;
    const digits = String(to).replace(/[^0-9+]/g, '');
    window.location.href = `tel:${digits}`;
    setShowLog(true);
  };

  const logCall = async () => {
    setSaving(true); setResult(null);
    try {
      await api.post('/lead_contact_logs', {
        lead_id: leadId,
        channel: 'phone',
        outcome,
        notes: notes.trim() || null,
      });
      setResult({ ok: true, message: 'Call logged in contact history.' });
      setShowLog(false);
      setNotes('');
      onLogged?.();
    } catch (err) {
      setResult({ ok: false, message: extractApiError(err, 'Failed to log call.') });
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'w-full bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-2 text-[13px] focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none';

  return (
    <div className="space-y-3 pt-2">
      <div>
        <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Number</label>
        {phones.length > 1 ? (
          <select value={to} onChange={(e) => setTo(e.target.value)} className={inputCls}>
            {phones.map((p, i) => <option key={p} value={p}>Phone {i + 1} · {p}</option>)}
          </select>
        ) : (
          <input
            type="tel"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className={inputCls}
            placeholder="+1 555 123 4567"
          />
        )}
      </div>

      <button
        onClick={dialOpenPhone}
        disabled={!to}
        className="w-full px-4 py-2.5 text-[13px] font-semibold rounded-md text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 transition-colors"
      >
        Call {to} via OpenPhone
      </button>
      <p className="text-[10px] text-gray-400 text-center leading-relaxed">
        Opens OpenPhone in a new tab and copies <span className="font-mono">{toE164(to)}</span> to your clipboard — paste into the dialer and press Enter.
        <br />
        Or{' '}
        <button
          type="button"
          onClick={dialSystem}
          disabled={!to}
          className="underline hover:text-gray-600 disabled:opacity-50"
        >
          use the system dialer
        </button>
        {' '}(routes to OpenPhone if the Chrome extension or desktop app is installed).
      </p>

      {showLog && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-3 space-y-2">
          <p className="text-[12px] font-medium text-emerald-900">
            Just made the call? Log how it went so {agentName || 'the team'} doesn't redial cold.
          </p>
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Outcome</label>
            <select value={outcome} onChange={(e) => setOutcome(e.target.value)} className={inputCls}>
              <option value="attempted">No answer</option>
              <option value="voicemail">Left voicemail</option>
              <option value="connected">Connected — spoke with lead</option>
              <option value="wrong_number">Wrong number</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1">Notes (optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className={inputCls}
              placeholder="What did they say? Best time to call back?"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={() => { setShowLog(false); setNotes(''); }}
              className="px-3 py-1.5 text-[11px] text-gray-600 hover:text-gray-900"
            >
              Skip
            </button>
            <button
              onClick={logCall}
              disabled={saving}
              className="px-3 py-1.5 text-[11px] font-semibold rounded-md text-white bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50"
            >
              {saving ? 'Logging…' : 'Log call'}
            </button>
          </div>
        </div>
      )}

      {result && (
        <div
          className={`text-[12px] px-3 py-2 rounded-md ${
            result.ok ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-red-50 text-red-700 border border-red-100'
          }`}
        >
          {result.message}
        </div>
      )}
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

function Composer({ kind, leadId, initialTo, initialSubject, initialBody, phones, emails, onSent }) {
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
        ) : kind === 'email' && emails && emails.length > 1 ? (
          // Email 1 / Email 2 picker. Operator selects which address to
          // send to; the first one is selected by default to match the
          // legacy single-address behavior.
          <select value={to} onChange={(e) => setTo(e.target.value)} className={inputCls}>
            {emails.map((e, i) => (
              <option key={e} value={e}>Email {i + 1} · {e}</option>
            ))}
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

import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';

/**
 * Floating "incoming call" surface.
 *
 * Polls /api/inbound_calls every 5 seconds for any ringing event
 * recorded by the OpenPhone webhook in the last 60s. When one appears,
 * slides a card up from the bottom-right with the caller's name (or
 * just the phone number if we couldn't match it) and the vehicle on
 * file. "Open lead" jumps the agent into the lead drawer; "Dismiss"
 * acks the call so it doesn't re-fire.
 *
 * Auto-poll cadence dials up to every 2s while there's an active
 * ringing card on screen — call windows are short, every second of
 * extra latency is a missed pickup.
 *
 * Renders nothing if there are no active rings. Mounted once at the
 * DashboardLayout level so every page surfaces it consistently.
 */
// Polling is gated behind the OpenPhone carrier-acceptance handshake.
// Until that's approved by the carrier, the webhook can't deliver
// call.* events, so polling the lookup endpoint is pure DB-connection
// waste (the same Hostinger 500/hour cap we've been hitting all week).
//
// To re-enable when carrier approval lands, set the flag to true.
// The frontend will pick up the change on the next deploy without
// any other code path needing to know.
const RINGING_CALLS_ENABLED = false;

// Cadence used when the feature flag is on. 30s idle keeps the cap
// gentle while still surfacing a ring inside the typical 4–6 ring
// rotation. 3s active poll once a card is on screen so status
// transitions feel snappy.
const POLL_IDLE_MS   = 30000;
const POLL_ACTIVE_MS = 3000;

export default function RingingCallToast() {
  const [calls, setCalls] = useState([]);
  const navigate = useNavigate();
  // Keep a ref so we can decide poll cadence without re-creating the
  // useEffect when calls change.
  const activeRef = useRef(0);

  const fetchCalls = useCallback(async () => {
    try {
      const res = await api.get('/inbound_calls');
      const next = res.data?.calls || [];
      setCalls(next);
      activeRef.current = next.length;
    } catch {
      // Silent — polling is best-effort. Don't make the UI noisy
      // if the endpoint is temporarily down.
    }
  }, []);

  useEffect(() => {
    // Bail when the feature flag is off — no fetch, no timer, no
    // re-renders. The component still mounts (so flipping the flag
    // back on doesn't require a layout change), it just never polls.
    if (!RINGING_CALLS_ENABLED) return;

    // Adaptive cadence: poll fast while a call is on-screen, slow
    // when idle. Chained setTimeout that re-evaluates per tick.
    let cancelled = false;
    let timer = null;
    const tick = () => {
      if (cancelled) return;
      fetchCalls().finally(() => {
        if (cancelled) return;
        const delay = activeRef.current > 0 ? POLL_ACTIVE_MS : POLL_IDLE_MS;
        timer = setTimeout(tick, delay);
      });
    };
    // Fire-and-forget first poll, then schedule the loop.
    tick();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [fetchCalls]);

  const ack = async (id) => {
    setCalls((prev) => prev.filter((c) => c.id !== id));
    try { await api.post('/inbound_calls', { id, action: 'ack' }); }
    catch { /* best effort */ }
  };

  const openLead = (call) => {
    ack(call.id);
    if (call.matched_lead_id) {
      // Navigating to /leads with the right filters surfaces the
      // matching lead. Add a ?open=ID query so LeadsPage can auto-open
      // the drawer if it supports it (otherwise the lead is still
      // visible at the top of the filtered list).
      navigate(`/leads?id=${call.matched_lead_id}`);
    } else {
      // No match — drop the agent into Leads with a phone search.
      const digits = String(call.from_number || '').replace(/[^0-9]/g, '');
      navigate(`/leads?q=${encodeURIComponent(digits)}`);
    }
  };

  if (calls.length === 0) return null;

  return (
    <>
      <div className="ring-toast-stack">
        {calls.map((call) => (
          <div key={call.id} className="ring-toast">
            <div className="ring-toast-pulse" aria-hidden="true">
              <span className="ring-toast-pulse-dot" />
            </div>
            <div className="ring-toast-body">
              <div className="ring-toast-label">Incoming call</div>
              <div className="ring-toast-name" title={call.from_number}>
                {call.matched_lead_name || formatPhone(call.from_number)}
              </div>
              {call.vehicle && (
                <div className="ring-toast-meta">{call.vehicle}</div>
              )}
              {call.matched_user_name && (
                <div className="ring-toast-meta">→ {call.matched_user_name}</div>
              )}
              <div className="ring-toast-actions">
                <button
                  onClick={() => openLead(call)}
                  className="ring-toast-btn ring-toast-btn-primary"
                >
                  Open lead
                </button>
                <button onClick={() => ack(call.id)} className="ring-toast-btn">
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
      <style>{`
        .ring-toast-stack {
          position: fixed; right: 16px; bottom: 16px; z-index: 70;
          display: flex; flex-direction: column; gap: 10px;
          pointer-events: none;
        }
        .ring-toast {
          pointer-events: auto;
          width: 320px;
          background: var(--bg-1, #fff);
          border: 1px solid var(--border-0, #e5e7eb);
          border-left: 4px solid var(--success, #10b981);
          border-radius: 12px;
          box-shadow: 0 12px 32px rgba(15, 23, 42, 0.18);
          padding: 14px;
          display: flex; gap: 12px;
          animation: ring-toast-in 0.25s ease-out both;
        }
        @keyframes ring-toast-in {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .ring-toast-pulse {
          width: 32px; height: 32px; flex: 0 0 32px;
          display: flex; align-items: center; justify-content: center;
          position: relative;
        }
        .ring-toast-pulse-dot {
          width: 12px; height: 12px; border-radius: 50%;
          background: var(--success, #10b981);
          box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.6);
          animation: ring-toast-pulse 1.4s ease-out infinite;
        }
        @keyframes ring-toast-pulse {
          0%   { transform: scale(0.85); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.55); }
          70%  { transform: scale(1);    box-shadow: 0 0 0 14px rgba(16, 185, 129, 0); }
          100% { transform: scale(0.85); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
        }
        .ring-toast-body { flex: 1; min-width: 0; }
        .ring-toast-label {
          font-size: 10px; font-weight: 700; letter-spacing: 0.05em;
          text-transform: uppercase; color: var(--success, #047857);
        }
        .ring-toast-name {
          font-size: 16px; font-weight: 600; color: var(--text-0, #111827);
          margin-top: 2px; line-height: 1.2;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .ring-toast-meta {
          font-size: 11px; color: var(--text-3, #6b7280); margin-top: 2px;
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }
        .ring-toast-actions {
          display: flex; gap: 6px; margin-top: 10px;
        }
        .ring-toast-btn {
          font-size: 12px; font-weight: 500; padding: 6px 10px;
          border-radius: 6px; border: 1px solid var(--border-1, #d1d5db);
          background: var(--bg-2, #f9fafb); color: var(--text-1, #374151);
          cursor: pointer;
        }
        .ring-toast-btn:hover { background: var(--bg-3, #f3f4f6); }
        .ring-toast-btn-primary {
          background: var(--success, #10b981); color: #fff;
          border-color: var(--success, #10b981);
        }
        .ring-toast-btn-primary:hover { background: var(--success-700, #059669); }
      `}</style>
    </>
  );
}

/** US-style phone formatter; pass-through for anything non-10-digit. */
function formatPhone(value) {
  if (!value) return '';
  const digits = String(value).replace(/\D+/g, '');
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return String(value);
}

-- 041_per_agent_quo_phone.sql
--
-- Per-agent Quo (OpenPhone) line ownership. Before this migration every
-- outbound SMS went out as the shared `OPENPHONE_PHONE_NUMBER_ID` env
-- value, and every inbound text/call hit a shared mailbox (matched
-- only against the lead's assigned_user_id, falling back to nothing if
-- the sender wasn't a known lead).
--
-- After this migration each user can carry their own Quo line:
--   quo_phone_number     — E.164 string ("+12548708757"). Used as the
--                          `from` on outbound SMS, and looked up against
--                          the recipient (`to`) on inbound events so the
--                          line's owner is the one we notify.
--   quo_phone_number_id  — Quo's internal phone-number ID ("PN..."). Set
--                          alongside the E.164 string when you have it;
--                          some Quo webhook payloads carry the ID more
--                          reliably than the raw number for outbound.
--                          NULL is fine — lookup falls back to E.164.
--
-- Backwards-compat: both columns are NULL by default. dispatchOpenPhoneJob
-- and openphone_webhook.php only switch to per-agent routing when the
-- column is populated; unset users continue to use the env default.

ALTER TABLE users
    ADD COLUMN quo_phone_number    VARCHAR(20) NULL AFTER phone,
    ADD COLUMN quo_phone_number_id VARCHAR(50) NULL AFTER quo_phone_number,
    ADD UNIQUE KEY uniq_users_quo_phone_number (quo_phone_number);

-- Extend notifications.type ENUM so the openphone_webhook can drop a
-- bell notification for the line owner whenever someone texts/calls
-- their Quo number. NotificationBell.jsx renders any type; the icon
-- branching falls back to a generic chat/phone icon for unknown types
-- so the new values surface immediately without a frontend change.
ALTER TABLE notifications
    MODIFY COLUMN type ENUM(
        'task_overdue',
        'task_due_today',
        'task_due_soon',
        'task_assigned',
        'task_reopened',
        'inbound_sms',
        'inbound_call'
    ) NOT NULL;

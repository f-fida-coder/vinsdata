-- 042_inbound_call_auto_text.sql
--
-- Tracks whether the openphone_webhook has already fired a
-- "sorry I missed your call" auto-text on a given missed/voicemail
-- inbound call, so the same call event chain (ringing → missed →
-- voicemail can ship 2-3 webhook events) only triggers one outbound
-- SMS. NULL = haven't sent; NOT NULL = sent at that time.
--
-- Backwards-compat: column defaults to NULL, so every existing
-- inbound_calls row is treated as "auto-text not sent" — fine
-- because we only set it from new events going forward, and the
-- guard before sending also requires status IN (missed, voicemail)
-- which old completed rows don't match.

ALTER TABLE inbound_calls
    ADD COLUMN auto_text_sent_at TIMESTAMP NULL AFTER ack_at;

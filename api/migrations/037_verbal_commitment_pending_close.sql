-- Add 'verbal_commitment' + 'pending_close' to lead_states.status.
--
-- Operator-requested funnel states sitting between Interested and
-- Deal Closed:
--   verbal_commitment — lead has said yes verbally (call/text) but
--                       nothing's signed yet. High-priority follow-up
--                       state where the operator works on locking in
--                       paperwork.
--   pending_close     — paperwork is actively moving (BoS sent,
--                       transport scheduling, lien payoff, etc.).
--                       The deal is in flight but not yet wrapped.
--
-- ALTER TABLE on an ENUM is idempotent in MariaDB when the new set is
-- a superset of the old — repeated runs are no-ops. Existing 'new' /
-- 'contacted' / etc. rows are untouched. New rows can immediately use
-- the new values.

SET @s = (SELECT IF(
  EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name   = 'lead_states'
       AND column_name  = 'status'
       AND column_type LIKE "%'verbal_commitment'%"
       AND column_type LIKE "%'pending_close'%"
  ),
  "SELECT 'verbal_commitment + pending_close already in lead_states.status enum'",
  "ALTER TABLE lead_states MODIFY COLUMN status
     ENUM('new','contacted','callback','interested',
          'verbal_commitment','pending_close',
          'value_gap','not_interested','wrong_number','no_answer',
          'voicemail_left','deal_closed','nurture','disqualified',
          'do_not_call','marketing')
     NOT NULL DEFAULT 'new'"
));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

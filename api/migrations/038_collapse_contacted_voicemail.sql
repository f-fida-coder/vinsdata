-- Recategorize contacted + voicemail_left → no_answer, then drop
-- both values from the ENUM.
--
-- Rationale (operator-driven): in practice these three statuses all
-- represent the same end state from a follow-up perspective ("we
-- tried, didn't get them"), and operators were splitting hairs between
-- them inconsistently. Collapsing to a single 'no_answer' bucket
-- removes the noise.
--
-- Migration is two-phase:
--   1. UPDATE every row from contacted/voicemail_left → no_answer.
--      Activity log isn't touched — this is a one-time schema cleanup,
--      not a per-row operator decision. The status_changed audit trail
--      in lead_activities stays intact for the original transitions.
--   2. ALTER the ENUM to drop both values now that nothing references
--      them. Idempotent: re-running on a DB that's already been
--      migrated is a no-op (the EXISTS check on the column type
--      catches that).

-- Phase 1: bulk reassign.
UPDATE lead_states SET status = 'no_answer'
 WHERE status IN ('contacted', 'voicemail_left');

-- Phase 2: shrink the ENUM. The EXISTS check guards against re-runs:
-- if 'contacted' is no longer in the column definition, skip.
SET @s = (SELECT IF(
  EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name   = 'lead_states'
       AND column_name  = 'status'
       AND column_type LIKE "%'contacted'%"
  ),
  "ALTER TABLE lead_states MODIFY COLUMN status
     ENUM('new','callback','interested',
          'verbal_commitment','pending_close',
          'value_gap','not_interested','wrong_number','no_answer',
          'deal_closed','nurture','disqualified',
          'do_not_call','marketing')
     NOT NULL DEFAULT 'new'",
  "SELECT 'contacted + voicemail_left already removed from enum'"
));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

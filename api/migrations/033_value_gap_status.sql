-- Add 'value_gap' to the lead_states.status ENUM.
--
-- Operator-requested new status. Used when a lead is interested but the
-- price gap between what they want and what we offer is too wide to
-- close at the moment — distinct from "not interested" (which means
-- "they're out") and "nurture" (which is more generic). Operators can
-- still close the deal later if the gap narrows.
--
-- ALTER TABLE on an ENUM is idempotent in MariaDB when the new set is
-- a superset of the old — repeated runs are no-ops.

SET @s = (SELECT IF(
  EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name   = 'lead_states'
       AND column_name  = 'status'
       AND column_type LIKE "%'value_gap'%"
  ),
  "SELECT 'value_gap already in lead_states.status enum'",
  "ALTER TABLE lead_states MODIFY COLUMN status
     ENUM('new','contacted','callback','interested','value_gap','not_interested',
          'wrong_number','no_answer','voicemail_left','deal_closed',
          'nurture','disqualified','do_not_call','marketing')
     NOT NULL DEFAULT 'new'"
));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

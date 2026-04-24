-- Step 12: add 'no_answer' to the lead_temperature enum so the outreach state
-- machine can represent "we tried, no reply" as a first-class temperature
-- rather than inferring it from the status + contact_logs combination.
--
-- Spec-level state machine is:
--     no_answer → cold → warm → hot → closed
--
-- Idempotent: only runs the ALTER when 'no_answer' is absent.

SET @s := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name   = 'lead_states'
       AND column_name  = 'lead_temperature'
       AND column_type  LIKE '%no_answer%') = 0,
  "ALTER TABLE lead_states
     MODIFY COLUMN lead_temperature
       ENUM('no_answer','cold','warm','hot','closed') NULL",
  "SELECT 'lead_temperature enum already contains no_answer'"
));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

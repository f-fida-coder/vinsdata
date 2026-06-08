-- Drop 'hot' from the lead_states.priority ENUM.
--
-- "Hot" is a temperature signal, not a priority. The two were sometimes
-- conflated when an operator wanted to mark a lead as the highest of
-- the high — but lead_temperature already has its own 'hot' value, and
-- priority's purpose is workload ordering (low/medium/high), not
-- temperature classification. Recategorizing avoids the overload.
--
-- Two-phase, both idempotent:
--   1. Bulk reassign every row from priority='hot' → priority='high'.
--   2. ALTER the ENUM to drop 'hot' once nothing references it.

UPDATE lead_states SET priority = 'high' WHERE priority = 'hot';

SET @s = (SELECT IF(
  EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name   = 'lead_states'
       AND column_name  = 'priority'
       AND column_type LIKE "%'hot'%"
  ),
  "ALTER TABLE lead_states MODIFY COLUMN priority
     ENUM('low','medium','high')
     NOT NULL DEFAULT 'medium'",
  "SELECT 'hot already removed from lead_states.priority enum'"
));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

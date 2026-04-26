-- Step 17: drop 'hot' from priority enum on both lead_states and vehicles_v2.
--
-- Product feedback: priority 'hot' overlaps semantically with lead_temperature
-- 'hot' and confuses operators. Priority becomes a 3-step ladder: low / medium
-- / high. Existing rows with priority='hot' are mapped to 'high'.
--
-- Idempotent: each ALTER only runs if the enum still contains 'hot'.

-- lead_states.priority
SET @s := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name   = 'lead_states'
       AND column_name  = 'priority'
       AND column_type  LIKE "%'hot'%") = 1,
  "UPDATE lead_states SET priority = 'high' WHERE priority = 'hot'",
  "SELECT 'lead_states.priority already drops hot'"
));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @s := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name   = 'lead_states'
       AND column_name  = 'priority'
       AND column_type  LIKE "%'hot'%") = 1,
  "ALTER TABLE lead_states
     MODIFY COLUMN priority ENUM('low','medium','high') NOT NULL DEFAULT 'medium'",
  "SELECT 'lead_states.priority enum already trimmed'"
));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- vehicles_v2.priority (shadow table, no data — alter is cheap)
SET @s := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name   = 'vehicles_v2'
       AND column_name  = 'priority'
       AND column_type  LIKE "%'hot'%") = 1,
  "ALTER TABLE vehicles_v2
     MODIFY COLUMN priority ENUM('low','medium','high') NOT NULL DEFAULT 'medium'",
  "SELECT 'vehicles_v2.priority enum already trimmed'"
));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

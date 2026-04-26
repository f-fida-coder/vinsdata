-- Step 19: rename file status 'invalid' → 'flagged'.
--
-- Per product feedback: "There won't be invalid files just flagged files."
-- Files only get flagged for review; nothing is ever permanently invalid.
--
-- Rolled out in three sub-steps so the UPDATE has a destination value:
--   1) Expand enum to include both 'invalid' and 'flagged'
--   2) Move existing rows (status='invalid' OR is_invalid=1) to 'flagged'
--   3) Drop 'invalid' from the enum
-- Plus add 'flag' / 'unflag' to file_stage_history.action_type so future
-- transitions log the new vocabulary. Existing 'invalidate' / 'reactivate'
-- action_type values are kept so historical rows still validate.
--
-- The is_invalid boolean column is left in place for now — code stops reading
-- it in the same commit, but dropping the column waits one deploy cycle
-- (separate migration) so prior code releases don't 500 mid-deploy.

-- 1) Add 'flagged' alongside 'invalid' (idempotent — only runs if 'flagged' is missing).
SET @s := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'files' AND column_name = 'status'
       AND column_type LIKE "%'flagged'%") = 0,
  "ALTER TABLE files MODIFY COLUMN status
     ENUM('active','completed','blocked','invalid','flagged') NOT NULL DEFAULT 'active'",
  "SELECT 'files.status enum already has flagged'"
));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2) Backfill: any row with status='invalid' OR is_invalid=1 becomes 'flagged'.
UPDATE files SET status = 'flagged'
 WHERE status = 'invalid' OR (is_invalid = 1 AND status <> 'flagged');

-- 3) Drop 'invalid' from the enum (only if it's still present).
SET @s := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'files' AND column_name = 'status'
       AND column_type LIKE "%'invalid'%") = 1,
  "ALTER TABLE files MODIFY COLUMN status
     ENUM('active','completed','blocked','flagged') NOT NULL DEFAULT 'active'",
  "SELECT 'files.status enum already drops invalid'"
));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 4) Action-type enum: add 'flag' and 'unflag' for new transitions. Keep
--    'invalidate' and 'reactivate' so historical rows still validate.
SET @s := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'file_stage_history' AND column_name = 'action_type'
       AND column_type LIKE "%'flag'%") = 0,
  "ALTER TABLE file_stage_history MODIFY COLUMN action_type
     ENUM('create','upload','advance','complete','block','invalidate','reactivate','flag','unflag') NOT NULL",
  "SELECT 'file_stage_history.action_type already has flag'"
));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

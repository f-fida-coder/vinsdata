-- Step: Soft delete for leads.
-- Adds deleted_at / deleted_by to imported_leads_raw. Every read path
-- gets a default WHERE deleted_at IS NULL filter, so archived leads
-- disappear from /leads, /pipeline, /tasks, /reports, etc. without
-- losing the row (or any child rows — lead_states, lead_tasks, BoSes,
-- activities all stay attached, intact, restorable).
--
-- The "Archived leads" view explicitly opts in via ?include_archived=1.
-- Hard delete remains available (admin only) for a true purge.

SET @s = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'imported_leads_raw'
       AND column_name = 'deleted_at') = 0,
  "ALTER TABLE imported_leads_raw ADD COLUMN deleted_at TIMESTAMP NULL AFTER norm_year",
  "SELECT 'deleted_at already exists'"
));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @s = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'imported_leads_raw'
       AND column_name = 'deleted_by') = 0,
  "ALTER TABLE imported_leads_raw ADD COLUMN deleted_by INT NULL AFTER deleted_at",
  "SELECT 'deleted_by already exists'"
));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Index lets the "is this lead archived?" filter use an index seek
-- instead of a full table scan on every list query.
SET @s = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.statistics
     WHERE table_schema = DATABASE() AND table_name = 'imported_leads_raw'
       AND index_name = 'idx_ilr_deleted_at') = 0,
  "ALTER TABLE imported_leads_raw ADD INDEX idx_ilr_deleted_at (deleted_at)",
  "SELECT 'idx_ilr_deleted_at already exists'"
));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Activity log type for the archive / restore actions so the lead's
-- timeline shows them like any other state change.
ALTER TABLE lead_activities
  MODIFY COLUMN activity_type ENUM(
    'status_changed','priority_changed','assigned','unassigned',
    'label_added','label_removed',
    'note_added','note_edited','note_deleted',
    'temperature_changed','price_wanted_changed','price_offered_changed',
    'vehicle_color_changed','vehicle_odometer_changed',
    'task_created','task_updated','task_completed','task_cancelled','task_reopened',
    'contact_logged',
    'lead_archived','lead_restored'
  ) NOT NULL;

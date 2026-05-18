-- Step 7b: Client-requested CRM fields on lead_states.
-- "Agent" is intentionally NOT a new column — it reuses assigned_user_id.

SET @s := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'lead_states' AND column_name = 'lead_temperature') = 0,
  "ALTER TABLE lead_states
     ADD COLUMN lead_temperature ENUM('cold','warm','hot','closed') NULL AFTER priority,
     ADD COLUMN price_wanted     DECIMAL(12,2) NULL AFTER lead_temperature,
     ADD COLUMN price_offered    DECIMAL(12,2) NULL AFTER price_wanted,
     ADD INDEX idx_ls_temperature (lead_temperature)",
  "SELECT 'lead_states already extended'"
));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Extend activity type enum to cover the three new change types.
ALTER TABLE lead_activities
  MODIFY COLUMN activity_type ENUM(
    'status_changed','priority_changed','assigned','unassigned',
    'label_added','label_removed',
    'note_added','note_edited','note_deleted',
    'temperature_changed','price_wanted_changed','price_offered_changed'
  ) NOT NULL;

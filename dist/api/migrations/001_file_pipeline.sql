-- Step 1: File Pipeline formalization
-- Safe to run more than once where possible; guarded by column/table existence checks
-- where MySQL allows. Run in one session.

SET @s := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = DATABASE() AND table_name = 'files' AND column_name = 'base_name') = 0,
  "ALTER TABLE files
     ADD COLUMN base_name          VARCHAR(255) NULL AFTER vehicle_id,
     ADD COLUMN display_name       VARCHAR(255) NULL AFTER base_name,
     ADD COLUMN status             ENUM('active','completed','blocked','invalid') NOT NULL DEFAULT 'active' AFTER current_stage,
     ADD COLUMN created_by         INT NULL AFTER status,
     ADD COLUMN assigned_to        INT NULL AFTER created_by,
     ADD COLUMN latest_artifact_id INT NULL AFTER assigned_to",
  "SELECT 'files columns already present'"
));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE files
   SET base_name    = COALESCE(base_name, file_name),
       display_name = COALESCE(display_name, file_name),
       created_by   = COALESCE(created_by, added_by)
 WHERE base_name IS NULL OR display_name IS NULL OR created_by IS NULL;

UPDATE files SET status = 'invalid' WHERE is_invalid = 1 AND status = 'active';

ALTER TABLE files
  MODIFY COLUMN base_name    VARCHAR(255) NOT NULL,
  MODIFY COLUMN display_name VARCHAR(255) NOT NULL,
  MODIFY COLUMN created_by   INT NOT NULL,
  MODIFY COLUMN current_stage ENUM('generated','carfax','filter','tlo') NOT NULL DEFAULT 'generated';

CREATE TABLE IF NOT EXISTS file_artifacts (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  file_id           INT NOT NULL,
  stage             ENUM('generated','carfax','filter','tlo') NOT NULL,
  original_filename VARCHAR(255) NOT NULL,
  stored_filename   VARCHAR(255) NOT NULL,
  file_path         VARCHAR(512) NOT NULL,
  file_type         VARCHAR(128) NOT NULL,
  file_size         BIGINT NOT NULL,
  uploaded_by       INT NOT NULL,
  uploaded_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  notes             TEXT NULL,
  CONSTRAINT fk_artifacts_file FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE,
  CONSTRAINT fk_artifacts_user FOREIGN KEY (uploaded_by) REFERENCES users(id),
  INDEX idx_artifacts_file_stage (file_id, stage)
);

-- Backfill file_artifacts from legacy file_uploads if artifacts is empty
INSERT INTO file_artifacts (file_id, stage, original_filename, stored_filename, file_path, file_type, file_size, uploaded_by, uploaded_at)
SELECT u.file_id, u.stage, u.original_name, u.stored_name,
       CONCAT('api/uploads/', u.stored_name), u.mime_type, u.file_size, u.uploaded_by, u.created_at
FROM file_uploads u
WHERE NOT EXISTS (SELECT 1 FROM file_artifacts a LIMIT 1);

UPDATE files f
JOIN (SELECT file_id, MAX(id) AS max_id FROM file_artifacts GROUP BY file_id) x
  ON x.file_id = f.id
SET f.latest_artifact_id = x.max_id
WHERE f.latest_artifact_id IS NULL;

CREATE TABLE IF NOT EXISTS file_stage_history (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  file_id      INT NOT NULL,
  from_stage   ENUM('generated','carfax','filter','tlo') NULL,
  to_stage     ENUM('generated','carfax','filter','tlo') NOT NULL,
  action_type  ENUM('create','upload','advance','complete','block','invalidate','reactivate') NOT NULL,
  artifact_id  INT NULL,
  performed_by INT NOT NULL,
  remarks      TEXT NULL,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_hist_file     FOREIGN KEY (file_id)     REFERENCES files(id) ON DELETE CASCADE,
  CONSTRAINT fk_hist_artifact FOREIGN KEY (artifact_id) REFERENCES file_artifacts(id) ON DELETE SET NULL,
  CONSTRAINT fk_hist_user     FOREIGN KEY (performed_by) REFERENCES users(id),
  INDEX idx_hist_file_time (file_id, created_at)
);

-- Backfill history from legacy file_logs if history is empty
INSERT INTO file_stage_history (file_id, from_stage, to_stage, action_type, performed_by, remarks, created_at)
SELECT l.file_id, l.from_stage,
       COALESCE(l.to_stage, 'generated'),
       CASE WHEN l.from_stage IS NULL THEN 'create' ELSE 'advance' END,
       l.user_id, l.notes, l.created_at
FROM file_logs l
WHERE NOT EXISTS (SELECT 1 FROM file_stage_history LIMIT 1);

-- Add FK for latest_artifact_id now that artifacts exist
SET @s := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.table_constraints
   WHERE table_schema = DATABASE() AND table_name = 'files'
     AND constraint_name = 'fk_files_latest_artifact') = 0,
  "ALTER TABLE files
     ADD CONSTRAINT fk_files_created_by     FOREIGN KEY (created_by)         REFERENCES users(id),
     ADD CONSTRAINT fk_files_assigned_to    FOREIGN KEY (assigned_to)        REFERENCES users(id),
     ADD CONSTRAINT fk_files_latest_artifact FOREIGN KEY (latest_artifact_id) REFERENCES file_artifacts(id) ON DELETE SET NULL",
  "SELECT 'files FKs already present'"
));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

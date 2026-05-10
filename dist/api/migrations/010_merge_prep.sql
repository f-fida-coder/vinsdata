-- Step: Merge Prep / Related Leads Workspace
-- Two new tables + one new activity_type. All additive, no destructive changes.

CREATE TABLE IF NOT EXISTS lead_merge_prep_groups (
  id                        INT AUTO_INCREMENT PRIMARY KEY,
  duplicate_group_id        INT NOT NULL,
  preferred_primary_lead_id BIGINT NULL,
  review_notes              TEXT NULL,
  status                    ENUM('draft','prepared') NOT NULL DEFAULT 'draft',
  created_by                INT NOT NULL,
  prepared_by               INT NULL,
  prepared_at               TIMESTAMP NULL,
  created_at                TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at                TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_mpg_dup     FOREIGN KEY (duplicate_group_id)        REFERENCES lead_duplicate_groups(id) ON DELETE CASCADE,
  CONSTRAINT fk_mpg_primary FOREIGN KEY (preferred_primary_lead_id) REFERENCES imported_leads_raw(id)    ON DELETE SET NULL,
  CONSTRAINT fk_mpg_creator FOREIGN KEY (created_by)                REFERENCES users(id),
  CONSTRAINT fk_mpg_preparer FOREIGN KEY (prepared_by)              REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE KEY uq_mpg_dup (duplicate_group_id),
  INDEX idx_mpg_status (status)
);

CREATE TABLE IF NOT EXISTS lead_merge_prep_choices (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  prep_group_id       INT NOT NULL,
  imported_lead_id    BIGINT NOT NULL,
  keep_for_reference  TINYINT(1) NOT NULL DEFAULT 0,
  likely_best_phone   TINYINT(1) NOT NULL DEFAULT 0,
  likely_best_email   TINYINT(1) NOT NULL DEFAULT 0,
  likely_best_address TINYINT(1) NOT NULL DEFAULT 0,
  notes               TEXT NULL,
  created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_mpc_prep FOREIGN KEY (prep_group_id)    REFERENCES lead_merge_prep_groups(id) ON DELETE CASCADE,
  CONSTRAINT fk_mpc_lead FOREIGN KEY (imported_lead_id) REFERENCES imported_leads_raw(id)    ON DELETE CASCADE,
  UNIQUE KEY uq_mpc_prep_lead (prep_group_id, imported_lead_id),
  INDEX idx_mpc_lead (imported_lead_id)
);

ALTER TABLE lead_activities
  MODIFY COLUMN activity_type ENUM(
    'status_changed','priority_changed','assigned','unassigned',
    'label_added','label_removed',
    'note_added','note_edited','note_deleted',
    'temperature_changed','price_wanted_changed','price_offered_changed',
    'task_created','task_updated','task_completed','task_cancelled','task_reopened',
    'contact_logged',
    'merge_prep_updated'
  ) NOT NULL;

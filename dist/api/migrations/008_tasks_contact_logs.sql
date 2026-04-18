-- Step: Tasks + Follow-up Queue + Contact Logging
-- lead_tasks: internal next-action tracking. lead_contact_logs: append-only
-- record of contact attempts/outcomes. Both layer on top of imported leads.

CREATE TABLE IF NOT EXISTS lead_tasks (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  imported_lead_id  BIGINT NOT NULL,
  assigned_user_id  INT NULL,
  task_type         ENUM('callback','follow_up','review','verify_contact','custom') NOT NULL DEFAULT 'follow_up',
  title             VARCHAR(255) NOT NULL,
  notes             TEXT NULL,
  due_at            DATETIME NULL,
  status            ENUM('open','completed','cancelled') NOT NULL DEFAULT 'open',
  created_by        INT NOT NULL,
  completed_at      TIMESTAMP NULL,
  completed_by      INT NULL,
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_lt_lead      FOREIGN KEY (imported_lead_id) REFERENCES imported_leads_raw(id) ON DELETE CASCADE,
  CONSTRAINT fk_lt_assigned  FOREIGN KEY (assigned_user_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT fk_lt_creator   FOREIGN KEY (created_by)       REFERENCES users(id),
  CONSTRAINT fk_lt_completer FOREIGN KEY (completed_by)     REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_lt_lead_status  (imported_lead_id, status),
  INDEX idx_lt_assigned_due (assigned_user_id, status, due_at),
  INDEX idx_lt_status_due   (status, due_at)
);

CREATE TABLE IF NOT EXISTS lead_contact_logs (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  imported_lead_id  BIGINT NOT NULL,
  user_id           INT NOT NULL,
  channel           ENUM('phone','email','sms','whatsapp','other') NOT NULL,
  outcome           ENUM('attempted','connected','no_answer','voicemail','wrong_number','follow_up_needed','completed','other') NOT NULL,
  notes             TEXT NULL,
  happened_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_lcl_lead FOREIGN KEY (imported_lead_id) REFERENCES imported_leads_raw(id) ON DELETE CASCADE,
  CONSTRAINT fk_lcl_user FOREIGN KEY (user_id)          REFERENCES users(id),
  INDEX idx_lcl_lead_time (imported_lead_id, happened_at DESC),
  INDEX idx_lcl_user_time (user_id, happened_at DESC)
);

ALTER TABLE lead_activities
  MODIFY COLUMN activity_type ENUM(
    'status_changed','priority_changed','assigned','unassigned',
    'label_added','label_removed',
    'note_added','note_edited','note_deleted',
    'temperature_changed','price_wanted_changed','price_offered_changed',
    'task_created','task_updated','task_completed','task_cancelled','task_reopened',
    'contact_logged'
  ) NOT NULL;

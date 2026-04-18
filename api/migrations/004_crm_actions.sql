-- Step 5: CRM Actions Layer
-- All new tables attach to imported_leads_raw(id). Imported source data stays untouched.

CREATE TABLE IF NOT EXISTS lead_states (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  imported_lead_id BIGINT NOT NULL UNIQUE,
  status           ENUM('new','contacted','callback','interested','not_interested',
                        'wrong_number','no_answer','voicemail_left','deal_closed',
                        'nurture','disqualified','do_not_call') NOT NULL DEFAULT 'new',
  priority         ENUM('low','medium','high','hot') NOT NULL DEFAULT 'medium',
  assigned_user_id INT NULL,
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_ls_lead FOREIGN KEY (imported_lead_id) REFERENCES imported_leads_raw(id) ON DELETE CASCADE,
  CONSTRAINT fk_ls_user FOREIGN KEY (assigned_user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_ls_status_priority (status, priority),
  INDEX idx_ls_assigned        (assigned_user_id)
);

CREATE TABLE IF NOT EXISTS lead_labels (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(80) NOT NULL UNIQUE,
  color      VARCHAR(9)  NOT NULL DEFAULT '#6b7280',
  created_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_ll_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS lead_label_links (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  imported_lead_id BIGINT NOT NULL,
  label_id         INT NOT NULL,
  created_by       INT NULL,
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_lll_lead  FOREIGN KEY (imported_lead_id) REFERENCES imported_leads_raw(id) ON DELETE CASCADE,
  CONSTRAINT fk_lll_label FOREIGN KEY (label_id)         REFERENCES lead_labels(id)        ON DELETE CASCADE,
  CONSTRAINT fk_lll_user  FOREIGN KEY (created_by)       REFERENCES users(id)              ON DELETE SET NULL,
  UNIQUE KEY uq_lll_lead_label (imported_lead_id, label_id),
  INDEX idx_lll_label (label_id)
);

CREATE TABLE IF NOT EXISTS lead_notes (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  imported_lead_id BIGINT NOT NULL,
  user_id          INT NOT NULL,
  note             TEXT NOT NULL,
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_ln_lead FOREIGN KEY (imported_lead_id) REFERENCES imported_leads_raw(id) ON DELETE CASCADE,
  CONSTRAINT fk_ln_user FOREIGN KEY (user_id)          REFERENCES users(id),
  INDEX idx_ln_lead_time (imported_lead_id, created_at DESC)
);

CREATE TABLE IF NOT EXISTS lead_activities (
  id               BIGINT AUTO_INCREMENT PRIMARY KEY,
  imported_lead_id BIGINT NOT NULL,
  user_id          INT NOT NULL,
  activity_type    ENUM('status_changed','priority_changed','assigned','unassigned',
                        'label_added','label_removed',
                        'note_added','note_edited','note_deleted') NOT NULL,
  old_value_json   JSON NULL,
  new_value_json   JSON NULL,
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_la_lead FOREIGN KEY (imported_lead_id) REFERENCES imported_leads_raw(id) ON DELETE CASCADE,
  CONSTRAINT fk_la_user FOREIGN KEY (user_id)          REFERENCES users(id),
  INDEX idx_la_lead_time (imported_lead_id, created_at DESC)
);

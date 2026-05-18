-- Step 6: Duplicate Detection + Review Layer
-- Three tables; all FKs cascade to keep duplicate-review state consistent with
-- the immutable imported rows. Groups keep a current review_status for fast
-- filtering; lead_duplicate_reviews is the journal (every decision appended).

CREATE TABLE IF NOT EXISTS lead_duplicate_groups (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  match_type    ENUM('vin','phone','email','address_last_name','name_phone') NOT NULL,
  match_key     VARCHAR(255) NOT NULL,
  confidence    DECIMAL(3,2) NOT NULL DEFAULT 0.50,
  review_status ENUM('pending','confirmed_duplicate','not_duplicate','ignored') NOT NULL DEFAULT 'pending',
  reviewed_by   INT NULL,
  reviewed_at   TIMESTAMP NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_ldg_user FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE KEY uq_ldg_type_key (match_type, match_key),
  INDEX idx_ldg_status_type (review_status, match_type),
  INDEX idx_ldg_confidence  (confidence)
);

CREATE TABLE IF NOT EXISTS lead_duplicate_group_members (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  group_id         INT NOT NULL,
  imported_lead_id BIGINT NOT NULL,
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ldgm_group FOREIGN KEY (group_id)         REFERENCES lead_duplicate_groups(id) ON DELETE CASCADE,
  CONSTRAINT fk_ldgm_lead  FOREIGN KEY (imported_lead_id) REFERENCES imported_leads_raw(id)   ON DELETE CASCADE,
  UNIQUE KEY uq_ldgm_group_lead (group_id, imported_lead_id),
  INDEX idx_ldgm_lead (imported_lead_id)
);

CREATE TABLE IF NOT EXISTS lead_duplicate_reviews (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  group_id    INT NOT NULL,
  decision    ENUM('pending','confirmed_duplicate','not_duplicate','ignored') NOT NULL,
  notes       TEXT NULL,
  reviewed_by INT NOT NULL,
  reviewed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ldr_group FOREIGN KEY (group_id)    REFERENCES lead_duplicate_groups(id) ON DELETE CASCADE,
  CONSTRAINT fk_ldr_user  FOREIGN KEY (reviewed_by) REFERENCES users(id),
  INDEX idx_ldr_group_time (group_id, created_at DESC)
);

-- Step 3: Lead Import Foundation
-- Creates column_mapping_templates, lead_import_batches, imported_leads_raw.
-- Guarded with CREATE IF NOT EXISTS; safe to re-run.

CREATE TABLE IF NOT EXISTS column_mapping_templates (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  template_name VARCHAR(255) NOT NULL,
  source_stage  ENUM('generated','carfax','filter','tlo') NOT NULL,
  mapping_json  JSON NOT NULL,
  active        TINYINT(1) NOT NULL DEFAULT 1,
  created_by    INT NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_cmt_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_cmt_stage_active (source_stage, active)
);

CREATE TABLE IF NOT EXISTS lead_import_batches (
  id                   INT AUTO_INCREMENT PRIMARY KEY,
  file_id              INT NOT NULL,
  artifact_id          INT NOT NULL,
  batch_name           VARCHAR(255) NOT NULL,
  source_stage         ENUM('generated','carfax','filter','tlo') NOT NULL,
  total_rows           INT NOT NULL DEFAULT 0,
  imported_rows        INT NOT NULL DEFAULT 0,
  duplicate_rows       INT NOT NULL DEFAULT 0,
  failed_rows          INT NOT NULL DEFAULT 0,
  imported_by          INT NOT NULL,
  imported_at          TIMESTAMP NULL,
  mapping_template_id  INT NULL,
  mapping_json         JSON NULL,
  notes                TEXT NULL,
  created_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_lib_file     FOREIGN KEY (file_id)     REFERENCES files(id) ON DELETE CASCADE,
  CONSTRAINT fk_lib_artifact FOREIGN KEY (artifact_id) REFERENCES file_artifacts(id) ON DELETE CASCADE,
  CONSTRAINT fk_lib_user     FOREIGN KEY (imported_by) REFERENCES users(id),
  CONSTRAINT fk_lib_template FOREIGN KEY (mapping_template_id) REFERENCES column_mapping_templates(id) ON DELETE SET NULL,
  INDEX idx_lib_file (file_id),
  INDEX idx_lib_artifact (artifact_id)
);

CREATE TABLE IF NOT EXISTS imported_leads_raw (
  id                      BIGINT AUTO_INCREMENT PRIMARY KEY,
  batch_id                INT NOT NULL,
  source_row_number       INT NOT NULL,
  raw_payload_json        JSON NOT NULL,
  normalized_payload_json JSON NULL,
  import_status           ENUM('imported','duplicate','failed','skipped') NOT NULL DEFAULT 'imported',
  error_message           TEXT NULL,
  created_at              TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ilr_batch FOREIGN KEY (batch_id) REFERENCES lead_import_batches(id) ON DELETE CASCADE,
  INDEX idx_ilr_batch (batch_id),
  INDEX idx_ilr_status (batch_id, import_status)
);

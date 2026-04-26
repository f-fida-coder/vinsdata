-- Step 14: shadow tables for the canonical Vehicle-by-VIN model.
--
-- DESIGN: see docs/data-model-v2.md for the full reasoning.
-- THIS MIGRATION IS NON-DESTRUCTIVE. It only creates new tables. No data
-- is copied, no existing tables are altered, no code path reads or writes
-- these new tables yet. Safe to deploy today.
--
-- Backfill (migration 015) and cutover come later, gated on explicit approval.

-- One row per VIN. The canonical Vehicle record.
SET @s := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = 'vehicles_v2') = 0,
  "CREATE TABLE vehicles_v2 (
     id                    BIGINT AUTO_INCREMENT PRIMARY KEY,
     vin                   VARCHAR(17)   NOT NULL,

     year                  SMALLINT      NULL,
     make                  VARCHAR(80)   NULL,
     model                 VARCHAR(80)   NULL,
     trim                  VARCHAR(80)   NULL,
     mileage               INT           NULL,
     vehicle_condition     VARCHAR(80)   NULL,

     owner_first_name      VARCHAR(80)   NULL,
     owner_last_name       VARCHAR(80)   NULL,
     owner_full_address    VARCHAR(255)  NULL,
     owner_city            VARCHAR(80)   NULL,
     owner_state           CHAR(2)       NULL,
     owner_zip             VARCHAR(15)   NULL,
     owner_phone           VARCHAR(40)   NULL,
     owner_email           VARCHAR(255)  NULL,
     owner_age             SMALLINT      NULL,

     asking_price          DECIMAL(12,2) NULL,
     offer_price           DECIMAL(12,2) NULL,
     acquisition_price     DECIMAL(12,2) NULL,

     data_stage            ENUM('generated','carfax','filter','tlo') NOT NULL DEFAULT 'generated',
     lead_temperature      ENUM('no_answer','cold','warm','hot','closed') NULL,
     priority              ENUM('low','medium','high','hot') NOT NULL DEFAULT 'medium',
     lead_status           VARCHAR(40)   NULL,
     assigned_user_id      INT           NULL,

     source                VARCHAR(255)  NULL,
     date_imported         TIMESTAMP     NULL,
     list_name             VARCHAR(255)  NULL,

     dead_reason           VARCHAR(255)  NULL,
     dead_at               TIMESTAMP     NULL,

     notes                 TEXT          NULL,

     created_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
     updated_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

     UNIQUE KEY uniq_vehicles_v2_vin (vin),
     INDEX idx_vehicles_v2_data_stage (data_stage),
     INDEX idx_vehicles_v2_temperature (lead_temperature),
     INDEX idx_vehicles_v2_state       (owner_state),
     INDEX idx_vehicles_v2_make_model  (make, model),
     INDEX idx_vehicles_v2_year        (year),
     INDEX idx_vehicles_v2_assigned    (assigned_user_id),
     CONSTRAINT fk_vehicles_v2_assigned FOREIGN KEY (assigned_user_id) REFERENCES users(id) ON DELETE SET NULL
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
  "SELECT 'vehicles_v2 already exists'"
));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Provenance: links a canonical Vehicle to every imported_leads_raw row
-- that ever contributed data to it.
SET @s := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = 'vehicle_imports') = 0,
  "CREATE TABLE vehicle_imports (
     id                BIGINT AUTO_INCREMENT PRIMARY KEY,
     vehicle_id        BIGINT NOT NULL,
     imported_lead_id  BIGINT NOT NULL,
     batch_id          INT    NULL,
     created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

     UNIQUE KEY uniq_vehicle_lead (vehicle_id, imported_lead_id),
     INDEX idx_vehicle_imports_lead  (imported_lead_id),
     INDEX idx_vehicle_imports_batch (batch_id),

     CONSTRAINT fk_vehicle_imports_vehicle  FOREIGN KEY (vehicle_id)       REFERENCES vehicles_v2(id)         ON DELETE CASCADE,
     CONSTRAINT fk_vehicle_imports_lead     FOREIGN KEY (imported_lead_id) REFERENCES imported_leads_raw(id)  ON DELETE CASCADE,
     CONSTRAINT fk_vehicle_imports_batch    FOREIGN KEY (batch_id)         REFERENCES lead_import_batches(id) ON DELETE SET NULL
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
  "SELECT 'vehicle_imports already exists'"
));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Merge log: every field-level mutation triggered by a re-import.
-- Lets the drawer show "what changed and when" per spec.
SET @s := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = 'vehicle_field_changes') = 0,
  "CREATE TABLE vehicle_field_changes (
     id                BIGINT AUTO_INCREMENT PRIMARY KEY,
     vehicle_id        BIGINT NOT NULL,
     imported_lead_id  BIGINT NULL,
     field_name        VARCHAR(80) NOT NULL,
     old_value         TEXT NULL,
     new_value         TEXT NULL,
     source            VARCHAR(255) NULL,
     changed_by        INT NULL,
     created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

     INDEX idx_vfc_vehicle (vehicle_id, created_at),
     INDEX idx_vfc_lead    (imported_lead_id),

     CONSTRAINT fk_vfc_vehicle  FOREIGN KEY (vehicle_id)       REFERENCES vehicles_v2(id)        ON DELETE CASCADE,
     CONSTRAINT fk_vfc_lead     FOREIGN KEY (imported_lead_id) REFERENCES imported_leads_raw(id) ON DELETE SET NULL,
     CONSTRAINT fk_vfc_actor    FOREIGN KEY (changed_by)       REFERENCES users(id)              ON DELETE SET NULL
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
  "SELECT 'vehicle_field_changes already exists'"
));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

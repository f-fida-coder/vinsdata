-- Step 4: Lead Explorer indexing
-- Adds STORED generated columns on imported_leads_raw for the most-filtered
-- normalized fields, plus indexes on them. Guarded so it can re-run.

SET @s := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'imported_leads_raw' AND column_name = 'norm_vin') = 0,
  "ALTER TABLE imported_leads_raw
     ADD COLUMN norm_vin           VARCHAR(50)  GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(normalized_payload_json, '$.vin'))) STORED,
     ADD COLUMN norm_phone_primary VARCHAR(50)  GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(normalized_payload_json, '$.phone_primary'))) STORED,
     ADD COLUMN norm_email_primary VARCHAR(255) GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(normalized_payload_json, '$.email_primary'))) STORED,
     ADD COLUMN norm_state         VARCHAR(20)  GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(normalized_payload_json, '$.state'))) STORED,
     ADD COLUMN norm_make          VARCHAR(100) GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(normalized_payload_json, '$.make'))) STORED,
     ADD COLUMN norm_model         VARCHAR(100) GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(normalized_payload_json, '$.model'))) STORED,
     ADD COLUMN norm_year          INT          GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(normalized_payload_json, '$.year')) + 0) STORED",
  "SELECT 'norm_* columns already present'"
));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @s := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.statistics
     WHERE table_schema = DATABASE() AND table_name = 'imported_leads_raw' AND index_name = 'idx_leads_vin') = 0,
  "ALTER TABLE imported_leads_raw
     ADD INDEX idx_leads_vin        (norm_vin),
     ADD INDEX idx_leads_phone      (norm_phone_primary),
     ADD INDEX idx_leads_email      (norm_email_primary),
     ADD INDEX idx_leads_state      (norm_state),
     ADD INDEX idx_leads_make_model (norm_make, norm_model),
     ADD INDEX idx_leads_year       (norm_year),
     ADD INDEX idx_leads_batch      (batch_id, import_status)",
  "SELECT 'lead indexes already present'"
));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

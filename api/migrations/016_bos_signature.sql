-- Bill of Sale signature columns. Added in advance of the v2 e-signature
-- integration so the list endpoint + drawer UI can render a status pill
-- now ("draft" / "ready to send" / "awaiting signature" / "signed")
-- without breaking when the columns aren't yet present.
--
-- Each ALTER is wrapped in an information_schema check so re-running is
-- a no-op. The data path treats every value as nullable; v2 will set
-- these when a real signing request is dispatched (OpenSign or similar).

SET @s = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'bill_of_sale'
       AND column_name = 'signature_request_id') = 0,
  "ALTER TABLE bill_of_sale ADD COLUMN signature_request_id VARCHAR(120) NULL AFTER updated_at",
  "SELECT 'signature_request_id already exists'"
));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @s = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'bill_of_sale'
       AND column_name = 'signature_status') = 0,
  "ALTER TABLE bill_of_sale ADD COLUMN signature_status ENUM('draft','sent','viewed','signed','declined','expired') NULL AFTER signature_request_id",
  "SELECT 'signature_status already exists'"
));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @s = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'bill_of_sale'
       AND column_name = 'signature_sent_at') = 0,
  "ALTER TABLE bill_of_sale ADD COLUMN signature_sent_at TIMESTAMP NULL AFTER signature_status",
  "SELECT 'signature_sent_at already exists'"
));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @s = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'bill_of_sale'
       AND column_name = 'signed_at') = 0,
  "ALTER TABLE bill_of_sale ADD COLUMN signed_at TIMESTAMP NULL AFTER signature_sent_at",
  "SELECT 'signed_at already exists'"
));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @s = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'bill_of_sale'
       AND column_name = 'signed_pdf_artifact_id') = 0,
  "ALTER TABLE bill_of_sale ADD COLUMN signed_pdf_artifact_id BIGINT UNSIGNED NULL AFTER signed_at",
  "SELECT 'signed_pdf_artifact_id already exists'"
));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

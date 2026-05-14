-- Funding columns on bill_of_sale. Tracks when a closed deal moves from
-- "BoS signed" to "funded" — the step where the buyer has paid us and
-- we've cleared the title work. This is the bridge between Bill of Sale
-- and Dispatch in the post-close pipeline.
--
-- One column per fact (timestamp, amount, who marked it) so we can show
-- the operator who funded what and when without a separate audit table.
-- All nullable; idempotent via information_schema gates.

SET @s = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'bill_of_sale'
       AND column_name = 'funded_at') = 0,
  "ALTER TABLE bill_of_sale ADD COLUMN funded_at TIMESTAMP NULL AFTER signed_pdf_artifact_id",
  "SELECT 'funded_at already exists'"
));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @s = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'bill_of_sale'
       AND column_name = 'funded_amount') = 0,
  "ALTER TABLE bill_of_sale ADD COLUMN funded_amount DECIMAL(12,2) NULL AFTER funded_at",
  "SELECT 'funded_amount already exists'"
));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @s = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'bill_of_sale'
       AND column_name = 'funded_by') = 0,
  "ALTER TABLE bill_of_sale ADD COLUMN funded_by INT NULL AFTER funded_amount",
  "SELECT 'funded_by already exists'"
));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @s = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'bill_of_sale'
       AND column_name = 'funding_notes') = 0,
  "ALTER TABLE bill_of_sale ADD COLUMN funding_notes TEXT NULL AFTER funded_by",
  "SELECT 'funding_notes already exists'"
));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

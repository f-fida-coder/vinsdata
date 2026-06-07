-- Add additional_terms column to bill_of_sale.
--
-- Free-form "Additional Terms and Conditions" the operator types when
-- creating the BoS — appears as a dedicated section in the rendered
-- PDF (between the standard clauses and the signature block). If the
-- operator leaves it blank, the PDF prints "No Additional Terms of
-- Sale" so the section is always visually present.
--
-- Distinct from the existing `other_terms` column, which is tied to
-- the Section 3 "Other" payment type (rendered inline next to the
-- checkbox). additional_terms is independent of payment type and
-- holds general extra clauses ("vehicle sold as-is with X mechanical
-- note", "buyer pays for transport", etc.).
--
-- Idempotent: the existence check skips the ALTER if the column was
-- added in a previous run.

SET @s = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name   = 'bill_of_sale'
       AND column_name  = 'additional_terms') = 0,
  "ALTER TABLE bill_of_sale ADD COLUMN additional_terms TEXT NULL AFTER other_terms",
  "SELECT 'additional_terms already exists on bill_of_sale'"
));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

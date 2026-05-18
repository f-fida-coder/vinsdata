-- Step: Store the OpenSign signed-PDF URL on the BoS row.
-- When the poll endpoint detects a signed document, it copies the
-- SignedUrl from OpenSign onto the local row so the BoS list + drawer
-- can render a "View signed PDF" link without re-querying OpenSign.
-- Keeping it on the row also means the link survives if the operator
-- later rotates OpenSign credentials.

SET @s = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'bill_of_sale'
       AND column_name = 'signed_pdf_url') = 0,
  "ALTER TABLE bill_of_sale ADD COLUMN signed_pdf_url VARCHAR(512) NULL AFTER signed_pdf_artifact_id",
  "SELECT 'signed_pdf_url already exists'"
));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

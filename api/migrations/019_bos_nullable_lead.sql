-- Allow standalone Bill of Sale documents — for walk-in sellers, vehicles
-- already in inventory before they had a CRM lead, or any case where the
-- operator wants to generate a BoS without first creating a fake lead.
--
-- Drops the NOT NULL on imported_lead_id. MySQL allows multiple NULLs in
-- a UNIQUE index (uq_bos_lead), so we don't need to touch that — the
-- "one BoS per lead" constraint still holds for lead-attached rows,
-- and standalone rows can stack freely with NULL.
--
-- Idempotent via information_schema check on column IS_NULLABLE.

SET @s = (SELECT IF(
  (SELECT IS_NULLABLE FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'bill_of_sale'
       AND column_name = 'imported_lead_id') = 'NO',
  "ALTER TABLE bill_of_sale MODIFY imported_lead_id BIGINT UNSIGNED NULL",
  "SELECT 'bill_of_sale.imported_lead_id already nullable'"
));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

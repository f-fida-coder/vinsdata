-- Step 18: vehicles get make / model / year so a list batch is identified
-- by the actual car it's hunting (e.g. "2014 Lexus LFA"), not a free-form
-- name only.
--
-- Idempotent: each ADD COLUMN only runs if absent.

SET @s := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'vehicles' AND column_name = 'make') = 0,
  "ALTER TABLE vehicles ADD COLUMN make VARCHAR(80) NULL AFTER name",
  "SELECT 'vehicles.make already exists'"
));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @s := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'vehicles' AND column_name = 'model') = 0,
  "ALTER TABLE vehicles ADD COLUMN model VARCHAR(80) NULL AFTER make",
  "SELECT 'vehicles.model already exists'"
));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @s := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'vehicles' AND column_name = 'year') = 0,
  "ALTER TABLE vehicles ADD COLUMN year SMALLINT NULL AFTER model",
  "SELECT 'vehicles.year already exists'"
));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

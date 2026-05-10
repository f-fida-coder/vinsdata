-- 012_artifact_bytes.sql
-- Move artifact storage from "filesystem only" to "DB-as-source-of-truth, disk-as-cache."
--
-- Why: dev runs PHP locally (Vite proxy → localhost:8001) but reads from the
-- production MySQL host. That meant uploaded file bytes landed on the dev
-- machine while the corresponding artifact row landed in prod, leaving a row
-- whose `stored_filename` pointed at a file the live server had never seen.
-- Storing the bytes inline removes the second filesystem from the equation:
-- whichever PHP saves the row also saves the bytes, and any other PHP can read
-- them without caring about which disk wrote them.
--
-- MEDIUMBLOB caps at 16 MB; our spreadsheets are <100 KB. The column is
-- nullable so legacy rows whose bytes still live only on disk keep working
-- through the fallback path until backfilled.

SET @col_exists := (
  SELECT COUNT(*)
    FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name = 'file_artifacts'
     AND column_name = 'file_bytes'
);

SET @ddl := IF(@col_exists = 0,
  'ALTER TABLE file_artifacts ADD COLUMN file_bytes MEDIUMBLOB NULL AFTER file_size',
  'SELECT "012_artifact_bytes: file_bytes column already present" AS note'
);

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

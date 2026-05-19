-- Step: indexes that keep the lead pipeline fast at 500K rows.
-- Every list / count / report query filters on the combination of
-- import_status='imported' AND deleted_at IS NULL. The existing indexes
-- (norm_make, norm_state, norm_year, etc.) cover specific filter dropdowns
-- but the optimizer has no covering option for the common base predicate,
-- so a COUNT(*) without a narrowing filter forces a table scan.
--
-- Composite index lets:
--   - COUNT(*) at the top of the list endpoint (api/leads.php) be an
--     index-range scan,
--   - the reports leadsReport() aggregations (api/reports_lib.php) skip
--     archived rows by index lookup,
--   - the soft-delete archive view filter `deleted_at IS NOT NULL` flip
--     direction with the same index.

SET @s = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.statistics
     WHERE table_schema = DATABASE()
       AND table_name = 'imported_leads_raw'
       AND index_name = 'idx_ilr_import_status_deleted_at') = 0,
  "ALTER TABLE imported_leads_raw
     ADD INDEX idx_ilr_import_status_deleted_at (import_status, deleted_at)",
  "SELECT 'idx_ilr_import_status_deleted_at already exists'"
));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Activity log lookup by user (admin sees "who did what" timelines).
-- The existing (imported_lead_id, created_at) index doesn't help when
-- the operator filters by actor instead of lead.
SET @s = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.statistics
     WHERE table_schema = DATABASE()
       AND table_name = 'lead_activities'
       AND index_name = 'idx_la_user_time') = 0,
  "ALTER TABLE lead_activities ADD INDEX idx_la_user_time (user_id, created_at DESC)",
  "SELECT 'idx_la_user_time already exists'"
));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Reverse-lookup label-to-leads (e.g. "show every lead tagged Collector")
-- currently hits idx_lll_label and then probes the row for imported_lead_id.
-- Promote to a covering index so the lookup is index-only.
SET @s = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.statistics
     WHERE table_schema = DATABASE()
       AND table_name = 'lead_label_links'
       AND index_name = 'idx_lll_label_lead') = 0,
  "ALTER TABLE lead_label_links ADD INDEX idx_lll_label_lead (label_id, imported_lead_id)",
  "SELECT 'idx_lll_label_lead already exists'"
));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

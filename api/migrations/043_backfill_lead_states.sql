-- 043_backfill_lead_states.sql
--
-- Every imported_leads_raw row should have exactly one corresponding
-- lead_states row so the standard `WHERE status = 'new'` filter that
-- the leads page (and dashboard counters, and pipeline view) all
-- depend on actually surfaces freshly-imported leads. Two import code
-- paths (api/lead_imports.php and api/lead_manual.php) historically
-- created the imported_leads_raw row but skipped lead_states unless
-- something else triggered an assignment — leaving ghost rows that
-- were invisible to status-based queries.
--
-- This backfills every live (deleted_at IS NULL) successful import
-- that's missing a lead_states row with the schema defaults:
--   status   = 'new'
--   priority = 'medium'
--   assigned_user_id = NULL
--   lead_temperature = NULL  (i.e. unset)
--
-- INSERT IGNORE guards against the lead_states.imported_lead_id UNIQUE
-- constraint so this is safe to re-run if needed. Rows that already
-- have a state (29 with status='new' + 565 no_answer + 521 unassigned
-- no_answer + others — 949 total at the time of writing) are not
-- touched; only ghosts get filled in.

INSERT IGNORE INTO lead_states (imported_lead_id, status, priority)
SELECT r.id, 'new', 'medium'
  FROM imported_leads_raw r
  LEFT JOIN lead_states ls ON ls.imported_lead_id = r.id
 WHERE r.import_status = 'imported'
   AND r.deleted_at   IS NULL
   AND ls.imported_lead_id IS NULL;

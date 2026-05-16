-- Step: Lead-level vehicle overrides on lead_states.
-- Imported vehicle data (color, mileage) lives in
-- imported_leads_raw.normalized_payload_json and is treated as immutable
-- audit-of-source. When the operator learns the real color or an updated
-- odometer reading, they need somewhere to record that without rewriting
-- the import. We add the override columns to lead_states (same place
-- price_wanted / price_offered live) so the existing upsert/activity
-- machinery picks them up for free.
--
-- BoS prefill (api/bos_helpers.php defaultsFromLead) is updated to
-- prefer these overrides before falling back to normalized_payload, so
-- once an operator corrects miles on the lead the BoS draft uses the
-- corrected value.

ALTER TABLE lead_states
  ADD COLUMN vehicle_color    VARCHAR(50)  NULL AFTER price_offered,
  ADD COLUMN vehicle_odometer INT UNSIGNED NULL AFTER vehicle_color;

-- Activity log enum already supports price_*_changed; extend it for
-- the two new fields so the lead timeline shows operator edits.
ALTER TABLE lead_activities
  MODIFY COLUMN activity_type ENUM(
    'status_changed','priority_changed','assigned','unassigned',
    'label_added','label_removed',
    'note_added','note_edited','note_deleted',
    'temperature_changed','price_wanted_changed','price_offered_changed',
    'vehicle_color_changed','vehicle_odometer_changed',
    'task_created','task_updated','task_completed','task_cancelled','task_reopened',
    'contact_logged'
  ) NOT NULL;

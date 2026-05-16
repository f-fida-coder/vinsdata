-- Step: Auto-follow-up flag on labels.
-- When a label with auto_follow_up=1 is attached to a lead, the attach
-- endpoint creates an open 'follow_up' task on that lead. The operator
-- picks the due date at attach time (blank = no due date, just an open
-- task in the queue). Bulk attach uses NULL due_at by default since one
-- shared date rarely fits every lead.
--
-- The first such label is "Collector". Additional labels can carry the
-- same behavior just by flipping the flag — no code change required.

ALTER TABLE lead_labels
  ADD COLUMN auto_follow_up TINYINT(1) NOT NULL DEFAULT 0 AFTER color;

-- Seed the Collector label. Idempotent: INSERT IGNORE on the unique name
-- so re-running the migration is a no-op if the row already exists. If
-- an operator created a "Collector" label manually before this migration
-- shipped, we promote it to auto_follow_up = 1 via the UPDATE below so
-- the rest of the wiring works without a rename.
INSERT IGNORE INTO lead_labels (name, color, auto_follow_up)
  VALUES ('Collector', '#dc2626', 1);

UPDATE lead_labels SET auto_follow_up = 1 WHERE name = 'Collector';

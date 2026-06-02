-- Potential Investor label.
--
-- Companion to the Collector label seeded in migration 020. Same
-- pattern: a lead_labels row with auto_follow_up=1 so attaching it
-- automatically creates an open follow-up task on the lead, and the
-- LeadsPage renders an inline pill next to the lead's name when the
-- label is attached.
--
-- Use case: operator meets a lead who could fund future JV cars
-- (separate from the formal Investors workspace), tags them
-- "Potential Investor", system queues a follow-up so the operator
-- doesn't lose the thread.
--
-- Color #059669 (emerald 600) signals money / opportunity and
-- visually distinguishes it from the red Collector pill in the
-- leads list.

INSERT IGNORE INTO lead_labels (name, color, auto_follow_up)
  VALUES ('Potential Investor', '#059669', 1);

-- If a label already exists with this name (e.g. created manually
-- before this migration), promote it to auto_follow_up=1 and align
-- the color so the rendered pill matches operator expectations.
UPDATE lead_labels
   SET color = '#059669',
       auto_follow_up = 1
 WHERE name = 'Potential Investor';

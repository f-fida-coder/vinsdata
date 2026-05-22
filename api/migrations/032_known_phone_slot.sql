-- Identified / verified phone number per lead.
--
-- Each lead carries up to 4 phone numbers (phone_primary, phone_secondary,
-- Phone Number 3, Phone Number 4) sourced from the imported CSV. Once an
-- operator actually reaches the lead and confirms which number is the
-- "right" one to call, they mark that slot as known here. The list-view
-- phone column then shows a green check next to that number, and outbound
-- calls / SMS preferentially use the marked slot.
--
-- NULL = no number has been verified yet.
--
-- Implemented in:
--   api/lead_state.php  -- PUT accepts known_phone_slot
--   api/leads.php       -- SELECT joins it into crm_state
--   src/pages/LeadsPage.jsx + LeadDetailDrawer.jsx  -- UI

SET @s = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = 'lead_states'
       AND column_name = 'known_phone_slot') = 0,
  "ALTER TABLE lead_states
     ADD COLUMN known_phone_slot
       ENUM('phone_primary','phone_secondary','phone_3','phone_4')
       NULL DEFAULT NULL
     COMMENT 'Which of the 4 phone slots has been confirmed reachable. NULL = unset.'",
  "SELECT 'known_phone_slot already exists'"
));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

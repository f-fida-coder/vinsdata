-- Step 13: VIN Filter rule engine.
--
-- Product spec: "VIN Filter logic — two-pass. Auto-filter first, then manual
-- review. The specific rules should be configurable via a simple admin UI,
-- not hard-coded."
--
-- Model:
--   filter_rules        — admin-defined predicates with an action (reject or flag)
--   filter_rule_results — per-lead-per-rule evaluation outcomes + review state
--
-- The evaluator runs when a lead is promoted from carfax -> filter. Any
-- `reject` match blocks promotion; any `flag_for_review` match promotes the
-- lead but enqueues it in the manual-review queue.

SET @s := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = 'filter_rules') = 0,
  "CREATE TABLE filter_rules (
     id                INT AUTO_INCREMENT PRIMARY KEY,
     name              VARCHAR(150) NOT NULL,
     description       TEXT NULL,
     predicate_json    JSON NOT NULL,
     action            ENUM('reject','flag_for_review') NOT NULL DEFAULT 'flag_for_review',
     active            TINYINT(1) NOT NULL DEFAULT 1,
     created_by        INT NOT NULL,
     created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
     updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
     FOREIGN KEY (created_by) REFERENCES users(id),
     INDEX idx_filter_rules_active (active)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
  "SELECT 'filter_rules table already exists'"
));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @s := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = 'filter_rule_results') = 0,
  "CREATE TABLE filter_rule_results (
     id                BIGINT AUTO_INCREMENT PRIMARY KEY,
     imported_lead_id  BIGINT NOT NULL,
     rule_id           INT NOT NULL,
     result            ENUM('passed','rejected','flagged') NOT NULL,
     review_status     ENUM('pending','accepted','rejected') NULL,
     reviewed_by       INT NULL,
     reviewed_at       TIMESTAMP NULL,
     created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
     FOREIGN KEY (imported_lead_id) REFERENCES imported_leads_raw(id) ON DELETE CASCADE,
     FOREIGN KEY (rule_id)          REFERENCES filter_rules(id),
     FOREIGN KEY (reviewed_by)      REFERENCES users(id),
     INDEX idx_fr_results_pending (review_status, created_at),
     INDEX idx_fr_results_lead    (imported_lead_id, created_at)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
  "SELECT 'filter_rule_results table already exists'"
));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

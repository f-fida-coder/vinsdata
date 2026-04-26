-- Step 15: SLA / stale-lead engine.
--
-- Spec: "Surface leads with no activity in N days (configurable). Dashboard
-- badge + optional email digest."
--
-- Two tables. sla_rules is admin-configured; sla_alerts is append-on-fire,
-- resolved-on-activity. Idempotent — re-running the migration is a no-op.

SET @s := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = 'sla_rules') = 0,
  "CREATE TABLE sla_rules (
     id                          INT AUTO_INCREMENT PRIMARY KEY,
     name                        VARCHAR(150) NOT NULL,
     description                 TEXT NULL,

     -- Predicate: which leads this rule applies to. NULL = any.
     -- Stored as JSON arrays of enum keys (e.g. ['warm','hot']).
     if_temperature_in           JSON NULL,
     if_status_in                JSON NULL,
     if_no_activity_for_days     INT NOT NULL,

     -- Action: who gets notified when the rule fires.
     notify_assignee             TINYINT(1) NOT NULL DEFAULT 1,
     notify_role                 VARCHAR(40) NULL,

     active                      TINYINT(1) NOT NULL DEFAULT 1,
     created_by                  INT NOT NULL,
     created_at                  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
     updated_at                  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

     INDEX idx_sla_rules_active (active),
     CONSTRAINT fk_sla_rules_creator FOREIGN KEY (created_by) REFERENCES users(id)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
  "SELECT 'sla_rules already exists'"
));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @s := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = 'sla_alerts') = 0,
  "CREATE TABLE sla_alerts (
     id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
     rule_id             INT NOT NULL,
     imported_lead_id    BIGINT NOT NULL,
     fired_at            TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
     resolved_at         TIMESTAMP NULL,
     resolved_reason     VARCHAR(80) NULL,

     INDEX idx_sla_alerts_pending  (resolved_at, fired_at),
     INDEX idx_sla_alerts_lead     (imported_lead_id, resolved_at),
     INDEX idx_sla_alerts_rule     (rule_id, resolved_at),

     CONSTRAINT fk_sla_alerts_rule FOREIGN KEY (rule_id)          REFERENCES sla_rules(id)         ON DELETE CASCADE,
     CONSTRAINT fk_sla_alerts_lead FOREIGN KEY (imported_lead_id) REFERENCES imported_leads_raw(id) ON DELETE CASCADE
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
  "SELECT 'sla_alerts already exists'"
));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

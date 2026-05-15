-- Outbound email/SMS job queue. One row per send attempt; the dispatcher
-- in api/outbound_helpers.php drives it. Idempotent: the table already
-- exists on the live DB from an earlier (now-removed) migration, so the
-- information_schema check below makes this a no-op there.

SET @s = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = 'outbound_jobs') = 0,
  "CREATE TABLE outbound_jobs (
     id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
     kind                ENUM('email','sms') NOT NULL,
     provider            VARCHAR(40) NOT NULL DEFAULT 'stub',
     imported_lead_id    BIGINT NULL,
     to_address          VARCHAR(255) NOT NULL,
     subject             VARCHAR(500) NULL,
     body                TEXT NOT NULL,
     status              ENUM('pending','sending','sent','failed','bounced') NOT NULL DEFAULT 'pending',
     provider_message_id VARCHAR(255) NULL,
     fail_reason         VARCHAR(500) NULL,
     attempts            INT NOT NULL DEFAULT 0,
     run_at              TIMESTAMP NULL,
     sent_at             TIMESTAMP NULL,
     created_by          INT NULL,
     created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
     updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
     INDEX idx_outbound_jobs_status_run (status, run_at),
     INDEX idx_outbound_jobs_lead (imported_lead_id, created_at),
     INDEX idx_outbound_jobs_provider_msg (provider, provider_message_id),
     CONSTRAINT fk_outbound_jobs_lead    FOREIGN KEY (imported_lead_id) REFERENCES imported_leads_raw(id) ON DELETE SET NULL,
     CONSTRAINT fk_outbound_jobs_creator FOREIGN KEY (created_by)       REFERENCES users(id)              ON DELETE SET NULL
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
  "SELECT 'outbound_jobs already exists'"
));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Observability for inbound webhooks. Records every POST attempt the
-- moment it arrives, before any signature / payload validation runs.
-- Lets us answer "is OpenPhone actually delivering events?" without
-- needing access to PHP error logs on Hostinger.
--
-- One row per inbound POST. `verified=1` means signature passed;
-- `reject_reason` is set when we bail (bad sig / stale / missing).
-- `body_preview` keeps the first 2000 chars of the raw POST body so
-- we can see the event shape even when the signature failed.

SET @s = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = 'webhook_hits') = 0,
  "CREATE TABLE webhook_hits (
     id BIGINT AUTO_INCREMENT PRIMARY KEY,
     source VARCHAR(40) NOT NULL,
     hit_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
     remote_ip VARCHAR(64) NULL,
     user_agent VARCHAR(255) NULL,
     has_signature TINYINT NOT NULL DEFAULT 0,
     verified TINYINT NOT NULL DEFAULT 0,
     reject_reason VARCHAR(120) NULL,
     event_type VARCHAR(80) NULL,
     http_status INT NULL,
     body_preview VARCHAR(2000) NULL,
     INDEX idx_wh_source_time (source, hit_at DESC)
   )",
  "SELECT 'webhook_hits already exists'"
));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

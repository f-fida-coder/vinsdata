-- app_secrets: admin-settable integration credentials that don't belong
-- in the .env file (because rotating them shouldn't require SSH access
-- to the production box). Used by getEnvValue() as a fallback when the
-- key isn't present in .env or the process environment.
--
-- Stored plaintext; that's fine because a) the DB password itself sits
-- in plaintext .env, so an attacker with file access already wins, and
-- b) it lets us keep a single source of truth and avoid managing keys
-- for keys-management.
--
-- Idempotent via information_schema gate.

SET @s = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = 'app_secrets') = 0,
  "CREATE TABLE app_secrets (
     `key`       VARCHAR(80)  NOT NULL PRIMARY KEY,
     `value`     TEXT NOT NULL,
     updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
     updated_by  INT NULL,
     CONSTRAINT fk_app_secrets_user FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
  "SELECT 'app_secrets already exists'"
));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Rate-limiting state for /api/auth. We track failed login attempts
-- by (ip, email) so a brute-force on one account from one IP gets
-- locked out quickly while legitimate password resets / typo retries
-- across the team don't share a counter.
--
-- Cleanup is rolling: the lookup query only counts attempts within
-- the last 15 minutes. Older rows are dropped opportunistically by
-- the same query path so we don't need a cron.

SET @s = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = 'login_attempts') = 0,
  "CREATE TABLE login_attempts (
     id BIGINT AUTO_INCREMENT PRIMARY KEY,
     ip          VARCHAR(64)  NOT NULL,
     email       VARCHAR(255) NOT NULL,
     success     TINYINT(1)   NOT NULL DEFAULT 0,
     attempted_at TIMESTAMP   DEFAULT CURRENT_TIMESTAMP,
     INDEX idx_la_ip_email_time (ip, email, attempted_at),
     INDEX idx_la_time          (attempted_at)
   )",
  "SELECT 'login_attempts already exists'"
));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

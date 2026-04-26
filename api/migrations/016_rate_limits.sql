-- Step 16: rate-limit event log.
--
-- Sliding-window counter table. Each tracked request inserts one row;
-- enforcement is COUNT(*) over a window. Old rows are deleted by an inline
-- cleanup that runs occasionally (1% chance per check) to keep the table
-- small without needing a separate cron.
--
-- Used initially to throttle:
--   - /api/duplicate_scan (expensive GROUP BY)
--   - /api/marketing_send (bulk dispatch — sender-reputation guard)

SET @s := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = 'rate_limit_events') = 0,
  "CREATE TABLE rate_limit_events (
     id          BIGINT AUTO_INCREMENT PRIMARY KEY,
     scope       VARCHAR(64) NOT NULL,
     user_id     INT NULL,
     created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
     INDEX idx_rl_window (scope, user_id, created_at),
     CONSTRAINT fk_rl_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
  "SELECT 'rate_limit_events already exists'"
));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

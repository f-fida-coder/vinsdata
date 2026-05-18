-- Step: Reminder + Notification Layer (internal only).
-- One table, UNIQUE (user_id, dedupe_key) is the single dedupe mechanism.

CREATE TABLE IF NOT EXISTS notifications (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  user_id         INT NOT NULL,
  type            ENUM('task_overdue','task_due_today','task_due_soon',
                       'task_assigned','task_reopened') NOT NULL,
  title           VARCHAR(255) NOT NULL,
  message         TEXT NULL,
  related_lead_id BIGINT NULL,
  related_task_id INT NULL,
  is_read         TINYINT(1) NOT NULL DEFAULT 0,
  read_at         TIMESTAMP NULL,
  dedupe_key      VARCHAR(255) NOT NULL,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_notif_user FOREIGN KEY (user_id)         REFERENCES users(id)              ON DELETE CASCADE,
  CONSTRAINT fk_notif_lead FOREIGN KEY (related_lead_id) REFERENCES imported_leads_raw(id) ON DELETE CASCADE,
  CONSTRAINT fk_notif_task FOREIGN KEY (related_task_id) REFERENCES lead_tasks(id)         ON DELETE CASCADE,
  UNIQUE KEY uq_notif_user_key (user_id, dedupe_key),
  INDEX idx_notif_user_unread (user_id, is_read, created_at DESC),
  INDEX idx_notif_task        (related_task_id)
);

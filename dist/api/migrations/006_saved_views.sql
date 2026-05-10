-- Step 7: Saved Views table. Per-user filter/sort state for leads + duplicates pages.

CREATE TABLE IF NOT EXISTS saved_views (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  user_id      INT NOT NULL,
  view_type    ENUM('leads','duplicates') NOT NULL,
  name         VARCHAR(128) NOT NULL,
  filters_json JSON NOT NULL,
  sort_json    JSON NULL,
  is_default   TINYINT(1) NOT NULL DEFAULT 0,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_sv_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uq_sv_user_type_name (user_id, view_type, name),
  INDEX idx_sv_user_type (user_id, view_type)
);

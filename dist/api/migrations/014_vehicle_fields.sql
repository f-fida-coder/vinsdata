-- 014_vehicle_fields.sql
-- Promote vehicles from a thin lookup table to a proper hunting profile.
-- The existing columns (id, name, make, model, year, created_at) stay. We
-- only add what's missing. `ADD COLUMN IF NOT EXISTS` keeps the migration
-- idempotent on MariaDB / MySQL 8+ without the prepare/execute dance that
-- the simple statement-splitter migration runner can't handle.

ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS body_type  VARCHAR(80) NULL AFTER year;

ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS `trim`     VARCHAR(80) NULL AFTER body_type;

ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS notes      TEXT NULL AFTER `trim`;

ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS is_active  TINYINT(1) NOT NULL DEFAULT 1 AFTER notes;

ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at;

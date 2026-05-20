-- Admin-toggleable feature flags. Stored separately from app_secrets
-- because the values aren't secret (just on/off + a label + a
-- description) and we want them queryable + listable without
-- co-mingling with API keys.
--
-- Each row is one named flag. The frontend fetches all rows via
-- /api/feature_flags on app load + when an admin toggles one in
-- Company Settings; components that gate behavior read from a
-- React context populated from that fetch.

SET @s = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = 'feature_flags') = 0,
  "CREATE TABLE feature_flags (
     `key` VARCHAR(80) PRIMARY KEY,
     enabled TINYINT(1) NOT NULL DEFAULT 0,
     label VARCHAR(200) NOT NULL,
     description TEXT NULL,
     updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
     updated_by INT NULL,
     CONSTRAINT fk_ff_user FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
   )",
  "SELECT 'feature_flags already exists'"
));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Seed known flags. INSERT IGNORE so re-running the migration is a
-- no-op even after the admin has toggled a flag from the UI.
INSERT IGNORE INTO feature_flags (`key`, enabled, label, description) VALUES
  ('RINGING_CALLS', 0,
   'Inbound-call popup',
   'Slide-in toast when an OpenPhone call rings. Requires the carrier to have approved the OpenPhone webhook — leave off until that''s confirmed.'),
  ('TRANSPORT_SMS', 0,
   'Send SMS to transporters',
   'When ON, the Notify Transporters modal''s SMS option dispatches via OpenPhone. Leave OFF if your team prefers email-only transporter outreach.'),
  ('LEAD_AUTO_TIER', 1,
   'Auto-tier on import',
   'Apply Tier 1/2/3 classification to newly imported leads based on Age + NumberOfOwners. Operators can still override per lead. Defaults ON.');

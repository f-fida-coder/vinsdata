-- Step: incoming-call notification surface.
--
-- A webhook receiver records every "ring" event from the team's VoIP
-- provider (OpenPhone is what's wired today; the schema is provider-
-- agnostic). The leads page polls a small endpoint that returns any
-- ringing events from the last ~60s with their resolved lead so the
-- agent gets a CRM popup the moment their phone lights up.
--
-- Only ringing/answered/missed terminal states are interesting — we
-- don't try to capture full call duration here. Call detail records
-- can live in a separate report if we ever need them.

SET @s = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = 'inbound_calls') = 0,
  "CREATE TABLE inbound_calls (
     id BIGINT AUTO_INCREMENT PRIMARY KEY,
     provider VARCHAR(40) NOT NULL DEFAULT 'openphone',
     provider_event_id VARCHAR(255) NULL,
     provider_call_id  VARCHAR(255) NULL,
     from_number VARCHAR(40) NOT NULL,
     to_number   VARCHAR(40) NULL,
     status ENUM('ringing','answered','missed','completed','voicemail') NOT NULL DEFAULT 'ringing',
     matched_lead_id BIGINT NULL,
     matched_lead_name VARCHAR(200) NULL,
     matched_user_id INT NULL,
     ringing_at TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
     ended_at   TIMESTAMP NULL,
     duration_sec INT NULL,
     raw_payload_json JSON NULL,
     ack_user_id INT NULL,
     ack_at TIMESTAMP NULL,
     created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
     updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
     INDEX idx_ic_status_time (status, ringing_at DESC),
     INDEX idx_ic_from_time   (from_number, ringing_at DESC),
     INDEX idx_ic_provider_event (provider, provider_event_id),
     INDEX idx_ic_user_time   (matched_user_id, ringing_at DESC),
     CONSTRAINT fk_ic_lead FOREIGN KEY (matched_lead_id) REFERENCES imported_leads_raw(id) ON DELETE SET NULL,
     CONSTRAINT fk_ic_user FOREIGN KEY (matched_user_id) REFERENCES users(id) ON DELETE SET NULL,
     CONSTRAINT fk_ic_ack  FOREIGN KEY (ack_user_id)     REFERENCES users(id) ON DELETE SET NULL
   )",
  "SELECT 'inbound_calls already exists'"
));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

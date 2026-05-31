-- Inbound message support on transport_notifications.
--
-- Before this migration, transport_notifications was outbound-only:
-- every row represented a message WE sent to a transporter. The
-- OpenPhone webhook's handleInboundMessage path silently dropped
-- replies from transporter phones because it could only match
-- senders to leads, not transporters.
--
-- After this migration:
--   - direction = 'outbound'  → existing rows + future operator-sent
--                                texts/emails to transporters
--   - direction = 'inbound'   → transporter SMS replies the webhook
--                                catches by matching the sender phone
--                                against transporters.phone
--
-- The dispatch event panel's "Activity log" then renders both
-- directions in one chronological feed so the operator sees a
-- proper two-way conversation.

SET @s := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name   = 'transport_notifications'
       AND column_name  = 'direction') = 0,
  "ALTER TABLE transport_notifications
     ADD COLUMN direction ENUM('outbound','inbound') NOT NULL DEFAULT 'outbound' AFTER channel,
     ADD INDEX idx_tn_direction (direction)",
  "SELECT 'transport_notifications.direction already exists'"
));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Backfill is a no-op because the column default is 'outbound' and
-- every existing row was an outbound send. No data migration needed.

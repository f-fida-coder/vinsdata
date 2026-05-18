-- 013_dispatch.sql
-- Dispatch dashboard, transport assignments, transporters, bill of sale records.
--
-- Tables:
--   transporters             — master list of carriers/transporters
--   lead_transport           — 1:1 with imported_leads_raw; transport schedule + status
--   transport_notifications  — audit log of every notify-transporter message
--   bill_of_sale             — saved Bill of Sale records per lead
--   company_settings         — single-row table for seller/company info on the BoS PDF

CREATE TABLE IF NOT EXISTS transporters (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(255) NOT NULL,
  phone       VARCHAR(50)  NULL,
  email       VARCHAR(255) NULL,
  notes       TEXT NULL,
  is_active   TINYINT(1) NOT NULL DEFAULT 1,
  created_by  BIGINT UNSIGNED NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_transporters_active (is_active, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS lead_transport (
  id                       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  imported_lead_id         BIGINT UNSIGNED NOT NULL,
  transport_date           DATE NULL,
  transport_time           TIME NULL,
  time_window              VARCHAR(100) NULL,
  pickup_location          TEXT NULL,
  delivery_location        TEXT NULL,
  vehicle_info             TEXT NULL,
  status                   ENUM('new','notified','assigned','in_transit','delivered','cancelled') NOT NULL DEFAULT 'new',
  assigned_transporter_id  BIGINT UNSIGNED NULL,
  notes                    TEXT NULL,
  created_by               BIGINT UNSIGNED NULL,
  created_at               TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at               TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_lead_transport_lead (imported_lead_id),
  INDEX idx_lt_date_status (transport_date, status),
  INDEX idx_lt_transporter (assigned_transporter_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS transport_notifications (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  transport_id   BIGINT UNSIGNED NOT NULL,
  transporter_id BIGINT UNSIGNED NULL,
  channel        ENUM('email','sms','manual') NOT NULL,
  recipient      VARCHAR(255) NULL,
  subject        VARCHAR(255) NULL,
  body           TEXT NULL,
  sent_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_by        BIGINT UNSIGNED NULL,
  status         ENUM('sent','failed') NOT NULL DEFAULT 'sent',
  error_message  TEXT NULL,
  INDEX idx_tn_transport (transport_id, sent_at),
  INDEX idx_tn_transporter (transporter_id, sent_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bill_of_sale (
  id                       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  imported_lead_id         BIGINT UNSIGNED NOT NULL,
  sale_county              VARCHAR(100) NULL,
  sale_state               VARCHAR(100) NULL,
  sale_date                DATE NULL,
  buyer_name               VARCHAR(255) NULL,
  buyer_address            TEXT NULL,
  seller_name              VARCHAR(255) NULL,
  seller_address           TEXT NULL,
  vehicle_make             VARCHAR(100) NULL,
  vehicle_model            VARCHAR(100) NULL,
  vehicle_body_type        VARCHAR(100) NULL,
  vehicle_year             VARCHAR(10)  NULL,
  vehicle_color            VARCHAR(50)  NULL,
  vehicle_odometer         VARCHAR(50)  NULL,
  vehicle_vin              VARCHAR(50)  NULL,
  payment_type             ENUM('cash','trade','gift','other') NOT NULL DEFAULT 'cash',
  payment_amount           DECIMAL(12,2) NULL,
  trade_amount             DECIMAL(12,2) NULL,
  trade_make               VARCHAR(100) NULL,
  trade_model              VARCHAR(100) NULL,
  trade_body_type          VARCHAR(100) NULL,
  trade_year               VARCHAR(10)  NULL,
  trade_color              VARCHAR(50)  NULL,
  trade_odometer           VARCHAR(50)  NULL,
  gift_value               DECIMAL(12,2) NULL,
  other_terms              TEXT NULL,
  taxes_paid_by            ENUM('buyer','seller') NOT NULL DEFAULT 'buyer',
  odometer_accurate        TINYINT(1) NOT NULL DEFAULT 1,
  odometer_exceeds_limits  TINYINT(1) NOT NULL DEFAULT 0,
  odometer_not_actual      TINYINT(1) NOT NULL DEFAULT 0,
  created_by               BIGINT UNSIGNED NULL,
  created_at               TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at               TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_bos_lead (imported_lead_id),
  INDEX idx_bos_sale_date (sale_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS company_settings (
  id              TINYINT UNSIGNED NOT NULL PRIMARY KEY DEFAULT 1,
  company_name    VARCHAR(255) NULL,
  company_address TEXT NULL,
  company_phone   VARCHAR(50)  NULL,
  company_email   VARCHAR(255) NULL,
  default_state   VARCHAR(100) NULL,
  default_county  VARCHAR(100) NULL,
  updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT chk_company_settings_singleton CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO company_settings (id, company_name) VALUES (1, NULL);

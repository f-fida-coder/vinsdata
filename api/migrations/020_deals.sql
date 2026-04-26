-- Step 20: Deals — acquisition + resale tracking on a per-lead basis.
--
-- Per product feedback: "for closed deals have tab and allow the user to
-- input purchase price, transport, selling fees, and other; purchase date,
-- Days on Market, and sell date."
--
-- Model: one Deal per imported lead (1:1 via UNIQUE imported_lead_id).
-- Both acquisition fields (purchase_price + transport + selling_fees + other,
-- purchase_date) and resale fields (listed_date, sold_date, sale_price,
-- buyer_name) are tracked on the same row so the lifecycle is one record.
--
-- Days on Market is computed in the app — typically sold_date - listed_date,
-- falling back to sold_date - purchase_date if the lead was acquired and
-- sold without going through a separate listing date.
--
-- Idempotent: only creates the table if absent.

SET @s := (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = 'deals') = 0,
  "CREATE TABLE deals (
     id                BIGINT AUTO_INCREMENT PRIMARY KEY,
     imported_lead_id  BIGINT NOT NULL,

     -- Acquisition costs (per the spec)
     purchase_price    DECIMAL(12,2) NULL,
     transport_cost    DECIMAL(12,2) NULL,
     selling_fees      DECIMAL(12,2) NULL,
     other_cost        DECIMAL(12,2) NULL,
     purchase_date     DATE NULL,

     -- Resale tracking
     listed_date       DATE NULL,
     sold_date         DATE NULL,
     sale_price        DECIMAL(12,2) NULL,
     buyer_name        VARCHAR(255) NULL,
     buyer_notes       TEXT NULL,

     notes             TEXT NULL,
     created_by        INT NULL,
     created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
     updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

     UNIQUE KEY uniq_deals_lead (imported_lead_id),
     INDEX idx_deals_purchase_date (purchase_date),
     INDEX idx_deals_sold_date     (sold_date),

     CONSTRAINT fk_deals_lead     FOREIGN KEY (imported_lead_id) REFERENCES imported_leads_raw(id) ON DELETE CASCADE,
     CONSTRAINT fk_deals_creator  FOREIGN KEY (created_by)       REFERENCES users(id)              ON DELETE SET NULL
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4",
  "SELECT 'deals already exists'"
));
PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;

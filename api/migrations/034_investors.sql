-- Investor records + investor-to-car linkage.
--
-- Investors fund the acquisition of specific cars. One investor can
-- back multiple cars; one car can have multiple investors (joint
-- venture). We track investment amount + profit-share % per linkage,
-- plus the JV-agreement state machine (draft → sent → signed) and
-- the OpenSign document id once a signature request is issued.
--
-- Access: admin role only (enforced in api/investors.php +
-- api/investor_leads.php).

CREATE TABLE IF NOT EXISTS investors (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  name            VARCHAR(160) NOT NULL,
  email           VARCHAR(255) NULL,
  phone           VARCHAR(40)  NULL,
  entity_name     VARCHAR(200) NULL COMMENT 'LLC / Inc. for the JV signature block',
  address         TEXT         NULL,
  notes           TEXT         NULL,
  created_by      INT          NOT NULL,
  created_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  archived_at     TIMESTAMP    NULL DEFAULT NULL COMMENT 'Soft-delete; hidden from list when set',
  CONSTRAINT fk_investor_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  INDEX idx_inv_name        (name),
  INDEX idx_inv_email       (email),
  INDEX idx_inv_archived    (archived_at)
);

CREATE TABLE IF NOT EXISTS investor_leads (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  investor_id         INT          NOT NULL,
  imported_lead_id    BIGINT       NOT NULL,
  investment_amount   DECIMAL(10,2) NULL  COMMENT 'Investor capital contribution for this car',
  share_pct           DECIMAL(5,2)  NULL  COMMENT 'Investor share of profit, 0-100',
  notes               TEXT         NULL,
  -- JV agreement state machine
  jv_status           ENUM('draft','sent','signed','cancelled') NOT NULL DEFAULT 'draft',
  jv_sent_at          TIMESTAMP    NULL DEFAULT NULL,
  jv_signed_at        TIMESTAMP    NULL DEFAULT NULL,
  jv_opensign_doc_id  VARCHAR(120) NULL DEFAULT NULL COMMENT 'OpenSign Document.objectId for polling + linkback',
  jv_pdf_path         VARCHAR(500) NULL DEFAULT NULL,
  created_by          INT          NOT NULL,
  created_at          TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP    DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_il_investor FOREIGN KEY (investor_id)      REFERENCES investors(id)            ON DELETE CASCADE,
  CONSTRAINT fk_il_lead     FOREIGN KEY (imported_lead_id) REFERENCES imported_leads_raw(id)  ON DELETE CASCADE,
  CONSTRAINT fk_il_creator  FOREIGN KEY (created_by)       REFERENCES users(id)                ON DELETE RESTRICT,
  -- One investor can only be linked to a given car once.
  UNIQUE KEY uniq_investor_lead (investor_id, imported_lead_id),
  INDEX idx_il_lead       (imported_lead_id),
  INDEX idx_il_jv_status  (jv_status)
);

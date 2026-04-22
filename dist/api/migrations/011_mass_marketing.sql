-- Step: Mass Marketing (Phase 1)
-- Adds email/SMS/WhatsApp campaign scaffolding. All additive.

CREATE TABLE IF NOT EXISTS marketing_templates (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  name            VARCHAR(128) NOT NULL,
  channel         ENUM('email','sms','whatsapp') NOT NULL,
  subject         VARCHAR(255) NULL,
  body            TEXT NOT NULL,
  variables_json  JSON NULL,
  is_active       TINYINT(1) NOT NULL DEFAULT 1,
  created_by      INT NULL,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_mt_creator FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE KEY uq_mt_channel_name (channel, name),
  INDEX idx_mt_channel_active (channel, is_active)
);

CREATE TABLE IF NOT EXISTS marketing_campaigns (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  name              VARCHAR(200) NOT NULL,
  channel           ENUM('email','sms','whatsapp') NOT NULL,
  template_id       INT NULL,
  subject_snapshot  VARCHAR(255) NULL,
  body_snapshot     TEXT NOT NULL,
  sender_identity   VARCHAR(255) NULL,
  segment_json      JSON NULL,
  status            ENUM('draft','queued','sending','sent','partially_failed','cancelled') NOT NULL DEFAULT 'draft',
  stats_json        JSON NULL,
  scheduled_at      DATETIME NULL,
  started_at        TIMESTAMP NULL,
  completed_at      TIMESTAMP NULL,
  created_by        INT NOT NULL,
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_mc_template FOREIGN KEY (template_id) REFERENCES marketing_templates(id) ON DELETE SET NULL,
  CONSTRAINT fk_mc_creator  FOREIGN KEY (created_by)  REFERENCES users(id),
  INDEX idx_mc_status_scheduled (status, scheduled_at),
  INDEX idx_mc_creator (created_by)
);

CREATE TABLE IF NOT EXISTS marketing_campaign_recipients (
  id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
  campaign_id         INT NOT NULL,
  imported_lead_id    BIGINT NOT NULL,
  resolved_to         VARCHAR(320) NOT NULL,
  rendered_subject    VARCHAR(255) NULL,
  rendered_body       TEXT NULL,
  send_status         ENUM('pending','sending','sent','failed','skipped','bounced','opted_out') NOT NULL DEFAULT 'pending',
  provider_message_id VARCHAR(128) NULL,
  fail_reason         VARCHAR(255) NULL,
  sent_at             TIMESTAMP NULL,
  opened_at           TIMESTAMP NULL,
  clicked_at          TIMESTAMP NULL,
  replied_at          TIMESTAMP NULL,
  created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_mcr_campaign FOREIGN KEY (campaign_id)      REFERENCES marketing_campaigns(id) ON DELETE CASCADE,
  CONSTRAINT fk_mcr_lead     FOREIGN KEY (imported_lead_id) REFERENCES imported_leads_raw(id) ON DELETE CASCADE,
  UNIQUE KEY uq_mcr_campaign_lead (campaign_id, imported_lead_id),
  INDEX idx_mcr_campaign_status (campaign_id, send_status),
  INDEX idx_mcr_lead (imported_lead_id),
  INDEX idx_mcr_provider_msg (provider_message_id)
);

CREATE TABLE IF NOT EXISTS marketing_suppressions (
  id                 INT AUTO_INCREMENT PRIMARY KEY,
  identifier_type    ENUM('email','phone') NOT NULL,
  identifier         VARCHAR(320) NOT NULL,
  reason             ENUM('unsubscribe','bounce','complaint','manual_dnc','legal') NOT NULL,
  source_campaign_id INT NULL,
  source_lead_id     BIGINT NULL,
  created_by         INT NULL,
  notes              TEXT NULL,
  created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ms_campaign FOREIGN KEY (source_campaign_id) REFERENCES marketing_campaigns(id) ON DELETE SET NULL,
  CONSTRAINT fk_ms_lead     FOREIGN KEY (source_lead_id)     REFERENCES imported_leads_raw(id) ON DELETE SET NULL,
  CONSTRAINT fk_ms_user     FOREIGN KEY (created_by)         REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE KEY uq_ms_identifier (identifier_type, identifier),
  INDEX idx_ms_reason (reason)
);

-- Extend lead status with `marketing`.
ALTER TABLE lead_states
  MODIFY COLUMN status ENUM(
    'new','contacted','callback','interested','not_interested',
    'wrong_number','no_answer','voicemail_left','deal_closed',
    'nurture','disqualified','do_not_call',
    'marketing'
  ) NOT NULL DEFAULT 'new';

-- Extend activity timeline with marketing events.
ALTER TABLE lead_activities
  MODIFY COLUMN activity_type ENUM(
    'status_changed','priority_changed','assigned','unassigned',
    'label_added','label_removed',
    'note_added','note_edited','note_deleted',
    'temperature_changed','price_wanted_changed','price_offered_changed',
    'task_created','task_updated','task_completed','task_cancelled','task_reopened',
    'contact_logged',
    'merge_prep_updated',
    'moved_to_marketing','campaign_sent','campaign_opened','campaign_clicked',
    'campaign_replied','campaign_bounced','opted_out'
  ) NOT NULL;

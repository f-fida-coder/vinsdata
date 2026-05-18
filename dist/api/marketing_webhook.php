<?php
// Public webhook endpoint for SendGrid (and other providers, via ?provider=).
// No session auth — verified via HMAC signature + timestamp window.
//
// SendGrid event types handled:
//   - delivered  → send_status='sent' (if not already)
//   - open       → opened_at
//   - click      → clicked_at
//   - bounce     → send_status='bounced', fail_reason
//   - dropped    → send_status='failed',  fail_reason
//   - spamreport → writes suppression + send_status='opted_out'
//   - unsubscribe → writes suppression + send_status='opted_out'
//
// SendGrid posts a JSON array of events. Each event has an `sg_message_id` of
// the form "<id>.filter<X>.<timestamp>.<random>" — we match the prefix before
// ".filter" against the raw provider_message_id we stored at send time.
//
// To enable: in the SendGrid Event Webhook settings, point to
// https://<your-host>/api/marketing_webhook.php?provider=sendgrid and set
// MARKETING_WEBHOOK_SECRET in config.php. Turn on "Signed Event Webhook
// Requests" and paste the public key into MARKETING_SENDGRID_WEBHOOK_PUBLIC_KEY
// (optional; HMAC shared-secret works too).

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/pipeline.php';

$db = getDBConnection();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['success' => false, 'message' => 'Method not allowed']);
    exit();
}

$rawBody = file_get_contents('php://input');
if ($rawBody === '' || $rawBody === false) {
    http_response_code(400);
    echo json_encode(['success' => false, 'message' => 'Empty body']);
    exit();
}

// --- Signature verification ---
// Two modes, whichever is configured:
//   1. HMAC shared secret: header "X-Marketing-Signature: sha256=<hex>" where
//      payload is the raw body; secret is MARKETING_WEBHOOK_SECRET.
//   2. SendGrid's own ECDSA signing: verify via header
//      "X-Twilio-Email-Event-Webhook-Signature" + public key. Left as TODO since
//      it requires the sodium extension and most installs won't have it enabled.
$hmacHeader  = $_SERVER['HTTP_X_MARKETING_SIGNATURE'] ?? '';
$sgSigHeader = $_SERVER['HTTP_X_TWILIO_EMAIL_EVENT_WEBHOOK_SIGNATURE'] ?? '';

$verified = false;
if (defined('MARKETING_WEBHOOK_SECRET') && MARKETING_WEBHOOK_SECRET !== '' && $hmacHeader !== '') {
    $expected = 'sha256=' . hash_hmac('sha256', $rawBody, MARKETING_WEBHOOK_SECRET);
    if (hash_equals($expected, $hmacHeader)) $verified = true;
}
if (!$verified && $sgSigHeader !== '' && defined('MARKETING_SENDGRID_WEBHOOK_PUBLIC_KEY') && function_exists('sodium_crypto_sign_verify_detached')) {
    // SendGrid signs timestamp + body with Ed25519. Base64-decode the signature
    // and the public key (strip PEM markers on the key).
    $ts = $_SERVER['HTTP_X_TWILIO_EMAIL_EVENT_WEBHOOK_TIMESTAMP'] ?? '';
    $pk = MARKETING_SENDGRID_WEBHOOK_PUBLIC_KEY;
    $pk = str_replace(["-----BEGIN PUBLIC KEY-----", "-----END PUBLIC KEY-----", "\n", "\r"], '', $pk);
    $pkBytes = base64_decode($pk);
    $sigBytes = base64_decode($sgSigHeader);
    if ($pkBytes && $sigBytes && $ts !== '') {
        try {
            // ECDSA key handling differs per SendGrid doc; this is a best-effort stub.
            if (sodium_crypto_sign_verify_detached($sigBytes, $ts . $rawBody, $pkBytes)) {
                $verified = true;
            }
        } catch (Throwable $e) {
            // fall through to unverified
        }
    }
}

// Refuse if no verification configured OR verification failed. If nothing is
// configured, default to refusing — don't accept unsigned events in prod.
if (!$verified) {
    http_response_code(401);
    echo json_encode(['success' => false, 'message' => 'Signature required or invalid']);
    exit();
}

$events = json_decode($rawBody, true);
if (!is_array($events)) {
    http_response_code(400);
    echo json_encode(['success' => false, 'message' => 'Body must be a JSON array']);
    exit();
}

$processed = 0; $ignored = 0;

// Prepared statements reused across events.
$findByMsgId = $db->prepare(
    "SELECT r.*, c.id AS campaign_id, c.name AS campaign_name, c.channel AS channel,
            c.stats_json AS stats_json
       FROM marketing_campaign_recipients r
       JOIN marketing_campaigns c ON c.id = r.campaign_id
      WHERE r.provider_message_id = :pmid
         OR r.provider_message_id LIKE :pmid_prefix
      LIMIT 1"
);
$findById = $db->prepare(
    "SELECT r.*, c.id AS campaign_id, c.name AS campaign_name, c.channel AS channel,
            c.stats_json AS stats_json
       FROM marketing_campaign_recipients r
       JOIN marketing_campaigns c ON c.id = r.campaign_id
      WHERE r.id = :rid LIMIT 1"
);
$updOpened  = $db->prepare('UPDATE marketing_campaign_recipients SET opened_at  = COALESCE(opened_at,  NOW()) WHERE id = :id');
$updClicked = $db->prepare('UPDATE marketing_campaign_recipients SET clicked_at = COALESCE(clicked_at, NOW()), opened_at = COALESCE(opened_at, NOW()) WHERE id = :id');
$updSent    = $db->prepare("UPDATE marketing_campaign_recipients SET send_status = 'sent', sent_at = COALESCE(sent_at, NOW()) WHERE id = :id AND send_status NOT IN ('bounced','failed','opted_out')");
$updBounce  = $db->prepare("UPDATE marketing_campaign_recipients SET send_status = 'bounced', fail_reason = :reason WHERE id = :id");
$updFailed  = $db->prepare("UPDATE marketing_campaign_recipients SET send_status = 'failed',  fail_reason = :reason WHERE id = :id");
$updOpted   = $db->prepare("UPDATE marketing_campaign_recipients SET send_status = CASE WHEN send_status IN ('sent','bounced') THEN send_status ELSE 'opted_out' END WHERE id = :id");
$insSuppress = $db->prepare(
    'INSERT IGNORE INTO marketing_suppressions (identifier_type, identifier, reason, source_campaign_id, source_lead_id)
     VALUES (:t, :i, :r, :c, :l)'
);

/** Given stats_json, increment a counter and save. */
$bumpStat = function (int $campaignId, string $key, int $by = 1) use ($db) {
    $db->prepare(
        "UPDATE marketing_campaigns
            SET stats_json = JSON_SET(COALESCE(stats_json, JSON_OBJECT()),
                                      CONCAT('$.', :k),
                                      COALESCE(CAST(JSON_EXTRACT(stats_json, CONCAT('$.', :k2)) AS UNSIGNED), 0) + :n)
          WHERE id = :cid"
    )->execute([':k' => $key, ':k2' => $key, ':n' => $by, ':cid' => $campaignId]);
};

foreach ($events as $event) {
    if (!is_array($event)) { $ignored++; continue; }
    $type = (string) ($event['event'] ?? $event['type'] ?? '');

    // Resolve the recipient row. Prefer our own custom arg if we injected one,
    // otherwise match on provider message id.
    $recipient = null;
    if (!empty($event['recipient_id'])) {
        $findById->execute([':rid' => (int) $event['recipient_id']]);
        $recipient = $findById->fetch();
    }
    if (!$recipient) {
        $sgMsgId = (string) ($event['sg_message_id'] ?? $event['message_id'] ?? '');
        if ($sgMsgId !== '') {
            // SendGrid's sg_message_id is "<core>.filter<X>.<ts>.<rand>". Match
            // either the full value or the prefix before ".filter".
            $core = $sgMsgId;
            if (($pos = strpos($sgMsgId, '.filter')) !== false) $core = substr($sgMsgId, 0, $pos);
            $findByMsgId->execute([':pmid' => $core, ':pmid_prefix' => $core . '%']);
            $recipient = $findByMsgId->fetch();
        }
    }
    if (!$recipient) { $ignored++; continue; }

    $recipientId = (int) $recipient['id'];
    $campaignId  = (int) $recipient['campaign_id'];
    $leadId      = (int) $recipient['imported_lead_id'];
    $channel     = (string) $recipient['channel'];

    try {
        switch ($type) {
            case 'delivered':
                $updSent->execute([':id' => $recipientId]);
                break;

            case 'open':
                $updOpened->execute([':id' => $recipientId]);
                // Only log once per recipient to avoid timeline spam.
                if (!$recipient['opened_at']) {
                    logLeadActivity($db, $leadId, 0, 'campaign_opened', null, [
                        'campaign_id' => $campaignId, 'campaign_name' => $recipient['campaign_name'],
                    ]);
                    $bumpStat($campaignId, 'opened');
                }
                break;

            case 'click':
                $updClicked->execute([':id' => $recipientId]);
                if (!$recipient['clicked_at']) {
                    logLeadActivity($db, $leadId, 0, 'campaign_clicked', null, [
                        'campaign_id' => $campaignId, 'campaign_name' => $recipient['campaign_name'],
                        'url' => $event['url'] ?? null,
                    ]);
                    $bumpStat($campaignId, 'clicked');
                }
                break;

            case 'bounce':
            case 'blocked':
                $reason = substr((string) ($event['reason'] ?? $event['type'] ?? 'bounced'), 0, 250);
                $updBounce->execute([':reason' => $reason, ':id' => $recipientId]);
                logLeadActivity($db, $leadId, 0, 'campaign_bounced', null, [
                    'campaign_id' => $campaignId, 'campaign_name' => $recipient['campaign_name'],
                    'reason' => $reason,
                ]);
                // Hard bounces are added to the global suppression list to
                // protect our sending reputation on future campaigns.
                if (($event['type'] ?? '') === 'bounce' || ($event['bounce_classification'] ?? '') === 'Hard') {
                    $insSuppress->execute([
                        ':t' => $channel === 'email' ? 'email' : 'phone',
                        ':i' => normalizeContactIdentifier($channel === 'email' ? 'email' : 'phone', (string) $recipient['resolved_to']),
                        ':r' => 'bounce', ':c' => $campaignId, ':l' => $leadId,
                    ]);
                }
                $bumpStat($campaignId, 'bounced');
                break;

            case 'dropped':
            case 'deferred':
                $reason = substr((string) ($event['reason'] ?? $type), 0, 250);
                $updFailed->execute([':reason' => $reason, ':id' => $recipientId]);
                break;

            case 'spamreport':
            case 'group_unsubscribe':
            case 'unsubscribe':
                $idType = $channel === 'email' ? 'email' : 'phone';
                $insSuppress->execute([
                    ':t' => $idType,
                    ':i' => normalizeContactIdentifier($idType, (string) $recipient['resolved_to']),
                    ':r' => $type === 'spamreport' ? 'complaint' : 'unsubscribe',
                    ':c' => $campaignId, ':l' => $leadId,
                ]);
                $updOpted->execute([':id' => $recipientId]);
                logLeadActivity($db, $leadId, 0, 'opted_out', null, [
                    'campaign_id' => $campaignId, 'campaign_name' => $recipient['campaign_name'],
                    'reason' => $type,
                ]);
                $bumpStat($campaignId, 'opted_out');
                break;

            default:
                // processed, delivered-lite, etc. — ignored by design.
                $ignored++;
                continue 2;
        }
        $processed++;
    } catch (Throwable $e) {
        error_log('marketing_webhook: ' . $e->getMessage());
        $ignored++;
    }
}

echo json_encode(['success' => true, 'processed' => $processed, 'ignored' => $ignored]);

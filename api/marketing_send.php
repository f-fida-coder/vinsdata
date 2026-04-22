<?php
// Executes the pending recipients of a campaign.
//
// Phase-1 behavior: provider-agnostic dispatcher. There are two modes:
//
//   1. "stub"   — default when no provider is configured. Marks each pending
//                 recipient as sent (with a synthetic provider_message_id)
//                 and writes lead activities / contact logs as if it were
//                 real. Lets the whole workflow be clicked end-to-end while
//                 the user decides on a real provider.
//
//   2. "sendgrid" — set MARKETING_EMAIL_PROVIDER=sendgrid + SENDGRID_API_KEY
//                   + MARKETING_EMAIL_FROM in config.php (see comments below).
//                   Email channel only. SMS/WhatsApp still run in stub mode
//                   until phase 3/4 adds their providers.
//
// This endpoint is synchronous and capped by CAMPAIGN_RECIPIENT_CAP (500) in
// marketing_campaigns.php so it can't time out on a typical PHP request.

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/pipeline.php';
initSession();

$user = requireAuth();
$db   = getDBConnection();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    pipelineFail(405, 'Method not allowed', 'method_not_allowed');
}
assertAdminOrMarketer($user);

$input = json_decode(file_get_contents('php://input'), true) ?? [];
$campaignId = (int) ($input['campaign_id'] ?? 0);
if ($campaignId <= 0) pipelineFail(400, 'campaign_id is required', 'missing_fields');

$stmt = $db->prepare('SELECT * FROM marketing_campaigns WHERE id = :id');
$stmt->execute([':id' => $campaignId]);
$campaign = $stmt->fetch();
if (!$campaign) pipelineFail(404, 'Campaign not found', 'campaign_not_found');
if (!in_array($campaign['status'], ['draft','queued','partially_failed'], true)) {
    pipelineFail(409, "Campaign is '{$campaign['status']}' and cannot be sent", 'invalid_state');
}

// Pick provider. Reads constants from config.php if set.
$provider = defined('MARKETING_EMAIL_PROVIDER') ? MARKETING_EMAIL_PROVIDER : 'stub';
if ($campaign['channel'] !== 'email') {
    // SMS / WhatsApp run as stub in Phase 1; flag so the UI can show "simulated".
    $provider = 'stub';
}

// Flip status → sending so concurrent callers can't double-send.
$db->prepare("UPDATE marketing_campaigns SET status = 'sending', started_at = COALESCE(started_at, NOW()) WHERE id = :id")
    ->execute([':id' => $campaignId]);

$recipStmt = $db->prepare(
    "SELECT * FROM marketing_campaign_recipients
      WHERE campaign_id = :c AND send_status = 'pending'
      ORDER BY id ASC"
);
$recipStmt->execute([':c' => $campaignId]);
$pending = $recipStmt->fetchAll();

$markSent   = $db->prepare(
    "UPDATE marketing_campaign_recipients
        SET send_status = 'sent', provider_message_id = :pmid, sent_at = NOW()
      WHERE id = :id"
);
$markFailed = $db->prepare(
    "UPDATE marketing_campaign_recipients
        SET send_status = 'failed', fail_reason = :reason
      WHERE id = :id"
);

$sent = 0; $failed = 0; $failures = [];

foreach ($pending as $r) {
    try {
        // Render unsubscribe URL now that we know the recipient id.
        $token = signUnsubscribeToken($campaignId, (int) $r['id']);
        $unsubUrl = (defined('APP_BASE_URL') ? rtrim(APP_BASE_URL, '/') : '')
            . '/api/marketing_unsubscribe.php?t=' . urlencode($token);

        $subject = $r['rendered_subject'] ?? null;
        $body    = (string) ($r['rendered_body'] ?? '');
        $body    = str_replace('{{unsubscribe_url}}', $unsubUrl, $body);
        if ($subject !== null) {
            $subject = str_replace('{{unsubscribe_url}}', $unsubUrl, $subject);
        }

        // Append a CAN-SPAM unsubscribe footer for email (if not already present in body).
        if ($campaign['channel'] === 'email' && !str_contains($body, 'unsubscribe')) {
            $body .= "\n\n---\nIf you no longer wish to receive these emails, unsubscribe here: $unsubUrl";
        }

        $messageId = null;
        if ($provider === 'sendgrid' && $campaign['channel'] === 'email') {
            $messageId = sendEmailViaSendGrid($r['resolved_to'], $subject, $body, $campaign['sender_identity'] ?? null);
        } else {
            // Stub provider: synthesize an ID and pretend to have sent it.
            $messageId = 'stub-' . substr(bin2hex(random_bytes(8)), 0, 16);
        }

        $markSent->execute([':pmid' => $messageId, ':id' => (int) $r['id']]);
        $sent++;

        // Log a per-lead contact log + activity so the normal timeline reflects it.
        $logStmt = $db->prepare(
            'INSERT INTO lead_contact_logs (imported_lead_id, user_id, channel, outcome, notes, happened_at)
             VALUES (:lid, :uid, :ch, "attempted", :notes, NOW())'
        );
        $logStmt->execute([
            ':lid'   => (int) $r['imported_lead_id'],
            ':uid'   => (int) $user['id'],
            ':ch'    => $campaign['channel'],
            ':notes' => "Campaign #$campaignId · {$campaign['name']}" . ($provider === 'stub' ? ' (simulated send)' : ''),
        ]);
        logLeadActivity(
            $db, (int) $r['imported_lead_id'], (int) $user['id'], 'campaign_sent',
            null,
            [
                'campaign_id'   => $campaignId,
                'campaign_name' => $campaign['name'],
                'channel'       => $campaign['channel'],
                'provider'      => $provider,
            ]
        );
    } catch (Throwable $e) {
        $markFailed->execute([':reason' => substr($e->getMessage(), 0, 250), ':id' => (int) $r['id']]);
        $failed++;
        $failures[] = (int) $r['id'];
    }
}

// Final campaign status.
$newStatus = $failed === 0
    ? 'sent'
    : ($sent > 0 ? 'partially_failed' : 'partially_failed');
$stats = json_decode($campaign['stats_json'] ?? 'null', true) ?: [];
$stats['sent']   = ($stats['sent']   ?? 0) + $sent;
$stats['failed'] = ($stats['failed'] ?? 0) + $failed;
$stats['last_run_at'] = date('c');
$stats['last_run_provider'] = $provider;

$db->prepare(
    "UPDATE marketing_campaigns
        SET status = :st, stats_json = :s, completed_at = NOW()
      WHERE id = :id"
)->execute([':st' => $newStatus, ':s' => json_encode($stats), ':id' => $campaignId]);

echo json_encode([
    'success'       => true,
    'campaign_id'   => $campaignId,
    'provider'      => $provider,
    'sent'          => $sent,
    'failed'        => $failed,
    'failure_ids'   => $failures,
    'status'        => $newStatus,
]);
exit();

/* ----------------------------------------------------------------------
 * SendGrid provider.
 *
 * To enable:
 *   1. Add to config.php:
 *        define('MARKETING_EMAIL_PROVIDER', 'sendgrid');
 *        define('SENDGRID_API_KEY',         'SG.xxx');
 *        define('MARKETING_EMAIL_FROM',     '"Your Name" <noreply@your-domain.com>');
 *        define('APP_BASE_URL',             'https://dashboard.your-domain.com');
 *   2. Verify the `from` domain in SendGrid (DKIM + SPF).
 *
 * Throws on failure so the caller marks the recipient as failed.
 * Returns the provider message id.
 * -------------------------------------------------------------------- */
function sendEmailViaSendGrid(string $to, ?string $subject, string $body, ?string $fromOverride): string
{
    if (!defined('SENDGRID_API_KEY') || SENDGRID_API_KEY === '') {
        throw new RuntimeException('SENDGRID_API_KEY is not configured');
    }
    $from = $fromOverride ?: (defined('MARKETING_EMAIL_FROM') ? MARKETING_EMAIL_FROM : null);
    if (!$from) throw new RuntimeException('MARKETING_EMAIL_FROM is not configured');

    // Parse "Name <email>" form if present.
    $fromEmail = $from;
    $fromName  = null;
    if (preg_match('/^\s*"?([^"<]+)"?\s*<([^>]+)>\s*$/', $from, $m)) {
        $fromName  = trim($m[1]);
        $fromEmail = trim($m[2]);
    }

    $payload = [
        'personalizations' => [['to' => [['email' => $to]]]],
        'from'             => array_filter(['email' => $fromEmail, 'name' => $fromName]),
        'subject'          => $subject ?? '(no subject)',
        'content'          => [['type' => 'text/plain', 'value' => $body]],
    ];

    $ch = curl_init('https://api.sendgrid.com/v3/mail/send');
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => json_encode($payload),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HEADER         => true,
        CURLOPT_TIMEOUT        => 15,
        CURLOPT_HTTPHEADER     => [
            'Authorization: Bearer ' . SENDGRID_API_KEY,
            'Content-Type: application/json',
        ],
    ]);
    $response = curl_exec($ch);
    if ($response === false) {
        $err = curl_error($ch);
        curl_close($ch);
        throw new RuntimeException("SendGrid curl error: $err");
    }
    $code       = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $headerSize = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    $headers    = substr($response, 0, $headerSize);
    $body       = substr($response, $headerSize);
    curl_close($ch);

    if ($code < 200 || $code >= 300) {
        throw new RuntimeException("SendGrid HTTP $code: " . substr($body, 0, 200));
    }
    // SendGrid returns the message id in the X-Message-Id header.
    if (preg_match('/^x-message-id:\s*(\S+)/mi', $headers, $m)) {
        return trim($m[1]);
    }
    return 'sendgrid-' . substr(bin2hex(random_bytes(8)), 0, 16);
}

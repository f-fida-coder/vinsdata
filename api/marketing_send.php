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
// dispatchOpenPhoneJob() lives in outbound_helpers — pulled in so mass
// SMS campaigns hand off to OpenPhone the same way per-lead outreach
// does (Phase-2 wiring; was stub-only before).
require_once __DIR__ . '/outbound_helpers.php';
// Email-send functions (sendEmailViaSendGrid + Gmail fallback) live in
// their own pure-helpers file so the transporter-notify path can
// require them without ALSO running this file's request handler — that
// was 405'ing every non-POST hit to /api/lead_transport before the
// split (the auto-notify-on-first-assign wiring transitively required
// this file).
require_once __DIR__ . '/marketing_email_helpers.php';
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

// Pick provider. The explicit override (MARKETING_EMAIL_PROVIDER in
// .env / app_secrets) still wins for backward compat, but the default
// is now 'auto' — which delegates to sendEmailViaSendGrid(). That
// function picks SendGrid if configured, else falls back to Gmail SMTP
// (so a team with Gmail + no SendGrid still gets real sends).
$provider = getEnvValue('MARKETING_EMAIL_PROVIDER', 'auto');
if ($campaign['channel'] === 'sms') {
    // Mass SMS now goes through OpenPhone when the API key + phone
    // number ID are configured. If they're not set, the dispatcher
    // returns 'openphone_not_configured' per recipient and the
    // campaign records each as failed (operator sees the reason).
    // resolveOutboundProvider() picks 'openphone' vs 'stub' based on
    // the secrets in app_secrets / .env.
    $provider = resolveOutboundProvider('sms');
} elseif ($campaign['channel'] !== 'email') {
    // WhatsApp + any future channels are still stubbed until we add
    // a real dispatcher for them.
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
        // TCPA-compliance footer for SMS. Required for marketing SMS in
        // the US — recipients must have a clear way to opt out. We add
        // it only if the operator's body doesn't already mention STOP,
        // so a hand-written message with custom opt-out copy isn't
        // duplicated. Inbound STOP/CANCEL/UNSUBSCRIBE/etc. is handled
        // by openphone_webhook.php which writes a suppression and
        // skips the recipient on all future campaigns.
        if ($campaign['channel'] === 'sms' && stripos($body, 'STOP') === false) {
            $body .= "\n\nReply STOP to opt out.";
        }

        $messageId = null;
        if (($provider === 'sendgrid' || $provider === 'auto') && $campaign['channel'] === 'email') {
            // sendEmailViaSendGrid() now auto-picks SendGrid vs Gmail SMTP
            // based on what's configured. Throws on no-provider-configured.
            $messageId = sendEmailViaSendGrid($r['resolved_to'], $subject, $body, $campaign['sender_identity'] ?? null);
        } elseif ($provider === 'openphone' && $campaign['channel'] === 'sms') {
            // Mass SMS via OpenPhone. dispatchOpenPhoneJob handles
            // E.164 canonicalization + the /v1/messages POST. If the
            // API rejects this number (invalid format, blocked, etc.)
            // we throw so the recipient goes into the failed bucket
            // with the actual API reason as fail_reason.
            //
            // Throttle to ~6 messages/sec so we stay comfortably under
            // OpenPhone's 10/sec rate limit. Each iteration of the send
            // loop sleeps 150ms before the next OpenPhone call — for a
            // 500-recipient cap that's an extra ~75s of clock time but
            // avoids 429s mid-blast that would put recipients in the
            // failed bucket through no fault of their own. The sleep
            // happens only on the OpenPhone path so email sends stay
            // fast.
            usleep(150_000);
            $opResult = dispatchOpenPhoneJob([
                'kind'       => 'sms',
                'to_address' => $r['resolved_to'],
                'body'       => $body,
            ]);
            if (!empty($opResult['ok'])) {
                $messageId = $opResult['message_id'] ?? null;
            } else {
                throw new RuntimeException($opResult['fail_reason'] ?? 'openphone_send_failed');
            }
        } else {
            // Stub: synthesize an ID and pretend to have sent it.
            // (WhatsApp + any unconfigured channel land here.)
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

// Email send helpers (sendEmailViaSendGrid, sendEmailViaSendGridApi,
// sendEmailViaGmailFallback) moved to marketing_email_helpers.php and
// required at the top of this file — see comment up there for why.

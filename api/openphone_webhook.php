<?php
// OpenPhone webhook — public endpoint that receives inbound SMS events.
// No session auth; verified via HMAC signature using the
// OPENPHONE_WEBHOOK_SECRET .env value.
//
// What it handles:
//   - message.received       → match sender phone to a lead, log a
//                               contact_logged inbound-sms activity, and
//                               bump lead_temperature from cold/no_answer
//                               → warm. (Hot/closed are left alone — those
//                               are deliberate operator-set states.)
//   - message.delivered      → look up the matching outbound_jobs row by
//                               provider_message_id and mark it delivered.
//
// Anything else is ack'd with 200 so OpenPhone stops retrying.
//
// Setup (once per environment):
//   1. In .env, set OPENPHONE_WEBHOOK_SECRET to the signing key OpenPhone
//      shows when you create the webhook. (It's base64; we base64-decode
//      it before HMAC.)
//   2. In OpenPhone → Settings → Webhooks, create a webhook pointing at
//      https://crm.vinvault.us/api/openphone_webhook and subscribe to
//      message.received + message.delivered.

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/pipeline.php';

$db = getDBConnection();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['ok' => false, 'message' => 'Method not allowed']);
    exit();
}

$rawBody = file_get_contents('php://input');
if ($rawBody === '' || $rawBody === false) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'message' => 'Empty body']);
    exit();
}

// --- Signature verification ----------------------------------------------
// OpenPhone's signature header looks like:
//   openphone-signature: hmac;1;<timestamp_ms>;<base64_sig>
// Algorithm: HMAC-SHA256(<timestamp_ms> + '.' + <raw_body>) with the
// base64-decoded signing key. Compare in constant time.
$sigHeader = $_SERVER['HTTP_OPENPHONE_SIGNATURE'] ?? '';

$openphoneSecret = getEnvValue('OPENPHONE_WEBHOOK_SECRET');
if ($openphoneSecret === '') {
    error_log('[openphone_webhook] rejecting: OPENPHONE_WEBHOOK_SECRET not configured in .env');
    http_response_code(503);
    echo json_encode(['ok' => false, 'message' => 'Webhook secret not configured']);
    exit();
}

if ($sigHeader === '') {
    http_response_code(401);
    echo json_encode(['ok' => false, 'message' => 'Missing signature']);
    exit();
}

$parts = explode(';', $sigHeader);
if (count($parts) !== 4 || $parts[0] !== 'hmac') {
    http_response_code(401);
    echo json_encode(['ok' => false, 'message' => 'Malformed signature header']);
    exit();
}
[, , $timestampMs, $providedSig] = $parts;

$secretBytes = base64_decode($openphoneSecret, true);
if ($secretBytes === false) {
    error_log('[openphone_webhook] OPENPHONE_WEBHOOK_SECRET is not valid base64');
    http_response_code(503);
    echo json_encode(['ok' => false, 'message' => 'Webhook secret malformed']);
    exit();
}

$expectedSig = base64_encode(hash_hmac('sha256', $timestampMs . '.' . $rawBody, $secretBytes, true));
if (!hash_equals($expectedSig, $providedSig)) {
    http_response_code(401);
    echo json_encode(['ok' => false, 'message' => 'Bad signature']);
    exit();
}

// Optional replay guard: reject events older than 5 min.
if (abs(((int) (microtime(true) * 1000)) - (int) $timestampMs) > 5 * 60 * 1000) {
    http_response_code(401);
    echo json_encode(['ok' => false, 'message' => 'Stale signature']);
    exit();
}

// --- Dispatch on event type ----------------------------------------------
$event = json_decode($rawBody, true);
if (!is_array($event)) {
    http_response_code(400);
    echo json_encode(['ok' => false, 'message' => 'Invalid JSON']);
    exit();
}

$type    = $event['type'] ?? '';
$message = $event['data']['object'] ?? [];

try {
    if ($type === 'message.received') {
        handleInboundMessage($db, $message);
    } elseif ($type === 'message.delivered') {
        handleDeliveredMessage($db, $message);
    }
    // Anything else: silently ack so OpenPhone doesn't keep retrying.
    echo json_encode(['ok' => true]);
} catch (Throwable $e) {
    // Keep returning 200 so we don't get retry-stormed for a soft failure
    // (no matching lead, etc.). Log so a human can investigate.
    error_log('[openphone_webhook] handler error: ' . $e->getMessage());
    echo json_encode(['ok' => true, 'note' => 'handler_soft_failed']);
}

// -------------------------------------------------------------------------

function handleInboundMessage(PDO $db, array $msg): void
{
    $from = (string) ($msg['from'] ?? '');
    $body = (string) ($msg['body'] ?? '');
    $msgId = (string) ($msg['id'] ?? '');
    if ($from === '' || $body === '') {
        error_log('[openphone_webhook] inbound message missing from/body');
        return;
    }

    $leadId = matchLeadIdByPhone($db, $from);
    if ($leadId === null) {
        error_log("[openphone_webhook] inbound from $from did not match any lead");
        return;
    }

    // lead_activities.user_id has a FK to users(id) — system events can't
    // pass 0. Use the lowest-id admin as the actor; if there are no admins
    // (fresh install), skip the activity log but still bump the
    // temperature so the operator sees the lead surface in the queue.
    $systemUserId = getSystemActorId($db);

    // Read current temperature so we can decide whether to bump.
    $cur = $db->prepare(
        'SELECT lead_temperature FROM lead_states WHERE imported_lead_id = :lead'
    );
    $cur->execute([':lead' => $leadId]);
    $row = $cur->fetch();
    $currentTemp = $row['lead_temperature'] ?? null;

    if ($systemUserId !== null) {
        logLeadActivity(
            $db,
            $leadId,
            $systemUserId,
            'contact_logged',
            null,
            [
                'channel'             => 'sms',
                'direction'           => 'inbound',
                'outcome'             => 'completed',
                'body'                => mb_substr($body, 0, 1000),
                'provider'            => 'openphone',
                'provider_message_id' => $msgId,
                'sender'              => $from,
                'actor'               => 'system_openphone_webhook',
            ]
        );
    }

    // Auto-bump cold/no_answer → warm. Hot and closed are deliberate;
    // leave them alone. Warm stays warm.
    if (in_array($currentTemp, ['cold', 'no_answer'], true)) {
        $upd = $db->prepare(
            'UPDATE lead_states
                SET lead_temperature = \'warm\', updated_at = NOW()
              WHERE imported_lead_id = :lead'
        );
        $upd->execute([':lead' => $leadId]);

        if ($systemUserId !== null) {
            logLeadActivity(
                $db,
                $leadId,
                $systemUserId,
                'temperature_changed',
                ['lead_temperature' => $currentTemp],
                ['lead_temperature' => 'warm', 'auto' => 'inbound_sms_reply']
            );
        }
    }
}

/**
 * Returns a user id we can attribute system-driven activity to. We pick
 * the lowest-id admin so the same user is used consistently across runs.
 * Cached for the lifetime of the request.
 */
function getSystemActorId(PDO $db): ?int
{
    static $cached = false;
    static $value = null;
    if ($cached) return $value;
    $cached = true;
    $stmt = $db->query("SELECT id FROM users WHERE role = 'admin' ORDER BY id ASC LIMIT 1");
    $row = $stmt->fetch();
    $value = $row ? (int) $row['id'] : null;
    return $value;
}

function handleDeliveredMessage(PDO $db, array $msg): void
{
    $providerMsgId = (string) ($msg['id'] ?? '');
    if ($providerMsgId === '') return;

    // Marking delivered is just a status note — the job already moved to
    // 'sent' when we got a 200 from the OpenPhone API at send time.
    $stmt = $db->prepare(
        "UPDATE outbound_jobs
            SET status = 'sent',
                sent_at = COALESCE(sent_at, NOW())
          WHERE provider = 'openphone'
            AND provider_message_id = :mid
            AND status IN ('sending','sent')"
    );
    $stmt->execute([':mid' => $providerMsgId]);
}

/**
 * Find the imported_lead_id whose owner phone matches the inbound number.
 * The four phone slots live in different places — primary is a real
 * column, the others are inside `normalized_payload_json`. Match by
 * digits-only LIKE to handle (555) 123-4567 vs +15551234567 etc.
 *
 * Returns the most recently created matching lead, since one VIN can
 * have multiple imports across files.
 */
function matchLeadIdByPhone(PDO $db, string $rawPhone): ?int
{
    $digits = preg_replace('/\D+/', '', $rawPhone);
    if ($digits === '') return null;
    // Tolerant: match the last 10 digits (US default) so +1 vs no-+1 both
    // resolve to the same lead.
    $tail = substr($digits, -10);
    if (strlen($tail) < 10) return null;
    $needle = '%' . $tail . '%';

    // Stored phones come in many shapes: "+15551234567", "(555) 123-4567",
    // "555.123.4567", etc. Strip everything that isn't a digit before the
    // LIKE so all of them collapse onto the same canonical form.
    $stripDigits = function (string $col): string {
        return "REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE($col, '-',''),' ',''),'(',''),')',''),'+',''),'.','')";
    };
    $primary = $stripDigits('norm_phone_primary');
    $second  = $stripDigits("JSON_UNQUOTE(JSON_EXTRACT(normalized_payload_json, '$.phone_secondary'))");
    $third   = $stripDigits("JSON_UNQUOTE(JSON_EXTRACT(normalized_payload_json, '$.phone_3'))");
    $fourth  = $stripDigits("JSON_UNQUOTE(JSON_EXTRACT(normalized_payload_json, '$.phone_4'))");

    $sql = "SELECT id FROM imported_leads_raw
             WHERE  $primary LIKE :n
                OR $second  LIKE :n
                OR $third   LIKE :n
                OR $fourth  LIKE :n
             ORDER BY id DESC
             LIMIT 1";
    $stmt = $db->prepare($sql);
    $stmt->execute([':n' => $needle]);
    $row = $stmt->fetch();
    return $row ? (int) $row['id'] : null;
}

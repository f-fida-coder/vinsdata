<?php
// OpenPhone webhook — public endpoint that receives inbound SMS + call
// events. No session auth; verified via HMAC signature using the
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
//   - call.ringing / .answered / .completed / .missed / .voicemail
//                            → upsert an inbound_calls row keyed by
//                               provider_call_id, resolve the caller to
//                               a lead, and surface the ring event so
//                               the leads page can pop up a notification.
//
// Anything else is ack'd with 200 so OpenPhone stops retrying.
//
// Setup (once per environment):
//   1. In .env, set OPENPHONE_WEBHOOK_SECRET to the signing key OpenPhone
//      shows when you create the webhook. (It's base64; we base64-decode
//      it before HMAC.)
//   2. In OpenPhone → Settings → Webhooks, create a webhook pointing at
//      https://crm.vinvault.us/api/openphone_webhook and subscribe to
//      message.received, message.delivered, AND the call.* events
//      you want to surface (at minimum call.ringing + call.completed).

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/pipeline.php';

$db = getDBConnection();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(['ok' => false, 'message' => 'Method not allowed']);
    exit();
}

$rawBody = file_get_contents('php://input');

// Stamp every POST in webhook_hits before any signature / payload
// check runs. This is the only way to tell "OpenPhone never hit us"
// apart from "OpenPhone hit us but the signature didn't match" on
// shared hosting where we can't tail PHP's error log.
//
// We never let the logger throw — observability shouldn't bring the
// real handler down on a transient DB blip.
$hitId = null;
$logHit = function (array $patch) use ($db, &$hitId) {
    try {
        if ($hitId === null) {
            $stmt = $db->prepare(
                "INSERT INTO webhook_hits
                   (source, remote_ip, user_agent, has_signature, body_preview)
                 VALUES
                   ('openphone', :ip, :ua, :sig, :body)"
            );
            $stmt->execute([
                ':ip'   => $_SERVER['REMOTE_ADDR'] ?? null,
                ':ua'   => substr($_SERVER['HTTP_USER_AGENT'] ?? '', 0, 255),
                ':sig'  => ($_SERVER['HTTP_OPENPHONE_SIGNATURE'] ?? '') !== '' ? 1 : 0,
                ':body' => substr($patch['body_preview'] ?? '', 0, 2000),
            ]);
            $hitId = (int) $db->lastInsertId();
            unset($patch['body_preview']);
        }
        if (!empty($patch)) {
            $sets = [];
            $params = [':id' => $hitId];
            foreach ($patch as $k => $v) {
                $sets[] = "$k = :$k";
                $params[":$k"] = $v;
            }
            $db->prepare("UPDATE webhook_hits SET " . implode(', ', $sets) . " WHERE id = :id")->execute($params);
        }
    } catch (Throwable $e) {
        error_log('[openphone_webhook] logHit failed: ' . $e->getMessage());
    }
};
$logHit(['body_preview' => (string) $rawBody]);

if ($rawBody === '' || $rawBody === false) {
    $logHit(['reject_reason' => 'empty_body', 'http_status' => 400]);
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
    $logHit(['reject_reason' => 'secret_not_configured', 'http_status' => 503]);
    http_response_code(503);
    echo json_encode(['ok' => false, 'message' => 'Webhook secret not configured']);
    exit();
}

if ($sigHeader === '') {
    $logHit(['reject_reason' => 'missing_signature', 'http_status' => 401]);
    http_response_code(401);
    echo json_encode(['ok' => false, 'message' => 'Missing signature']);
    exit();
}

$parts = explode(';', $sigHeader);
if (count($parts) !== 4 || $parts[0] !== 'hmac') {
    $logHit(['reject_reason' => 'malformed_signature', 'http_status' => 401]);
    http_response_code(401);
    echo json_encode(['ok' => false, 'message' => 'Malformed signature header']);
    exit();
}
[, , $timestampMs, $providedSig] = $parts;

$secretBytes = base64_decode($openphoneSecret, true);
if ($secretBytes === false) {
    error_log('[openphone_webhook] OPENPHONE_WEBHOOK_SECRET is not valid base64');
    $logHit(['reject_reason' => 'secret_not_base64', 'http_status' => 503]);
    http_response_code(503);
    echo json_encode(['ok' => false, 'message' => 'Webhook secret malformed']);
    exit();
}

$expectedSig = base64_encode(hash_hmac('sha256', $timestampMs . '.' . $rawBody, $secretBytes, true));
if (!hash_equals($expectedSig, $providedSig)) {
    $logHit(['reject_reason' => 'bad_signature', 'http_status' => 401]);
    http_response_code(401);
    echo json_encode(['ok' => false, 'message' => 'Bad signature']);
    exit();
}

// Optional replay guard: reject events older than 5 min.
if (abs(((int) (microtime(true) * 1000)) - (int) $timestampMs) > 5 * 60 * 1000) {
    $logHit(['reject_reason' => 'stale_signature', 'http_status' => 401]);
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
    } elseif (str_starts_with($type, 'call.')) {
        handleCallEvent($db, $type, $message, $rawBody);
    }
    // Signature checks passed and the handler didn't blow up. Tag the
    // hit row so the debug query reads as "received + verified +
    // dispatched ok".
    $logHit(['verified' => 1, 'event_type' => $type, 'http_status' => 200]);
    // Anything else: silently ack so OpenPhone doesn't keep retrying.
    echo json_encode(['ok' => true]);
} catch (Throwable $e) {
    // Keep returning 200 so we don't get retry-stormed for a soft failure
    // (no matching lead, etc.). Log so a human can investigate.
    error_log('[openphone_webhook] handler error: ' . $e->getMessage());
    $logHit([
        'verified'      => 1,
        'event_type'    => $type,
        'reject_reason' => 'handler_threw: ' . substr($e->getMessage(), 0, 80),
        'http_status'   => 200,
    ]);
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

/**
 * Inbound call event. Upserts a row in `inbound_calls` keyed by
 * provider_call_id so the ringing → answered → completed chain stays a
 * single record. Resolves the caller to a lead (digit-only match on the
 * four phone slots) so the frontend toast can display lead context.
 *
 * The leads page polls /api/inbound_calls every few seconds for any
 * row with status='ringing' and ringing_at within the last 60s. When
 * one appears it shows a slide-in card with "Open lead" + "Dismiss"
 * buttons. We mark the row as ack'd when the agent interacts so the
 * card doesn't keep re-firing.
 */
function handleCallEvent(PDO $db, string $eventType, array $call, string $rawBody): void
{
    $callId = (string) ($call['id'] ?? $call['callId'] ?? '');
    $from   = (string) ($call['from'] ?? $call['from_number'] ?? $call['caller'] ?? '');
    $to     = (string) ($call['to']   ?? $call['to_number']   ?? $call['callee'] ?? '');

    if ($from === '' && $callId === '') {
        error_log('[openphone_webhook] call event missing from + callId — skipping');
        return;
    }

    // Map event type → our status enum. Anything unknown defaults to
    // ringing so at least the first toast fires.
    $statusMap = [
        'call.ringing'             => 'ringing',
        'call.initiated'           => 'ringing',
        'call.answered'            => 'answered',
        'call.completed'           => 'completed',
        'call.missed'              => 'missed',
        'call.no_answer'           => 'missed',
        'call.voicemail'           => 'voicemail',
        'call.recording.completed' => 'completed',
    ];
    $status = $statusMap[$eventType] ?? 'ringing';

    // If the payload includes its own status field, prefer that — OpenPhone
    // sometimes ships completion in a single event with status='completed'
    // and the event still typed as call.ringing.
    $providerStatus = strtolower((string) ($call['status'] ?? ''));
    $providerStatusMap = [
        'ringing'     => 'ringing',
        'initiated'   => 'ringing',
        'in-progress' => 'answered',
        'answered'    => 'answered',
        'completed'   => 'completed',
        'no-answer'   => 'missed',
        'missed'      => 'missed',
        'voicemail'   => 'voicemail',
    ];
    if (isset($providerStatusMap[$providerStatus])) {
        $status = $providerStatusMap[$providerStatus];
    }

    // Resolve the caller's phone to a live lead. Reuses the same
    // helper as inbound messages.
    $leadId = matchLeadIdByPhone($db, $from);
    $leadName = null;
    $assignedUserId = null;
    if ($leadId !== null) {
        $row = $db->prepare(
            "SELECT JSON_UNQUOTE(JSON_EXTRACT(normalized_payload_json, '$.full_name')) AS full_name,
                    JSON_UNQUOTE(JSON_EXTRACT(normalized_payload_json, '$.first_name')) AS first_name,
                    JSON_UNQUOTE(JSON_EXTRACT(normalized_payload_json, '$.last_name')) AS last_name
               FROM imported_leads_raw WHERE id = :id"
        );
        $row->execute([':id' => $leadId]);
        $n = $row->fetch() ?: [];
        $candidate = $n['full_name'] ?: trim(((string) ($n['first_name'] ?? '')) . ' ' . ((string) ($n['last_name'] ?? '')));
        $leadName = $candidate !== '' ? $candidate : null;

        $stateRow = $db->prepare(
            "SELECT assigned_user_id FROM lead_states WHERE imported_lead_id = :id"
        );
        $stateRow->execute([':id' => $leadId]);
        $sr = $stateRow->fetch();
        $assignedUserId = $sr && $sr['assigned_user_id'] !== null ? (int) $sr['assigned_user_id'] : null;
    }

    // Upsert keyed by provider_call_id so we update an existing ring
    // chain instead of duplicating rows on the answer/complete event.
    $existingId = 0;
    if ($callId !== '') {
        $existing = $db->prepare(
            "SELECT id FROM inbound_calls
              WHERE provider = 'openphone' AND provider_call_id = :cid
              LIMIT 1"
        );
        $existing->execute([':cid' => $callId]);
        $existingId = (int) ($existing->fetchColumn() ?: 0);
    }

    if ($existingId > 0) {
        $up = $db->prepare(
            "UPDATE inbound_calls SET
               status            = :status,
               matched_lead_id   = COALESCE(matched_lead_id,   :lid),
               matched_lead_name = COALESCE(matched_lead_name, :lname),
               matched_user_id   = COALESCE(matched_user_id,   :uid),
               ended_at          = CASE WHEN :status2 IN ('completed','missed','voicemail') THEN COALESCE(ended_at, NOW()) ELSE ended_at END,
               raw_payload_json  = :raw
             WHERE id = :id"
        );
        $up->execute([
            ':status'  => $status,
            ':status2' => $status,
            ':lid'     => $leadId,
            ':lname'   => $leadName,
            ':uid'     => $assignedUserId,
            ':raw'     => $rawBody,
            ':id'      => $existingId,
        ]);
        return;
    }

    $ins = $db->prepare(
        "INSERT INTO inbound_calls
           (provider, provider_call_id, from_number, to_number,
            status, matched_lead_id, matched_lead_name, matched_user_id,
            ringing_at, raw_payload_json)
         VALUES
           ('openphone', :cid, :from, :to,
            :status, :lid, :lname, :uid,
            NOW(), :raw)"
    );
    $ins->execute([
        ':cid'    => $callId ?: null,
        ':from'   => $from,
        ':to'     => $to,
        ':status' => $status,
        ':lid'    => $leadId,
        ':lname'  => $leadName,
        ':uid'    => $assignedUserId,
        ':raw'    => $rawBody,
    ]);
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

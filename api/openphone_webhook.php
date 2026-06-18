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
    // `to` is the Quo line that RECEIVED the inbound text. Used below to
    // resolve which agent owns the line (users.quo_phone_number / id)
    // so the bell-notification + activity actor land on the right user.
    // Quo sometimes ships `to` as an array of recipients on multi-line
    // accounts — take the first non-empty entry.
    $toRaw = $msg['to'] ?? $msg['to_number'] ?? '';
    if (is_array($toRaw)) {
        $toRaw = $toRaw[0] ?? '';
    }
    $to    = (string) $toRaw;
    $toPid = (string) ($msg['phoneNumberId'] ?? '');
    if ($from === '' || $body === '') {
        error_log('[openphone_webhook] inbound message missing from/body');
        return;
    }

    // Marketing STOP-keyword handling. TCPA + carrier requirements: any
    // inbound containing STOP/UNSUBSCRIBE/CANCEL/END/QUIT/REVOKE/OPTOUT
    // (as a standalone word, case-insensitive) must immediately add the
    // sender's phone to the suppression list so no future campaign sends
    // to them. This runs BEFORE the lead-matching block because a STOP
    // from an unknown number still needs to be suppressed.
    $upper = strtoupper(trim($body));
    $stopKeywords = ['STOP','UNSUBSCRIBE','CANCEL','END','QUIT','REVOKE','OPTOUT','OPT-OUT','OPT OUT','STOPALL'];
    $isStopReply  = false;
    foreach ($stopKeywords as $kw) {
        // Match the keyword as a whole word at the start of the message
        // OR anywhere in a single-word reply. Avoids false-positives
        // like "I'll stop by tomorrow" while still catching "Stop!"
        // and "please cancel".
        if ($upper === $kw || preg_match('/(^|[\s.,;:!?])' . preg_quote($kw, '/') . '($|[\s.,;:!?])/', $upper)) {
            $isStopReply = true;
            break;
        }
    }
    if ($isStopReply) {
        handleSmsStopReply($db, $from, $msgId);
        // Fall through to log the inbound message + bump temperature so
        // the operator still sees the reply in the timeline (now tagged
        // as an opt-out).
    }

    // Transporter inbound: if the sender matches a known transporter
    // phone, log the reply as an inbound transport_notifications row
    // against their most-recent active dispatch. The dispatch panel's
    // Activity log surfaces inbound + outbound on the same timeline so
    // the operator can read it as a conversation. Returning a lead
    // match later (below) is independent — same number CAN belong to
    // both a lead and a transporter (rare); we log to both.
    $transporterMatch = matchTransporterByPhone($db, $from);
    if ($transporterMatch !== null) {
        logInboundTransporterReply($db, (int) $transporterMatch['id'], $from, $body, $msgId);
    }

    $leadId = matchLeadIdByPhone($db, $from);
    if ($leadId === null) {
        if ($transporterMatch === null) {
            error_log("[openphone_webhook] inbound from $from did not match any lead or transporter"
                . ($isStopReply ? ' (STOP reply still suppressed)' : ''));
        }
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

    // Per-agent line: if the receiving Quo number belongs to a specific
    // user (users.quo_phone_number — migration 041), drop a bell
    // notification on THEIR account so the message lights up their
    // NotificationBell instead of getting lost in a shared inbox. Falls
    // through silently when the line isn't owned by any user (shared
    // org line / legacy configuration).
    $lineOwnerId = lookupLineOwnerUserId($db, $to, $toPid);
    if ($lineOwnerId !== null) {
        try {
            $row = $db->prepare(
                "SELECT JSON_UNQUOTE(JSON_EXTRACT(normalized_payload_json, '$.full_name'))  AS full_name,
                        JSON_UNQUOTE(JSON_EXTRACT(normalized_payload_json, '$.first_name')) AS first_name,
                        JSON_UNQUOTE(JSON_EXTRACT(normalized_payload_json, '$.last_name'))  AS last_name
                   FROM imported_leads_raw WHERE id = :id"
            );
            $row->execute([':id' => $leadId]);
            $nm = $row->fetch() ?: [];
            $leadDisplay = $nm['full_name'] ?: trim(((string) ($nm['first_name'] ?? '')) . ' ' . ((string) ($nm['last_name'] ?? '')));
            $leadDisplay = $leadDisplay !== '' ? $leadDisplay : 'Unknown lead';

            $title   = "New text from $leadDisplay";
            $excerpt = mb_substr($body, 0, 140);
            $message = $from !== '' ? "$from · $excerpt" : $excerpt;
            // dedupe_key includes the provider message id so an event
            // retry from Quo won't double-insert (INSERT IGNORE on the
            // UNIQUE (user_id, dedupe_key) constraint).
            createNotification(
                $db,
                $lineOwnerId,
                'inbound_sms',
                'sms:' . ($msgId !== '' ? $msgId : ($from . '|' . substr(md5($body), 0, 8))),
                $title,
                $message,
                $leadId,
                null
            );
        } catch (Throwable $e) {
            error_log('[openphone_webhook] inbound_sms notification failed: ' . $e->getMessage());
        }
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
 * Resolves a Quo line (E.164 number and/or phoneNumberId) to the user
 * who owns it. Returns null if no user has that line registered, which
 * is the normal fallback when the org is still on a shared line and
 * only some agents have per-line ownership configured.
 *
 * Lookup precedence:
 *   1. quo_phone_number_id exact match (Quo's internal ID, most stable)
 *   2. quo_phone_number exact match on E.164 (set users.quo_phone_number
 *      to "+12548708757" via migration 041 / the admin UI)
 *   3. quo_phone_number match after canonicalization through
 *      openPhoneToE164() — handles webhook payloads that ship the raw
 *      "(254) 870-8757" / "254-870-8757" formats instead of E.164.
 *
 * Cached per-request to keep the webhook hot path cheap when a burst of
 * events arrives for the same line.
 */
function lookupLineOwnerUserId(PDO $db, string $e164, string $phoneNumberId = ''): ?int
{
    static $cache = [];
    $key = $phoneNumberId . '|' . $e164;
    if (array_key_exists($key, $cache)) return $cache[$key];

    try {
        if ($phoneNumberId !== '') {
            $stmt = $db->prepare('SELECT id FROM users WHERE quo_phone_number_id = :pid LIMIT 1');
            $stmt->execute([':pid' => $phoneNumberId]);
            $id = $stmt->fetchColumn();
            if ($id !== false) { $cache[$key] = (int) $id; return $cache[$key]; }
        }
        if ($e164 !== '') {
            $stmt = $db->prepare('SELECT id FROM users WHERE quo_phone_number = :p LIMIT 1');
            $stmt->execute([':p' => $e164]);
            $id = $stmt->fetchColumn();
            if ($id !== false) { $cache[$key] = (int) $id; return $cache[$key]; }

            // Fallback: canonicalize the raw incoming number through the
            // same E.164 helper outbound uses. Some Quo events ship
            // unformatted variants on the `to` field.
            $canonical = openPhoneToE164($e164);
            if ($canonical !== '' && $canonical !== $e164) {
                $stmt = $db->prepare('SELECT id FROM users WHERE quo_phone_number = :p LIMIT 1');
                $stmt->execute([':p' => $canonical]);
                $id = $stmt->fetchColumn();
                if ($id !== false) { $cache[$key] = (int) $id; return $cache[$key]; }
            }
        }
    } catch (Throwable $e) {
        error_log('[openphone_webhook] lookupLineOwnerUserId failed: ' . $e->getMessage());
    }
    $cache[$key] = null;
    return null;
}

/**
 * Builds the body for the auto-fire SMS that goes out when the
 * line owner misses an inbound call from a known lead. The text
 * comes from the line OWNER (not the lead's assigned rep), so the
 * reply lands in the right inbox and the no-reassignment rule
 * stays intact. Conversational style + first names match the rest
 * of the SMS templates (see SMS_TEMPLATES in LeadOutreachSection.jsx).
 */
function buildMissedCallAutoTextBody(string $leadFirst, string $agentFirst): string
{
    $lf = $leadFirst !== '' ? $leadFirst : 'there';
    $af = $agentFirst !== '' ? $agentFirst : 'Vin Vault';
    return "Hey $lf, this is $af. Sorry I missed your call! Shoot me a text or give me another try when you have a minute.";
}

/**
 * Fire-and-forget: when the line owner misses an inbound call from a
 * known lead, send a templated SMS from THEIR Quo line apologizing
 * for the miss. Idempotent via the inbound_calls.auto_text_sent_at
 * column — a call chain that fires ringing → missed → voicemail will
 * only ship one auto-text.
 *
 * Guard chain (any failure → silent no-op, never throws):
 *   - status must be 'missed' or 'voicemail' (not ringing/answered/completed)
 *   - direction must be inbound (we never auto-text when WE called THEM
 *     and got no answer — they're the ones reaching out)
 *   - line owner must be a known user (Quo line must be tied to a CRM
 *     user via users.quo_phone_number — migration 041)
 *   - lead must have matched a row in imported_leads_raw
 *   - lead must have a phone_primary
 *   - auto_text_sent_at on the inbound_calls row must still be NULL
 *
 * Stays out of the call-event hot path's success/failure — if anything
 * downstream throws (Quo API 500s, lead has no phone, etc.) we log and
 * move on; the inbound_calls row was already written above.
 */
function maybeSendMissedCallAutoText(
    PDO $db,
    int $inboundCallId,
    string $status,
    string $direction,
    ?int $lineOwnerId,
    ?int $leadId
): void {
    if (!in_array($status, ['missed', 'voicemail'], true)) return;
    if ($lineOwnerId === null || $leadId === null) return;

    // Accept Quo's variants — "incoming"/"inbound" both mean inbound.
    // Outbound calls that go to a lead's voicemail aren't "we missed
    // them", they're "they didn't pick up our outreach" — different UX,
    // we don't auto-text on those.
    $d = strtolower($direction);
    if ($d !== '' && !in_array($d, ['inbound', 'incoming'], true)) return;

    try {
        // Dedupe: skip if a prior event in the same call chain already
        // fired the auto-text. The UPDATE at the end is the locking
        // gate, but we cheap-check first to avoid the agent + lead
        // lookups when we already know we won't send.
        $check = $db->prepare(
            'SELECT auto_text_sent_at FROM inbound_calls WHERE id = :id'
        );
        $check->execute([':id' => $inboundCallId]);
        $sentAt = $check->fetchColumn();
        if ($sentAt !== false && $sentAt !== null) return;

        // Lead first name + phone — pulled from the normalized payload
        // so we get the same name the agent sees in the drawer.
        $leadRow = $db->prepare(
            "SELECT JSON_UNQUOTE(JSON_EXTRACT(normalized_payload_json, '$.first_name'))    AS first_name,
                    JSON_UNQUOTE(JSON_EXTRACT(normalized_payload_json, '$.phone_primary')) AS phone_primary
               FROM imported_leads_raw WHERE id = :id"
        );
        $leadRow->execute([':id' => $leadId]);
        $lead = $leadRow->fetch() ?: [];
        $leadFirst = trim((string) ($lead['first_name'] ?? ''));
        $leadPhone = trim((string) ($lead['phone_primary'] ?? ''));
        if ($leadPhone === '') return;

        // Agent first name — line owner's display name; first token.
        $agentRow = $db->prepare('SELECT name FROM users WHERE id = :id');
        $agentRow->execute([':id' => $lineOwnerId]);
        $agentName = trim((string) ($agentRow->fetchColumn() ?: ''));
        $agentFirst = $agentName !== '' ? trim(explode(' ', $agentName)[0]) : '';

        $body = buildMissedCallAutoTextBody($leadFirst, $agentFirst);

        // Dispatch via the same path the lead-drawer Send button uses.
        // created_by = lineOwnerId — dispatchOpenPhoneJob reads their
        // users.quo_phone_number and uses it as the API `from`, so the
        // SMS goes out from the agent's own line. Falls back to env
        // default if the owner's number is unset (shouldn't happen
        // since lineOwnerId resolution requires the column to be set,
        // but the dispatcher's safety chain still applies).
        enqueueAndDispatchOutbound($db, [
            'kind'             => 'sms',
            'to'               => $leadPhone,
            'body'             => $body,
            'imported_lead_id' => $leadId,
            'created_by'       => $lineOwnerId,
        ]);

        // Latch the dedupe sentinel AFTER successful enqueue. If the
        // dispatch threw (caught above), we never set this, so a retry
        // event on the same call CAN re-attempt. Trade-off: a transient
        // Quo API blip might dispatch twice if the second event comes
        // in after a successful enqueue but before this UPDATE — narrow
        // window, low probability. If we ever see duplicates in
        // practice, flip the order: UPDATE first, dispatch second.
        $latch = $db->prepare(
            'UPDATE inbound_calls SET auto_text_sent_at = NOW() WHERE id = :id'
        );
        $latch->execute([':id' => $inboundCallId]);
    } catch (Throwable $e) {
        // Soft-fail — call event already logged + matched_user_id set.
        // The auto-text is a courtesy; if it fails we don't want to
        // poison the webhook with a 5xx.
        error_log('[openphone_webhook] maybeSendMissedCallAutoText failed: ' . $e->getMessage());
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
    $callId    = (string) ($call['id'] ?? $call['callId'] ?? '');
    $from      = (string) ($call['from'] ?? $call['from_number'] ?? $call['caller'] ?? '');
    $to        = (string) ($call['to']   ?? $call['to_number']   ?? $call['callee'] ?? '');
    // Quo ships "incoming"/"outgoing" on most call events; older
    // events sometimes use "inbound"/"outbound". Both forms are
    // normalized in maybeSendMissedCallAutoText below.
    $direction = (string) ($call['direction'] ?? '');

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

    // Per-agent line: if the call is to a Quo number owned by a specific
    // user, prefer THAT user for matched_user_id so the RingingCallToast
    // pops on their screen (not the assigned-rep's). Falls back to the
    // lead's assigned_user_id when the line isn't owned by any user.
    $callToPid = (string) ($call['phoneNumberId'] ?? '');
    $lineOwnerId = lookupLineOwnerUserId($db, $to, $callToPid);
    if ($lineOwnerId !== null) {
        $assignedUserId = $lineOwnerId;
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
        // Missed-call auto-text path. Fires when the status transitions
        // to missed/voicemail on a known per-agent line for a known
        // lead. Idempotent via auto_text_sent_at (migration 042) so
        // ringing → missed → voicemail chains only ship one SMS.
        maybeSendMissedCallAutoText(
            $db, $existingId, $status, $direction, $lineOwnerId, $leadId
        );
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
    // Same auto-text path for the case where the very first event we
    // see is already the missed/voicemail one (no prior ringing event
    // — Quo sometimes collapses short rings into a single missed
    // event). Use the just-inserted row's id for the dedupe sentinel.
    $newId = (int) $db->lastInsertId();
    if ($newId > 0) {
        maybeSendMissedCallAutoText(
            $db, $newId, $status, $direction, $lineOwnerId, $leadId
        );
    }
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

    // Mirror the delivery confirmation onto the matching marketing
    // recipient row (if any). The marketing detail page reads
    // sent_at to show "Sent at <timestamp>" — we set it here so an
    // operator looking at the campaign sees the real delivery time
    // rather than the moment our outbound API call returned.
    $upd = $db->prepare(
        "UPDATE marketing_campaign_recipients
            SET sent_at = COALESCE(sent_at, NOW())
          WHERE provider_message_id = :mid
            AND send_status IN ('sending','sent')"
    );
    $upd->execute([':mid' => $providerMsgId]);
}

/**
 * Inbound STOP/CANCEL/UNSUBSCRIBE/etc. on an SMS:
 *   1. Add the sender's phone to marketing_suppressions (TCPA).
 *   2. Find any open marketing recipient rows for that phone and flip
 *      send_status='opted_out' + replied_at so the detail page reflects
 *      the opt-out (and any pending sends in a still-running campaign
 *      are skipped on next iteration).
 *   3. Log an opted_out activity on the matched lead (if any).
 *
 * Best-effort: failures here are swallowed so the webhook still returns
 * 200 and the operator can fix the lookup manually if needed.
 */
function handleSmsStopReply(PDO $db, string $fromPhone, string $msgId): void
{
    try {
        $normalized = normalizeContactIdentifier('phone', $fromPhone);
        $leadId     = matchLeadIdByPhone($db, $fromPhone);

        // 1. Suppression — keyed on the normalized phone so future
        //    campaigns of any kind skip this number. INSERT IGNORE so
        //    repeat STOP messages don't error on the unique key.
        $db->prepare(
            'INSERT IGNORE INTO marketing_suppressions
               (identifier_type, identifier, reason, source_lead_id)
             VALUES (:t, :i, :r, :l)'
        )->execute([
            ':t' => 'phone',
            ':i' => $normalized,
            ':r' => 'unsubscribe',
            ':l' => $leadId,
        ]);

        // 2. Mark every in-flight / sent marketing recipient row that
        //    matches this phone as opted_out, and stamp replied_at.
        //    Use both the canonical form and the original digits so we
        //    catch rows stored with either shape.
        $digits = preg_replace('/\D+/', '', $fromPhone) ?: $normalized;
        $tail   = strlen($digits) >= 10 ? substr($digits, -10) : $digits;
        $needle = '%' . $tail;
        $db->prepare(
            "UPDATE marketing_campaign_recipients
                SET send_status = 'opted_out',
                    replied_at  = COALESCE(replied_at, NOW())
              WHERE send_status IN ('pending','sending','sent')
                AND (resolved_to = :exact OR resolved_to LIKE :tail)"
        )->execute([':exact' => $normalized, ':tail' => $needle]);

        // 3. Activity log on the matched lead so the timeline tells the
        //    full story (inbound SMS + opt-out side-effect).
        if ($leadId !== null) {
            $systemUserId = getSystemActorId($db);
            if ($systemUserId !== null) {
                logLeadActivity($db, $leadId, $systemUserId, 'opted_out', null, [
                    'channel'             => 'sms',
                    'reason'              => 'inbound_stop_keyword',
                    'provider_message_id' => $msgId,
                ]);
            }
        }
    } catch (Throwable $e) {
        error_log('[openphone_webhook] handleSmsStopReply failed: ' . $e->getMessage());
    }
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
/**
 * Find a transporter whose phone matches the inbound number. Same
 * digit-tail match as matchLeadIdByPhone — handles "(817) 395-2397"
 * vs "+18173952397" vs "8173952397" by stripping everything that
 * isn't a digit and comparing the last 10 digits.
 *
 * Returns the matching row (id, name) or null. Inactive transporters
 * are included so historical reply matching still works after a
 * transporter is deactivated.
 */
function matchTransporterByPhone(PDO $db, string $rawPhone): ?array
{
    $digits = preg_replace('/\D+/', '', $rawPhone);
    if ($digits === '') return null;
    $tail = substr($digits, -10);
    if (strlen($tail) < 10) return null;
    $needle = '%' . $tail . '%';
    $stmt = $db->prepare(
        "SELECT id, name
           FROM transporters
          WHERE REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(phone, '-',''),' ',''),'(',''),')',''),'+',''),'.','') LIKE :needle
          ORDER BY is_active DESC, id ASC
          LIMIT 1"
    );
    $stmt->execute([':needle' => $needle]);
    $row = $stmt->fetch();
    return $row ?: null;
}

/**
 * Log an inbound SMS reply from a transporter to their most-recent
 * active dispatch. Falls back to the most-recent dispatch period if
 * nothing is active, so the message still surfaces in a relevant
 * panel rather than disappearing.
 *
 * The sender (transporter) doesn't write to lead_activities — that
 * table is for lead-side timeline entries. Inbound replies go into
 * transport_notifications with direction='inbound' so they merge
 * with outbound rows on the dispatch panel's Activity log.
 */
function logInboundTransporterReply(PDO $db, int $transporterId, string $from, string $body, string $msgId): void
{
    // 1. Pick the dispatch row this reply most likely refers to.
    //    Active dispatches (not delivered/cancelled) ordered by most
    //    recently touched. Falls back to any most-recent row.
    $stmt = $db->prepare(
        "SELECT id FROM lead_transport
          WHERE assigned_transporter_id = :tid
            AND status NOT IN ('delivered','cancelled')
          ORDER BY updated_at DESC, id DESC
          LIMIT 1"
    );
    $stmt->execute([':tid' => $transporterId]);
    $transportId = $stmt->fetchColumn();
    if (!$transportId) {
        $stmt = $db->prepare(
            "SELECT id FROM lead_transport
              WHERE assigned_transporter_id = :tid
              ORDER BY updated_at DESC, id DESC
              LIMIT 1"
        );
        $stmt->execute([':tid' => $transporterId]);
        $transportId = $stmt->fetchColumn();
    }
    if (!$transportId) {
        error_log("[openphone_webhook] transporter $transporterId replied but has no dispatch rows; dropping inbound");
        return;
    }

    // 2. Skip duplicates. OpenPhone occasionally re-delivers a webhook
    //    event; guard on provider_message_id via the (rebuilt-uniquely)
    //    error_message field. There's no dedicated FK column for the
    //    OpenPhone message id on transport_notifications today, so we
    //    re-use the existing schema and dedupe on a hash-friendly probe.
    if ($msgId !== '') {
        $dup = $db->prepare(
            "SELECT id FROM transport_notifications
              WHERE transport_id = :tid
                AND direction    = 'inbound'
                AND error_message = :probe
              LIMIT 1"
        );
        $probe = '[inbound msg_id]' . $msgId;
        $dup->execute([':tid' => (int) $transportId, ':probe' => $probe]);
        if ($dup->fetchColumn()) return;
    }

    // 3. Insert the inbound row. sent_by is set to the system actor
    //    so the FK constraint stays happy; the row is otherwise the
    //    inverse shape of an outbound send (recipient = our number,
    //    body = what the transporter wrote).
    $systemUserId = getSystemActorId($db);
    $ins = $db->prepare(
        'INSERT INTO transport_notifications
           (transport_id, transporter_id, channel, direction, recipient, subject, body, sent_by, status, error_message, sent_at)
         VALUES
           (:tid, :rid, :ch, :dir, :rec, NULL, :body, :u, :st, :err, NOW())'
    );
    $ins->execute([
        ':tid'  => (int) $transportId,
        ':rid'  => $transporterId,
        ':ch'   => 'sms',
        ':dir'  => 'inbound',
        ':rec'  => $from,
        ':body' => mb_substr($body, 0, 4000),
        ':u'    => $systemUserId,
        ':st'   => 'sent', // status enum is sent/failed; "sent" = received OK
        ':err'  => $msgId !== '' ? ('[inbound msg_id]' . $msgId) : null,
    ]);
}

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

    // Each placeholder occurrence needs its own name — PDO with
    // ATTR_EMULATE_PREPARES=false (which we enforce in config.php)
    // uses native MySQL prepares that treat repeated `:n` as a bind
    // error (HY093). Same pattern used in leads.php's global search.
    $sql = "SELECT id FROM imported_leads_raw
             WHERE  $primary LIKE :n1
                OR $second  LIKE :n2
                OR $third   LIKE :n3
                OR $fourth  LIKE :n4
             ORDER BY id DESC
             LIMIT 1";
    $stmt = $db->prepare($sql);
    $stmt->execute([':n1' => $needle, ':n2' => $needle, ':n3' => $needle, ':n4' => $needle]);
    $row = $stmt->fetch();
    return $row ? (int) $row['id'] : null;
}

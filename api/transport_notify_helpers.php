<?php
// Shared helpers for sending a transporter a notification.
//
// Two entry points hit these functions:
//   1. POST /api/transport_notify       — the manual "Notify transporter"
//                                          modal (operator-driven, picks
//                                          channels + recipients).
//   2. PUT  /api/lead_transport         — the auto-send-on-first-assignment
//                                          path inside lead_transport.php.
//
// Pulling the body builder + per-transporter dispatch out here keeps both
// callers in sync. If we change the default copy or swap providers later,
// neither caller has to know.

require_once __DIR__ . '/pipeline.php';
require_once __DIR__ . '/marketing_send.php';   // sendEmailViaSendGrid (Gmail SMTP fallback)
require_once __DIR__ . '/outbound_helpers.php'; // dispatchOpenPhoneJob

if (!function_exists('buildDefaultTransportSubject')) {
function buildDefaultTransportSubject(array $transport, array $np): string
{
    $vehicle = $transport['vehicle_info'] ?: trim(implode(' ', array_filter([
        $np['year'] ?? null, $np['make'] ?? null, $np['model'] ?? null,
    ])));
    $vin = $np['vin'] ?? null;
    return 'Transport assignment — ' . ($vehicle ?: 'Vehicle') . ($vin ? " (VIN $vin)" : '');
}
}

if (!function_exists('buildDefaultTransportBody')) {
function buildDefaultTransportBody(array $transport, array $np): string
{
    $leadName = trim(($np['full_name'] ?? '') ?: trim(($np['first_name'] ?? '') . ' ' . ($np['last_name'] ?? '')));
    $vehicle  = $transport['vehicle_info'] ?: trim(implode(' ', array_filter([
        $np['year'] ?? null, $np['make'] ?? null, $np['model'] ?? null,
    ])));
    $vin = $np['vin'] ?? null;

    $when = $transport['transport_date'] ?? '';
    if (!empty($transport['transport_time']))  $when .= ' at ' . $transport['transport_time'];
    if (!empty($transport['time_window']))     $when .= ' (' . $transport['time_window'] . ')';

    $body  = "Hello,\n\n";
    $body .= "We have a transport job for you:\n\n";
    $body .= "Vehicle: " . ($vehicle ?: '(see attached)') . ($vin ? " — VIN $vin\n" : "\n");
    if ($leadName)                       $body .= "Customer: $leadName\n";
    if (!empty($transport['pickup_location']))   $body .= "Pickup: "   . $transport['pickup_location']   . "\n";
    if (!empty($transport['delivery_location'])) $body .= "Delivery: " . $transport['delivery_location'] . "\n";
    if ($when !== '')                            $body .= "When: $when\n";
    if (!empty($transport['notes']))             $body .= "\nNotes: " . $transport['notes'] . "\n";
    $body .= "\nPlease reply to confirm. Thank you.";
    return $body;
}
}

if (!function_exists('sendTransporterNotification')) {
/**
 * Send ONE notification to ONE transporter on ONE channel + log it.
 *
 * Inserts a transport_notifications row regardless of send success, so
 * the operator's notify-modal history shows both successful sends and
 * failed attempts (with the actual error message in fail_reason).
 *
 * @param PDO    $db
 * @param int    $transportId
 * @param array  $transport     fetched lead_transport row + normalized_payload_json
 * @param array  $transporter   transporter row (id, name, email, phone)
 * @param string $channel       'email' | 'sms' | 'manual'
 * @param int    $userId        sent_by user id (operator or system)
 * @param ?string $subject      override; if null, default is built
 * @param ?string $body         override; if null, default is built
 * @param ?string $source       free-form label written into the row's
 *                              error_message column on failure for audit
 *                              ('auto_first_assign' vs 'manual_modal')
 *
 * @return array{transporter_id:int, status:'sent'|'failed', channel:string, recipient:?string, error:?string}
 */
function sendTransporterNotification(
    PDO    $db,
    int    $transportId,
    array  $transport,
    array  $transporter,
    string $channel,
    int    $userId,
    ?string $subject = null,
    ?string $body    = null,
    ?string $source  = null
): array {
    if (!in_array($channel, TRANSPORT_NOTIFY_CHANNELS, true)) {
        throw new InvalidArgumentException("Invalid channel: $channel");
    }

    $np = json_decode($transport['normalized_payload_json'] ?? 'null', true) ?: [];
    if ($subject === null || $subject === '') $subject = buildDefaultTransportSubject($transport, $np);
    if ($body    === null || $body    === '') $body    = buildDefaultTransportBody($transport, $np);

    $recipient = $channel === 'email'
        ? ($transporter['email'] ?? null)
        : ($channel === 'sms'
            ? ($transporter['phone'] ?? null)
            : (($transporter['email'] ?? null) ?: ($transporter['phone'] ?? null)));

    $status = 'sent';
    $error  = null;
    try {
        if ($channel === 'email') {
            if (!$recipient) throw new RuntimeException('Transporter has no email');
            sendEmailViaSendGrid($recipient, $subject, $body, null);
        } elseif ($channel === 'sms') {
            if (!$recipient) throw new RuntimeException('Transporter has no phone');
            $r = dispatchOpenPhoneJob([
                'kind'       => 'sms',
                'to_address' => $recipient,
                'body'       => $body,
            ]);
            if (empty($r['ok'])) {
                throw new RuntimeException('OpenPhone send failed: ' . ($r['fail_reason'] ?? 'unknown_error'));
            }
        }
        // 'manual' falls through — logged as sent without dispatching.
    } catch (Throwable $e) {
        $status = 'failed';
        $error  = $e->getMessage();
    }

    // Tag auto-sends in the error_message audit field so the operator can
    // distinguish them from manual sends when reviewing the history. We
    // only set it on failure (the column is named error_message); on
    // success the source is implicit from sent_by + sent_at.
    $auditError = $error;
    if ($status === 'failed' && $source !== null) {
        $auditError = "[$source] " . $error;
    }

    try {
        $db->prepare(
            'INSERT INTO transport_notifications
               (transport_id, transporter_id, channel, recipient, subject, body, sent_by, status, error_message)
             VALUES (:tid, :rid, :ch, :rec, :sub, :body, :u, :st, :err)'
        )->execute([
            ':tid'  => $transportId,
            ':rid'  => (int) $transporter['id'],
            ':ch'   => $channel,
            ':rec'  => $recipient,
            ':sub'  => $subject,
            ':body' => $body,
            ':u'    => $userId,
            ':st'   => $status,
            ':err'  => $auditError,
        ]);
    } catch (Throwable $e) {
        // Logging failure shouldn't break the caller — surface via error_log.
        error_log('[transport_notify_helpers] notification insert failed: ' . $e->getMessage());
    }

    return [
        'transporter_id' => (int) $transporter['id'],
        'name'           => $transporter['name'] ?? null,
        'channel'        => $channel,
        'recipient'      => $recipient,
        'status'         => $status,
        'error'          => $error,
    ];
}
}

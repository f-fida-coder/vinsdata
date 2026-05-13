<?php

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/pipeline.php';
require_once __DIR__ . '/marketing_send.php';
initSession();

$user = requireAuth();
$db   = getDBConnection();

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $transportId = (int) ($_GET['transport_id'] ?? 0);
    if ($transportId <= 0) pipelineFail(400, 'transport_id is required', 'missing_id');
    $stmt = $db->prepare(
        'SELECT n.*, t.name AS transporter_name, u.name AS sent_by_name
           FROM transport_notifications n
           LEFT JOIN transporters t ON t.id = n.transporter_id
           LEFT JOIN users u        ON u.id = n.sent_by
          WHERE n.transport_id = :tid
          ORDER BY n.sent_at DESC
          LIMIT 200'
    );
    $stmt->execute([':tid' => $transportId]);
    $rows = $stmt->fetchAll();
    foreach ($rows as &$r) {
        $r['id']             = (int) $r['id'];
        $r['transport_id']   = (int) $r['transport_id'];
        $r['transporter_id'] = $r['transporter_id'] !== null ? (int) $r['transporter_id'] : null;
    }
    echo json_encode($rows);
    exit();
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    pipelineFail(405, 'Method not allowed', 'method_not_allowed');
}

$input = json_decode(file_get_contents('php://input'), true) ?? [];
$transportId    = (int) ($input['transport_id'] ?? 0);
$transporterIds = $input['transporter_ids'] ?? [];
$channel        = (string) ($input['channel'] ?? 'email');
$subject        = trim((string) ($input['subject'] ?? ''));
$body           = trim((string) ($input['body']    ?? ''));

if ($transportId <= 0) pipelineFail(400, 'transport_id is required', 'missing_id');
if (!in_array($channel, TRANSPORT_NOTIFY_CHANNELS, true)) {
    pipelineFail(400, "Invalid channel '$channel'", 'invalid_channel');
}
if (!is_array($transporterIds) || empty($transporterIds)) {
    pipelineFail(400, 'transporter_ids must be a non-empty array', 'missing_transporters');
}

$stmt = $db->prepare(
    'SELECT lt.*, r.normalized_payload_json
       FROM lead_transport lt
       INNER JOIN imported_leads_raw r ON r.id = lt.imported_lead_id
      WHERE lt.id = :id'
);
$stmt->execute([':id' => $transportId]);
$transport = $stmt->fetch();
if (!$transport) pipelineFail(404, 'Transport not found', 'transport_not_found');

$np = json_decode($transport['normalized_payload_json'] ?? 'null', true) ?: [];
$leadName = trim(($np['full_name'] ?? '') ?: trim(($np['first_name'] ?? '') . ' ' . ($np['last_name'] ?? '')));
$vehicle  = $transport['vehicle_info'] ?: trim(implode(' ', array_filter([
    $np['year'] ?? null, $np['make'] ?? null, $np['model'] ?? null,
])));
$vin = $np['vin'] ?? null;

if ($subject === '') {
    $subject = 'Transport assignment — ' . ($vehicle ?: 'Vehicle') . ($vin ? " (VIN $vin)" : '');
}
if ($body === '') {
    $when = $transport['transport_date'];
    if ($transport['transport_time'])  $when .= ' at ' . $transport['transport_time'];
    if ($transport['time_window'])     $when .= ' (' . $transport['time_window'] . ')';
    $body  = "Hello,\n\n";
    $body .= "We have a transport job for you:\n\n";
    $body .= "Vehicle: " . ($vehicle ?: '(see attached)') . ($vin ? " — VIN $vin\n" : "\n");
    if ($leadName)                          $body .= "Customer: $leadName\n";
    if ($transport['pickup_location'])      $body .= "Pickup: "   . $transport['pickup_location']   . "\n";
    if ($transport['delivery_location'])    $body .= "Delivery: " . $transport['delivery_location'] . "\n";
    if ($when)                              $body .= "When: $when\n";
    if ($transport['notes'])                $body .= "\nNotes: " . $transport['notes'] . "\n";
    $body .= "\nPlease reply to confirm. Thank you.";
}

$in = str_repeat('?,', count($transporterIds) - 1) . '?';
$stmt = $db->prepare("SELECT id, name, email, phone FROM transporters WHERE id IN ($in)");
$stmt->execute(array_map('intval', $transporterIds));
$transporters = $stmt->fetchAll();

$results = [];
$sentCount = 0;
foreach ($transporters as $t) {
    $tid = (int) $t['id'];
    $recipient = $channel === 'email' ? $t['email'] : ($channel === 'sms' ? $t['phone'] : ($t['email'] ?: $t['phone']));
    $status    = 'sent';
    $error     = null;
    try {
        if ($channel === 'email') {
            if (!$recipient) throw new RuntimeException('Transporter has no email');
            if (defined('MARKETING_EMAIL_PROVIDER') && MARKETING_EMAIL_PROVIDER === 'sendgrid') {
                sendEmailViaSendGrid($recipient, $subject, $body, null);
            }
            // else: stub mode — log only.
        } elseif ($channel === 'sms') {
            if (!$recipient) throw new RuntimeException('Transporter has no phone');
            // SMS provider not yet wired; treat as logged manual send.
        }
        // 'manual' is always logged as sent.
    } catch (Throwable $e) {
        $status = 'failed';
        $error  = $e->getMessage();
    }
    $ins = $db->prepare(
        'INSERT INTO transport_notifications
           (transport_id, transporter_id, channel, recipient, subject, body, sent_by, status, error_message)
         VALUES (:tid, :rid, :ch, :rec, :sub, :body, :u, :st, :err)'
    );
    $ins->execute([
        ':tid' => $transportId,
        ':rid' => $tid,
        ':ch'  => $channel,
        ':rec' => $recipient,
        ':sub' => $subject,
        ':body'=> $body,
        ':u'   => $user['id'],
        ':st'  => $status,
        ':err' => $error,
    ]);
    if ($status === 'sent') $sentCount++;
    $results[] = [
        'transporter_id' => $tid,
        'name'           => $t['name'],
        'status'         => $status,
        'error'          => $error,
    ];
}

// Bump status to 'notified' on first successful send. Don't downgrade if already
// 'assigned'/'in_transit'/'delivered' — those are forward states.
$forwardStates = ['assigned','in_transit','delivered','cancelled'];
if ($sentCount > 0 && !in_array($transport['status'], $forwardStates, true)) {
    $upd = $db->prepare('UPDATE lead_transport SET status = "notified" WHERE id = :id');
    $upd->execute([':id' => $transportId]);
    logLeadActivity($db, (int) $transport['imported_lead_id'], $user['id'], 'transport_status_changed', $transport['status'], 'notified');
}

logLeadActivity($db, (int) $transport['imported_lead_id'], $user['id'], 'transport_notified', null, [
    'channel'          => $channel,
    'transporter_ids'  => array_map('intval', $transporterIds),
    'sent_count'       => $sentCount,
]);

echo json_encode([
    'success'   => true,
    'sent'      => $sentCount,
    'attempted' => count($results),
    'results'   => $results,
    'subject'   => $subject,
    'body'      => $body,
]);

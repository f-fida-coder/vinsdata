<?php

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/pipeline.php';
// Pure email-send helpers — NOT marketing_send.php (which is a
// request handler that 405s any non-POST during the require, see
// the dispatch 405 fix commit). transport_notify_helpers also pulls
// these in for the auto-notify-on-first-assign path.
require_once __DIR__ . '/marketing_email_helpers.php';
require_once __DIR__ . '/outbound_helpers.php';
require_once __DIR__ . '/transport_notify_helpers.php';
initSession();

// Open to every authenticated role: admin, marketer, sales_agent
// (Acquisition Agent), carfax, filter, tlo. Acquisition agents
// notify their own transporters for the leads they're working;
// dispatch / stage agents notify on behalf of their pipeline.
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

// Default body / subject are built per-call by the helper if the operator
// left them blank — extracted to transport_notify_helpers so the auto-
// send path on first transporter assignment uses the same copy.

$in = str_repeat('?,', count($transporterIds) - 1) . '?';
$stmt = $db->prepare("SELECT id, name, email, phone FROM transporters WHERE id IN ($in)");
$stmt->execute(array_map('intval', $transporterIds));
$transporters = $stmt->fetchAll();

$results = [];
$sentCount = 0;
$resolvedSubject = $subject;
$resolvedBody    = $body;
foreach ($transporters as $t) {
    $result = sendTransporterNotification(
        $db,
        $transportId,
        $transport,
        $t,
        $channel,
        (int) $user['id'],
        $subject !== '' ? $subject : null,
        $body    !== '' ? $body    : null,
        'manual_modal'
    );
    if ($result['status'] === 'sent') $sentCount++;
    $results[] = $result;
}
// Resolve subject/body once for the response so the client modal can show
// the auto-generated copy if the operator left them blank.
if ($resolvedSubject === '' || $resolvedBody === '') {
    $np = json_decode($transport['normalized_payload_json'] ?? 'null', true) ?: [];
    if ($resolvedSubject === '') $resolvedSubject = buildDefaultTransportSubject($transport, $np);
    if ($resolvedBody    === '') $resolvedBody    = buildDefaultTransportBody($transport, $np);
}
$subject = $resolvedSubject;
$body    = $resolvedBody;

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

<?php
// Polled by the frontend's <RingingCallToast/> every few seconds.
// Returns any incoming-call event still worth surfacing:
//   - status = 'ringing'  AND ringing_at within the last 60 seconds
//   - has not been ack'd by this user yet
//
// Sales agents (and admins) get every active ring. Pipeline-stage
// agents (carfax/filter/tlo) only see rings that match their own
// assigned leads. This keeps the noise down on a shared phone line.
//
// POST { id, action: 'ack' } marks a ring as acknowledged so it
// doesn't keep re-firing on subsequent polls.

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/pipeline.php';
initSession();

$user = requireAuth();
$db   = getDBConnection();
$role = $user['role'] ?? null;
$uid  = (int) $user['id'];
$isFullOperator = in_array($role, ['admin', 'marketer', 'sales_agent'], true);

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    // 60-second freshness window — calls older than this stop showing
    // up as ringing-toasts. The webhook usually transitions
    // ringing → answered/completed within ~30s anyway.
    $sql = "SELECT ic.id, ic.from_number, ic.to_number, ic.status,
                   ic.matched_lead_id, ic.matched_lead_name, ic.matched_user_id,
                   u.name AS matched_user_name,
                   ic.ringing_at,
                   TIMESTAMPDIFF(SECOND, ic.ringing_at, NOW()) AS age_sec,
                   r.normalized_payload_json
              FROM inbound_calls ic
              LEFT JOIN users u ON u.id = ic.matched_user_id
              LEFT JOIN imported_leads_raw r ON r.id = ic.matched_lead_id
             WHERE ic.status = 'ringing'
               AND ic.ringing_at >= DATE_SUB(NOW(), INTERVAL 60 SECOND)
               AND (ic.ack_user_id IS NULL OR ic.ack_user_id <> :uid)";
    if (!$isFullOperator) {
        // Stage agents only see rings that resolve to leads assigned
        // to them. No assigned-user = no notification for them.
        $sql .= ' AND ic.matched_user_id = :scope_uid';
    }
    $sql .= ' ORDER BY ic.ringing_at DESC LIMIT 10';

    $params = [':uid' => $uid];
    if (!$isFullOperator) $params[':scope_uid'] = $uid;

    $stmt = $db->prepare($sql);
    $stmt->execute($params);
    $rows = $stmt->fetchAll();

    $out = array_map(function ($r) {
        $np = json_decode($r['normalized_payload_json'] ?? 'null', true) ?: [];
        $vehicle = trim(implode(' ', array_filter([
            $np['year']  ?? null,
            $np['make']  ?? null,
            $np['model'] ?? null,
        ])));
        return [
            'id'                  => (int) $r['id'],
            'from_number'         => $r['from_number'],
            'status'              => $r['status'],
            'matched_lead_id'     => $r['matched_lead_id'] !== null ? (int) $r['matched_lead_id'] : null,
            'matched_lead_name'   => $r['matched_lead_name'],
            'matched_user_name'   => $r['matched_user_name'],
            'vehicle'             => $vehicle ?: null,
            'ringing_at'          => $r['ringing_at'],
            'age_sec'             => (int) $r['age_sec'],
        ];
    }, $rows);

    // Don't cache — this is real-time.
    header('Cache-Control: no-store');
    echo json_encode(['calls' => $out]);
    exit();
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $input = json_decode(file_get_contents('php://input'), true) ?? [];
    $action = (string) ($input['action'] ?? '');
    $id     = (int) ($input['id'] ?? 0);

    if ($action !== 'ack' || $id <= 0) {
        pipelineFail(400, 'action=ack and id are required', 'bad_request');
    }

    // Ack so the toast doesn't keep re-firing for the same user. We
    // don't transition the call status here — that's the webhook's job
    // on the answered/completed event. ack just hides the surface.
    $stmt = $db->prepare(
        "UPDATE inbound_calls
            SET ack_user_id = :uid, ack_at = NOW()
          WHERE id = :id"
    );
    $stmt->execute([':uid' => $uid, ':id' => $id]);
    echo json_encode(['ok' => true]);
    exit();
}

pipelineFail(405, 'Method not allowed', 'method_not_allowed');

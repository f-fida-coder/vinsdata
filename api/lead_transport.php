<?php

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/pipeline.php';
require_once __DIR__ . '/transport_notify_helpers.php';
initSession();

$user = requireAuth();
$db   = getDBConnection();
$method = $_SERVER['REQUEST_METHOD'];

function fetchTransport(PDO $db, int $leadId): ?array
{
    $stmt = $db->prepare(
        'SELECT lt.*, t.name AS transporter_name, t.phone AS transporter_phone, t.email AS transporter_email
           FROM lead_transport lt
           LEFT JOIN transporters t ON t.id = lt.assigned_transporter_id
          WHERE lt.imported_lead_id = :lid'
    );
    $stmt->execute([':lid' => $leadId]);
    $row = $stmt->fetch();
    if (!$row) return null;
    $row['id']                      = (int) $row['id'];
    $row['imported_lead_id']        = (int) $row['imported_lead_id'];
    $row['assigned_transporter_id'] = $row['assigned_transporter_id'] !== null ? (int) $row['assigned_transporter_id'] : null;
    return $row;
}

if ($method === 'GET') {
    $leadId = (int) ($_GET['lead_id'] ?? 0);
    if ($leadId <= 0) pipelineFail(400, 'lead_id is required', 'missing_lead_id');
    loadLeadOrFail($db, $leadId);
    $row = fetchTransport($db, $leadId);
    echo json_encode($row ?: null);
    exit();
}

$input = json_decode(file_get_contents('php://input'), true) ?? [];

if ($method === 'PUT') {
    $leadId = (int) ($input['lead_id'] ?? 0);
    if ($leadId <= 0) pipelineFail(400, 'lead_id is required', 'missing_lead_id');
    loadLeadOrFail($db, $leadId);

    $allowed = [
        'transport_date', 'transport_time', 'time_window',
        'pickup_location', 'delivery_location', 'vehicle_info',
        'status', 'assigned_transporter_id', 'notes',
    ];
    $payload = [];
    foreach ($allowed as $k) {
        if (!array_key_exists($k, $input)) continue;
        $v = $input[$k];
        if ($k === 'assigned_transporter_id') {
            $v = ($v === '' || $v === null) ? null : (int) $v;
            if ($v !== null) {
                $stmt = $db->prepare('SELECT id FROM transporters WHERE id = :id');
                $stmt->execute([':id' => $v]);
                if (!$stmt->fetch()) pipelineFail(404, 'Transporter not found', 'transporter_not_found');
            }
        } elseif ($k === 'status' && $v !== null && $v !== '') {
            assertTransportStatus((string) $v);
        } else {
            $v = ($v === '' || $v === null) ? null : (is_string($v) ? trim($v) : $v);
        }
        $payload[$k] = $v;
    }

    $existing = fetchTransport($db, $leadId);
    $oldStatus = $existing['status'] ?? null;
    $oldAssignee = $existing['assigned_transporter_id'] ?? null;

    try {
        $db->beginTransaction();
        if ($existing) {
            if (empty($payload)) {
                $db->commit();
                echo json_encode(['success' => true, 'unchanged' => true, 'transport' => $existing]);
                exit();
            }
            $sets = [];
            $params = [':lid' => $leadId];
            foreach ($payload as $k => $v) {
                $sets[] = "$k = :$k";
                $params[":$k"] = $v;
            }
            $sql = 'UPDATE lead_transport SET ' . implode(', ', $sets) . ' WHERE imported_lead_id = :lid';
            $db->prepare($sql)->execute($params);
            logLeadActivity($db, $leadId, $user['id'], 'transport_updated', null, $payload);
        } else {
            $cols = ['imported_lead_id', 'created_by'];
            $vals = [':lid', ':uid'];
            $params = [':lid' => $leadId, ':uid' => $user['id']];
            foreach ($payload as $k => $v) {
                $cols[] = $k;
                $vals[] = ":$k";
                $params[":$k"] = $v;
            }
            $sql = 'INSERT INTO lead_transport (' . implode(', ', $cols) . ') VALUES (' . implode(', ', $vals) . ')';
            $db->prepare($sql)->execute($params);
            logLeadActivity($db, $leadId, $user['id'], 'transport_scheduled', null, $payload);
        }

        $newStatus = $payload['status'] ?? $oldStatus;
        if ($oldStatus !== null && $newStatus !== null && $newStatus !== $oldStatus) {
            logLeadActivity($db, $leadId, $user['id'], 'transport_status_changed', $oldStatus, $newStatus);
        }
        $newAssignee = array_key_exists('assigned_transporter_id', $payload) ? $payload['assigned_transporter_id'] : $oldAssignee;
        if ($oldAssignee !== $newAssignee && $newAssignee !== null) {
            logLeadActivity($db, $leadId, $user['id'], 'transport_assigned', $oldAssignee, $newAssignee);
        }

        $db->commit();
    } catch (Throwable $e) {
        $db->rollBack();
        pipelineFail(500, 'Transport save failed: ' . $e->getMessage(), 'db_error');
    }

    // Auto-notify on FIRST assignment. Trigger: oldAssignee was null AND
    // newAssignee is not null. We don't fire on transporter swaps (X→Y),
    // unassign (X→null), or no-ops (X→X) — the user explicitly chose
    // "first assignment only" so swaps stay manual via the Notify modal.
    //
    // Best-effort: failures are swallowed and surfaced in the response
    // so the assignment save itself never breaks because OpenPhone /
    // Gmail had a hiccup. The operator can re-fire from the manual
    // notify modal which shares the same helper.
    $autoNotifications = [];
    if ($oldAssignee === null && $newAssignee !== null) {
        try {
            // Re-fetch transport + transporter + the lead's normalized
            // payload so we can build a body identical to what the manual
            // modal would send.
            $tStmt = $db->prepare(
                'SELECT lt.*, r.normalized_payload_json
                   FROM lead_transport lt
                   JOIN imported_leads_raw r ON r.id = lt.imported_lead_id
                  WHERE lt.imported_lead_id = :lid'
            );
            $tStmt->execute([':lid' => $leadId]);
            $transportRow = $tStmt->fetch();

            $trStmt = $db->prepare('SELECT id, name, email, phone FROM transporters WHERE id = :id');
            $trStmt->execute([':id' => $newAssignee]);
            $transporter = $trStmt->fetch();

            if ($transportRow && $transporter) {
                // Fire both channels the transporter is reachable on.
                // No email on file → skip email. No phone → skip SMS.
                // (sendTransporterNotification logs a failed row with
                // "Transporter has no email/phone" if we tried anyway —
                // skipping here keeps the history clean.)
                foreach (['email', 'sms'] as $ch) {
                    $reachable = $ch === 'email' ? !empty($transporter['email']) : !empty($transporter['phone']);
                    if (!$reachable) continue;
                    $autoNotifications[] = sendTransporterNotification(
                        $db,
                        (int) $transportRow['id'],
                        $transportRow,
                        $transporter,
                        $ch,
                        (int) $user['id'],
                        null, // default subject
                        null, // default body
                        'auto_first_assign'
                    );
                }

                // Bump status to 'notified' if at least one channel
                // succeeded and we're not already past it on the state
                // machine. Mirrors what transport_notify.php does on
                // manual sends.
                $anySent = false;
                foreach ($autoNotifications as $n) {
                    if ($n['status'] === 'sent') { $anySent = true; break; }
                }
                if ($anySent) {
                    $forwardStates = ['assigned','in_transit','delivered','cancelled'];
                    if (!in_array($transportRow['status'], $forwardStates, true)) {
                        $db->prepare('UPDATE lead_transport SET status = "notified" WHERE id = :id')
                            ->execute([':id' => (int) $transportRow['id']]);
                        logLeadActivity(
                            $db, $leadId, (int) $user['id'],
                            'transport_status_changed', $transportRow['status'], 'notified'
                        );
                    }
                    logLeadActivity($db, $leadId, (int) $user['id'], 'transport_notified', null, [
                        'channel'         => implode('+', array_unique(array_map(fn($n) => $n['channel'], $autoNotifications))),
                        'transporter_ids' => [(int) $transporter['id']],
                        'sent_count'      => count(array_filter($autoNotifications, fn($n) => $n['status'] === 'sent')),
                        'auto'            => true,
                    ]);
                }
            }
        } catch (Throwable $e) {
            // Don't fail the whole save — surface in error_log + response.
            error_log('[lead_transport] auto-notify failed: ' . $e->getMessage());
            $autoNotifications[] = [
                'channel' => 'all', 'status' => 'failed',
                'error'   => $e->getMessage(),
            ];
        }
    }

    echo json_encode([
        'success'            => true,
        'transport'          => fetchTransport($db, $leadId),
        'auto_notifications' => $autoNotifications,
    ]);
    exit();
}

if ($method === 'DELETE') {
    $leadId = (int) ($input['lead_id'] ?? $_GET['lead_id'] ?? 0);
    if ($leadId <= 0) pipelineFail(400, 'lead_id is required', 'missing_lead_id');
    loadLeadOrFail($db, $leadId);
    $stmt = $db->prepare('DELETE FROM lead_transport WHERE imported_lead_id = :lid');
    $stmt->execute([':lid' => $leadId]);
    if ($stmt->rowCount() > 0) {
        logLeadActivity($db, $leadId, $user['id'], 'transport_cancelled', null, null);
    }
    echo json_encode(['success' => true]);
    exit();
}

pipelineFail(405, 'Method not allowed', 'method_not_allowed');

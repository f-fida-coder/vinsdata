<?php

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/pipeline.php';
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

    echo json_encode(['success' => true, 'transport' => fetchTransport($db, $leadId)]);
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

<?php

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/pipeline.php';
initSession();

$user = requireAuth();
$db   = getDBConnection();

/** Normalize DB price string for stable equality comparisons. null → null, '12.5' → '12.50'. */
function normalizePrice($v): ?string
{
    if ($v === null || $v === '') return null;
    return number_format((float) $v, 2, '.', '');
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $leadId = isset($_GET['lead_id']) ? (int) $_GET['lead_id'] : 0;
    if ($leadId <= 0) pipelineFail(400, 'lead_id is required', 'missing_fields');
    loadLeadOrFail($db, $leadId);

    $stmt = $db->prepare(
        'SELECT s.status, s.priority, s.lead_temperature, s.price_wanted, s.price_offered,
                s.assigned_user_id, u.name AS assigned_user_name,
                s.created_at, s.updated_at
           FROM lead_states s
           LEFT JOIN users u ON u.id = s.assigned_user_id
          WHERE s.imported_lead_id = :lid'
    );
    $stmt->execute([':lid' => $leadId]);
    $row = $stmt->fetch();
    if (!$row) {
        echo json_encode([
            'status'             => DEFAULT_LEAD_STATE['status'],
            'priority'           => DEFAULT_LEAD_STATE['priority'],
            'lead_temperature'   => null,
            'price_wanted'       => null,
            'price_offered'      => null,
            'assigned_user_id'   => null,
            'assigned_user_name' => null,
            'is_default'         => true,
        ]);
        exit();
    }
    $row['assigned_user_id'] = $row['assigned_user_id'] !== null ? (int) $row['assigned_user_id'] : null;
    $row['price_wanted']     = $row['price_wanted']  !== null ? (float) $row['price_wanted']  : null;
    $row['price_offered']    = $row['price_offered'] !== null ? (float) $row['price_offered'] : null;
    $row['is_default'] = false;
    echo json_encode($row);
    exit();
}

if ($_SERVER['REQUEST_METHOD'] === 'PUT') {
    $input = json_decode(file_get_contents('php://input'), true) ?? [];
    $leadId = (int) ($input['lead_id'] ?? 0);
    if ($leadId <= 0) pipelineFail(400, 'lead_id is required', 'missing_fields');
    loadLeadOrFail($db, $leadId);

    // Load current (or defaults). Fetch every column we may touch.
    $stmt = $db->prepare(
        'SELECT status, priority, assigned_user_id, lead_temperature, price_wanted, price_offered
           FROM lead_states WHERE imported_lead_id = :lid'
    );
    $stmt->execute([':lid' => $leadId]);
    $row = $stmt->fetch();

    $current = $row ?: DEFAULT_LEAD_STATE;
    $currentAssignee    = isset($current['assigned_user_id']) && $current['assigned_user_id'] !== null
        ? (int) $current['assigned_user_id'] : null;
    $currentTemperature = $current['lead_temperature'] ?? null;
    $currentWanted      = normalizePrice($current['price_wanted']  ?? null);
    $currentOffered     = normalizePrice($current['price_offered'] ?? null);

    $next = [
        'status'           => $current['status'],
        'priority'         => $current['priority'],
        'assigned_user_id' => $currentAssignee,
        'lead_temperature' => $currentTemperature,
        'price_wanted'     => $currentWanted,
        'price_offered'    => $currentOffered,
    ];

    $changes = [];  // [activity_type, old, new]

    if (array_key_exists('status', $input) && $input['status'] !== null) {
        assertLeadStatus((string) $input['status']);
        if ($input['status'] !== $current['status']) {
            $changes[] = ['status_changed', $current['status'], $input['status']];
            $next['status'] = $input['status'];
        }
    }

    if (array_key_exists('priority', $input) && $input['priority'] !== null) {
        assertLeadPriority((string) $input['priority']);
        if ($input['priority'] !== $current['priority']) {
            $changes[] = ['priority_changed', $current['priority'], $input['priority']];
            $next['priority'] = $input['priority'];
        }
    }

    if (array_key_exists('assigned_user_id', $input)) {
        if (($user['role'] ?? null) !== 'admin') {
            pipelineFail(403, 'Only admin can change assignment', 'admin_required');
        }
        $newAssignee = $input['assigned_user_id'];
        $newAssignee = ($newAssignee === null || $newAssignee === '') ? null : (int) $newAssignee;
        if ($newAssignee !== null) {
            $stmt = $db->prepare('SELECT id, name FROM users WHERE id = :id');
            $stmt->execute([':id' => $newAssignee]);
            if (!$stmt->fetch()) pipelineFail(404, 'Assigned user not found', 'user_not_found');
        }
        if ($newAssignee !== $currentAssignee) {
            $changes[] = [$newAssignee === null ? 'unassigned' : 'assigned', $currentAssignee, $newAssignee];
            $next['assigned_user_id'] = $newAssignee;
        }
    }

    if (array_key_exists('lead_temperature', $input)) {
        $newTemp = $input['lead_temperature'];
        $newTemp = ($newTemp === '' || $newTemp === null) ? null : (string) $newTemp;
        assertLeadTemperature($newTemp);
        if ($newTemp !== $currentTemperature) {
            $changes[] = ['temperature_changed', $currentTemperature, $newTemp];
            $next['lead_temperature'] = $newTemp;
        }
    }

    if (array_key_exists('price_wanted', $input)) {
        $newWanted = parseLeadPrice($input['price_wanted'], 'price_wanted');
        if ($newWanted !== $currentWanted) {
            $changes[] = [
                'price_wanted_changed',
                $currentWanted !== null ? (float) $currentWanted : null,
                $newWanted     !== null ? (float) $newWanted     : null,
            ];
            $next['price_wanted'] = $newWanted;
        }
    }

    if (array_key_exists('price_offered', $input)) {
        $newOffered = parseLeadPrice($input['price_offered'], 'price_offered');
        if ($newOffered !== $currentOffered) {
            $changes[] = [
                'price_offered_changed',
                $currentOffered !== null ? (float) $currentOffered : null,
                $newOffered     !== null ? (float) $newOffered     : null,
            ];
            $next['price_offered'] = $newOffered;
        }
    }

    if (empty($changes)) {
        echo json_encode(['success' => true, 'unchanged' => true]);
        exit();
    }

    try {
        $db->beginTransaction();
        $stmt = $db->prepare(
            'INSERT INTO lead_states
               (imported_lead_id, status, priority, assigned_user_id, lead_temperature, price_wanted, price_offered)
             VALUES (:lid, :status, :priority, :assignee, :temp, :wanted, :offered)
             ON DUPLICATE KEY UPDATE
               status = VALUES(status),
               priority = VALUES(priority),
               assigned_user_id = VALUES(assigned_user_id),
               lead_temperature = VALUES(lead_temperature),
               price_wanted = VALUES(price_wanted),
               price_offered = VALUES(price_offered)'
        );
        $stmt->execute([
            ':lid'      => $leadId,
            ':status'   => $next['status'],
            ':priority' => $next['priority'],
            ':assignee' => $next['assigned_user_id'],
            ':temp'     => $next['lead_temperature'],
            ':wanted'   => $next['price_wanted'],
            ':offered'  => $next['price_offered'],
        ]);
        foreach ($changes as [$type, $old, $new]) {
            logLeadActivity($db, $leadId, $user['id'], $type, $old, $new);
        }
        $db->commit();
    } catch (Throwable $e) {
        $db->rollBack();
        pipelineFail(500, 'State update failed: ' . $e->getMessage(), 'db_error');
    }

    echo json_encode(['success' => true, 'changes' => count($changes), 'state' => $next]);
    exit();
}

pipelineFail(405, 'Method not allowed', 'method_not_allowed');

<?php
// Soft-delete + restore + hard-delete for leads.
//
// POST /api/lead_archive { lead_id, action: 'archive'|'restore' }
//   - archive: sets deleted_at = NOW(), deleted_by = current user. Lead
//     vanishes from /leads, /pipeline, /tasks, /reports default views.
//     Related rows (lead_states, lead_tasks, BoSes, activities, etc.)
//     are NOT cascaded — they stay intact so a restore puts everything
//     back without data loss.
//   - restore: clears deleted_at + deleted_by. Lead reappears in
//     default views with all its history.
//
// DELETE /api/lead_archive { lead_id }   — admin only
//   Hard delete. Removes the lead row; ON DELETE CASCADE on the
//   child FKs handles the rest. Used by the Archived view's "Purge
//   permanently" action.

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/pipeline.php';
initSession();

$user = requireAuth();
$db   = getDBConnection();

$method = $_SERVER['REQUEST_METHOD'];

if ($method !== 'POST' && $method !== 'DELETE') {
    pipelineFail(405, 'Method not allowed', 'method_not_allowed');
}

$input  = json_decode(file_get_contents('php://input'), true) ?? [];
$leadId = (int) ($input['lead_id'] ?? 0);
if ($leadId <= 0) pipelineFail(400, 'lead_id is required', 'missing_fields');

if ($method === 'DELETE') {
    if (($user['role'] ?? null) !== 'admin') {
        pipelineFail(403, 'Only admin can purge leads permanently', 'admin_required');
    }
    // Hard delete. CASCADE handles child tables. We don't soft-check
    // archive-first here: admin tooling occasionally needs to nuke a
    // live row (e.g., bad import). The admin confirm modal is the gate.
    $stmt = $db->prepare('DELETE FROM imported_leads_raw WHERE id = :id');
    $stmt->execute([':id' => $leadId]);
    echo json_encode(['success' => true, 'deleted' => (int) $stmt->rowCount()]);
    exit();
}

// POST — archive or restore.
$action = (string) ($input['action'] ?? '');
if (!in_array($action, ['archive', 'restore'], true)) {
    pipelineFail(400, "action must be 'archive' or 'restore'", 'invalid_action');
}

// Load row to confirm it exists + know current state for the activity log.
$stmt = $db->prepare('SELECT id, deleted_at FROM imported_leads_raw WHERE id = :id');
$stmt->execute([':id' => $leadId]);
$row = $stmt->fetch();
if (!$row) pipelineFail(404, 'Lead not found', 'lead_not_found');

$alreadyArchived = $row['deleted_at'] !== null;

try {
    $db->beginTransaction();

    if ($action === 'archive') {
        if ($alreadyArchived) {
            $db->rollBack();
            echo json_encode(['success' => true, 'unchanged' => true, 'state' => 'archived']);
            exit();
        }
        $db->prepare(
            'UPDATE imported_leads_raw
                SET deleted_at = NOW(),
                    deleted_by = :uid
              WHERE id = :id'
        )->execute([':uid' => $user['id'], ':id' => $leadId]);
        logLeadActivity($db, $leadId, (int) $user['id'], 'lead_archived', null, [
            'reason' => $input['reason'] ?? null,
        ]);
    } else {
        // restore
        if (!$alreadyArchived) {
            $db->rollBack();
            echo json_encode(['success' => true, 'unchanged' => true, 'state' => 'active']);
            exit();
        }
        $db->prepare(
            'UPDATE imported_leads_raw
                SET deleted_at = NULL,
                    deleted_by = NULL
              WHERE id = :id'
        )->execute([':id' => $leadId]);
        logLeadActivity($db, $leadId, (int) $user['id'], 'lead_restored', null, null);
    }

    $db->commit();
} catch (Throwable $e) {
    if ($db->inTransaction()) $db->rollBack();
    pipelineFail(500, ucfirst($action) . ' failed: ' . $e->getMessage(), 'db_error');
}

echo json_encode([
    'success' => true,
    'lead_id' => $leadId,
    'state'   => $action === 'archive' ? 'archived' : 'active',
]);

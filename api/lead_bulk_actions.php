<?php

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/pipeline.php';
initSession();

$user = requireAuth();
$db   = getDBConnection();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    pipelineFail(405, 'Method not allowed', 'method_not_allowed');
}

const BULK_MAX_LEADS = 500;

const BULK_ACTIONS = [
    'set_status', 'set_priority', 'assign',
    'add_label', 'remove_label', 'create_task',
    'send_to_marketing',
];

$input = json_decode(file_get_contents('php://input'), true) ?? [];

$action  = $input['action']   ?? null;
$leadIds = $input['lead_ids'] ?? [];
$payload = $input['payload']  ?? [];

if (!in_array($action, BULK_ACTIONS, true)) {
    pipelineFail(400, "Invalid action '$action'", 'invalid_action');
}
if (!is_array($leadIds) || empty($leadIds)) {
    pipelineFail(400, 'lead_ids is required', 'missing_fields');
}
if (count($leadIds) > BULK_MAX_LEADS) {
    pipelineFail(400, 'Too many lead_ids (max ' . BULK_MAX_LEADS . ')', 'too_many_leads');
}
$leadIds = array_values(array_unique(array_map('intval', $leadIds)));
$leadIds = array_values(array_filter($leadIds, fn($id) => $id > 0));
if (empty($leadIds)) {
    pipelineFail(400, 'lead_ids contained no valid integers', 'missing_fields');
}
if (!is_array($payload)) {
    pipelineFail(400, 'payload must be an object', 'invalid_payload');
}

// Upfront payload validation + whole-batch permission check. We validate once so
// a misconfigured batch is rejected cleanly rather than producing N identical row failures.

$prepared = [];

switch ($action) {
    case 'set_status': {
        $status = $payload['status'] ?? null;
        if (!is_string($status)) pipelineFail(400, 'status is required', 'missing_fields');
        assertLeadStatus($status);
        $prepared['status'] = $status;
        break;
    }
    case 'set_priority': {
        $priority = $payload['priority'] ?? null;
        if (!is_string($priority)) pipelineFail(400, 'priority is required', 'missing_fields');
        assertLeadPriority($priority);
        $prepared['priority'] = $priority;
        break;
    }
    case 'assign': {
        if (($user['role'] ?? null) !== 'admin') {
            pipelineFail(403, 'Only admin can change assignment', 'admin_required');
        }
        $assignee = $payload['assigned_user_id'] ?? null;
        $assignee = ($assignee === null || $assignee === '') ? null : (int) $assignee;
        if ($assignee !== null) {
            $stmt = $db->prepare('SELECT id FROM users WHERE id = :id');
            $stmt->execute([':id' => $assignee]);
            if (!$stmt->fetch()) pipelineFail(404, 'Assigned user not found', 'user_not_found');
        }
        $prepared['assigned_user_id'] = $assignee;
        break;
    }
    case 'add_label':
    case 'remove_label': {
        $labelId = (int) ($payload['label_id'] ?? 0);
        if ($labelId <= 0) pipelineFail(400, 'label_id is required', 'missing_fields');
        $stmt = $db->prepare('SELECT id, name FROM lead_labels WHERE id = :id');
        $stmt->execute([':id' => $labelId]);
        $label = $stmt->fetch();
        if (!$label) pipelineFail(404, 'Label not found', 'label_not_found');
        $prepared['label_id']   = $labelId;
        $prepared['label_name'] = $label['name'];
        break;
    }
    case 'send_to_marketing': {
        // No payload required. Sets status → 'marketing' and logs a timeline event.
        break;
    }
    case 'create_task': {
        $title = trim((string) ($payload['title'] ?? ''));
        if ($title === '') pipelineFail(400, 'title is required', 'missing_fields');
        if (mb_strlen($title) > 255) pipelineFail(400, 'title too long', 'title_too_long');
        $taskType = $payload['task_type'] ?? 'follow_up';
        assertTaskType($taskType);
        $notes  = isset($payload['notes']) ? trim((string) $payload['notes']) : null;
        if ($notes !== null && mb_strlen($notes) > 5000) pipelineFail(400, 'notes too long', 'notes_too_long');
        $dueAt  = parseDatetime($payload['due_at'] ?? null, 'due_at');
        $assignee = $payload['assigned_user_id'] ?? null;
        $assignee = ($assignee === null || $assignee === '') ? null : (int) $assignee;
        if ($assignee !== null) {
            $stmt = $db->prepare('SELECT id FROM users WHERE id = :id');
            $stmt->execute([':id' => $assignee]);
            if (!$stmt->fetch()) pipelineFail(404, 'Assigned user not found', 'user_not_found');
        }
        $prepared['title']            = $title;
        $prepared['task_type']        = $taskType;
        $prepared['notes']            = $notes;
        $prepared['due_at']           = $dueAt;
        $prepared['assigned_user_id'] = $assignee;
        break;
    }
}

$actorId = (int) $user['id'];
$results = [];
$totals  = ['total' => count($leadIds), 'succeeded' => 0, 'failed' => 0, 'skipped' => 0];

// Cache lookups used by every branch.
$leadExistsStmt = $db->prepare('SELECT id FROM imported_leads_raw WHERE id = :id');

foreach ($leadIds as $leadId) {
    try {
        $leadExistsStmt->execute([':id' => $leadId]);
        if (!$leadExistsStmt->fetch()) {
            throw new BulkError('lead_not_found', 'Lead not found');
        }

        $activityCount = 0;
        $skipped       = false;

        switch ($action) {
            case 'set_status':
            case 'set_priority':
            case 'assign': {
                // Mirror lead_state.php: diff against current, upsert if changed, emit activity.
                $curStmt = $db->prepare(
                    'SELECT status, priority, assigned_user_id FROM lead_states WHERE imported_lead_id = :lid'
                );
                $curStmt->execute([':lid' => $leadId]);
                $cur = $curStmt->fetch() ?: DEFAULT_LEAD_STATE;
                $curAssignee = isset($cur['assigned_user_id']) && $cur['assigned_user_id'] !== null
                    ? (int) $cur['assigned_user_id'] : null;

                $nextStatus   = $cur['status']   ?? 'new';
                $nextPriority = $cur['priority'] ?? 'medium';
                $nextAssignee = $curAssignee;

                $activityEvents = [];

                if ($action === 'set_status' && $prepared['status'] !== $cur['status']) {
                    $activityEvents[] = ['status_changed',   $cur['status'],   $prepared['status']];
                    $nextStatus = $prepared['status'];
                }
                if ($action === 'set_priority' && $prepared['priority'] !== $cur['priority']) {
                    $activityEvents[] = ['priority_changed', $cur['priority'], $prepared['priority']];
                    $nextPriority = $prepared['priority'];
                }
                if ($action === 'assign') {
                    $target = $prepared['assigned_user_id'];
                    if ($target !== $curAssignee) {
                        $activityEvents[] = [$target === null ? 'unassigned' : 'assigned', $curAssignee, $target];
                        $nextAssignee = $target;
                    }
                }

                if (empty($activityEvents)) {
                    $skipped = true;
                    break;
                }

                $db->beginTransaction();
                try {
                    $stmt = $db->prepare(
                        'INSERT INTO lead_states (imported_lead_id, status, priority, assigned_user_id)
                         VALUES (:lid, :status, :priority, :assignee)
                         ON DUPLICATE KEY UPDATE
                           status = VALUES(status),
                           priority = VALUES(priority),
                           assigned_user_id = VALUES(assigned_user_id)'
                    );
                    $stmt->execute([
                        ':lid'      => $leadId,
                        ':status'   => $nextStatus,
                        ':priority' => $nextPriority,
                        ':assignee' => $nextAssignee,
                    ]);
                    foreach ($activityEvents as [$type, $old, $new]) {
                        logLeadActivity($db, $leadId, $actorId, $type, $old, $new);
                        $activityCount++;
                    }
                    $db->commit();
                } catch (Throwable $e) {
                    $db->rollBack();
                    throw $e;
                }
                break;
            }

            case 'send_to_marketing': {
                $curStmt = $db->prepare(
                    'SELECT status, priority, assigned_user_id FROM lead_states WHERE imported_lead_id = :lid'
                );
                $curStmt->execute([':lid' => $leadId]);
                $cur = $curStmt->fetch() ?: DEFAULT_LEAD_STATE;
                if (($cur['status'] ?? 'new') === 'marketing') {
                    $skipped = true;
                    break;
                }
                $db->beginTransaction();
                try {
                    $stmt = $db->prepare(
                        'INSERT INTO lead_states (imported_lead_id, status, priority, assigned_user_id)
                         VALUES (:lid, "marketing", :priority, :assignee)
                         ON DUPLICATE KEY UPDATE status = VALUES(status)'
                    );
                    $stmt->execute([
                        ':lid'      => $leadId,
                        ':priority' => $cur['priority']         ?? 'medium',
                        ':assignee' => $cur['assigned_user_id'] ?? null,
                    ]);
                    logLeadActivity($db, $leadId, $actorId, 'status_changed', $cur['status'] ?? 'new', 'marketing');
                    logLeadActivity($db, $leadId, $actorId, 'moved_to_marketing');
                    $activityCount = 2;
                    $db->commit();
                } catch (Throwable $e) {
                    $db->rollBack();
                    throw $e;
                }
                break;
            }

            case 'add_label': {
                $db->beginTransaction();
                try {
                    $stmt = $db->prepare(
                        'INSERT IGNORE INTO lead_label_links (imported_lead_id, label_id, created_by)
                         VALUES (:l, :la, :u)'
                    );
                    $stmt->execute([':l' => $leadId, ':la' => $prepared['label_id'], ':u' => $actorId]);
                    if ($stmt->rowCount() === 0) {
                        $skipped = true;
                    } else {
                        logLeadActivity($db, $leadId, $actorId, 'label_added', null, [
                            'label_id' => $prepared['label_id'],
                            'name'     => $prepared['label_name'],
                        ]);
                        $activityCount = 1;
                    }
                    $db->commit();
                } catch (Throwable $e) {
                    $db->rollBack();
                    throw $e;
                }
                break;
            }

            case 'remove_label': {
                $db->beginTransaction();
                try {
                    $stmt = $db->prepare(
                        'DELETE FROM lead_label_links WHERE imported_lead_id = :l AND label_id = :la'
                    );
                    $stmt->execute([':l' => $leadId, ':la' => $prepared['label_id']]);
                    if ($stmt->rowCount() === 0) {
                        $skipped = true;
                    } else {
                        logLeadActivity($db, $leadId, $actorId, 'label_removed', [
                            'label_id' => $prepared['label_id'],
                            'name'     => $prepared['label_name'],
                        ], null);
                        $activityCount = 1;
                    }
                    $db->commit();
                } catch (Throwable $e) {
                    $db->rollBack();
                    throw $e;
                }
                break;
            }

            case 'create_task': {
                $db->beginTransaction();
                try {
                    $stmt = $db->prepare(
                        'INSERT INTO lead_tasks
                           (imported_lead_id, assigned_user_id, task_type, title, notes, due_at, created_by)
                         VALUES (:lid, :au, :type, :title, :notes, :due, :by)'
                    );
                    $stmt->execute([
                        ':lid'   => $leadId,
                        ':au'    => $prepared['assigned_user_id'],
                        ':type'  => $prepared['task_type'],
                        ':title' => $prepared['title'],
                        ':notes' => $prepared['notes'],
                        ':due'   => $prepared['due_at'],
                        ':by'    => $actorId,
                    ]);
                    $taskId = (int) $db->lastInsertId();
                    logLeadActivity($db, $leadId, $actorId, 'task_created', null, [
                        'task_id'           => $taskId,
                        'title'             => $prepared['title'],
                        'task_type'         => $prepared['task_type'],
                        'due_at'            => $prepared['due_at'],
                        'assigned_user_id'  => $prepared['assigned_user_id'],
                    ]);
                    $activityCount = 1;

                    // Mirror single-lead behaviour: notify assignee on create if not the actor.
                    if ($prepared['assigned_user_id'] !== null && $prepared['assigned_user_id'] !== $actorId) {
                        createNotification(
                            $db, $prepared['assigned_user_id'], 'task_assigned',
                            "task_assigned:$taskId:" . $prepared['assigned_user_id'],
                            'Task assigned: ' . $prepared['title'],
                            $prepared['due_at'] ? 'Due ' . $prepared['due_at'] : null,
                            $leadId, $taskId
                        );
                    }
                    $db->commit();
                } catch (Throwable $e) {
                    $db->rollBack();
                    throw $e;
                }
                break;
            }
        }

        if ($skipped) {
            $totals['skipped']++;
            $results[] = ['lead_id' => $leadId, 'ok' => true, 'skipped' => true, 'activity_count' => 0];
        } else {
            $totals['succeeded']++;
            $results[] = ['lead_id' => $leadId, 'ok' => true, 'activity_count' => $activityCount];
        }
    } catch (BulkError $e) {
        $totals['failed']++;
        $results[] = ['lead_id' => $leadId, 'ok' => false, 'code' => $e->errCode, 'message' => $e->getMessage()];
    } catch (Throwable $e) {
        $totals['failed']++;
        $results[] = [
            'lead_id' => $leadId,
            'ok'      => false,
            'code'    => 'internal_error',
            'message' => substr($e->getMessage(), 0, 200),
        ];
    }
}

echo json_encode([
    'success'   => true,
    'action'    => $action,
    'total'     => $totals['total'],
    'succeeded' => $totals['succeeded'],
    'skipped'   => $totals['skipped'],
    'failed'    => $totals['failed'],
    'results'   => $results,
]);

class BulkError extends Exception
{
    public string $errCode;
    public function __construct(string $errCode, string $message)
    {
        parent::__construct($message);
        $this->errCode = $errCode;
    }
}

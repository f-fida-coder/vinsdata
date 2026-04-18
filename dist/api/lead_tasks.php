<?php

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/pipeline.php';
initSession();

$user = requireAuth();
$db   = getDBConnection();

/**
 * Shapes a lead_tasks row for the frontend.
 * Expects JOINs with users (assigned + creator + completer) and optionally lead/batch/file info.
 */
function formatTask(array $r): array
{
    return [
        'id'                  => (int) $r['id'],
        'imported_lead_id'    => (int) $r['imported_lead_id'],
        'title'               => $r['title'],
        'notes'               => $r['notes'],
        'task_type'           => $r['task_type'],
        'status'              => $r['status'],
        'due_at'              => $r['due_at'],
        'completed_at'        => $r['completed_at'],
        'created_at'          => $r['created_at'],
        'updated_at'          => $r['updated_at'],
        'assigned_user_id'    => $r['assigned_user_id'] !== null ? (int) $r['assigned_user_id'] : null,
        'assigned_user_name'  => $r['assigned_user_name'] ?? null,
        'created_by'          => (int) $r['created_by'],
        'created_by_name'     => $r['created_by_name'] ?? null,
        'completed_by'        => $r['completed_by'] !== null ? (int) $r['completed_by'] : null,
        'completed_by_name'   => $r['completed_by_name'] ?? null,
        // optional lead-context columns when serving queue views:
        'lead' => isset($r['lead_display_name']) ? [
            'imported_lead_id' => (int) $r['imported_lead_id'],
            'display_name'     => $r['lead_display_name'],
            'batch_name'       => $r['batch_name']   ?? null,
            'vin'              => $r['lead_vin']     ?? null,
            'phone'            => $r['lead_phone']   ?? null,
        ] : null,
    ];
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $baseSelect = 'SELECT t.id, t.imported_lead_id, t.assigned_user_id, t.task_type, t.title, t.notes,
                          t.due_at, t.status, t.created_by, t.completed_at, t.completed_by,
                          t.created_at, t.updated_at,
                          au.name AS assigned_user_name,
                          cu.name AS created_by_name,
                          pu.name AS completed_by_name';

    // Lead / batch context included in queue mode so the Tasks page can render rows.
    $leadJoin = ' LEFT JOIN users au ON au.id = t.assigned_user_id
                  JOIN users cu ON cu.id = t.created_by
                  LEFT JOIN users pu ON pu.id = t.completed_by';

    // Detail-for-lead mode
    if (isset($_GET['lead_id'])) {
        $leadId = (int) $_GET['lead_id'];
        if ($leadId <= 0) pipelineFail(400, 'lead_id is required', 'missing_fields');
        loadLeadOrFail($db, $leadId);

        $stmt = $db->prepare(
            $baseSelect . ' FROM lead_tasks t' . $leadJoin .
            ' WHERE t.imported_lead_id = :lid
              ORDER BY
                FIELD(t.status, \'open\', \'completed\', \'cancelled\'),
                CASE WHEN t.due_at IS NULL THEN 1 ELSE 0 END,
                t.due_at ASC,
                t.id DESC'
        );
        $stmt->execute([':lid' => $leadId]);
        echo json_encode(array_map('formatTask', $stmt->fetchAll()));
        exit();
    }

    // Queue mode
    if (isset($_GET['queue'])) {
        $queue = $_GET['queue'];
        $assigneeFilter = $_GET['assigned_user_id'] ?? null; // 'me' | id | null
        $limit = max(1, min(500, (int) ($_GET['limit'] ?? 200)));

        $where  = [];
        $params = [];

        switch ($queue) {
            case 'mine_open':
                $where[] = "t.status = 'open'";
                $where[] = 't.assigned_user_id = :uid';
                $params[':uid'] = $user['id'];
                break;
            case 'due_today':
                $where[] = "t.status = 'open'";
                $where[] = 't.due_at IS NOT NULL';
                $where[] = 'DATE(t.due_at) = CURDATE()';
                break;
            case 'overdue':
                $where[] = "t.status = 'open'";
                $where[] = 't.due_at IS NOT NULL';
                $where[] = 't.due_at < NOW()';
                break;
            case 'all_open':
                $where[] = "t.status = 'open'";
                break;
            default:
                pipelineFail(400, "Invalid queue '$queue'", 'invalid_queue');
        }

        if ($assigneeFilter !== null && $assigneeFilter !== '' && $queue !== 'mine_open') {
            if ($assigneeFilter === 'me') {
                $where[] = 't.assigned_user_id = :uid';
                $params[':uid'] = $user['id'];
            } elseif ($assigneeFilter === 'unassigned') {
                $where[] = 't.assigned_user_id IS NULL';
            } else {
                $where[] = 't.assigned_user_id = :afu';
                $params[':afu'] = (int) $assigneeFilter;
            }
        }

        $whereSql = implode(' AND ', $where);

        $sql = "$baseSelect,
                       f.display_name AS lead_display_name,
                       b.batch_name,
                       JSON_UNQUOTE(JSON_EXTRACT(r.normalized_payload_json, '$.vin'))           AS lead_vin,
                       JSON_UNQUOTE(JSON_EXTRACT(r.normalized_payload_json, '$.phone_primary')) AS lead_phone
                  FROM lead_tasks t
                  JOIN imported_leads_raw r  ON r.id = t.imported_lead_id
                  JOIN lead_import_batches b ON b.id = r.batch_id
                  JOIN files f               ON f.id = b.file_id
                  LEFT JOIN users au ON au.id = t.assigned_user_id
                  JOIN users cu      ON cu.id = t.created_by
                  LEFT JOIN users pu ON pu.id = t.completed_by
                 WHERE $whereSql
                 ORDER BY
                   CASE WHEN t.due_at IS NULL THEN 1 ELSE 0 END,
                   t.due_at ASC,
                   t.id DESC
                 LIMIT :limit";
        $stmt = $db->prepare($sql);
        foreach ($params as $k => $v) {
            $stmt->bindValue($k, $v, is_int($v) ? PDO::PARAM_INT : PDO::PARAM_STR);
        }
        $stmt->bindValue(':limit', $limit, PDO::PARAM_INT);
        $stmt->execute();
        echo json_encode(array_map('formatTask', $stmt->fetchAll()));
        exit();
    }

    pipelineFail(400, 'lead_id or queue is required', 'missing_fields');
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $input = json_decode(file_get_contents('php://input'), true) ?? [];
    $leadId   = (int) ($input['lead_id'] ?? 0);
    $title    = trim((string) ($input['title'] ?? ''));
    $type     = $input['task_type'] ?? 'follow_up';
    $notes    = isset($input['notes']) ? trim((string) $input['notes']) : null;
    $dueAt    = parseDatetime($input['due_at'] ?? null, 'due_at');
    $assignee = $input['assigned_user_id'] ?? null;
    $assignee = ($assignee === null || $assignee === '') ? null : (int) $assignee;

    if ($leadId <= 0) pipelineFail(400, 'lead_id is required', 'missing_fields');
    if ($title === '') pipelineFail(400, 'title is required', 'missing_fields');
    if (mb_strlen($title) > 255) pipelineFail(400, 'title too long', 'title_too_long');
    if ($notes !== null && mb_strlen($notes) > 5000) pipelineFail(400, 'notes too long', 'notes_too_long');
    assertTaskType($type);
    loadLeadOrFail($db, $leadId);

    if ($assignee !== null) {
        $stmt = $db->prepare('SELECT id FROM users WHERE id = :id');
        $stmt->execute([':id' => $assignee]);
        if (!$stmt->fetch()) pipelineFail(404, 'Assigned user not found', 'user_not_found');
    }

    try {
        $db->beginTransaction();
        $stmt = $db->prepare(
            'INSERT INTO lead_tasks
               (imported_lead_id, assigned_user_id, task_type, title, notes, due_at, created_by)
             VALUES (:lid, :au, :type, :title, :notes, :due, :by)'
        );
        $stmt->execute([
            ':lid'   => $leadId,
            ':au'    => $assignee,
            ':type'  => $type,
            ':title' => $title,
            ':notes' => $notes,
            ':due'   => $dueAt,
            ':by'    => $user['id'],
        ]);
        $taskId = (int) $db->lastInsertId();
        logLeadActivity($db, $leadId, $user['id'], 'task_created', null, [
            'task_id'           => $taskId,
            'title'             => $title,
            'task_type'         => $type,
            'due_at'            => $dueAt,
            'assigned_user_id'  => $assignee,
        ]);

        // Notify the assignee (if set and not the actor themselves).
        if ($assignee !== null && $assignee !== (int) $user['id']) {
            createNotification(
                $db, $assignee, 'task_assigned',
                "task_assigned:$taskId:$assignee",
                "Task assigned: $title",
                $dueAt ? "Due $dueAt" : null,
                $leadId, $taskId
            );
        }

        $db->commit();
    } catch (Throwable $e) {
        if ($db->inTransaction()) $db->rollBack();
        pipelineFail(500, 'Create task failed: ' . $e->getMessage(), 'db_error');
    }

    echo json_encode(['success' => true, 'id' => $taskId]);
    exit();
}

if ($_SERVER['REQUEST_METHOD'] === 'PATCH') {
    $input = json_decode(file_get_contents('php://input'), true) ?? [];
    $id = (int) ($input['id'] ?? 0);
    if ($id <= 0) pipelineFail(400, 'id is required', 'missing_fields');

    $stmt = $db->prepare('SELECT * FROM lead_tasks WHERE id = :id');
    $stmt->execute([':id' => $id]);
    $task = $stmt->fetch();
    if (!$task) pipelineFail(404, 'Task not found', 'task_not_found');

    $leadId  = (int) $task['imported_lead_id'];
    $isAdmin = ($user['role'] ?? null) === 'admin';
    $isOwner = (int) $task['created_by'] === (int) $user['id'];

    // Action-style updates: complete / cancel / reopen
    if (isset($input['action'])) {
        $action = $input['action'];

        if ($action === 'complete') {
            // Any authenticated user can complete a task.
            if ($task['status'] !== 'open') {
                pipelineFail(409, 'Only open tasks can be completed', 'task_not_editable');
            }
            try {
                $db->beginTransaction();
                $stmt = $db->prepare(
                    "UPDATE lead_tasks
                        SET status='completed', completed_at=NOW(), completed_by=:by
                      WHERE id=:id"
                );
                $stmt->execute([':by' => $user['id'], ':id' => $id]);
                logLeadActivity($db, $leadId, $user['id'], 'task_completed',
                    ['task_id' => $id, 'title' => $task['title']],
                    ['task_id' => $id, 'completed_at' => date('Y-m-d H:i:s')]
                );
                $db->commit();
            } catch (Throwable $e) {
                if ($db->inTransaction()) $db->rollBack();
                pipelineFail(500, 'Complete failed: ' . $e->getMessage(), 'db_error');
            }
            echo json_encode(['success' => true]);
            exit();
        }

        if ($action === 'cancel') {
            if (!$isAdmin && !$isOwner) pipelineFail(403, 'Only creator or admin can cancel a task', 'task_forbidden');
            if ($task['status'] !== 'open') pipelineFail(409, 'Only open tasks can be cancelled', 'task_not_editable');
            try {
                $db->beginTransaction();
                $stmt = $db->prepare("UPDATE lead_tasks SET status='cancelled' WHERE id=:id");
                $stmt->execute([':id' => $id]);
                logLeadActivity($db, $leadId, $user['id'], 'task_cancelled',
                    ['task_id' => $id, 'title' => $task['title'], 'previous_status' => 'open'],
                    ['task_id' => $id]
                );
                $db->commit();
            } catch (Throwable $e) {
                if ($db->inTransaction()) $db->rollBack();
                pipelineFail(500, 'Cancel failed: ' . $e->getMessage(), 'db_error');
            }
            echo json_encode(['success' => true]);
            exit();
        }

        if ($action === 'reopen') {
            if (!$isAdmin && !$isOwner) pipelineFail(403, 'Only creator or admin can reopen a task', 'task_forbidden');
            if ($task['status'] === 'open') pipelineFail(409, 'Task is already open', 'task_not_editable');
            try {
                $db->beginTransaction();
                $stmt = $db->prepare("UPDATE lead_tasks SET status='open', completed_at=NULL, completed_by=NULL WHERE id=:id");
                $stmt->execute([':id' => $id]);
                logLeadActivity($db, $leadId, $user['id'], 'task_reopened',
                    ['task_id' => $id, 'previous_status' => $task['status']],
                    ['task_id' => $id]
                );

                // Notify assignee + creator (unless they're the actor). Each
                // reopen event gets a unique dedupe key so re-reopens re-fire.
                $reopenKey = time();
                $targets = [];
                if ($task['assigned_user_id'] !== null) $targets[] = (int) $task['assigned_user_id'];
                $targets[] = (int) $task['created_by'];
                $targets = array_values(array_unique(array_filter($targets, fn($u) => $u !== (int) $user['id'])));
                foreach ($targets as $uid) {
                    createNotification(
                        $db, $uid, 'task_reopened',
                        "task_reopened:$id:$reopenKey:$uid",
                        "Task reopened: " . $task['title'],
                        null,
                        $leadId, $id
                    );
                }

                $db->commit();
            } catch (Throwable $e) {
                if ($db->inTransaction()) $db->rollBack();
                pipelineFail(500, 'Reopen failed: ' . $e->getMessage(), 'db_error');
            }
            echo json_encode(['success' => true]);
            exit();
        }

        pipelineFail(400, "Invalid action '$action'", 'invalid_action');
    }

    // Field edits — only creator or admin, and only while open
    if (!$isAdmin && !$isOwner) pipelineFail(403, 'Only creator or admin can edit a task', 'task_forbidden');
    if ($task['status'] !== 'open') pipelineFail(409, 'Cannot edit a closed task', 'task_not_editable');

    $changes = []; // [field => [old, new]]
    $setFields = [];
    $params = [':id' => $id];

    if (array_key_exists('title', $input)) {
        $title = trim((string) $input['title']);
        if ($title === '')         pipelineFail(400, 'title cannot be empty', 'missing_fields');
        if (mb_strlen($title) > 255) pipelineFail(400, 'title too long', 'title_too_long');
        if ($title !== $task['title']) {
            $setFields[] = 'title = :title';
            $params[':title'] = $title;
            $changes['title'] = [$task['title'], $title];
        }
    }
    if (array_key_exists('notes', $input)) {
        $notes = $input['notes'];
        $notes = $notes === null ? null : trim((string) $notes);
        if ($notes !== null && mb_strlen($notes) > 5000) pipelineFail(400, 'notes too long', 'notes_too_long');
        if (($notes ?? '') !== ($task['notes'] ?? '')) {
            $setFields[] = 'notes = :notes';
            $params[':notes'] = $notes;
            $changes['notes'] = [
                mb_substr((string) $task['notes'], 0, 140),
                $notes === null ? null : mb_substr($notes, 0, 140),
            ];
        }
    }
    if (array_key_exists('task_type', $input)) {
        $type = $input['task_type'];
        assertTaskType($type);
        if ($type !== $task['task_type']) {
            $setFields[] = 'task_type = :type';
            $params[':type'] = $type;
            $changes['task_type'] = [$task['task_type'], $type];
        }
    }
    if (array_key_exists('due_at', $input)) {
        $due = parseDatetime($input['due_at'], 'due_at');
        if (($due ?? null) !== ($task['due_at'] ?? null)) {
            $setFields[] = 'due_at = :due';
            $params[':due'] = $due;
            $changes['due_at'] = [$task['due_at'], $due];
        }
    }
    if (array_key_exists('assigned_user_id', $input)) {
        $assignee = $input['assigned_user_id'];
        $assignee = ($assignee === null || $assignee === '') ? null : (int) $assignee;
        if ($assignee !== null) {
            $stmt = $db->prepare('SELECT id FROM users WHERE id = :id');
            $stmt->execute([':id' => $assignee]);
            if (!$stmt->fetch()) pipelineFail(404, 'Assigned user not found', 'user_not_found');
        }
        $currentAssignee = $task['assigned_user_id'] !== null ? (int) $task['assigned_user_id'] : null;
        if ($assignee !== $currentAssignee) {
            $setFields[] = 'assigned_user_id = :au';
            $params[':au'] = $assignee;
            $changes['assigned_user_id'] = [$currentAssignee, $assignee];
        }
    }

    if (empty($changes)) {
        echo json_encode(['success' => true, 'unchanged' => true]);
        exit();
    }

    try {
        $db->beginTransaction();
        $sql = 'UPDATE lead_tasks SET ' . implode(', ', $setFields) . ' WHERE id = :id';
        $stmt = $db->prepare($sql);
        $stmt->execute($params);

        $oldMap = [];
        $newMap = [];
        foreach ($changes as $field => [$old, $new]) {
            $oldMap[$field] = $old;
            $newMap[$field] = $new;
        }
        logLeadActivity($db, $leadId, $user['id'], 'task_updated',
            ['task_id' => $id, 'changed_fields' => $oldMap],
            ['task_id' => $id, 'changed_fields' => $newMap]
        );

        // If assignee changed to someone other than the actor, notify them.
        if (isset($changes['assigned_user_id'])) {
            $newAssignee = $changes['assigned_user_id'][1];
            if ($newAssignee !== null && $newAssignee !== (int) $user['id']) {
                $effectiveTitle = $changes['title'][1] ?? $task['title'];
                $effectiveDue   = array_key_exists('due_at', $changes) ? $changes['due_at'][1] : $task['due_at'];
                createNotification(
                    $db, $newAssignee, 'task_assigned',
                    "task_assigned:$id:$newAssignee",
                    "Task assigned: $effectiveTitle",
                    $effectiveDue ? "Due $effectiveDue" : null,
                    $leadId, $id
                );
            }
        }

        $db->commit();
    } catch (Throwable $e) {
        if ($db->inTransaction()) $db->rollBack();
        pipelineFail(500, 'Update failed: ' . $e->getMessage(), 'db_error');
    }

    echo json_encode(['success' => true, 'changed' => array_keys($changes)]);
    exit();
}

pipelineFail(405, 'Method not allowed', 'method_not_allowed');

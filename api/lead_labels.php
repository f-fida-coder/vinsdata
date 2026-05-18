<?php

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/pipeline.php';
initSession();

$user = requireAuth();
$db   = getDBConnection();

function readInput(): array
{
    if (!empty($_POST)) return $_POST;
    return json_decode(file_get_contents('php://input'), true) ?? [];
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $input   = readInput();
    $leadId  = (int) ($input['lead_id']  ?? 0);
    $labelId = (int) ($input['label_id'] ?? 0);
    // Optional. Only consulted for labels with auto_follow_up=1; ignored
    // (silently) for plain labels so a stale param can't accidentally
    // create a stray task on a regular attach.
    $followUpDueAt = parseDatetime($input['follow_up_due_at'] ?? null, 'follow_up_due_at');
    if ($leadId <= 0 || $labelId <= 0) pipelineFail(400, 'lead_id and label_id are required', 'missing_fields');
    loadLeadOrFail($db, $leadId);

    $stmt = $db->prepare('SELECT id, name, auto_follow_up FROM lead_labels WHERE id = :id');
    $stmt->execute([':id' => $labelId]);
    $label = $stmt->fetch();
    if (!$label) pipelineFail(404, 'Label not found', 'label_not_found');
    $autoFollowUp = (int) $label['auto_follow_up'] === 1;

    try {
        $db->beginTransaction();
        try {
            $stmt = $db->prepare(
                'INSERT INTO lead_label_links (imported_lead_id, label_id, created_by) VALUES (:l, :la, :u)'
            );
            $stmt->execute([':l' => $leadId, ':la' => $labelId, ':u' => $user['id']]);
            $linkId = (int) $db->lastInsertId();
        } catch (PDOException $e) {
            if ($e->getCode() === '23000') {
                $db->rollBack();
                // Re-attach is a no-op for the link, and we deliberately
                // don't recreate the follow-up task here: if the operator
                // wants a fresh task, they detach + re-attach, which gets
                // them a new prompt for the due date.
                echo json_encode(['success' => true, 'already_attached' => true]);
                exit();
            }
            throw $e;
        }
        logLeadActivity($db, $leadId, $user['id'], 'label_added', null, [
            'label_id' => $labelId,
            'name'     => $label['name'],
        ]);

        // Auto-follow-up: create an open task on the same lead. We always
        // assign to the actor — they're the operator attaching the label,
        // so the work falls naturally on them. Due date is whatever they
        // chose at attach time (NULL is valid → open task, no deadline).
        $taskId = null;
        if ($autoFollowUp) {
            $title = "Follow up — {$label['name']}";
            $stmt = $db->prepare(
                'INSERT INTO lead_tasks
                   (imported_lead_id, assigned_user_id, task_type, title, due_at, created_by)
                 VALUES (:lid, :au, :type, :title, :due, :by)'
            );
            $stmt->execute([
                ':lid'   => $leadId,
                ':au'    => $user['id'],
                ':type'  => 'follow_up',
                ':title' => $title,
                ':due'   => $followUpDueAt,
                ':by'    => $user['id'],
            ]);
            $taskId = (int) $db->lastInsertId();
            logLeadActivity($db, $leadId, $user['id'], 'task_created', null, [
                'task_id'           => $taskId,
                'title'             => $title,
                'task_type'         => 'follow_up',
                'due_at'            => $followUpDueAt,
                'assigned_user_id'  => (int) $user['id'],
                'auto_from_label'   => $labelId,
            ]);
        }

        $db->commit();
        echo json_encode([
            'success'   => true,
            'link_id'   => $linkId,
            'task_id'   => $taskId,
            'auto_task' => $autoFollowUp,
        ]);
    } catch (Throwable $e) {
        if ($db->inTransaction()) $db->rollBack();
        pipelineFail(500, 'Attach failed: ' . $e->getMessage(), 'db_error');
    }
    exit();
}

if ($_SERVER['REQUEST_METHOD'] === 'DELETE') {
    $input   = readInput();
    $leadId  = (int) ($input['lead_id']  ?? 0);
    $labelId = (int) ($input['label_id'] ?? 0);
    if ($leadId <= 0 || $labelId <= 0) pipelineFail(400, 'lead_id and label_id are required', 'missing_fields');
    loadLeadOrFail($db, $leadId);

    $stmt = $db->prepare('SELECT name FROM lead_labels WHERE id = :id');
    $stmt->execute([':id' => $labelId]);
    $label = $stmt->fetch();
    if (!$label) pipelineFail(404, 'Label not found', 'label_not_found');

    try {
        $db->beginTransaction();
        $stmt = $db->prepare('DELETE FROM lead_label_links WHERE imported_lead_id = :l AND label_id = :la');
        $stmt->execute([':l' => $leadId, ':la' => $labelId]);
        if ($stmt->rowCount() === 0) {
            $db->rollBack();
            echo json_encode(['success' => true, 'already_detached' => true]);
            exit();
        }
        logLeadActivity($db, $leadId, $user['id'], 'label_removed', [
            'label_id' => $labelId,
            'name'     => $label['name'],
        ], null);
        $db->commit();
        echo json_encode(['success' => true]);
    } catch (Throwable $e) {
        if ($db->inTransaction()) $db->rollBack();
        pipelineFail(500, 'Detach failed: ' . $e->getMessage(), 'db_error');
    }
    exit();
}

pipelineFail(405, 'Method not allowed', 'method_not_allowed');

<?php

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/pipeline.php';
initSession();

$user = requireAuth();
$db   = getDBConnection();

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $leadId = isset($_GET['lead_id']) ? (int) $_GET['lead_id'] : 0;
    if ($leadId <= 0) pipelineFail(400, 'lead_id is required', 'missing_fields');
    loadLeadOrFail($db, $leadId);
    $stmt = $db->prepare(
        'SELECT n.id, n.user_id, u.name AS user_name, n.note, n.created_at, n.updated_at,
                (n.created_at <> n.updated_at) AS edited
           FROM lead_notes n
           JOIN users u ON u.id = n.user_id
          WHERE n.imported_lead_id = :lid
          ORDER BY n.created_at DESC, n.id DESC'
    );
    $stmt->execute([':lid' => $leadId]);
    $rows = array_map(function ($r) {
        $r['id']      = (int) $r['id'];
        $r['user_id'] = (int) $r['user_id'];
        $r['edited']  = (bool) $r['edited'];
        return $r;
    }, $stmt->fetchAll());
    echo json_encode($rows);
    exit();
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $input  = json_decode(file_get_contents('php://input'), true) ?? [];
    $leadId = (int) ($input['lead_id'] ?? 0);
    $note   = trim((string) ($input['note'] ?? ''));
    if ($leadId <= 0) pipelineFail(400, 'lead_id is required', 'missing_fields');
    if ($note === '') pipelineFail(400, 'note is required', 'missing_fields');
    if (mb_strlen($note) > 5000) pipelineFail(400, 'note too long (max 5000 chars)', 'note_too_long');
    loadLeadOrFail($db, $leadId);

    try {
        $db->beginTransaction();
        $stmt = $db->prepare(
            'INSERT INTO lead_notes (imported_lead_id, user_id, note) VALUES (:lid, :uid, :note)'
        );
        $stmt->execute([':lid' => $leadId, ':uid' => $user['id'], ':note' => $note]);
        $noteId = (int) $db->lastInsertId();
        logLeadActivity($db, $leadId, $user['id'], 'note_added', null, [
            'note_id' => $noteId,
            'preview' => mb_substr($note, 0, 140),
        ]);
        $db->commit();
        echo json_encode(['success' => true, 'id' => $noteId]);
    } catch (Throwable $e) {
        if ($db->inTransaction()) $db->rollBack();
        pipelineFail(500, 'Create note failed: ' . $e->getMessage(), 'db_error');
    }
    exit();
}

if ($_SERVER['REQUEST_METHOD'] === 'PATCH') {
    $input  = json_decode(file_get_contents('php://input'), true) ?? [];
    $id     = (int) ($input['id']   ?? 0);
    $note   = trim((string) ($input['note'] ?? ''));
    if ($id <= 0)     pipelineFail(400, 'id is required', 'missing_fields');
    if ($note === '') pipelineFail(400, 'note is required', 'missing_fields');
    if (mb_strlen($note) > 5000) pipelineFail(400, 'note too long (max 5000 chars)', 'note_too_long');

    $stmt = $db->prepare('SELECT id, imported_lead_id, user_id, note FROM lead_notes WHERE id = :id');
    $stmt->execute([':id' => $id]);
    $existing = $stmt->fetch();
    if (!$existing) pipelineFail(404, 'Note not found', 'note_not_found');
    if ((int) $existing['user_id'] !== (int) $user['id'] && ($user['role'] ?? null) !== 'admin') {
        pipelineFail(403, 'Only the author or admin can edit this note', 'note_forbidden');
    }
    if ($existing['note'] === $note) {
        echo json_encode(['success' => true, 'unchanged' => true]);
        exit();
    }
    try {
        $db->beginTransaction();
        $stmt = $db->prepare('UPDATE lead_notes SET note = :note WHERE id = :id');
        $stmt->execute([':note' => $note, ':id' => $id]);
        logLeadActivity($db, (int) $existing['imported_lead_id'], $user['id'], 'note_edited',
            ['note_id' => $id, 'preview' => mb_substr($existing['note'], 0, 140)],
            ['note_id' => $id, 'preview' => mb_substr($note, 0, 140)]
        );
        $db->commit();
        echo json_encode(['success' => true]);
    } catch (Throwable $e) {
        if ($db->inTransaction()) $db->rollBack();
        pipelineFail(500, 'Edit note failed: ' . $e->getMessage(), 'db_error');
    }
    exit();
}

if ($_SERVER['REQUEST_METHOD'] === 'DELETE') {
    $input = json_decode(file_get_contents('php://input'), true) ?? [];
    $id = (int) ($input['id'] ?? 0);
    if ($id <= 0) pipelineFail(400, 'id is required', 'missing_fields');

    $stmt = $db->prepare('SELECT id, imported_lead_id, user_id, note FROM lead_notes WHERE id = :id');
    $stmt->execute([':id' => $id]);
    $existing = $stmt->fetch();
    if (!$existing) pipelineFail(404, 'Note not found', 'note_not_found');
    if ((int) $existing['user_id'] !== (int) $user['id'] && ($user['role'] ?? null) !== 'admin') {
        pipelineFail(403, 'Only the author or admin can delete this note', 'note_forbidden');
    }

    try {
        $db->beginTransaction();
        $stmt = $db->prepare('DELETE FROM lead_notes WHERE id = :id');
        $stmt->execute([':id' => $id]);
        logLeadActivity($db, (int) $existing['imported_lead_id'], $user['id'], 'note_deleted',
            ['note_id' => $id, 'preview' => mb_substr($existing['note'], 0, 140)],
            null
        );
        $db->commit();
        echo json_encode(['success' => true]);
    } catch (Throwable $e) {
        if ($db->inTransaction()) $db->rollBack();
        pipelineFail(500, 'Delete note failed: ' . $e->getMessage(), 'db_error');
    }
    exit();
}

pipelineFail(405, 'Method not allowed', 'method_not_allowed');

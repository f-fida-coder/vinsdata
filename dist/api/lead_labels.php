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
    if ($leadId <= 0 || $labelId <= 0) pipelineFail(400, 'lead_id and label_id are required', 'missing_fields');
    loadLeadOrFail($db, $leadId);

    $stmt = $db->prepare('SELECT id, name FROM lead_labels WHERE id = :id');
    $stmt->execute([':id' => $labelId]);
    $label = $stmt->fetch();
    if (!$label) pipelineFail(404, 'Label not found', 'label_not_found');

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
                echo json_encode(['success' => true, 'already_attached' => true]);
                exit();
            }
            throw $e;
        }
        logLeadActivity($db, $leadId, $user['id'], 'label_added', null, [
            'label_id' => $labelId,
            'name'     => $label['name'],
        ]);
        $db->commit();
        echo json_encode(['success' => true, 'link_id' => $linkId]);
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

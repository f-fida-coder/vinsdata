<?php

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/pipeline.php';
initSession();

$user = requireAuth();
$db   = getDBConnection();

function formatSuppression(array $row): array
{
    return [
        'id'                 => (int) $row['id'],
        'identifier_type'    => $row['identifier_type'],
        'identifier'         => $row['identifier'],
        'reason'             => $row['reason'],
        'source_campaign_id' => $row['source_campaign_id'] !== null ? (int) $row['source_campaign_id'] : null,
        'source_lead_id'     => $row['source_lead_id']     !== null ? (int) $row['source_lead_id']     : null,
        'created_by'         => $row['created_by']         !== null ? (int) $row['created_by']         : null,
        'notes'              => $row['notes'],
        'created_at'         => $row['created_at'],
    ];
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $sql = 'SELECT * FROM marketing_suppressions WHERE 1=1';
    $params = [];
    if (!empty($_GET['identifier_type'])) {
        $t = $_GET['identifier_type'];
        if (!in_array($t, ['email','phone'], true)) {
            pipelineFail(400, 'Invalid identifier_type', 'invalid_identifier_type');
        }
        $sql .= ' AND identifier_type = :t';
        $params[':t'] = $t;
    }
    if (!empty($_GET['reason'])) {
        assertSuppressionReason($_GET['reason']);
        $sql .= ' AND reason = :r';
        $params[':r'] = $_GET['reason'];
    }
    if (!empty($_GET['q'])) {
        $sql .= ' AND identifier LIKE :q';
        $params[':q'] = '%' . $_GET['q'] . '%';
    }
    $sql .= ' ORDER BY created_at DESC LIMIT 1000';
    $stmt = $db->prepare($sql);
    $stmt->execute($params);
    echo json_encode(array_map('formatSuppression', $stmt->fetchAll()));
    exit();
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    assertAdminOrMarketer($user);
    $input = json_decode(file_get_contents('php://input'), true) ?? [];

    $type  = (string) ($input['identifier_type'] ?? '');
    if (!in_array($type, ['email','phone'], true)) {
        pipelineFail(400, 'identifier_type must be email or phone', 'invalid_identifier_type');
    }
    $id = normalizeContactIdentifier($type, (string) ($input['identifier'] ?? ''));
    if ($id === '') pipelineFail(400, 'identifier is required', 'missing_fields');
    $reason = (string) ($input['reason'] ?? 'manual_dnc');
    assertSuppressionReason($reason);
    $notes = isset($input['notes']) ? trim((string) $input['notes']) : null;
    if ($notes !== null && mb_strlen($notes) > 2000) pipelineFail(400, 'notes too long', 'notes_too_long');

    try {
        $stmt = $db->prepare(
            'INSERT INTO marketing_suppressions (identifier_type, identifier, reason, notes, created_by)
             VALUES (:t, :i, :r, :n, :by)'
        );
        $stmt->execute([
            ':t' => $type, ':i' => $id, ':r' => $reason, ':n' => $notes, ':by' => (int) $user['id'],
        ]);
    } catch (PDOException $e) {
        if ($e->getCode() === '23000') {
            pipelineFail(409, 'Identifier is already suppressed', 'suppression_exists');
        }
        throw $e;
    }
    $newId = (int) $db->lastInsertId();
    $stmt = $db->prepare('SELECT * FROM marketing_suppressions WHERE id = :id');
    $stmt->execute([':id' => $newId]);
    echo json_encode(formatSuppression($stmt->fetch()));
    exit();
}

if ($_SERVER['REQUEST_METHOD'] === 'DELETE') {
    assertAdminOrMarketer($user);
    $input = json_decode(file_get_contents('php://input'), true) ?? [];
    $id = (int) ($input['id'] ?? $_GET['id'] ?? 0);
    if ($id <= 0) pipelineFail(400, 'id is required', 'missing_fields');
    $stmt = $db->prepare('DELETE FROM marketing_suppressions WHERE id = :id');
    $stmt->execute([':id' => $id]);
    echo json_encode(['success' => true, 'id' => $id]);
    exit();
}

pipelineFail(405, 'Method not allowed', 'method_not_allowed');

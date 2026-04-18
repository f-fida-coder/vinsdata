<?php

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/pipeline.php';
initSession();

$user = requireAuth();
$db   = getDBConnection();

function decodeMapping($raw): ?array
{
    if (is_array($raw)) return $raw;
    if (!is_string($raw) || $raw === '') return null;
    $decoded = json_decode($raw, true);
    return is_array($decoded) ? $decoded : null;
}

function assertMappingShape(array $mapping): void
{
    if (empty($mapping)) {
        pipelineFail(400, 'mapping must be a non-empty header → field object', 'invalid_mapping');
    }
    foreach ($mapping as $header => $target) {
        if (!is_string($header) || $header === '') {
            pipelineFail(400, 'mapping keys must be non-empty strings', 'invalid_mapping');
        }
        if (!is_string($target) || $target === '') {
            pipelineFail(400, "mapping value for '$header' must be a non-empty string", 'invalid_mapping');
        }
    }
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $sql = 'SELECT t.id, t.template_name, t.source_stage, t.mapping_json, t.active,
                   t.created_by, u.name AS created_by_name, t.created_at, t.updated_at
              FROM column_mapping_templates t
              LEFT JOIN users u ON u.id = t.created_by
             WHERE 1=1';
    $params = [];
    if (!empty($_GET['source_stage'])) {
        assertStage($_GET['source_stage']);
        $sql .= ' AND t.source_stage = :stage';
        $params[':stage'] = $_GET['source_stage'];
    }
    if (isset($_GET['active'])) {
        $sql .= ' AND t.active = :active';
        $params[':active'] = $_GET['active'] ? 1 : 0;
    }
    $sql .= ' ORDER BY t.source_stage, t.template_name';
    $stmt = $db->prepare($sql);
    $stmt->execute($params);

    $rows = array_map(function ($r) {
        $r['active']       = (int) $r['active'];
        $r['mapping_json'] = json_decode($r['mapping_json'], true) ?: new stdClass();
        return $r;
    }, $stmt->fetchAll());

    echo json_encode($rows);
    exit();
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    assertAdmin($user);
    $input = json_decode(file_get_contents('php://input'), true) ?? [];

    $name    = trim($input['template_name'] ?? '');
    $stage   = $input['source_stage'] ?? null;
    $mapping = decodeMapping($input['mapping_json'] ?? null);
    $active  = isset($input['active']) ? (int) !!$input['active'] : 1;

    if ($name === '') {
        pipelineFail(400, 'template_name is required', 'missing_fields');
    }
    assertStage($stage);
    if ($mapping === null) {
        pipelineFail(400, 'mapping_json must be an object', 'invalid_mapping');
    }
    assertMappingShape($mapping);

    $stmt = $db->prepare(
        'INSERT INTO column_mapping_templates (template_name, source_stage, mapping_json, active, created_by)
         VALUES (:name, :stage, :mapping, :active, :by)'
    );
    $stmt->execute([
        ':name'    => $name,
        ':stage'   => $stage,
        ':mapping' => json_encode($mapping),
        ':active'  => $active,
        ':by'      => $user['id'],
    ]);
    echo json_encode(['success' => true, 'id' => (int) $db->lastInsertId()]);
    exit();
}

if ($_SERVER['REQUEST_METHOD'] === 'PATCH') {
    assertAdmin($user);
    $input = json_decode(file_get_contents('php://input'), true) ?? [];
    $id = (int) ($input['id'] ?? 0);
    if ($id <= 0) {
        pipelineFail(400, 'id is required', 'missing_fields');
    }

    $fields = [];
    $params = [':id' => $id];

    if (isset($input['template_name'])) {
        $name = trim($input['template_name']);
        if ($name === '') pipelineFail(400, 'template_name cannot be empty', 'missing_fields');
        $fields[] = 'template_name = :name';
        $params[':name'] = $name;
    }
    if (isset($input['source_stage'])) {
        assertStage($input['source_stage']);
        $fields[] = 'source_stage = :stage';
        $params[':stage'] = $input['source_stage'];
    }
    if (isset($input['mapping_json'])) {
        $mapping = decodeMapping($input['mapping_json']);
        if ($mapping === null) pipelineFail(400, 'mapping_json must be an object', 'invalid_mapping');
        assertMappingShape($mapping);
        $fields[] = 'mapping_json = :mapping';
        $params[':mapping'] = json_encode($mapping);
    }
    if (isset($input['active'])) {
        $fields[] = 'active = :active';
        $params[':active'] = $input['active'] ? 1 : 0;
    }

    if (empty($fields)) {
        pipelineFail(400, 'No fields to update', 'missing_fields');
    }

    $sql = 'UPDATE column_mapping_templates SET ' . implode(', ', $fields) . ' WHERE id = :id';
    $stmt = $db->prepare($sql);
    $stmt->execute($params);
    echo json_encode(['success' => true]);
    exit();
}

if ($_SERVER['REQUEST_METHOD'] === 'DELETE') {
    assertAdmin($user);
    $input = json_decode(file_get_contents('php://input'), true) ?? [];
    $id = (int) ($input['id'] ?? 0);
    if ($id <= 0) pipelineFail(400, 'id is required', 'missing_fields');
    $stmt = $db->prepare('DELETE FROM column_mapping_templates WHERE id = :id');
    $stmt->execute([':id' => $id]);
    echo json_encode(['success' => true]);
    exit();
}

pipelineFail(405, 'Method not allowed', 'method_not_allowed');

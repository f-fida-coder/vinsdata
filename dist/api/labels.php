<?php

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/pipeline.php';
initSession();

$user = requireAuth();
$db   = getDBConnection();

function validateColor(?string $color): string
{
    if ($color === null || $color === '') return '#6b7280';
    if (!preg_match('/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/', $color)) {
        pipelineFail(400, 'color must be #rrggbb or #rrggbbaa', 'invalid_color');
    }
    return strtolower($color);
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $stmt = $db->query(
        'SELECT l.id, l.name, l.color, l.created_by, u.name AS created_by_name,
                l.created_at, l.updated_at,
                (SELECT COUNT(*) FROM lead_label_links lll WHERE lll.label_id = l.id) AS usage_count
           FROM lead_labels l
           LEFT JOIN users u ON u.id = l.created_by
          ORDER BY l.name'
    );
    $labels = array_map(function ($r) {
        $r['id']          = (int) $r['id'];
        $r['usage_count'] = (int) $r['usage_count'];
        return $r;
    }, $stmt->fetchAll());
    echo json_encode($labels);
    exit();
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    assertAdmin($user);
    $input = json_decode(file_get_contents('php://input'), true) ?? [];
    $name  = trim((string) ($input['name']  ?? ''));
    $color = validateColor($input['color'] ?? null);
    if ($name === '') pipelineFail(400, 'name is required', 'missing_fields');
    if (mb_strlen($name) > 80) pipelineFail(400, 'name too long', 'name_too_long');

    try {
        $stmt = $db->prepare('INSERT INTO lead_labels (name, color, created_by) VALUES (:n, :c, :u)');
        $stmt->execute([':n' => $name, ':c' => $color, ':u' => $user['id']]);
    } catch (PDOException $e) {
        if ($e->getCode() === '23000') pipelineFail(409, 'A label with that name already exists', 'duplicate_label');
        throw $e;
    }
    echo json_encode(['success' => true, 'id' => (int) $db->lastInsertId()]);
    exit();
}

if ($_SERVER['REQUEST_METHOD'] === 'PATCH') {
    assertAdmin($user);
    $input = json_decode(file_get_contents('php://input'), true) ?? [];
    $id = (int) ($input['id'] ?? 0);
    if ($id <= 0) pipelineFail(400, 'id is required', 'missing_fields');

    $fields = []; $params = [':id' => $id];
    if (isset($input['name'])) {
        $name = trim((string) $input['name']);
        if ($name === '')         pipelineFail(400, 'name cannot be empty', 'missing_fields');
        if (mb_strlen($name) > 80) pipelineFail(400, 'name too long', 'name_too_long');
        $fields[] = 'name = :name';
        $params[':name'] = $name;
    }
    if (isset($input['color'])) {
        $fields[] = 'color = :color';
        $params[':color'] = validateColor((string) $input['color']);
    }
    if (empty($fields)) pipelineFail(400, 'No fields to update', 'missing_fields');

    try {
        $stmt = $db->prepare('UPDATE lead_labels SET ' . implode(', ', $fields) . ' WHERE id = :id');
        $stmt->execute($params);
    } catch (PDOException $e) {
        if ($e->getCode() === '23000') pipelineFail(409, 'A label with that name already exists', 'duplicate_label');
        throw $e;
    }
    echo json_encode(['success' => true]);
    exit();
}

if ($_SERVER['REQUEST_METHOD'] === 'DELETE') {
    assertAdmin($user);
    $input = json_decode(file_get_contents('php://input'), true) ?? [];
    $id = (int) ($input['id'] ?? 0);
    if ($id <= 0) pipelineFail(400, 'id is required', 'missing_fields');
    $stmt = $db->prepare('DELETE FROM lead_labels WHERE id = :id');
    $stmt->execute([':id' => $id]);
    echo json_encode(['success' => true]);
    exit();
}

pipelineFail(405, 'Method not allowed', 'method_not_allowed');

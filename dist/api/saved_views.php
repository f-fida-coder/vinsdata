<?php

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/pipeline.php';
initSession();

$user = requireAuth();
$db   = getDBConnection();

const SAVED_VIEW_TYPES = ['leads', 'duplicates'];

function assertViewType(?string $v): void
{
    if (!in_array($v, SAVED_VIEW_TYPES, true)) {
        pipelineFail(400, "Invalid view_type '$v'", 'invalid_view_type');
    }
}

function decodeJsonObject($raw, string $field, bool $allowNull = false)
{
    if ($raw === null && $allowNull) return null;
    if (is_array($raw)) return $raw;
    if (!is_string($raw) || $raw === '') {
        if ($allowNull) return null;
        pipelineFail(400, "$field must be a JSON object", 'invalid_json');
    }
    $decoded = json_decode($raw, true);
    if (!is_array($decoded)) pipelineFail(400, "$field must be a JSON object", 'invalid_json');
    return $decoded;
}

function loadOwnedView(PDO $db, int $id, int $userId): array
{
    $stmt = $db->prepare('SELECT * FROM saved_views WHERE id = :id AND user_id = :uid');
    $stmt->execute([':id' => $id, ':uid' => $userId]);
    $row = $stmt->fetch();
    if (!$row) pipelineFail(404, 'Saved view not found', 'view_not_found');
    return $row;
}

function formatView(array $row): array
{
    return [
        'id'           => (int) $row['id'],
        'user_id'      => (int) $row['user_id'],
        'view_type'    => $row['view_type'],
        'name'         => $row['name'],
        'filters_json' => json_decode($row['filters_json'] ?? 'null', true) ?? new stdClass(),
        'sort_json'    => $row['sort_json'] !== null ? json_decode($row['sort_json'], true) : null,
        'is_default'   => (int) $row['is_default'] === 1,
        'created_at'   => $row['created_at'],
        'updated_at'   => $row['updated_at'],
    ];
}

function clearOtherDefaults(PDO $db, int $userId, string $viewType, int $keepId): void
{
    $stmt = $db->prepare(
        'UPDATE saved_views SET is_default = 0
          WHERE user_id = :uid AND view_type = :vt AND is_default = 1 AND id <> :keep'
    );
    $stmt->execute([':uid' => $userId, ':vt' => $viewType, ':keep' => $keepId]);
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $viewType = $_GET['view_type'] ?? null;
    if ($viewType !== null) assertViewType($viewType);

    $sql = 'SELECT * FROM saved_views WHERE user_id = :uid';
    $params = [':uid' => $user['id']];
    if ($viewType !== null) {
        $sql .= ' AND view_type = :vt';
        $params[':vt'] = $viewType;
    }
    $sql .= ' ORDER BY view_type, is_default DESC, name';
    $stmt = $db->prepare($sql);
    $stmt->execute($params);
    echo json_encode(array_map('formatView', $stmt->fetchAll()));
    exit();
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $input = json_decode(file_get_contents('php://input'), true) ?? [];
    $viewType = $input['view_type'] ?? null;
    assertViewType($viewType);
    $name = trim((string) ($input['name'] ?? ''));
    if ($name === '') pipelineFail(400, 'name is required', 'missing_fields');
    if (mb_strlen($name) > 128) pipelineFail(400, 'name too long (max 128 chars)', 'name_too_long');
    $filters = decodeJsonObject($input['filters_json'] ?? [], 'filters_json');
    $sort    = decodeJsonObject($input['sort_json']    ?? null, 'sort_json', true);
    $isDefault = !empty($input['is_default']) ? 1 : 0;

    try {
        $db->beginTransaction();
        try {
            $stmt = $db->prepare(
                'INSERT INTO saved_views (user_id, view_type, name, filters_json, sort_json, is_default)
                 VALUES (:uid, :vt, :name, :filters, :sort, :isd)'
            );
            $stmt->execute([
                ':uid'     => $user['id'],
                ':vt'      => $viewType,
                ':name'    => $name,
                ':filters' => json_encode($filters),
                ':sort'    => $sort === null ? null : json_encode($sort),
                ':isd'     => $isDefault,
            ]);
        } catch (PDOException $e) {
            if ($e->getCode() === '23000') {
                $db->rollBack();
                pipelineFail(409, 'A view with that name already exists', 'duplicate_name');
            }
            throw $e;
        }
        $newId = (int) $db->lastInsertId();
        if ($isDefault) clearOtherDefaults($db, $user['id'], $viewType, $newId);
        $db->commit();
    } catch (Throwable $e) {
        if ($db->inTransaction()) $db->rollBack();
        pipelineFail(500, 'Create failed: ' . $e->getMessage(), 'db_error');
    }

    $stmt = $db->prepare('SELECT * FROM saved_views WHERE id = :id');
    $stmt->execute([':id' => $newId]);
    echo json_encode(['success' => true, 'view' => formatView($stmt->fetch())]);
    exit();
}

if ($_SERVER['REQUEST_METHOD'] === 'PATCH') {
    $input = json_decode(file_get_contents('php://input'), true) ?? [];
    $id = (int) ($input['id'] ?? 0);
    if ($id <= 0) pipelineFail(400, 'id is required', 'missing_fields');
    $existing = loadOwnedView($db, $id, (int) $user['id']);

    $fields = []; $params = [':id' => $id, ':uid' => $user['id']];

    if (isset($input['name'])) {
        $name = trim((string) $input['name']);
        if ($name === '')             pipelineFail(400, 'name cannot be empty', 'missing_fields');
        if (mb_strlen($name) > 128)   pipelineFail(400, 'name too long', 'name_too_long');
        $fields[] = 'name = :name';
        $params[':name'] = $name;
    }
    if (array_key_exists('filters_json', $input)) {
        $filters = decodeJsonObject($input['filters_json'], 'filters_json');
        $fields[] = 'filters_json = :filters';
        $params[':filters'] = json_encode($filters);
    }
    if (array_key_exists('sort_json', $input)) {
        $sort = decodeJsonObject($input['sort_json'], 'sort_json', true);
        $fields[] = 'sort_json = :sort';
        $params[':sort'] = $sort === null ? null : json_encode($sort);
    }
    $setDefault = array_key_exists('is_default', $input) ? !empty($input['is_default']) : null;
    if ($setDefault !== null) {
        $fields[] = 'is_default = :isd';
        $params[':isd'] = $setDefault ? 1 : 0;
    }

    if (empty($fields)) pipelineFail(400, 'No fields to update', 'missing_fields');

    try {
        $db->beginTransaction();
        try {
            $sql = 'UPDATE saved_views SET ' . implode(', ', $fields) . ' WHERE id = :id AND user_id = :uid';
            $stmt = $db->prepare($sql);
            $stmt->execute($params);
        } catch (PDOException $e) {
            if ($e->getCode() === '23000') {
                $db->rollBack();
                pipelineFail(409, 'A view with that name already exists', 'duplicate_name');
            }
            throw $e;
        }
        if ($setDefault === true) {
            clearOtherDefaults($db, (int) $user['id'], $existing['view_type'], $id);
        }
        $db->commit();
    } catch (Throwable $e) {
        if ($db->inTransaction()) $db->rollBack();
        pipelineFail(500, 'Update failed: ' . $e->getMessage(), 'db_error');
    }

    $stmt = $db->prepare('SELECT * FROM saved_views WHERE id = :id');
    $stmt->execute([':id' => $id]);
    echo json_encode(['success' => true, 'view' => formatView($stmt->fetch())]);
    exit();
}

if ($_SERVER['REQUEST_METHOD'] === 'DELETE') {
    $input = json_decode(file_get_contents('php://input'), true) ?? [];
    $id = (int) ($input['id'] ?? 0);
    if ($id <= 0) pipelineFail(400, 'id is required', 'missing_fields');
    loadOwnedView($db, $id, (int) $user['id']); // 404 if not owned
    $stmt = $db->prepare('DELETE FROM saved_views WHERE id = :id AND user_id = :uid');
    $stmt->execute([':id' => $id, ':uid' => $user['id']]);
    echo json_encode(['success' => true]);
    exit();
}

pipelineFail(405, 'Method not allowed', 'method_not_allowed');

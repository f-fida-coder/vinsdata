<?php
// Admin CRUD for VIN Filter rules.
//
// Rules are predicates that run when a lead moves carfax -> filter. A `reject`
// action blocks promotion; a `flag_for_review` action promotes the lead but
// enqueues it in the manual-review queue (separate endpoint, not here).

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/pipeline.php';
require_once __DIR__ . '/filter_rule_helpers.php';
initSession();

$user = requireAuth();
$db   = getDBConnection();

function formatRule(array $r): array
{
    $predicate = json_decode($r['predicate_json'] ?? '{}', true) ?: [];
    return [
        'id'          => (int) $r['id'],
        'name'        => $r['name'],
        'description' => $r['description'],
        'predicate'   => $predicate,
        'action'      => $r['action'],
        'active'      => (int) $r['active'] === 1,
        'created_by'  => (int) $r['created_by'],
        'created_at'  => $r['created_at'],
        'updated_at'  => $r['updated_at'],
    ];
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    // Anyone authenticated can list rules (operators may want to see why a
    // lead got flagged). Admin-only on write paths.
    $onlyActive = isset($_GET['active']) && $_GET['active'] === '1';
    $sql = 'SELECT id, name, description, predicate_json, action, active, created_by, created_at, updated_at
              FROM filter_rules';
    if ($onlyActive) $sql .= ' WHERE active = 1';
    $sql .= ' ORDER BY active DESC, name ASC';

    $stmt = $db->query($sql);
    $rules = array_map('formatRule', $stmt->fetchAll());

    echo json_encode([
        'success' => true,
        'rules'   => $rules,
        'fields'  => FILTER_RULE_FIELDS,
        'ops'     => FILTER_RULE_OPS,
    ]);
    exit();
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    assertAdmin($user);
    $input = json_decode(file_get_contents('php://input'), true) ?? [];

    $name        = trim((string) ($input['name'] ?? ''));
    $description = isset($input['description']) ? (string) $input['description'] : null;
    $predicate   = $input['predicate'] ?? null;
    $action      = $input['action'] ?? 'flag_for_review';
    $active      = !empty($input['active']);

    if ($name === '')                       pipelineFail(400, 'name is required', 'missing_fields');
    if (strlen($name) > 150)                pipelineFail(400, 'name too long (max 150 chars)', 'invalid_field');
    if (!is_array($predicate))              pipelineFail(400, 'predicate is required', 'missing_fields');
    if (!in_array($action, ['reject', 'flag_for_review'], true)) {
        pipelineFail(400, "action must be 'reject' or 'flag_for_review'", 'invalid_field');
    }
    assertValidPredicate($predicate);

    $stmt = $db->prepare(
        'INSERT INTO filter_rules (name, description, predicate_json, action, active, created_by)
         VALUES (:name, :description, :predicate, :action, :active, :user)'
    );
    $stmt->execute([
        ':name'        => $name,
        ':description' => $description,
        ':predicate'   => json_encode($predicate),
        ':action'      => $action,
        ':active'      => $active ? 1 : 0,
        ':user'        => $user['id'],
    ]);

    $id = (int) $db->lastInsertId();
    $row = $db->prepare('SELECT * FROM filter_rules WHERE id = :id');
    $row->execute([':id' => $id]);

    echo json_encode(['success' => true, 'rule' => formatRule($row->fetch())]);
    exit();
}

if ($_SERVER['REQUEST_METHOD'] === 'PATCH' || $_SERVER['REQUEST_METHOD'] === 'PUT') {
    assertAdmin($user);
    $input = json_decode(file_get_contents('php://input'), true) ?? [];
    $id = (int) ($input['id'] ?? 0);
    if ($id <= 0) pipelineFail(400, 'id is required', 'missing_fields');

    $row = $db->prepare('SELECT * FROM filter_rules WHERE id = :id');
    $row->execute([':id' => $id]);
    $existing = $row->fetch();
    if (!$existing) pipelineFail(404, 'Rule not found', 'rule_not_found');

    $fields = [];
    $params = [':id' => $id];

    if (array_key_exists('name', $input)) {
        $name = trim((string) $input['name']);
        if ($name === '')       pipelineFail(400, 'name cannot be empty', 'invalid_field');
        if (strlen($name) > 150) pipelineFail(400, 'name too long', 'invalid_field');
        $fields[] = 'name = :name';
        $params[':name'] = $name;
    }
    if (array_key_exists('description', $input)) {
        $fields[] = 'description = :description';
        $params[':description'] = $input['description'];
    }
    if (array_key_exists('predicate', $input)) {
        if (!is_array($input['predicate'])) pipelineFail(400, 'predicate must be an object', 'invalid_field');
        assertValidPredicate($input['predicate']);
        $fields[] = 'predicate_json = :predicate';
        $params[':predicate'] = json_encode($input['predicate']);
    }
    if (array_key_exists('action', $input)) {
        if (!in_array($input['action'], ['reject', 'flag_for_review'], true)) {
            pipelineFail(400, "action must be 'reject' or 'flag_for_review'", 'invalid_field');
        }
        $fields[] = 'action = :action';
        $params[':action'] = $input['action'];
    }
    if (array_key_exists('active', $input)) {
        $fields[] = 'active = :active';
        $params[':active'] = !empty($input['active']) ? 1 : 0;
    }

    if (empty($fields)) pipelineFail(400, 'No fields to update', 'missing_fields');

    $sql = 'UPDATE filter_rules SET ' . implode(', ', $fields) . ' WHERE id = :id';
    $stmt = $db->prepare($sql);
    $stmt->execute($params);

    $row->execute([':id' => $id]);
    echo json_encode(['success' => true, 'rule' => formatRule($row->fetch())]);
    exit();
}

if ($_SERVER['REQUEST_METHOD'] === 'DELETE') {
    assertAdmin($user);
    $input = json_decode(file_get_contents('php://input'), true) ?? [];
    $id = (int) ($input['id'] ?? 0);
    if ($id <= 0) pipelineFail(400, 'id is required', 'missing_fields');

    // Hard-delete only if no results reference the rule. Otherwise soft-deactivate.
    $check = $db->prepare('SELECT COUNT(*) FROM filter_rule_results WHERE rule_id = :id');
    $check->execute([':id' => $id]);
    $referenced = (int) $check->fetchColumn() > 0;

    if ($referenced) {
        $stmt = $db->prepare('UPDATE filter_rules SET active = 0 WHERE id = :id');
        $stmt->execute([':id' => $id]);
        echo json_encode(['success' => true, 'deactivated' => true]);
    } else {
        $stmt = $db->prepare('DELETE FROM filter_rules WHERE id = :id');
        $stmt->execute([':id' => $id]);
        echo json_encode(['success' => true, 'deleted' => true]);
    }
    exit();
}

pipelineFail(405, 'Method not allowed', 'method_not_allowed');

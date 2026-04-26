<?php
// Admin CRUD for SLA rules.

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/pipeline.php';
initSession();

$user = requireAuth();
$db   = getDBConnection();

// Read access for any authenticated user — operators may want to see why a
// lead got flagged. Write paths are admin-only.

function formatSlaRule(array $r): array
{
    return [
        'id'                  => (int) $r['id'],
        'name'                => $r['name'],
        'description'         => $r['description'],
        'temperatures'        => json_decode((string) ($r['if_temperature_in'] ?? 'null'), true) ?: [],
        'statuses'            => json_decode((string) ($r['if_status_in']      ?? 'null'), true) ?: [],
        'days'                => (int) $r['if_no_activity_for_days'],
        'notify_assignee'     => (int) $r['notify_assignee'] === 1,
        'notify_role'         => $r['notify_role'],
        'active'              => (int) $r['active'] === 1,
        'created_by'          => (int) $r['created_by'],
        'created_at'          => $r['created_at'],
        'updated_at'          => $r['updated_at'],
    ];
}

function assertValidSlaRule(array $input): void
{
    $name = trim((string) ($input['name'] ?? ''));
    if ($name === '')                pipelineFail(400, 'name is required', 'missing_fields');
    if (strlen($name) > 150)         pipelineFail(400, 'name too long (max 150)', 'invalid_field');

    $days = (int) ($input['days'] ?? 0);
    if ($days <= 0 || $days > 365)   pipelineFail(400, 'days must be 1..365', 'invalid_field');

    foreach (['temperatures', 'statuses'] as $arrField) {
        if (array_key_exists($arrField, $input) && $input[$arrField] !== null) {
            if (!is_array($input[$arrField])) {
                pipelineFail(400, "$arrField must be an array", 'invalid_field');
            }
        }
    }

    $notifyRole = $input['notify_role'] ?? null;
    if ($notifyRole !== null && $notifyRole !== '') {
        if (!in_array($notifyRole, ['admin', 'marketer', 'carfax', 'filter', 'tlo'], true)) {
            pipelineFail(400, "notify_role invalid", 'invalid_field');
        }
    }
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $stmt = $db->query(
        'SELECT id, name, description, if_temperature_in, if_status_in, if_no_activity_for_days,
                notify_assignee, notify_role, active, created_by, created_at, updated_at
           FROM sla_rules
          ORDER BY active DESC, name ASC'
    );
    $rules = array_map('formatSlaRule', $stmt->fetchAll());
    echo json_encode(['success' => true, 'rules' => $rules]);
    exit();
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    assertAdmin($user);
    $input = json_decode(file_get_contents('php://input'), true) ?? [];
    assertValidSlaRule($input);

    $stmt = $db->prepare(
        'INSERT INTO sla_rules (name, description, if_temperature_in, if_status_in,
                                if_no_activity_for_days, notify_assignee, notify_role,
                                active, created_by)
         VALUES (:name, :description, :temps, :statuses, :days, :notify_assignee, :notify_role,
                 :active, :user)'
    );
    $stmt->execute([
        ':name'             => trim((string) $input['name']),
        ':description'      => $input['description'] ?? null,
        ':temps'            => empty($input['temperatures']) ? null : json_encode(array_values($input['temperatures'])),
        ':statuses'         => empty($input['statuses'])     ? null : json_encode(array_values($input['statuses'])),
        ':days'             => (int) $input['days'],
        ':notify_assignee'  => !empty($input['notify_assignee']) ? 1 : 0,
        ':notify_role'      => $input['notify_role'] ?? null,
        ':active'           => isset($input['active']) ? (!empty($input['active']) ? 1 : 0) : 1,
        ':user'             => $user['id'],
    ]);

    $id = (int) $db->lastInsertId();
    $row = $db->prepare('SELECT * FROM sla_rules WHERE id = :id');
    $row->execute([':id' => $id]);
    echo json_encode(['success' => true, 'rule' => formatSlaRule($row->fetch())]);
    exit();
}

if ($_SERVER['REQUEST_METHOD'] === 'PATCH' || $_SERVER['REQUEST_METHOD'] === 'PUT') {
    assertAdmin($user);
    $input = json_decode(file_get_contents('php://input'), true) ?? [];
    $id = (int) ($input['id'] ?? 0);
    if ($id <= 0) pipelineFail(400, 'id is required', 'missing_fields');

    $row = $db->prepare('SELECT * FROM sla_rules WHERE id = :id');
    $row->execute([':id' => $id]);
    if (!$row->fetch()) pipelineFail(404, 'Rule not found', 'rule_not_found');

    $fields = []; $params = [':id' => $id];

    if (array_key_exists('name', $input)) {
        $name = trim((string) $input['name']);
        if ($name === '')          pipelineFail(400, 'name cannot be empty', 'invalid_field');
        if (strlen($name) > 150)   pipelineFail(400, 'name too long', 'invalid_field');
        $fields[] = 'name = :name'; $params[':name'] = $name;
    }
    if (array_key_exists('description', $input)) {
        $fields[] = 'description = :description'; $params[':description'] = $input['description'];
    }
    if (array_key_exists('temperatures', $input)) {
        $v = $input['temperatures'];
        if ($v !== null && !is_array($v)) pipelineFail(400, 'temperatures must be array', 'invalid_field');
        $fields[] = 'if_temperature_in = :temps';
        $params[':temps'] = empty($v) ? null : json_encode(array_values($v));
    }
    if (array_key_exists('statuses', $input)) {
        $v = $input['statuses'];
        if ($v !== null && !is_array($v)) pipelineFail(400, 'statuses must be array', 'invalid_field');
        $fields[] = 'if_status_in = :statuses';
        $params[':statuses'] = empty($v) ? null : json_encode(array_values($v));
    }
    if (array_key_exists('days', $input)) {
        $d = (int) $input['days'];
        if ($d <= 0 || $d > 365) pipelineFail(400, 'days must be 1..365', 'invalid_field');
        $fields[] = 'if_no_activity_for_days = :days'; $params[':days'] = $d;
    }
    if (array_key_exists('notify_assignee', $input)) {
        $fields[] = 'notify_assignee = :notify_assignee'; $params[':notify_assignee'] = !empty($input['notify_assignee']) ? 1 : 0;
    }
    if (array_key_exists('notify_role', $input)) {
        $fields[] = 'notify_role = :notify_role'; $params[':notify_role'] = $input['notify_role'] ?: null;
    }
    if (array_key_exists('active', $input)) {
        $fields[] = 'active = :active'; $params[':active'] = !empty($input['active']) ? 1 : 0;
    }

    if (empty($fields)) pipelineFail(400, 'No fields to update', 'missing_fields');

    $sql = 'UPDATE sla_rules SET ' . implode(', ', $fields) . ' WHERE id = :id';
    $stmt = $db->prepare($sql);
    $stmt->execute($params);

    $row->execute([':id' => $id]);
    echo json_encode(['success' => true, 'rule' => formatSlaRule($row->fetch())]);
    exit();
}

if ($_SERVER['REQUEST_METHOD'] === 'DELETE') {
    assertAdmin($user);
    $input = json_decode(file_get_contents('php://input'), true) ?? [];
    $id = (int) ($input['id'] ?? 0);
    if ($id <= 0) pipelineFail(400, 'id is required', 'missing_fields');

    $check = $db->prepare('SELECT COUNT(*) FROM sla_alerts WHERE rule_id = :id');
    $check->execute([':id' => $id]);
    if ((int) $check->fetchColumn() > 0) {
        $stmt = $db->prepare('UPDATE sla_rules SET active = 0 WHERE id = :id');
        $stmt->execute([':id' => $id]);
        echo json_encode(['success' => true, 'deactivated' => true]);
    } else {
        $stmt = $db->prepare('DELETE FROM sla_rules WHERE id = :id');
        $stmt->execute([':id' => $id]);
        echo json_encode(['success' => true, 'deleted' => true]);
    }
    exit();
}

pipelineFail(405, 'Method not allowed', 'method_not_allowed');

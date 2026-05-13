<?php

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/pipeline.php';
initSession();

$user = requireAuth();
$db   = getDBConnection();
$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    $includeInactive = !empty($_GET['include_inactive']);
    $sql = 'SELECT id, name, phone, email, notes, is_active, created_at, updated_at FROM transporters';
    if (!$includeInactive) $sql .= ' WHERE is_active = 1';
    $sql .= ' ORDER BY is_active DESC, name ASC';
    $rows = $db->query($sql)->fetchAll();
    foreach ($rows as &$r) {
        $r['id']        = (int) $r['id'];
        $r['is_active'] = (bool) $r['is_active'];
    }
    echo json_encode($rows);
    exit();
}

$input = json_decode(file_get_contents('php://input'), true) ?? [];

if ($method === 'POST') {
    $name  = trim((string) ($input['name']  ?? ''));
    $phone = trim((string) ($input['phone'] ?? ''));
    $email = trim((string) ($input['email'] ?? ''));
    $notes = trim((string) ($input['notes'] ?? ''));
    if ($name === '') pipelineFail(400, 'Transporter name is required', 'missing_name');
    if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        pipelineFail(400, 'Invalid email', 'invalid_email');
    }
    $stmt = $db->prepare(
        'INSERT INTO transporters (name, phone, email, notes, created_by)
         VALUES (:n, :p, :e, :no, :u)'
    );
    $stmt->execute([
        ':n'  => $name,
        ':p'  => $phone === '' ? null : $phone,
        ':e'  => $email === '' ? null : $email,
        ':no' => $notes === '' ? null : $notes,
        ':u'  => $user['id'],
    ]);
    echo json_encode(['success' => true, 'id' => (int) $db->lastInsertId()]);
    exit();
}

if ($method === 'PUT') {
    $id = (int) ($input['id'] ?? 0);
    if ($id <= 0) pipelineFail(400, 'id is required', 'missing_id');
    $stmt = $db->prepare('SELECT id FROM transporters WHERE id = :id');
    $stmt->execute([':id' => $id]);
    if (!$stmt->fetch()) pipelineFail(404, 'Transporter not found', 'not_found');

    $fields = [];
    $params = [':id' => $id];
    foreach (['name','phone','email','notes'] as $k) {
        if (array_key_exists($k, $input)) {
            $v = $input[$k];
            $v = ($v === '' || $v === null) ? null : trim((string) $v);
            if ($k === 'name' && ($v === null || $v === '')) {
                pipelineFail(400, 'Name cannot be empty', 'missing_name');
            }
            if ($k === 'email' && $v !== null && !filter_var($v, FILTER_VALIDATE_EMAIL)) {
                pipelineFail(400, 'Invalid email', 'invalid_email');
            }
            $fields[] = "$k = :$k";
            $params[":$k"] = $v;
        }
    }
    if (array_key_exists('is_active', $input)) {
        $fields[] = 'is_active = :is_active';
        $params[':is_active'] = !empty($input['is_active']) ? 1 : 0;
    }
    if (empty($fields)) {
        echo json_encode(['success' => true, 'unchanged' => true]);
        exit();
    }
    $sql = 'UPDATE transporters SET ' . implode(', ', $fields) . ' WHERE id = :id';
    $stmt = $db->prepare($sql);
    $stmt->execute($params);
    echo json_encode(['success' => true]);
    exit();
}

if ($method === 'DELETE') {
    $id = (int) ($input['id'] ?? $_GET['id'] ?? 0);
    if ($id <= 0) pipelineFail(400, 'id is required', 'missing_id');
    // Soft-delete by deactivating so existing transport assignments still resolve a name.
    $stmt = $db->prepare('UPDATE transporters SET is_active = 0 WHERE id = :id');
    $stmt->execute([':id' => $id]);
    echo json_encode(['success' => true]);
    exit();
}

pipelineFail(405, 'Method not allowed', 'method_not_allowed');

<?php

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/pipeline.php';
initSession();

$user = requireAuth();
$db   = getDBConnection();

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $stmt = $db->query(
        'SELECT id, name, make, model, year, created_at
           FROM vehicles
          ORDER BY (year IS NULL), year DESC, name ASC'
    );
    echo json_encode($stmt->fetchAll());
    exit();
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    assertAdmin($user);
    $input = json_decode(file_get_contents('php://input'), true) ?? [];
    $name  = trim((string) ($input['name']  ?? ''));
    $make  = isset($input['make'])  ? trim((string) $input['make'])  : null;
    $model = isset($input['model']) ? trim((string) $input['model']) : null;
    $year  = isset($input['year']) && $input['year'] !== '' ? (int) $input['year'] : null;

    if ($name === '') pipelineFail(400, 'name is required', 'missing_fields');
    if ($year !== null && ($year < 1900 || $year > 2100)) {
        pipelineFail(400, 'year must be a valid 4-digit year', 'invalid_field');
    }

    $stmt = $db->prepare(
        'INSERT INTO vehicles (name, make, model, year)
         VALUES (:name, :make, :model, :year)'
    );
    $stmt->execute([
        ':name'  => $name,
        ':make'  => $make ?: null,
        ':model' => $model ?: null,
        ':year'  => $year,
    ]);

    $id = (int) $db->lastInsertId();
    $row = $db->prepare('SELECT id, name, make, model, year, created_at FROM vehicles WHERE id = :id');
    $row->execute([':id' => $id]);
    echo json_encode(['success' => true, 'vehicle' => $row->fetch()]);
    exit();
}

if ($_SERVER['REQUEST_METHOD'] === 'PATCH' || $_SERVER['REQUEST_METHOD'] === 'PUT') {
    assertAdmin($user);
    $input = json_decode(file_get_contents('php://input'), true) ?? [];
    $id = (int) ($input['id'] ?? 0);
    if ($id <= 0) pipelineFail(400, 'id is required', 'missing_fields');

    $check = $db->prepare('SELECT id FROM vehicles WHERE id = :id');
    $check->execute([':id' => $id]);
    if (!$check->fetch()) pipelineFail(404, 'Vehicle not found', 'vehicle_not_found');

    $fields = []; $params = [':id' => $id];
    if (array_key_exists('name', $input)) {
        $name = trim((string) $input['name']);
        if ($name === '') pipelineFail(400, 'name cannot be empty', 'invalid_field');
        $fields[] = 'name = :name';
        $params[':name'] = $name;
    }
    if (array_key_exists('make', $input)) {
        $fields[] = 'make = :make';
        $params[':make'] = trim((string) $input['make']) ?: null;
    }
    if (array_key_exists('model', $input)) {
        $fields[] = 'model = :model';
        $params[':model'] = trim((string) $input['model']) ?: null;
    }
    if (array_key_exists('year', $input)) {
        $year = $input['year'] === '' || $input['year'] === null ? null : (int) $input['year'];
        if ($year !== null && ($year < 1900 || $year > 2100)) {
            pipelineFail(400, 'year must be a valid 4-digit year', 'invalid_field');
        }
        $fields[] = 'year = :year';
        $params[':year'] = $year;
    }
    if (empty($fields)) pipelineFail(400, 'No fields to update', 'missing_fields');

    $sql = 'UPDATE vehicles SET ' . implode(', ', $fields) . ' WHERE id = :id';
    $stmt = $db->prepare($sql);
    $stmt->execute($params);

    $row = $db->prepare('SELECT id, name, make, model, year, created_at FROM vehicles WHERE id = :id');
    $row->execute([':id' => $id]);
    echo json_encode(['success' => true, 'vehicle' => $row->fetch()]);
    exit();
}

pipelineFail(405, 'Method not allowed', 'method_not_allowed');

<?php

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/pipeline.php';
initSession();

$user = requireAuth();
$db   = getDBConnection();
$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    $row = $db->query(
        'SELECT id, company_name, company_address, company_phone, company_email,
                default_state, default_county, updated_at
           FROM company_settings WHERE id = 1'
    )->fetch();
    if (!$row) {
        echo json_encode([
            'id' => 1, 'company_name' => null, 'company_address' => null,
            'company_phone' => null, 'company_email' => null,
            'default_state' => null, 'default_county' => null, 'updated_at' => null,
        ]);
        exit();
    }
    echo json_encode($row);
    exit();
}

if ($method === 'PUT') {
    assertAdmin($user);
    $input = json_decode(file_get_contents('php://input'), true) ?? [];
    $allowed = ['company_name','company_address','company_phone','company_email','default_state','default_county'];
    $sets    = [];
    $params  = [];
    foreach ($allowed as $k) {
        if (!array_key_exists($k, $input)) continue;
        $v = $input[$k];
        $v = ($v === '' || $v === null) ? null : trim((string) $v);
        if ($k === 'company_email' && $v !== null && !filter_var($v, FILTER_VALIDATE_EMAIL)) {
            pipelineFail(400, 'Invalid company email', 'invalid_email');
        }
        $sets[] = "$k = :$k";
        $params[":$k"] = $v;
    }
    if (empty($sets)) {
        echo json_encode(['success' => true, 'unchanged' => true]);
        exit();
    }
    // Singleton row; INSERT … ON DUPLICATE KEY UPDATE so first PUT also creates it.
    $insertCols = array_merge(['id'], array_keys(array_combine(array_map(fn($k) => substr($k, 1), array_keys($params)), $params)));
    $cols = ['id'];
    $vals = ['1'];
    foreach ($allowed as $k) {
        if (array_key_exists($k, $input)) {
            $cols[] = $k;
            $vals[] = ":$k";
        }
    }
    $sql  = 'INSERT INTO company_settings (' . implode(',', $cols) . ') VALUES (' . implode(',', $vals) . ') ';
    $sql .= 'ON DUPLICATE KEY UPDATE ' . implode(', ', $sets);
    $db->prepare($sql)->execute($params);
    echo json_encode(['success' => true]);
    exit();
}

pipelineFail(405, 'Method not allowed', 'method_not_allowed');

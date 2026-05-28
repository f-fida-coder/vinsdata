<?php
// Investor directory — admin-only CRUD.
//
//   GET  /api/investors                  → list of active investors
//   GET  /api/investors?id=X             → single investor + their linked cars
//   GET  /api/investors?include_archived → admin can audit
//   POST /api/investors                  → create
//   PUT  /api/investors                  → update (body.id)
//   DELETE /api/investors                → soft-delete (body.id; sets archived_at)
//
// Investor-to-car linkage lives in /api/investor_leads.

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/pipeline.php';
initSession();

$user = requireAuth();
if (($user['role'] ?? null) !== 'admin') {
    pipelineFail(403, 'Investors are admin-only', 'admin_required');
}
$db = getDBConnection();

function formatInvestor(array $r): array
{
    return [
        'id'           => (int) $r['id'],
        'name'         => $r['name'],
        'email'        => $r['email'],
        'phone'        => $r['phone'],
        'entity_name'  => $r['entity_name'],
        'address'      => $r['address'],
        'notes'        => $r['notes'],
        'created_by'   => (int) $r['created_by'],
        'created_at'   => $r['created_at'],
        'updated_at'   => $r['updated_at'],
        'archived_at'  => $r['archived_at'],
        'cars_count'   => isset($r['cars_count']) ? (int) $r['cars_count'] : 0,
        'total_invested' => isset($r['total_invested']) && $r['total_invested'] !== null
            ? (float) $r['total_invested'] : null,
    ];
}

$method = $_SERVER['REQUEST_METHOD'];

if ($method === 'GET') {
    $id = isset($_GET['id']) ? (int) $_GET['id'] : 0;
    $includeArchived = !empty($_GET['include_archived']);

    if ($id > 0) {
        $stmt = $db->prepare(
            'SELECT i.*,
                    (SELECT COUNT(*)        FROM investor_leads il WHERE il.investor_id = i.id) AS cars_count,
                    (SELECT SUM(il.investment_amount) FROM investor_leads il WHERE il.investor_id = i.id) AS total_invested
               FROM investors i WHERE i.id = :id'
        );
        $stmt->execute([':id' => $id]);
        $row = $stmt->fetch();
        if (!$row) pipelineFail(404, 'Investor not found', 'investor_not_found');
        echo json_encode(['success' => true, 'investor' => formatInvestor($row)]);
        exit();
    }

    $where = $includeArchived ? '1=1' : 'i.archived_at IS NULL';
    $stmt = $db->query(
        "SELECT i.*,
                (SELECT COUNT(*)         FROM investor_leads il WHERE il.investor_id = i.id) AS cars_count,
                (SELECT SUM(il.investment_amount) FROM investor_leads il WHERE il.investor_id = i.id) AS total_invested
           FROM investors i WHERE $where ORDER BY i.name ASC"
    );
    $rows = array_map('formatInvestor', $stmt->fetchAll());
    echo json_encode(['success' => true, 'investors' => $rows]);
    exit();
}

if ($method === 'POST' || $method === 'PUT') {
    $input = json_decode(file_get_contents('php://input'), true) ?? [];
    $name        = trim((string) ($input['name']        ?? ''));
    $email       = trim((string) ($input['email']       ?? ''));
    $phone       = trim((string) ($input['phone']       ?? ''));
    $entity_name = trim((string) ($input['entity_name'] ?? ''));
    $address     = trim((string) ($input['address']     ?? ''));
    $notes       = trim((string) ($input['notes']       ?? ''));

    if ($name === '')              pipelineFail(400, 'name is required', 'missing_name');
    if (mb_strlen($name) > 160)    pipelineFail(400, 'name too long (160)', 'name_too_long');
    if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
        pipelineFail(400, "Invalid email '$email'", 'invalid_email');
    }

    if ($method === 'POST') {
        $stmt = $db->prepare(
            'INSERT INTO investors (name, email, phone, entity_name, address, notes, created_by)
             VALUES (:n, :e, :p, :en, :a, :no, :u)'
        );
        $stmt->execute([
            ':n'  => $name,
            ':e'  => $email !== '' ? $email : null,
            ':p'  => $phone !== '' ? $phone : null,
            ':en' => $entity_name !== '' ? $entity_name : null,
            ':a'  => $address !== '' ? $address : null,
            ':no' => $notes !== '' ? $notes : null,
            ':u'  => (int) $user['id'],
        ]);
        $id = (int) $db->lastInsertId();
        echo json_encode(['success' => true, 'id' => $id]);
        exit();
    }

    // PUT — update by id
    $id = (int) ($input['id'] ?? 0);
    if ($id <= 0) pipelineFail(400, 'id is required for update', 'missing_id');

    $stmt = $db->prepare(
        'UPDATE investors
            SET name        = :n,
                email       = :e,
                phone       = :p,
                entity_name = :en,
                address     = :a,
                notes       = :no
          WHERE id = :id'
    );
    $stmt->execute([
        ':n'  => $name,
        ':e'  => $email !== '' ? $email : null,
        ':p'  => $phone !== '' ? $phone : null,
        ':en' => $entity_name !== '' ? $entity_name : null,
        ':a'  => $address !== '' ? $address : null,
        ':no' => $notes !== '' ? $notes : null,
        ':id' => $id,
    ]);
    echo json_encode(['success' => true]);
    exit();
}

if ($method === 'DELETE') {
    $input = json_decode(file_get_contents('php://input'), true) ?? [];
    $id = (int) ($input['id'] ?? 0);
    if ($id <= 0) pipelineFail(400, 'id is required', 'missing_id');
    // Soft-delete — investor history is preserved on linked cars.
    $stmt = $db->prepare('UPDATE investors SET archived_at = NOW() WHERE id = :id');
    $stmt->execute([':id' => $id]);
    echo json_encode(['success' => true]);
    exit();
}

pipelineFail(405, 'Method not allowed', 'method_not_allowed');

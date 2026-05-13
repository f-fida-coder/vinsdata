<?php

require_once __DIR__ . '/config.php';
initSession();

if (!isset($_SESSION['user_id'])) {
    http_response_code(401);
    echo json_encode(["success" => false, "message" => "Not authenticated"]);
    exit();
}

$db = getDBConnection();
$method = $_SERVER['REQUEST_METHOD'];

function assertAdminOr403(): void
{
    if (($_SESSION['user_role'] ?? null) !== 'admin') {
        http_response_code(403);
        echo json_encode(["success" => false, "message" => "Admin role required"]);
        exit();
    }
}

function castVehicle(array $row): array
{
    $row['id']        = (int) $row['id'];
    $row['year']      = isset($row['year'])      && $row['year']      !== null ? (int) $row['year']      : null;
    $row['is_active'] = isset($row['is_active']) ? (bool) $row['is_active'] : true;
    return $row;
}

if ($method === 'GET') {
    $id = isset($_GET['id']) ? (int) $_GET['id'] : 0;
    if ($id > 0) {
        $stmt = $db->prepare(
            "SELECT id, name, make, model, year, body_type, `trim`, notes, is_active, created_at, updated_at
               FROM vehicles WHERE id = :id"
        );
        $stmt->execute([':id' => $id]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if (!$row) {
            http_response_code(404);
            echo json_encode(["success" => false, "message" => "Vehicle not found"]);
            exit();
        }
        echo json_encode(castVehicle($row));
        exit();
    }

    $includeInactive = !empty($_GET['include_inactive']);
    $sql = "SELECT v.id, v.name, v.make, v.model, v.year, v.body_type, v.`trim`, v.notes, v.is_active,
                   v.created_at, v.updated_at,
                   (SELECT COUNT(*) FROM files f WHERE f.vehicle_id = v.id) AS file_count
              FROM vehicles v";
    if (!$includeInactive) $sql .= " WHERE v.is_active = 1";
    $sql .= " ORDER BY v.is_active DESC, v.name";
    $rows = $db->query($sql)->fetchAll(PDO::FETCH_ASSOC);
    echo json_encode(array_map(function ($r) {
        $r['file_count'] = (int) $r['file_count'];
        return castVehicle($r);
    }, $rows));
    exit();
}

$input = json_decode(file_get_contents("php://input"), true) ?? [];

/** Build "Year Make Model Trim" as a sensible default display name. */
function buildDefaultName(array $input): string
{
    $parts = [];
    if (!empty($input['year']))      $parts[] = (string) $input['year'];
    if (!empty($input['make']))      $parts[] = trim((string) $input['make']);
    if (!empty($input['model']))     $parts[] = trim((string) $input['model']);
    if (!empty($input['trim']))      $parts[] = trim((string) $input['trim']);
    return trim(implode(' ', $parts));
}

/** Return [$columns, $placeholders, $params] for a vehicles INSERT/UPDATE from the input. */
function extractVehicleColumns(array $input, bool $forUpdate = false): array
{
    $allowed = ['name','make','model','year','body_type','trim','notes','is_active'];
    $cols = []; $params = [];
    foreach ($allowed as $k) {
        if (!array_key_exists($k, $input)) continue;
        $v = $input[$k];
        if ($k === 'year') {
            $v = ($v === '' || $v === null) ? null : (int) $v;
            if ($v !== null && ($v < 1900 || $v > 2100)) {
                http_response_code(400);
                echo json_encode(["success" => false, "message" => "Year must be between 1900 and 2100"]);
                exit();
            }
        } elseif ($k === 'is_active') {
            $v = $v ? 1 : 0;
        } else {
            $v = ($v === '' || $v === null) ? null : trim((string) $v);
        }
        $cols[$k] = $v;
        $params[":$k"] = $v;
    }
    return [$cols, $params];
}

if ($method === 'POST') {
    assertAdminOr403();
    // Auto-fill name if blank but make/model/year supplied.
    if (!isset($input['name']) || trim((string)($input['name'] ?? '')) === '') {
        $built = buildDefaultName($input);
        if ($built !== '') $input['name'] = $built;
    }
    $input['name'] = trim((string)($input['name'] ?? ''));
    if ($input['name'] === '') {
        http_response_code(400);
        echo json_encode(["success" => false, "message" => "Vehicle name is required (or supply make/model/year so it can be auto-built)"]);
        exit();
    }
    [$cols, $params] = extractVehicleColumns($input);
    $colNames = array_keys($cols);
    // Quote `trim` since it's a reserved word.
    $colNamesSql = array_map(fn($c) => $c === 'trim' ? '`trim`' : $c, $colNames);
    $sql = "INSERT INTO vehicles (" . implode(',', $colNamesSql) . ") VALUES (" . implode(',', array_keys($params)) . ")";
    try {
        $db->prepare($sql)->execute($params);
        $id = (int) $db->lastInsertId();
        $row = $db->query("SELECT id, name, make, model, year, body_type, `trim`, notes, is_active, created_at, updated_at FROM vehicles WHERE id = $id")->fetch(PDO::FETCH_ASSOC);
        echo json_encode(castVehicle($row));
    } catch (PDOException $e) {
        http_response_code(500);
        echo json_encode(["success" => false, "message" => "Failed to add vehicle: " . $e->getMessage()]);
    }
    exit();
}

if ($method === 'PUT') {
    assertAdminOr403();
    $id = (int) ($input['id'] ?? 0);
    if ($id <= 0) {
        http_response_code(400);
        echo json_encode(["success" => false, "message" => "id is required"]);
        exit();
    }
    $stmt = $db->prepare("SELECT id FROM vehicles WHERE id = :id");
    $stmt->execute([':id' => $id]);
    if (!$stmt->fetch()) {
        http_response_code(404);
        echo json_encode(["success" => false, "message" => "Vehicle not found"]);
        exit();
    }
    [$cols, $params] = extractVehicleColumns($input, true);
    if (empty($cols)) {
        echo json_encode(["success" => true, "unchanged" => true]);
        exit();
    }
    if (array_key_exists('name', $cols) && ($cols['name'] === null || $cols['name'] === '')) {
        http_response_code(400);
        echo json_encode(["success" => false, "message" => "Name cannot be empty"]);
        exit();
    }
    $sets = [];
    foreach ($cols as $k => $_) {
        $col = $k === 'trim' ? '`trim`' : $k;
        $sets[] = "$col = :$k";
    }
    $params[':id'] = $id;
    $sql = "UPDATE vehicles SET " . implode(', ', $sets) . " WHERE id = :id";
    $db->prepare($sql)->execute($params);
    $row = $db->query("SELECT id, name, make, model, year, body_type, `trim`, notes, is_active, created_at, updated_at FROM vehicles WHERE id = $id")->fetch(PDO::FETCH_ASSOC);
    echo json_encode(castVehicle($row));
    exit();
}

if ($method === 'DELETE') {
    assertAdminOr403();
    $id = (int) ($input['id'] ?? 0);
    if ($id <= 0) {
        http_response_code(400);
        echo json_encode(["success" => false, "message" => "id is required"]);
        exit();
    }
    // Block hard delete if files reference this vehicle. The user can instead
    // toggle is_active = 0 to retire a vehicle while preserving FK history.
    $stmt = $db->prepare("SELECT COUNT(*) FROM files WHERE vehicle_id = :id");
    $stmt->execute([':id' => $id]);
    $fileCount = (int) $stmt->fetchColumn();
    if ($fileCount > 0) {
        http_response_code(409);
        echo json_encode([
            "success" => false,
            "code"    => "vehicle_has_files",
            "message" => "Cannot delete: $fileCount file(s) are still attached. Deactivate the vehicle instead (Edit → Active off).",
        ]);
        exit();
    }
    $stmt = $db->prepare("DELETE FROM vehicles WHERE id = :id");
    $stmt->execute([':id' => $id]);
    echo json_encode(["success" => true, "id" => $id]);
    exit();
}

http_response_code(405);
echo json_encode(["success" => false, "message" => "Method not allowed"]);

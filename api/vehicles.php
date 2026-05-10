<?php

require_once __DIR__ . '/config.php';
initSession();

if (!isset($_SESSION['user_id'])) {
    http_response_code(401);
    echo json_encode(["success" => false, "message" => "Not authenticated"]);
    exit();
}

$db = getDBConnection();

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $stmt = $db->query("SELECT id, name FROM vehicles ORDER BY name");
    echo json_encode($stmt->fetchAll());

} elseif ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if ($_SESSION['user_role'] !== 'admin') {
        http_response_code(403);
        echo json_encode(["success" => false, "message" => "Forbidden"]);
        exit();
    }

    $input = json_decode(file_get_contents("php://input"), true);
    $name = $input['name'] ?? '';

    if (empty($name)) {
        http_response_code(400);
        echo json_encode(["success" => false, "message" => "Vehicle name is required"]);
        exit();
    }

    $stmt = $db->prepare("INSERT INTO vehicles (name) VALUES (:name)");
    $stmt->execute([':name' => $name]);

    echo json_encode(["success" => true, "id" => (int) $db->lastInsertId()]);

} elseif ($_SERVER['REQUEST_METHOD'] === 'PUT') {
    if ($_SESSION['user_role'] !== 'admin') {
        http_response_code(403);
        echo json_encode(["success" => false, "message" => "Forbidden"]);
        exit();
    }
    $input = json_decode(file_get_contents("php://input"), true) ?? [];
    $id   = (int) ($input['id']   ?? 0);
    $name = trim((string) ($input['name'] ?? ''));
    if ($id <= 0 || $name === '') {
        http_response_code(400);
        echo json_encode(["success" => false, "message" => "id and name are required"]);
        exit();
    }
    $stmt = $db->prepare("UPDATE vehicles SET name = :name WHERE id = :id");
    $stmt->execute([':name' => $name, ':id' => $id]);
    echo json_encode(["success" => true, "id" => $id, "name" => $name]);

} elseif ($_SERVER['REQUEST_METHOD'] === 'DELETE') {
    if ($_SESSION['user_role'] !== 'admin') {
        http_response_code(403);
        echo json_encode(["success" => false, "message" => "Forbidden"]);
        exit();
    }
    $input = json_decode(file_get_contents("php://input"), true) ?? [];
    $id = (int) ($input['id'] ?? 0);
    if ($id <= 0) {
        http_response_code(400);
        echo json_encode(["success" => false, "message" => "id is required"]);
        exit();
    }
    // Block delete if files reference this vehicle — the FK is RESTRICT so
    // we'd error anyway, but we surface a helpful message instead of a raw
    // PDOException.
    $stmt = $db->prepare("SELECT COUNT(*) FROM files WHERE vehicle_id = :id");
    $stmt->execute([':id' => $id]);
    $fileCount = (int) $stmt->fetchColumn();
    if ($fileCount > 0) {
        http_response_code(409);
        echo json_encode([
            "success" => false,
            "code"    => "vehicle_has_files",
            "message" => "Cannot delete: $fileCount file(s) are still attached to this vehicle. Delete or reassign them first.",
        ]);
        exit();
    }
    $stmt = $db->prepare("DELETE FROM vehicles WHERE id = :id");
    $stmt->execute([':id' => $id]);
    echo json_encode(["success" => true, "id" => $id]);

} else {
    http_response_code(405);
    echo json_encode(["success" => false, "message" => "Method not allowed"]);
}

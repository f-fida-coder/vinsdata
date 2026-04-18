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

} else {
    http_response_code(405);
    echo json_encode(["success" => false, "message" => "Method not allowed"]);
}

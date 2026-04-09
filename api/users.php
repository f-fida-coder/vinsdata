<?php

require_once __DIR__ . '/config.php';
initSession();

if (!isset($_SESSION['user_id'])) {
    http_response_code(401);
    echo json_encode(["success" => false, "message" => "Not authenticated"]);
    exit();
}

if ($_SESSION['user_role'] !== 'admin') {
    http_response_code(403);
    echo json_encode(["success" => false, "message" => "Forbidden"]);
    exit();
}

$db = getDBConnection();

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $stmt = $db->query("SELECT id, name, email, role, created_at FROM users ORDER BY created_at DESC");
    echo json_encode($stmt->fetchAll());

} elseif ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $input = json_decode(file_get_contents("php://input"), true);

    $name = $input['name'] ?? '';
    $email = $input['email'] ?? '';
    $password = $input['password'] ?? '';
    $role = $input['role'] ?? '';

    if (empty($name) || empty($email) || empty($password) || empty($role)) {
        http_response_code(400);
        echo json_encode(["success" => false, "message" => "All fields are required"]);
        exit();
    }

    $hash = password_hash($password, PASSWORD_BCRYPT);

    $stmt = $db->prepare("INSERT INTO users (name, email, password, role) VALUES (:name, :email, :password, :role)");
    $stmt->execute([
        ':name' => $name,
        ':email' => $email,
        ':password' => $hash,
        ':role' => $role,
    ]);

    echo json_encode(["success" => true, "id" => (int) $db->lastInsertId()]);

} else {
    http_response_code(405);
    echo json_encode(["success" => false, "message" => "Method not allowed"]);
}

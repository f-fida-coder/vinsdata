<?php

require_once __DIR__ . '/config.php';
initSession();

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    http_response_code(405);
    echo json_encode(["success" => false, "message" => "Method not allowed"]);
    exit();
}

if (!isset($_SESSION['user_id'])) {
    http_response_code(401);
    echo json_encode(["success" => false, "message" => "Not authenticated"]);
    exit();
}

echo json_encode([
    "success" => true,
    "user" => [
        "id" => $_SESSION['user_id'],
        "name" => $_SESSION['user_name'],
        "role" => $_SESSION['user_role'],
    ],
    "csrf_token" => $_SESSION['csrf_token'] ?? null,
]);

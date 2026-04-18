<?php

require_once __DIR__ . '/config.php';
initSession();

if (!isset($_SESSION['user_id'])) {
    http_response_code(401);
    echo json_encode(["success" => false, "message" => "Not authenticated"]);
    exit();
}

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    http_response_code(405);
    echo json_encode(["success" => false, "message" => "Method not allowed"]);
    exit();
}

$fileId = $_GET['file_id'] ?? null;

if (empty($fileId)) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "file_id is required"]);
    exit();
}

$db = getDBConnection();

$stmt = $db->prepare("SELECT fl.id, fl.from_stage, fl.to_stage, fl.notes, u.name AS user_name, fl.created_at AS timestamp
                      FROM file_logs fl
                      JOIN users u ON fl.user_id = u.id
                      WHERE fl.file_id = :file_id
                      ORDER BY fl.created_at ASC");
$stmt->execute([':file_id' => $fileId]);
echo json_encode($stmt->fetchAll());

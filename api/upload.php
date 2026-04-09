<?php

require_once __DIR__ . '/config.php';
initSession();

if (!isset($_SESSION['user_id'])) {
    http_response_code(401);
    echo json_encode(["success" => false, "message" => "Not authenticated"]);
    exit();
}

$db = getDBConnection();
$uploadDir = __DIR__ . '/uploads/';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $fileId = $_POST['file_id'] ?? null;
    $stage = $_POST['stage'] ?? null;
    $validStages = ['generated', 'carfax', 'filter', 'tlo'];

    if (empty($fileId) || !in_array($stage, $validStages, true)) {
        http_response_code(400);
        echo json_encode(["success" => false, "message" => "Valid file_id and stage are required"]);
        exit();
    }

    // Verify file record exists
    $stmt = $db->prepare("SELECT id FROM files WHERE id = :id");
    $stmt->execute([':id' => $fileId]);
    if (!$stmt->fetch()) {
        http_response_code(404);
        echo json_encode(["success" => false, "message" => "File not found"]);
        exit();
    }

    if (!isset($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
        http_response_code(400);
        echo json_encode(["success" => false, "message" => "File upload failed"]);
        exit();
    }

    $file = $_FILES['file'];
    $ext = pathinfo($file['name'], PATHINFO_EXTENSION);
    $storedName = uniqid('', true) . '_' . bin2hex(random_bytes(8)) . ($ext ? '.' . $ext : '');

    if (!move_uploaded_file($file['tmp_name'], $uploadDir . $storedName)) {
        http_response_code(500);
        echo json_encode(["success" => false, "message" => "Failed to store file"]);
        exit();
    }

    // Upsert: replace if already exists for this file_id+stage
    $stmt = $db->prepare("SELECT id, stored_name FROM file_uploads WHERE file_id = :file_id AND stage = :stage");
    $stmt->execute([':file_id' => $fileId, ':stage' => $stage]);
    $existing = $stmt->fetch();

    if ($existing) {
        // Delete old file from disk
        @unlink($uploadDir . $existing['stored_name']);
        $stmt = $db->prepare("UPDATE file_uploads SET original_name = :original_name, stored_name = :stored_name,
                              mime_type = :mime_type, file_size = :file_size, uploaded_by = :uploaded_by, created_at = NOW()
                              WHERE id = :id");
        $stmt->execute([
            ':original_name' => $file['name'],
            ':stored_name' => $storedName,
            ':mime_type' => $file['type'] ?: 'application/octet-stream',
            ':file_size' => $file['size'],
            ':uploaded_by' => $_SESSION['user_id'],
            ':id' => $existing['id'],
        ]);
        echo json_encode(["success" => true, "id" => $existing['id']]);
    } else {
        $stmt = $db->prepare("INSERT INTO file_uploads (file_id, stage, original_name, stored_name, mime_type, file_size, uploaded_by)
                              VALUES (:file_id, :stage, :original_name, :stored_name, :mime_type, :file_size, :uploaded_by)");
        $stmt->execute([
            ':file_id' => $fileId,
            ':stage' => $stage,
            ':original_name' => $file['name'],
            ':stored_name' => $storedName,
            ':mime_type' => $file['type'] ?: 'application/octet-stream',
            ':file_size' => $file['size'],
            ':uploaded_by' => $_SESSION['user_id'],
        ]);
        echo json_encode(["success" => true, "id" => (int) $db->lastInsertId()]);
    }

} elseif ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $fileId = $_GET['file_id'] ?? null;
    $stage = $_GET['stage'] ?? null;

    if (empty($fileId)) {
        http_response_code(400);
        echo json_encode(["success" => false, "message" => "file_id is required"]);
        exit();
    }

    if ($stage) {
        // Download mode
        $stmt = $db->prepare("SELECT original_name, stored_name, mime_type, file_size FROM file_uploads WHERE file_id = :file_id AND stage = :stage");
        $stmt->execute([':file_id' => $fileId, ':stage' => $stage]);
        $upload = $stmt->fetch();

        if (!$upload) {
            http_response_code(404);
            echo json_encode(["success" => false, "message" => "No upload found for this stage"]);
            exit();
        }

        $filePath = $uploadDir . $upload['stored_name'];
        if (!file_exists($filePath)) {
            http_response_code(404);
            echo json_encode(["success" => false, "message" => "File not found on disk"]);
            exit();
        }

        header('Content-Type: ' . $upload['mime_type']);
        header('Content-Disposition: attachment; filename="' . $upload['original_name'] . '"');
        header('Content-Length: ' . $upload['file_size']);
        readfile($filePath);
        exit();
    } else {
        // List mode
        $stmt = $db->prepare("SELECT id, stage, original_name, file_size, created_at FROM file_uploads WHERE file_id = :file_id ORDER BY created_at ASC");
        $stmt->execute([':file_id' => $fileId]);
        echo json_encode($stmt->fetchAll());
    }

} elseif ($_SERVER['REQUEST_METHOD'] === 'PATCH') {
    $input = json_decode(file_get_contents("php://input"), true);
    $fileId = $input['file_id'] ?? null;
    $stage = $input['stage'] ?? null;
    $status = $input['status'] ?? null;

    if (empty($fileId) || empty($stage) || !in_array($status, ['pending', 'confirmed'], true)) {
        http_response_code(400);
        echo json_encode(["success" => false, "message" => "file_id, stage, and valid status (pending/confirmed) are required"]);
        exit();
    }

    $stmt = $db->prepare("UPDATE file_uploads SET status = :status WHERE file_id = :file_id AND stage = :stage");
    $stmt->execute([':status' => $status, ':file_id' => $fileId, ':stage' => $stage]);

    if ($stmt->rowCount() === 0) {
        http_response_code(404);
        echo json_encode(["success" => false, "message" => "Upload not found"]);
        exit();
    }

    echo json_encode(["success" => true]);

} else {
    http_response_code(405);
    echo json_encode(["success" => false, "message" => "Method not allowed"]);
}

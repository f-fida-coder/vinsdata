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
    $sql = "SELECT f.id, f.file_name, v.name AS vehicle_name, f.year, f.version,
                   f.current_stage, f.is_invalid, u.name AS added_by_name, f.created_at, f.updated_at
            FROM files f
            JOIN vehicles v ON f.vehicle_id = v.id
            JOIN users u ON f.added_by = u.id
            WHERE 1=1";
    $params = [];

    if (!empty($_GET['vehicle_id'])) {
        $sql .= " AND f.vehicle_id = :vehicle_id";
        $params[':vehicle_id'] = $_GET['vehicle_id'];
    }

    if (!empty($_GET['stage'])) {
        $sql .= " AND f.current_stage = :stage";
        $params[':stage'] = $_GET['stage'];
    }

    if (!empty($_GET['year'])) {
        $sql .= " AND f.year = :year";
        $params[':year'] = $_GET['year'];
    }

    $sql .= " ORDER BY f.updated_at DESC";

    $stmt = $db->prepare($sql);
    $stmt->execute($params);
    $files = $stmt->fetchAll();

    // Attach uploaded_stages to each file
    $fileIds = array_column($files, 'id');
    $uploadMap = [];
    if (!empty($fileIds)) {
        $placeholders = implode(',', array_fill(0, count($fileIds), '?'));
        $uploadStmt = $db->prepare("SELECT file_id, stage FROM file_uploads WHERE file_id IN ($placeholders)");
        $uploadStmt->execute($fileIds);
        foreach ($uploadStmt->fetchAll() as $u) {
            $uploadMap[$u['file_id']][] = $u['stage'];
        }
    }
    foreach ($files as &$f) {
        $f['uploaded_stages'] = $uploadMap[$f['id']] ?? [];
    }

    echo json_encode($files);

} elseif ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $input = json_decode(file_get_contents("php://input"), true);

    $vehicleId = $input['vehicle_id'] ?? null;
    $fileName = $input['file_name'] ?? '';
    $year = $input['year'] ?? null;
    $version = $input['version'] ?? null;

    if (empty($vehicleId) || empty($fileName)) {
        http_response_code(400);
        echo json_encode(["success" => false, "message" => "vehicle_id and file_name are required"]);
        exit();
    }

    $db->beginTransaction();

    $stmt = $db->prepare("INSERT INTO files (vehicle_id, file_name, year, version, current_stage, added_by)
                          VALUES (:vehicle_id, :file_name, :year, :version, 'generated', :added_by)");
    $stmt->execute([
        ':vehicle_id' => $vehicleId,
        ':file_name' => $fileName,
        ':year' => $year,
        ':version' => $version,
        ':added_by' => $_SESSION['user_id'],
    ]);

    $fileId = (int) $db->lastInsertId();

    $stmt = $db->prepare("INSERT INTO file_logs (file_id, user_id, from_stage, to_stage)
                          VALUES (:file_id, :user_id, NULL, 'generated')");
    $stmt->execute([
        ':file_id' => $fileId,
        ':user_id' => $_SESSION['user_id'],
    ]);

    $db->commit();

    echo json_encode(["success" => true, "id" => $fileId]);

} elseif ($_SERVER['REQUEST_METHOD'] === 'PUT') {
    $input = json_decode(file_get_contents("php://input"), true);

    $fileId = $input['id'] ?? null;
    $newStage = $input['stage'] ?? '';
    $notes = $input['notes'] ?? null;

    $validStages = ['generated', 'carfax', 'filter', 'tlo'];

    if (empty($fileId) || !in_array($newStage, $validStages, true)) {
        http_response_code(400);
        echo json_encode(["success" => false, "message" => "Valid id and stage (generated, carfax, filter, tlo) are required"]);
        exit();
    }

    $stmt = $db->prepare("SELECT current_stage FROM files WHERE id = :id");
    $stmt->execute([':id' => $fileId]);
    $file = $stmt->fetch();

    if (!$file) {
        http_response_code(404);
        echo json_encode(["success" => false, "message" => "File not found"]);
        exit();
    }

    $fromStage = $file['current_stage'];

    $db->beginTransaction();

    $stmt = $db->prepare("UPDATE files SET current_stage = :stage, updated_at = NOW() WHERE id = :id");
    $stmt->execute([':stage' => $newStage, ':id' => $fileId]);

    $stmt = $db->prepare("INSERT INTO file_logs (file_id, user_id, from_stage, to_stage, notes)
                          VALUES (:file_id, :user_id, :from_stage, :to_stage, :notes)");
    $stmt->execute([
        ':file_id' => $fileId,
        ':user_id' => $_SESSION['user_id'],
        ':from_stage' => $fromStage,
        ':to_stage' => $newStage,
        ':notes' => $notes,
    ]);

    $db->commit();

    echo json_encode(["success" => true]);

} elseif ($_SERVER['REQUEST_METHOD'] === 'PATCH') {
    $input = json_decode(file_get_contents("php://input"), true);

    // Bulk invalid toggle
    if (isset($input['ids'])) {
        $ids = $input['ids'];
        $isInvalid = $input['is_invalid'] ?? null;

        if (empty($ids) || $isInvalid === null) {
            http_response_code(400);
            echo json_encode(["success" => false, "message" => "ids array and is_invalid are required"]);
            exit();
        }

        $placeholders = implode(',', array_fill(0, count($ids), '?'));
        $stmt = $db->prepare("UPDATE files SET is_invalid = ?, updated_at = NOW() WHERE id IN ($placeholders)");
        $stmt->execute(array_merge([$isInvalid ? 1 : 0], $ids));

        echo json_encode(["success" => true]);

    // Single file edit
    } elseif (isset($input['id'])) {
        $fileId = $input['id'];
        $fileName = $input['file_name'] ?? null;
        $year = $input['year'] ?? null;
        $version = $input['version'] ?? null;

        if (empty($fileId)) {
            http_response_code(400);
            echo json_encode(["success" => false, "message" => "File id is required"]);
            exit();
        }

        $fields = [];
        $params = [':id' => $fileId];

        if ($fileName !== null) {
            $fields[] = "file_name = :file_name";
            $params[':file_name'] = $fileName;
        }
        if ($year !== null) {
            $fields[] = "year = :year";
            $params[':year'] = $year ?: null;
        }
        if ($version !== null) {
            $fields[] = "version = :version";
            $params[':version'] = $version ?: null;
        }

        if (empty($fields)) {
            http_response_code(400);
            echo json_encode(["success" => false, "message" => "No fields to update"]);
            exit();
        }

        $fields[] = "updated_at = NOW()";
        $sql = "UPDATE files SET " . implode(', ', $fields) . " WHERE id = :id";
        $stmt = $db->prepare($sql);
        $stmt->execute($params);

        echo json_encode(["success" => true]);

    } else {
        http_response_code(400);
        echo json_encode(["success" => false, "message" => "Invalid request"]);
    }

} elseif ($_SERVER['REQUEST_METHOD'] === 'DELETE') {
    $input = json_decode(file_get_contents("php://input"), true);
    $fileId = $input['id'] ?? null;

    if (empty($fileId)) {
        http_response_code(400);
        echo json_encode(["success" => false, "message" => "File id is required"]);
        exit();
    }

    // Check file exists
    $stmt = $db->prepare("SELECT id FROM files WHERE id = :id");
    $stmt->execute([':id' => $fileId]);
    if (!$stmt->fetch()) {
        http_response_code(404);
        echo json_encode(["success" => false, "message" => "File not found"]);
        exit();
    }

    // Delete uploaded files from disk
    $uploadDir = __DIR__ . '/uploads/';
    $stmt = $db->prepare("SELECT stored_name FROM file_uploads WHERE file_id = :file_id");
    $stmt->execute([':file_id' => $fileId]);
    foreach ($stmt->fetchAll() as $upload) {
        @unlink($uploadDir . $upload['stored_name']);
    }

    $db->beginTransaction();

    // file_uploads has ON DELETE CASCADE, but delete explicitly for safety
    $stmt = $db->prepare("DELETE FROM file_uploads WHERE file_id = :file_id");
    $stmt->execute([':file_id' => $fileId]);

    $stmt = $db->prepare("DELETE FROM file_logs WHERE file_id = :file_id");
    $stmt->execute([':file_id' => $fileId]);

    $stmt = $db->prepare("DELETE FROM files WHERE id = :id");
    $stmt->execute([':id' => $fileId]);

    $db->commit();

    echo json_encode(["success" => true]);

} else {
    http_response_code(405);
    echo json_encode(["success" => false, "message" => "Method not allowed"]);
}

<?php

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/pipeline.php';
initSession();

$user = requireAuth();
$db   = getDBConnection();

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $sql = "SELECT f.id, f.vehicle_id, v.name AS vehicle_name,
                   f.base_name, f.display_name, f.file_name,
                   f.year, f.version, f.current_stage, f.status, f.is_invalid,
                   f.created_by, cu.name AS created_by_name,
                   f.assigned_to, au.name AS assigned_to_name,
                   f.latest_artifact_id, f.created_at, f.updated_at
              FROM files f
              JOIN vehicles v ON f.vehicle_id = v.id
              JOIN users cu   ON f.created_by = cu.id
              LEFT JOIN users au ON f.assigned_to = au.id
             WHERE 1=1";
    $params = [];

    if (!empty($_GET['vehicle_id'])) {
        $sql .= ' AND f.vehicle_id = :vehicle_id';
        $params[':vehicle_id'] = $_GET['vehicle_id'];
    }
    if (!empty($_GET['stage'])) {
        $sql .= ' AND f.current_stage = :stage';
        $params[':stage'] = $_GET['stage'];
    }
    if (!empty($_GET['status'])) {
        $sql .= ' AND f.status = :status';
        $params[':status'] = $_GET['status'];
    }
    if (!empty($_GET['year'])) {
        $sql .= ' AND f.year = :year';
        $params[':year'] = $_GET['year'];
    }

    $sql .= ' ORDER BY f.updated_at DESC';

    $stmt = $db->prepare($sql);
    $stmt->execute($params);
    $files = $stmt->fetchAll();

    $fileIds = array_column($files, 'id');
    $artifactsByFile = [];
    if (!empty($fileIds)) {
        $placeholders = implode(',', array_fill(0, count($fileIds), '?'));
        $stmt = $db->prepare(
            "SELECT a.id, a.file_id, a.stage, a.original_filename, a.file_size,
                    a.uploaded_at, a.notes, u.name AS uploaded_by_name
               FROM file_artifacts a
               JOIN users u ON u.id = a.uploaded_by
              WHERE a.file_id IN ($placeholders)
              ORDER BY a.uploaded_at ASC, a.id ASC"
        );
        $stmt->execute($fileIds);
        foreach ($stmt->fetchAll() as $a) {
            $artifactsByFile[$a['file_id']][] = $a;
        }
    }

    foreach ($files as &$f) {
        $artifacts = $artifactsByFile[$f['id']] ?? [];
        $byStage = ['generated' => [], 'carfax' => [], 'filter' => [], 'tlo' => []];
        foreach ($artifacts as $a) {
            $byStage[$a['stage']][] = [
                'id'                => (int) $a['id'],
                'original_filename' => $a['original_filename'],
                'file_size'         => (int) $a['file_size'],
                'uploaded_at'       => $a['uploaded_at'],
                'uploaded_by_name'  => $a['uploaded_by_name'],
                'notes'             => $a['notes'],
            ];
        }
        $f['vehicle']          = ['id' => (int) $f['vehicle_id'], 'name' => $f['vehicle_name']];
        $f['created_by_user']  = ['id' => (int) $f['created_by'], 'name' => $f['created_by_name']];
        $f['assigned_to_user'] = $f['assigned_to'] ? ['id' => (int) $f['assigned_to'], 'name' => $f['assigned_to_name']] : null;
        $f['artifacts_by_stage'] = $byStage;
        // Legacy aliases for the existing frontend
        $f['uploaded_stages'] = array_values(array_unique(array_column($artifacts, 'stage')));
        $f['uploads'] = array_map(fn($s) => ['stage' => $s, 'status' => 'confirmed'], $f['uploaded_stages']);
        $f['is_invalid'] = (int) $f['is_invalid'];

        $next = NEXT_STAGE[$f['current_stage']] ?? null;
        $f['next_stage'] = $next;
        $f['next_upload_missing'] = $next !== null
            && $f['status'] === 'active'
            && empty($byStage[$next]);
    }

    echo json_encode($files);
    exit();
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    assertAdmin($user);
    $input = json_decode(file_get_contents('php://input'), true) ?? [];

    $vehicleId   = (int) ($input['vehicle_id'] ?? 0);
    $baseName    = trim($input['base_name'] ?? $input['file_name'] ?? '');
    $displayName = trim($input['display_name'] ?? $baseName);
    $year        = $input['year']    ?? null;
    $version     = $input['version'] ?? null;

    if ($vehicleId <= 0 || $baseName === '') {
        pipelineFail(400, 'vehicle_id and base_name are required', 'missing_fields');
    }

    try {
        $db->beginTransaction();
        $stmt = $db->prepare(
            "INSERT INTO files (vehicle_id, base_name, display_name, file_name, year, version,
                                current_stage, status, created_by, added_by)
             VALUES (:vehicle_id, :base_name, :display_name, :file_name, :year, :version,
                     'generated', 'active', :created_by, :created_by)"
        );
        $stmt->execute([
            ':vehicle_id'   => $vehicleId,
            ':base_name'    => $baseName,
            ':display_name' => $displayName,
            ':file_name'    => $displayName,
            ':year'         => $year ?: null,
            ':version'      => $version ?: null,
            ':created_by'   => $user['id'],
        ]);
        $fileId = (int) $db->lastInsertId();

        recordHistory($db, $fileId, null, 'generated', 'create', null, $user['id']);
        $db->commit();
    } catch (Throwable $e) {
        $db->rollBack();
        pipelineFail(500, 'Create failed: ' . $e->getMessage(), 'db_error');
    }

    echo json_encode(['success' => true, 'id' => $fileId]);
    exit();
}

if ($_SERVER['REQUEST_METHOD'] === 'PUT') {
    // Kept for backward compatibility with the existing frontend: forwards to advance logic.
    $input = json_decode(file_get_contents('php://input'), true) ?? [];
    $_POST['file_id'] = $input['id']    ?? null;
    $_POST['notes']   = $input['notes'] ?? null;
    $_POST['target_stage'] = $input['stage'] ?? null;
    require __DIR__ . '/advance.php';
    exit();
}

if ($_SERVER['REQUEST_METHOD'] === 'PATCH') {
    $input = json_decode(file_get_contents('php://input'), true) ?? [];

    // Status override (admin only)
    if (isset($input['id'], $input['status'])) {
        assertAdmin($user);
        $newStatus = $input['status'];
        if (!in_array($newStatus, STATUSES, true)) {
            pipelineFail(400, 'Invalid status', 'invalid_status');
        }
        $file = loadFileOrFail($db, (int) $input['id']);
        $action = match ($newStatus) {
            'invalid'   => 'invalidate',
            'blocked'   => 'block',
            'completed' => 'complete',
            'active'    => 'reactivate',
        };
        try {
            $db->beginTransaction();
            $stmt = $db->prepare('UPDATE files SET status = :status, is_invalid = :is_invalid, updated_at = NOW() WHERE id = :id');
            $stmt->execute([
                ':status'     => $newStatus,
                ':is_invalid' => $newStatus === 'invalid' ? 1 : 0,
                ':id'         => $file['id'],
            ]);
            recordHistory($db, (int) $file['id'], $file['current_stage'], $file['current_stage'], $action, null, $user['id'], $input['remarks'] ?? null);
            $db->commit();
        } catch (Throwable $e) {
            $db->rollBack();
            pipelineFail(500, 'Status update failed: ' . $e->getMessage(), 'db_error');
        }
        echo json_encode(['success' => true]);
        exit();
    }

    // Legacy bulk invalid toggle (admin only)
    if (isset($input['ids']) && array_key_exists('is_invalid', $input)) {
        assertAdmin($user);
        $ids = array_values(array_filter(array_map('intval', $input['ids'])));
        if (empty($ids)) {
            pipelineFail(400, 'ids array is required', 'missing_fields');
        }
        $flag   = $input['is_invalid'] ? 1 : 0;
        $status = $flag ? 'invalid' : 'active';
        $placeholders = implode(',', array_fill(0, count($ids), '?'));
        $stmt = $db->prepare("UPDATE files SET is_invalid = ?, status = ?, updated_at = NOW() WHERE id IN ($placeholders)");
        $stmt->execute(array_merge([$flag, $status], $ids));
        echo json_encode(['success' => true]);
        exit();
    }

    // Single file edit (admin only for metadata changes)
    if (isset($input['id'])) {
        assertAdmin($user);
        $fileId      = (int) $input['id'];
        $displayName = $input['display_name'] ?? $input['file_name'] ?? null;
        $year        = $input['year']    ?? null;
        $version     = $input['version'] ?? null;

        $fields = []; $params = [':id' => $fileId];
        if ($displayName !== null) {
            $fields[] = 'display_name = :display_name';
            $fields[] = 'file_name    = :file_name';
            $params[':display_name'] = $displayName;
            $params[':file_name']    = $displayName;
        }
        if ($year    !== null) { $fields[] = 'year    = :year';    $params[':year']    = $year ?: null; }
        if ($version !== null) { $fields[] = 'version = :version'; $params[':version'] = $version ?: null; }

        if (empty($fields)) {
            pipelineFail(400, 'No fields to update', 'missing_fields');
        }
        $fields[] = 'updated_at = NOW()';
        $sql = 'UPDATE files SET ' . implode(', ', $fields) . ' WHERE id = :id';
        $stmt = $db->prepare($sql);
        $stmt->execute($params);
        echo json_encode(['success' => true]);
        exit();
    }

    pipelineFail(400, 'Invalid request', 'invalid_request');
}

if ($_SERVER['REQUEST_METHOD'] === 'DELETE') {
    assertAdmin($user);
    $input = json_decode(file_get_contents('php://input'), true) ?? [];
    $fileId = (int) ($input['id'] ?? 0);
    if ($fileId <= 0) {
        pipelineFail(400, 'File id is required', 'missing_fields');
    }

    $file = loadFileOrFail($db, $fileId);

    $uploadDir = __DIR__ . '/uploads/';
    $stmt = $db->prepare('SELECT stored_filename FROM file_artifacts WHERE file_id = :id');
    $stmt->execute([':id' => $fileId]);
    foreach ($stmt->fetchAll() as $a) {
        @unlink($uploadDir . $a['stored_filename']);
    }
    // also sweep legacy file_uploads to keep disk clean
    $stmt = $db->prepare('SELECT stored_name FROM file_uploads WHERE file_id = :id');
    $stmt->execute([':id' => $fileId]);
    foreach ($stmt->fetchAll() as $u) {
        @unlink($uploadDir . $u['stored_name']);
    }

    try {
        $db->beginTransaction();
        // legacy tables first (no FKs on them)
        $db->prepare('DELETE FROM file_uploads WHERE file_id = :id')->execute([':id' => $fileId]);
        $db->prepare('DELETE FROM file_logs    WHERE file_id = :id')->execute([':id' => $fileId]);
        // file_artifacts and file_stage_history cascade on FK
        $db->prepare('DELETE FROM files WHERE id = :id')->execute([':id' => $fileId]);
        $db->commit();
    } catch (Throwable $e) {
        $db->rollBack();
        pipelineFail(500, 'Delete failed: ' . $e->getMessage(), 'db_error');
    }

    echo json_encode(['success' => true]);
    exit();
}

pipelineFail(405, 'Method not allowed', 'method_not_allowed');

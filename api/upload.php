<?php

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/pipeline.php';
initSession();

$user = requireAuth();
$db   = getDBConnection();
$uploadDir = __DIR__ . '/uploads/';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $fileId = (int) ($_POST['file_id'] ?? 0);
    $stage  = assertStage($_POST['stage'] ?? null);
    $notes  = $_POST['notes'] ?? null;

    if ($fileId <= 0) {
        pipelineFail(400, 'file_id is required', 'missing_file_id');
    }

    if (!isset($_FILES['file'])) {
        pipelineFail(400, 'No file provided', 'no_file');
    }
    validateUploadedArtifact($_FILES['file']);

    $file = loadFileOrFail($db, $fileId);
    assertActive($file);

    // Stage rule: upload is allowed only for the current stage (re-upload)
    // or the next stage (pre-advance). No skipping.
    $current = $file['current_stage'];
    $next    = NEXT_STAGE[$current] ?? null;
    if ($stage !== $current && $stage !== $next) {
        pipelineFail(422, "Upload for stage '$stage' not allowed; file is at '$current'", 'stage_not_allowed');
    }

    assertRoleForStage($user['role'] ?? '', $stage);

    $stored = storeUploadedFile($uploadDir, $_FILES['file']);

    try {
        $db->beginTransaction();

        $stmt = $db->prepare(
            'INSERT INTO file_artifacts
               (file_id, stage, original_filename, stored_filename, file_path, file_type, file_size, uploaded_by, notes)
             VALUES (:file_id, :stage, :original_filename, :stored_filename, :file_path, :file_type, :file_size, :uploaded_by, :notes)'
        );
        $stmt->execute([
            ':file_id'           => $fileId,
            ':stage'             => $stage,
            ':original_filename' => $_FILES['file']['name'],
            ':stored_filename'   => $stored['stored_name'],
            ':file_path'         => $stored['relative_path'],
            ':file_type'         => $_FILES['file']['type'] ?: 'application/octet-stream',
            ':file_size'         => $_FILES['file']['size'],
            ':uploaded_by'       => $user['id'],
            ':notes'             => $notes,
        ]);
        $artifactId = (int) $db->lastInsertId();

        $stmt = $db->prepare('UPDATE files SET latest_artifact_id = :aid, updated_at = NOW() WHERE id = :id');
        $stmt->execute([':aid' => $artifactId, ':id' => $fileId]);

        recordHistory($db, $fileId, $current, $stage, 'upload', $artifactId, $user['id'], $notes);

        $db->commit();
    } catch (Throwable $e) {
        $db->rollBack();
        @unlink($stored['destination']);
        pipelineFail(500, 'Upload failed: ' . $e->getMessage(), 'db_error');
    }

    echo json_encode([
        'success'     => true,
        'artifact_id' => $artifactId,
        'stage'       => $stage,
    ]);
    exit();
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $fileId     = isset($_GET['file_id'])    ? (int) $_GET['file_id']    : null;
    $stage      = $_GET['stage']             ?? null;
    $artifactId = isset($_GET['artifact_id']) ? (int) $_GET['artifact_id'] : null;

    // Download by explicit artifact id (preserves access to historical versions)
    if ($artifactId) {
        $stmt = $db->prepare('SELECT original_filename, stored_filename, file_type, file_size FROM file_artifacts WHERE id = :id');
        $stmt->execute([':id' => $artifactId]);
        $artifact = $stmt->fetch();
        if (!$artifact) {
            pipelineFail(404, 'Artifact not found', 'artifact_not_found');
        }
        $path = $uploadDir . $artifact['stored_filename'];
        if (!file_exists($path)) {
            pipelineFail(404, 'File missing on disk', 'file_missing');
        }
        header('Content-Type: ' . $artifact['file_type']);
        header('Content-Disposition: attachment; filename="' . $artifact['original_filename'] . '"');
        header('Content-Length: ' . $artifact['file_size']);
        readfile($path);
        exit();
    }

    if (!$fileId) {
        pipelineFail(400, 'file_id is required', 'missing_file_id');
    }

    // Download latest artifact for a given stage
    if ($stage) {
        assertStage($stage);
        $stmt = $db->prepare(
            'SELECT original_filename, stored_filename, file_type, file_size
               FROM file_artifacts
              WHERE file_id = :fid AND stage = :stage
              ORDER BY id DESC LIMIT 1'
        );
        $stmt->execute([':fid' => $fileId, ':stage' => $stage]);
        $artifact = $stmt->fetch();
        if (!$artifact) {
            pipelineFail(404, 'No artifact for this stage', 'artifact_not_found');
        }
        $path = $uploadDir . $artifact['stored_filename'];
        if (!file_exists($path)) {
            pipelineFail(404, 'File missing on disk', 'file_missing');
        }
        header('Content-Type: ' . $artifact['file_type']);
        header('Content-Disposition: attachment; filename="' . $artifact['original_filename'] . '"');
        header('Content-Length: ' . $artifact['file_size']);
        readfile($path);
        exit();
    }

    // List mode: all artifacts for a file
    $stmt = $db->prepare(
        'SELECT a.id, a.stage, a.original_filename, a.file_size, a.uploaded_at, a.notes,
                u.name AS uploaded_by_name
           FROM file_artifacts a
           JOIN users u ON u.id = a.uploaded_by
          WHERE a.file_id = :fid
          ORDER BY a.uploaded_at ASC, a.id ASC'
    );
    $stmt->execute([':fid' => $fileId]);
    echo json_encode($stmt->fetchAll());
    exit();
}

if ($_SERVER['REQUEST_METHOD'] === 'PATCH') {
    // Backward-compat no-op: the old pending/confirmed model is gone.
    // Every upload is authoritative on insert. The UI still calls this before
    // opening the WhatsApp notify modal; keep it as a success response until the UI is rewritten.
    echo json_encode(['success' => true, 'compat' => 'noop']);
    exit();
}

pipelineFail(405, 'Method not allowed', 'method_not_allowed');

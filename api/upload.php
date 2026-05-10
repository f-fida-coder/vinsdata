<?php

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/pipeline.php';
initSession();

$user = requireAuth();
$db   = getDBConnection();
$uploadDir = __DIR__ . '/uploads/';

/**
 * Send the artifact's content to the client. Prefers the inline DB blob
 * (file_bytes) — that's the source of truth and works regardless of which
 * filesystem actually wrote the original upload. Falls back to disk for
 * legacy artifacts uploaded before migration 012, and 404s if neither has
 * the bytes.
 *
 * On disk-fallback hit, the bytes are also persisted back into the DB so
 * subsequent reads don't have to re-touch disk.
 */
function serveArtifactBody(array $artifact, string $uploadDir): void
{
    // Make sure JSON content-type from config.php doesn't leak into a binary
    // download — explicitly clear and re-set.
    if (function_exists('header_remove')) header_remove('Content-Type');

    $bytes = $artifact['file_bytes'] ?? null;

    if ($bytes !== null && $bytes !== '') {
        header('Content-Type: ' . ($artifact['file_type'] ?: 'application/octet-stream'));
        header('Content-Disposition: attachment; filename="' . $artifact['original_filename'] . '"');
        header('Content-Length: ' . strlen($bytes));
        echo $bytes;
        return;
    }

    // Legacy fallback: bytes column is null because the row predates 012.
    $path = $uploadDir . $artifact['stored_filename'];
    if (is_file($path)) {
        header('Content-Type: ' . ($artifact['file_type'] ?: 'application/octet-stream'));
        header('Content-Disposition: attachment; filename="' . $artifact['original_filename'] . '"');
        header('Content-Length: ' . filesize($path));
        readfile($path);

        // Opportunistically backfill the blob so next read skips the disk hop.
        $diskBytes = @file_get_contents($path);
        if ($diskBytes !== false && isset($artifact['id'])) {
            try {
                $upd = getDBConnection()->prepare('UPDATE file_artifacts SET file_bytes = :b WHERE id = :id');
                $upd->bindValue(':b',  $diskBytes, PDO::PARAM_LOB);
                $upd->bindValue(':id', (int) $artifact['id'], PDO::PARAM_INT);
                $upd->execute();
            } catch (Throwable $_) { /* non-fatal; main response already sent */ }
        }
        return;
    }

    pipelineFail(404, 'File missing on disk and DB blob is empty', 'file_missing');
}

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

    // Read the bytes off disk so we can store them inline in the DB. The DB is
    // the source of truth — disk is just a cache that any environment can
    // re-hydrate. This is what makes dev (local PHP) and prod (Hostinger PHP)
    // share artifact contents through the shared MySQL host without manual
    // file syncing.
    $bytes = @file_get_contents($stored['destination']);
    if ($bytes === false) {
        @unlink($stored['destination']);
        pipelineFail(500, 'Failed to read uploaded file for DB storage', 'read_failed');
    }

    try {
        $db->beginTransaction();

        $stmt = $db->prepare(
            'INSERT INTO file_artifacts
               (file_id, stage, original_filename, stored_filename, file_path, file_type, file_size, file_bytes, uploaded_by, notes)
             VALUES (:file_id, :stage, :original_filename, :stored_filename, :file_path, :file_type, :file_size, :file_bytes, :uploaded_by, :notes)'
        );
        $stmt->bindValue(':file_id',           $fileId,                                            PDO::PARAM_INT);
        $stmt->bindValue(':stage',             $stage,                                             PDO::PARAM_STR);
        $stmt->bindValue(':original_filename', $_FILES['file']['name'],                            PDO::PARAM_STR);
        $stmt->bindValue(':stored_filename',   $stored['stored_name'],                             PDO::PARAM_STR);
        $stmt->bindValue(':file_path',         $stored['relative_path'],                           PDO::PARAM_STR);
        $stmt->bindValue(':file_type',         $_FILES['file']['type'] ?: 'application/octet-stream', PDO::PARAM_STR);
        $stmt->bindValue(':file_size',         (int) $_FILES['file']['size'],                      PDO::PARAM_INT);
        $stmt->bindValue(':file_bytes',        $bytes,                                             PDO::PARAM_LOB);
        $stmt->bindValue(':uploaded_by',       (int) $user['id'],                                  PDO::PARAM_INT);
        $stmt->bindValue(':notes',             $notes,                                             $notes === null ? PDO::PARAM_NULL : PDO::PARAM_STR);
        $stmt->execute();
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
        $stmt = $db->prepare('SELECT id, original_filename, stored_filename, file_type, file_size, file_bytes FROM file_artifacts WHERE id = :id');
        $stmt->execute([':id' => $artifactId]);
        $artifact = $stmt->fetch();
        if (!$artifact) {
            pipelineFail(404, 'Artifact not found', 'artifact_not_found');
        }
        serveArtifactBody($artifact, $uploadDir);
        exit();
    }

    if (!$fileId) {
        pipelineFail(400, 'file_id is required', 'missing_file_id');
    }

    // Download latest artifact for a given stage
    if ($stage) {
        assertStage($stage);
        $stmt = $db->prepare(
            'SELECT id, original_filename, stored_filename, file_type, file_size, file_bytes
               FROM file_artifacts
              WHERE file_id = :fid AND stage = :stage
              ORDER BY id DESC LIMIT 1'
        );
        $stmt->execute([':fid' => $fileId, ':stage' => $stage]);
        $artifact = $stmt->fetch();
        if (!$artifact) {
            pipelineFail(404, 'No artifact for this stage', 'artifact_not_found');
        }
        serveArtifactBody($artifact, $uploadDir);
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

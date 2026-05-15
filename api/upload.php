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

if ($_SERVER['REQUEST_METHOD'] === 'DELETE') {
    assertAdmin($user);
    $input      = json_decode(file_get_contents('php://input'), true) ?? [];
    $artifactId = (int) ($input['artifact_id'] ?? $_GET['artifact_id'] ?? 0);
    if ($artifactId <= 0) {
        pipelineFail(400, 'artifact_id is required', 'missing_artifact_id');
    }

    $stmt = $db->prepare('SELECT id, file_id, stage, stored_filename FROM file_artifacts WHERE id = :id');
    $stmt->execute([':id' => $artifactId]);
    $artifact = $stmt->fetch();
    if (!$artifact) {
        pipelineFail(404, 'Artifact not found', 'artifact_not_found');
    }

    $file = loadFileOrFail($db, (int) $artifact['file_id']);

    // Count leads cascading out via lead_import_batches → imported_leads_raw,
    // so the response can confirm what was wiped.
    $stmt = $db->prepare(
        'SELECT COUNT(r.id)
           FROM imported_leads_raw r
           JOIN lead_import_batches b ON b.id = r.batch_id
          WHERE b.artifact_id = :aid'
    );
    $stmt->execute([':aid' => $artifactId]);
    $leadCount = (int) $stmt->fetchColumn();

    try {
        $db->beginTransaction();

        // Cascade does the heavy lifting:
        //   file_artifacts → lead_import_batches → imported_leads_raw
        //                  → lead_states / labels / notes / activities / tasks / contact_logs
        //                    / marketing_campaign_recipients / merge_prep_choices
        //                    / lead_duplicate_group_members
        // files.latest_artifact_id is ON DELETE SET NULL — we re-point it below.
        // file_stage_history.artifact_id is ON DELETE SET NULL — history rows are preserved.
        $del = $db->prepare('DELETE FROM file_artifacts WHERE id = :id');
        $del->execute([':id' => $artifactId]);

        // Re-point latest_artifact_id to the most recent remaining artifact (or NULL).
        $stmt = $db->prepare(
            'SELECT id FROM file_artifacts WHERE file_id = :fid ORDER BY id DESC LIMIT 1'
        );
        $stmt->execute([':fid' => $file['id']]);
        $latestId = $stmt->fetchColumn();

        // Recompute the file's effective stage from what's left on disk.
        // Rule: the new current_stage is the longest unbroken prefix of STAGES
        // that still has at least one artifact at each step. Deleting any stage
        // mid-pipeline (e.g. carfax while at TLO) rolls the file back so the
        // user must re-upload that stage before advancing/importing again.
        $stmt = $db->prepare('SELECT DISTINCT stage FROM file_artifacts WHERE file_id = :fid');
        $stmt->execute([':fid' => $file['id']]);
        $has = array_fill_keys(STAGES, false);
        foreach ($stmt->fetchAll(PDO::FETCH_COLUMN) as $s) {
            if (isset($has[$s])) $has[$s] = true;
        }
        $effectiveStage = 'generated';
        foreach (STAGES as $s) {
            if ($has[$s]) {
                $effectiveStage = $s;
            } else {
                break;
            }
        }
        // Never auto-advance past where the file already is.
        $stageOrder = array_flip(STAGES);
        if ($stageOrder[$effectiveStage] > $stageOrder[$file['current_stage']]) {
            $effectiveStage = $file['current_stage'];
        }

        // 'completed' is only valid at TLO and only while a TLO artifact remains.
        $newStatus = ($effectiveStage === 'tlo' && $file['status'] === 'completed')
            ? 'completed'
            : 'active';

        $rolledBack    = $effectiveStage !== $file['current_stage'];
        $reactivated   = !$rolledBack && $newStatus !== $file['status'];
        $stageNames    = ['generated' => 'Generated', 'carfax' => 'Carfax', 'filter' => 'Filter', 'tlo' => 'TLO'];
        $deletedLabel  = $stageNames[$artifact['stage']] ?? $artifact['stage'];

        $upd = $db->prepare(
            'UPDATE files
                SET current_stage      = :stage,
                    status             = :status,
                    latest_artifact_id = :aid,
                    is_invalid         = CASE WHEN :status2 = \'invalid\' THEN 1 ELSE 0 END,
                    updated_at         = NOW()
              WHERE id = :id'
        );
        $upd->execute([
            ':stage'   => $effectiveStage,
            ':status'  => $newStatus,
            ':status2' => $newStatus,
            ':aid'     => $latestId ?: null,
            ':id'      => $file['id'],
        ]);

        if ($rolledBack) {
            recordHistory(
                $db, (int) $file['id'], $file['current_stage'], $effectiveStage, 'reactivate',
                null, $user['id'],
                "Rolled back to {$stageNames[$effectiveStage]} after deleting $deletedLabel artifact"
            );
        } elseif ($reactivated) {
            recordHistory(
                $db, (int) $file['id'], $file['current_stage'], $file['current_stage'], 'reactivate',
                null, $user['id'],
                "Reactivated after deleting $deletedLabel artifact"
            );
        }

        $db->commit();
    } catch (Throwable $e) {
        $db->rollBack();
        pipelineFail(500, 'Delete failed: ' . $e->getMessage(), 'db_error');
    }

    // Best-effort disk cleanup. DB is source of truth (artifact bytes live in
    // file_bytes), so a missing/legacy file on disk is not an error.
    if (!empty($artifact['stored_filename'])) {
        @unlink($uploadDir . $artifact['stored_filename']);
    }

    echo json_encode([
        'success'         => true,
        'artifact_id'     => $artifactId,
        'stage'           => $artifact['stage'],
        'deleted_leads'   => $leadCount,
        'rolled_back_to'  => $rolledBack ? $effectiveStage : null,
        'new_status'      => $newStatus,
    ]);
    exit();
}

pipelineFail(405, 'Method not allowed', 'method_not_allowed');

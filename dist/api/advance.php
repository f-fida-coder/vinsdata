<?php

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/pipeline.php';

// Allow direct call or include from files.php PUT
if (!isset($_SESSION) || session_status() !== PHP_SESSION_ACTIVE) {
    initSession();
}

$user = requireAuth();
$db   = $db ?? getDBConnection();

if (!in_array($_SERVER['REQUEST_METHOD'], ['POST', 'PUT'], true)) {
    pipelineFail(405, 'Method not allowed', 'method_not_allowed');
}

// Input source: JSON body for direct POST, $_POST when forwarded from files.php PUT
$input = !empty($_POST) ? $_POST : (json_decode(file_get_contents('php://input'), true) ?? []);

$fileId      = (int) ($input['file_id'] ?? $input['id'] ?? 0);
$remarks     = $input['remarks'] ?? $input['notes'] ?? null;
$targetStage = $input['target_stage'] ?? $input['stage'] ?? null;

if ($fileId <= 0) {
    pipelineFail(400, 'file_id is required', 'missing_file_id');
}

$file = loadFileOrFail($db, $fileId);
assertActive($file);

$current = $file['current_stage'];
$next    = NEXT_STAGE[$current] ?? null;

if ($next === null) {
    pipelineFail(409, "File is already at terminal stage '$current'", 'terminal_stage');
}

// If caller passed a target_stage, it must equal the next stage. No skipping, no backwards.
if ($targetStage !== null && $targetStage !== $next) {
    pipelineFail(422, "Cannot move from '$current' to '$targetStage' — only '$next' allowed", 'invalid_transition');
}

assertRoleForStage($user['role'] ?? '', $next);

// Require an artifact uploaded for the next stage
$stmt = $db->prepare('SELECT id FROM file_artifacts WHERE file_id = :fid AND stage = :stage ORDER BY id DESC LIMIT 1');
$stmt->execute([':fid' => $fileId, ':stage' => $next]);
$artifact = $stmt->fetch();
if (!$artifact) {
    pipelineFail(422, "Cannot advance to '$next' without an uploaded artifact for that stage", 'artifact_required');
}

$newStatus = $next === 'tlo' ? 'completed' : 'active';

try {
    $db->beginTransaction();

    $stmt = $db->prepare(
        'UPDATE files
            SET current_stage = :stage,
                status        = :status,
                latest_artifact_id = :aid,
                updated_at    = NOW()
          WHERE id = :id'
    );
    $stmt->execute([
        ':stage'  => $next,
        ':status' => $newStatus,
        ':aid'    => (int) $artifact['id'],
        ':id'     => $fileId,
    ]);

    recordHistory($db, $fileId, $current, $next, 'advance', (int) $artifact['id'], $user['id'], $remarks);
    if ($newStatus === 'completed') {
        recordHistory($db, $fileId, $next, $next, 'complete', (int) $artifact['id'], $user['id'], 'Auto-complete on TLO');
    }

    $db->commit();
} catch (Throwable $e) {
    $db->rollBack();
    pipelineFail(500, 'Advance failed: ' . $e->getMessage(), 'db_error');
}

echo json_encode([
    'success'       => true,
    'from_stage'    => $current,
    'to_stage'      => $next,
    'status'        => $newStatus,
    'artifact_id'   => (int) $artifact['id'],
]);

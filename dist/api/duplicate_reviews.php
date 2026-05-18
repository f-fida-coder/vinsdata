<?php

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/pipeline.php';
initSession();

$user = requireAuth();
$db   = getDBConnection();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    pipelineFail(405, 'Method not allowed', 'method_not_allowed');
}
assertAdmin($user);

$input    = json_decode(file_get_contents('php://input'), true) ?? [];
$groupId  = (int) ($input['group_id'] ?? 0);
$decision = $input['decision'] ?? null;
$notes    = trim((string) ($input['notes'] ?? ''));

if ($groupId <= 0) pipelineFail(400, 'group_id is required', 'missing_fields');
assertReviewDecision($decision);
if (mb_strlen($notes) > 2000) pipelineFail(400, 'notes too long (max 2000 chars)', 'notes_too_long');

$stmt = $db->prepare('SELECT id, review_status FROM lead_duplicate_groups WHERE id = :id');
$stmt->execute([':id' => $groupId]);
$group = $stmt->fetch();
if (!$group) pipelineFail(404, 'Group not found', 'group_not_found');

try {
    $db->beginTransaction();

    $stmt = $db->prepare(
        'INSERT INTO lead_duplicate_reviews (group_id, decision, notes, reviewed_by)
         VALUES (:gid, :dec, :notes, :by)'
    );
    $stmt->execute([
        ':gid'   => $groupId,
        ':dec'   => $decision,
        ':notes' => $notes === '' ? null : $notes,
        ':by'    => $user['id'],
    ]);
    $reviewId = (int) $db->lastInsertId();

    $stmt = $db->prepare(
        'UPDATE lead_duplicate_groups
            SET review_status = :rs, reviewed_by = :by, reviewed_at = NOW()
          WHERE id = :id'
    );
    $stmt->execute([
        ':rs' => $decision,
        ':by' => $user['id'],
        ':id' => $groupId,
    ]);

    $db->commit();
} catch (Throwable $e) {
    $db->rollBack();
    pipelineFail(500, 'Review failed: ' . $e->getMessage(), 'db_error');
}

echo json_encode([
    'success'       => true,
    'review_id'     => $reviewId,
    'group_id'      => $groupId,
    'review_status' => $decision,
    'previous'      => $group['review_status'],
]);

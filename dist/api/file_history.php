<?php

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/pipeline.php';
initSession();

$user = requireAuth();
$db   = getDBConnection();

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    pipelineFail(405, 'Method not allowed', 'method_not_allowed');
}

$fileId = isset($_GET['file_id']) ? (int) $_GET['file_id'] : 0;
if ($fileId <= 0) {
    pipelineFail(400, 'file_id is required', 'missing_file_id');
}

$stmt = $db->prepare(
    'SELECT h.id, h.file_id, h.from_stage, h.to_stage, h.action_type, h.artifact_id, h.remarks, h.created_at,
            u.name AS performed_by_name, u.role AS performed_by_role,
            a.original_filename AS artifact_name, a.stage AS artifact_stage
       FROM file_stage_history h
       JOIN users u ON u.id = h.performed_by
       LEFT JOIN file_artifacts a ON a.id = h.artifact_id
      WHERE h.file_id = :fid
      ORDER BY h.created_at DESC, h.id DESC'
);
$stmt->execute([':fid' => $fileId]);
echo json_encode($stmt->fetchAll());

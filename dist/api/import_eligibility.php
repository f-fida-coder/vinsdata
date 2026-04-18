<?php

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/pipeline.php';
initSession();

$user = requireAuth();
$db   = getDBConnection();

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    pipelineFail(405, 'Method not allowed', 'method_not_allowed');
}

$fileId     = isset($_GET['file_id'])     ? (int) $_GET['file_id']     : 0;
$artifactId = isset($_GET['artifact_id']) ? (int) $_GET['artifact_id'] : 0;

if ($fileId <= 0 || $artifactId <= 0) {
    pipelineFail(400, 'file_id and artifact_id are required', 'missing_fields');
}

$result = checkImportEligibility($db, $fileId, $artifactId);

if (($user['role'] ?? null) !== 'admin') {
    $result['eligible'] = false;
    $result['code']     = 'admin_required';
    $result['reason']   = 'Admin role required to import';
}

echo json_encode([
    'eligible' => (bool) $result['eligible'],
    'code'     => $result['code'],
    'reason'   => $result['reason'],
    'artifact' => $result['artifact'] ? [
        'id'                => (int) $result['artifact']['id'],
        'stage'             => $result['artifact']['stage'],
        'original_filename' => $result['artifact']['original_filename'],
        'file_size'         => (int) $result['artifact']['file_size'],
    ] : null,
]);

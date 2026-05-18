<?php

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/pipeline.php';
require_once __DIR__ . '/reports_lib.php';
initSession();

$user = requireAuth();
$db   = getDBConnection();

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    pipelineFail(405, 'Method not allowed', 'method_not_allowed');
}

$type = $_GET['type'] ?? null;

$userRole = $user['role'] ?? null;
$isAdmin  = $userRole === 'admin';
// Marketers get the same unscoped "see all leads" treatment as admins, because
// they need cross-portfolio visibility to build campaign segments.
$unscopedForReports = $isAdmin || $userRole === 'marketer';

if ($type === 'marketing') {
    if (!$isAdmin && $userRole !== 'marketer') {
        pipelineFail(403, 'Admin or marketer role required', 'marketing_forbidden');
    }
    echo json_encode(['marketing' => marketingReport($db)]);
    exit();
}

if ($type === 'leads') {
    echo json_encode(['leads' => leadsReport($db, (int) $user['id'], $unscopedForReports)]);
} elseif ($type === 'duplicates') {
    echo json_encode(['duplicates' => duplicatesReport($db, (int) $user['id'])]);
} elseif ($type === 'dispatch') {
    echo json_encode(['dispatch' => dispatchReport($db)]);
} elseif ($type === null) {
    $bundle = [
        'leads'      => leadsReport($db, (int) $user['id'], $unscopedForReports),
        'duplicates' => duplicatesReport($db, (int) $user['id']),
        'dispatch'   => dispatchReport($db),
    ];
    if ($unscopedForReports) {
        $bundle['marketing'] = marketingReport($db);
    }
    echo json_encode($bundle);
} else {
    pipelineFail(400, "Invalid type '$type'", 'invalid_type');
}

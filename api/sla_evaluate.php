<?php
// Run SLA rule evaluation. Two callers:
//   1. Admin clicks a "Run now" button in the rules UI → POST with session.
//   2. A cron job pings this URL with ?cron_token=... matching the
//      SLA_CRON_TOKEN constant in api/config.local.php (optional).
//
// The evaluator is idempotent — re-running won't duplicate alerts because
// the SQL skips leads that already have an unresolved alert per rule.

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/pipeline.php';
require_once __DIR__ . '/sla_helpers.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST' && $_SERVER['REQUEST_METHOD'] !== 'GET') {
    pipelineFail(405, 'Method not allowed', 'method_not_allowed');
}

// Cron path: bypass session if the request carries the shared secret.
$cronToken = $_GET['cron_token'] ?? '';
$expected  = defined('SLA_CRON_TOKEN') ? SLA_CRON_TOKEN : '';
$isCron    = $cronToken !== '' && $expected !== '' && hash_equals($expected, $cronToken);

if (!$isCron) {
    initSession();
    $user = requireAuth();
    assertAdmin($user);
}

$db = getDBConnection();
$summary = evaluateSlaRules($db);

echo json_encode([
    'success' => true,
    'mode'    => $isCron ? 'cron' : 'manual',
    'summary' => $summary,
]);

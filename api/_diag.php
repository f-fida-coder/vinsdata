<?php
// One-off diagnostic. Does NOT include config.php so we can see what
// the bare PHP-FPM process sees independent of our boot chain.
//
// Returns the PHP version, the include errors when trying to require
// our standard boot files, and whether key tables / secrets reach.
// Remove after debugging.

header('Content-Type: application/json');

$out = [
    'php_version'    => PHP_VERSION,
    'php_sapi'       => PHP_SAPI,
    'time'           => date('c'),
    'opcache_enabled' => function_exists('opcache_get_status'),
    'pdo_drivers'    => PDO::getAvailableDrivers(),
    'load_tests'     => [],
];

// Try including each boot file one at a time so we can spot which
// crashes the worker. Each attempt is wrapped in a try/catch even
// though require_once fatals would normally bypass that — at least
// the json_encode below will run with whatever we got.
$files = ['config.php', 'pipeline.php', 'outbound_helpers.php', 'marketing_send.php'];
foreach ($files as $f) {
    $path = __DIR__ . '/' . $f;
    $entry = [
        'file' => $f,
        'exists' => file_exists($path),
        'size'   => file_exists($path) ? filesize($path) : null,
        'readable' => is_readable($path),
    ];
    if ($entry['exists'] && $entry['readable']) {
        // Try parse with the linter
        $linted = @shell_exec('php -l ' . escapeshellarg($path) . ' 2>&1');
        $entry['lint'] = trim((string) $linted);
    }
    $out['load_tests'][] = $entry;
}

echo json_encode($out, JSON_PRETTY_PRINT);

<?php
// Standalone diagnostic endpoint. Does NOT include config.php — that's the
// point: if config.php is broken, this still answers. Tells us:
//   1. Is PHP itself running on this host?
//   2. Can it parse a tiny script?
//   3. Can it reach MySQL with the same creds config.php uses?
//
// Safe to leave deployed: returns no secrets, no session data, no DB rows.

header('Content-Type: application/json; charset=UTF-8');

$out = [
    'ok'         => true,
    'php'        => PHP_VERSION,
    'sapi'       => PHP_SAPI,
    'time'       => date('c'),
    'pdo_loaded' => extension_loaded('pdo_mysql'),
    'config_php' => [
        'exists' => is_readable(__DIR__ . '/config.php'),
        'size'   => is_readable(__DIR__ . '/config.php') ? filesize(__DIR__ . '/config.php') : null,
    ],
    'db' => null,
];

// Uploads directory inspection (no filenames leaked, just counts/sizes).
$uploadsDir = __DIR__ . '/uploads/';
if (is_dir($uploadsDir)) {
    $count = 0; $totalBytes = 0;
    foreach (scandir($uploadsDir) ?: [] as $f) {
        if ($f === '.' || $f === '..' || $f === '.htaccess') continue;
        $count++;
        $totalBytes += @filesize($uploadsDir . $f) ?: 0;
    }
    $out['uploads'] = [
        'path_resolves' => realpath($uploadsDir) ?: null,
        'writable'      => is_writable($uploadsDir),
        'file_count'    => $count,
        'total_bytes'   => $totalBytes,
    ];
} else {
    $out['uploads'] = ['error' => 'uploads dir missing or not a directory'];
}

if (isset($_GET['db']) && extension_loaded('pdo_mysql')) {
    // Attempt the same kind of connection config.php's getDBConnection() makes.
    // We DON'T trust config.php here in case it's the broken file; we read the
    // four DB constants from it via a sandboxed include.
    $dbCheck = ['attempted' => true, 'connected' => false, 'error' => null];
    try {
        if (!is_readable(__DIR__ . '/config.php')) {
            throw new RuntimeException('config.php not readable');
        }
        // Parse out the four define() calls without executing the rest of the file.
        $src = file_get_contents(__DIR__ . '/config.php');
        $rx = "/define\\(\\s*'(DB_HOST|DB_NAME|DB_USER|DB_PASS)'\\s*,\\s*'([^']*)'\\s*\\)/";
        $vals = [];
        if (preg_match_all($rx, $src, $m, PREG_SET_ORDER)) {
            foreach ($m as $row) { $vals[$row[1]] = $row[2]; }
        }
        foreach (['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASS'] as $k) {
            if (!isset($vals[$k])) {
                throw new RuntimeException("config.php missing $k");
            }
        }
        $dsn = "mysql:host={$vals['DB_HOST']};dbname={$vals['DB_NAME']};charset=utf8mb4";
        new PDO($dsn, $vals['DB_USER'], $vals['DB_PASS'], [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_TIMEOUT => 5,
        ]);
        $dbCheck['connected'] = true;
    } catch (Throwable $e) {
        $dbCheck['error'] = $e->getMessage();
    }
    $out['db'] = $dbCheck;
}

echo json_encode($out, JSON_UNESCAPED_SLASHES);

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

// Did the deploy land .env at the expected location? Don't expose contents,
// just whether it's readable + size. Helps debug scanner-ate-config.php
// scenarios where everything else is in place.
$envCandidates = [
    __DIR__ . '/../../.env' => 'domain_root',
    __DIR__ . '/../.env'    => 'public_html',
];
$envInfo = [];
foreach ($envCandidates as $path => $label) {
    $envInfo[$label] = [
        'path'      => $path,
        'resolved'  => realpath($path) ?: null,
        'readable'  => is_readable($path),
        'size'      => is_readable($path) ? filesize($path) : null,
    ];
}
$out['env'] = $envInfo;

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

// Outbound providers diagnostic — opt-in, like ?db=1. Reports which
// adapter each kind would resolve to (stub / gmail / openphone) WITHOUT
// exposing any secret values. Useful for confirming a deploy picked up
// the credentials stored in app_secrets / .env.
//
// Wrapped in try/catch so a broken config.php can't crash the rest of
// the diagnostic — same defensive posture as the ?db=1 block above.
if (isset($_GET['providers'])) {
    $prov = ['attempted' => true, 'error' => null, 'email' => null, 'sms' => null];
    try {
        require_once __DIR__ . '/config.php';
        require_once __DIR__ . '/outbound_helpers.php';
        $prov['email'] = resolveOutboundProvider('email');
        $prov['sms']   = resolveOutboundProvider('sms');
        // Whether each key has SOME source (env file, env var, or app_secrets row).
        // No values, just presence flags — safe to expose.
        $prov['has'] = [
            'GMAIL_SMTP_USER'           => getEnvValue('GMAIL_SMTP_USER') !== '',
            'GMAIL_SMTP_PASS'           => getEnvValue('GMAIL_SMTP_PASS') !== '',
            'OPENPHONE_API_KEY'         => getEnvValue('OPENPHONE_API_KEY') !== '',
            'OPENPHONE_PHONE_NUMBER_ID' => getEnvValue('OPENPHONE_PHONE_NUMBER_ID') !== '',
            'OPENPHONE_WEBHOOK_SECRET'  => getEnvValue('OPENPHONE_WEBHOOK_SECRET') !== '',
        ];
    } catch (Throwable $e) {
        $prov['error'] = $e->getMessage();
    }
    $out['providers'] = $prov;
}

echo json_encode($out, JSON_UNESCAPED_SLASHES);

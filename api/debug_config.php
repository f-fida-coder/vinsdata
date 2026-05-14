<?php
// One-off diagnostic that does NOT include config.php — used to figure out
// why every config-requiring endpoint is 500'ing. Reports size, sha1,
// first-line snippet, and attempts to require it in a try/catch so we can
// see the parse/fatal error PHP would normally suppress.
//
// Safe to leave deployed: emits no DB creds or secrets — config.php in this
// project doesn't contain plaintext credentials (those live in .env).

header('Content-Type: application/json; charset=UTF-8');

$cfg = __DIR__ . '/config.php';
$out = [
    'path'      => $cfg,
    'exists'    => file_exists($cfg),
    'readable'  => is_readable($cfg),
    'size'      => is_readable($cfg) ? filesize($cfg) : null,
    'sha1'      => is_readable($cfg) ? sha1_file($cfg) : null,
    'mtime'     => is_readable($cfg) ? gmdate('c', filemtime($cfg)) : null,
];

if (is_readable($cfg)) {
    // First 240 chars — should be the docblock + opening function. No
    // secrets to leak; this file shouldn't contain any plaintext creds.
    $content = file_get_contents($cfg, false, null, 0, 240);
    $out['head'] = $content;
    // Last 240 chars — to confirm the file isn't truncated mid-function.
    $size = filesize($cfg);
    if ($size > 240) {
        $tail = file_get_contents($cfg, false, null, max(0, $size - 240), 240);
        $out['tail'] = $tail;
    }
    // Total newlines + did we see the expected function definitions.
    $full = file_get_contents($cfg);
    $out['lines'] = substr_count($full, "\n") + 1;
    $out['has_loadEnvFile']  = (strpos($full, 'function loadEnvFile') !== false);
    $out['has_getEnvValue']  = (strpos($full, 'function getEnvValue') !== false);
    $out['has_loadAppSecret']= (strpos($full, 'function loadAppSecret') !== false);
    $out['has_getDBConnection']= (strpos($full, 'function getDBConnection') !== false);
    $out['has_initSession']  = (strpos($full, 'function initSession') !== false);
}

// Try requiring it in a sandbox so the fatal-error message becomes visible.
try {
    ob_start();
    $err = null;
    set_error_handler(function ($severity, $message, $file, $line) use (&$err) {
        $err = compact('severity', 'message', 'file', 'line');
    });
    @require $cfg;
    restore_error_handler();
    ob_end_clean();
    $out['require'] = ['ok' => true, 'err' => $err];
} catch (Throwable $e) {
    if (ob_get_level()) ob_end_clean();
    $out['require'] = [
        'ok'      => false,
        'class'   => get_class($e),
        'message' => $e->getMessage(),
        'file'    => $e->getFile(),
        'line'    => $e->getLine(),
    ];
}

echo json_encode($out, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);

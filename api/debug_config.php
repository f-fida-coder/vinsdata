<?php
// Diagnostic that does NOT include config.php normally — used to figure
// out why config-requiring endpoints intermittently 500. Hosts emit no
// secrets: config.php in this project doesn't contain plaintext creds.

header('Content-Type: application/json; charset=UTF-8');

$cfg = __DIR__ . '/config.php';
$out = [
    'path'     => $cfg,
    'exists'   => file_exists($cfg),
    'readable' => is_readable($cfg),
    'size'     => is_readable($cfg) ? filesize($cfg) : null,
    'sha1'     => is_readable($cfg) ? sha1_file($cfg) : null,
    'mtime'    => is_readable($cfg) ? gmdate('c', filemtime($cfg)) : null,
];

if (is_readable($cfg)) {
    $full = file_get_contents($cfg);
    $out['head'] = substr($full, 0, 240);
    $size = filesize($cfg);
    if ($size > 240) $out['tail'] = substr($full, $size - 240);
    $out['lines'] = substr_count($full, "\n") + 1;
    $out['has_loadEnvFile']      = (strpos($full, 'function loadEnvFile') !== false);
    $out['has_getEnvValue']      = (strpos($full, 'function getEnvValue') !== false);
    $out['has_loadAppSecret']    = (strpos($full, 'function loadAppSecret') !== false);
    $out['has_getDBConnection']  = (strpos($full, 'function getDBConnection') !== false);
    $out['has_initSession']      = (strpos($full, 'function initSession') !== false);
    // Capture last 20 lines so we can see any tail truncation
    $lines = explode("\n", $full);
    $out['last_20_lines'] = array_slice($lines, -20);
    // Any non-UTF8 / non-printable bytes that PHP might choke on
    $weird = [];
    for ($i = 0; $i < strlen($full); $i++) {
        $byte = ord($full[$i]);
        if ($byte < 9 || ($byte > 13 && $byte < 32) || $byte == 127) {
            $weird[] = ['offset' => $i, 'byte' => sprintf('0x%02X', $byte)];
            if (count($weird) > 5) break;
        }
    }
    $out['suspicious_bytes'] = $weird;
}

// Try requiring without @ suppression so the real error message comes through.
// Tokenize first so we catch parse errors without crashing the script.
try {
    $tokens = @token_get_all($full ?? '', TOKEN_PARSE);
    $out['tokenize'] = ['ok' => true, 'count' => count($tokens)];
} catch (Throwable $e) {
    $out['tokenize'] = ['ok' => false, 'class' => get_class($e), 'message' => $e->getMessage(), 'line' => $e->getLine()];
}

// Now try a real require so we see the failure mode end-to-end.
$beforeError = error_get_last();
$requireResult = null;
try {
    $requireResult = (require $cfg);
    $out['require'] = ['ok' => true, 'result' => $requireResult];
} catch (Throwable $e) {
    $out['require'] = ['ok' => false, 'class' => get_class($e), 'message' => $e->getMessage(), 'file' => $e->getFile(), 'line' => $e->getLine()];
}
$afterError = error_get_last();
if ($afterError !== $beforeError) {
    $out['error_get_last'] = $afterError;
}

// Sandbox initSession + getDBConnection if we got past require.
if (!empty($out['require']['ok'])) {
    $out['initSession_callable']   = function_exists('initSession');
    $out['getDBConnection_callable'] = function_exists('getDBConnection');
    if (function_exists('getDBConnection')) {
        try {
            $pdo = getDBConnection();
            $row = $pdo->query('SELECT 1 AS ok')->fetch();
            $out['db_ping'] = ['ok' => true, 'ping' => $row['ok'] ?? null];
        } catch (Throwable $e) {
            $out['db_ping'] = ['ok' => false, 'message' => $e->getMessage()];
        }
    }
}

echo json_encode($out, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);

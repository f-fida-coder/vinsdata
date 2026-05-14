<?php

if (PHP_SAPI !== 'cli') {
    header("Content-Type: application/json; charset=UTF-8");
    if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
        http_response_code(200);
        exit();
    }
}

// DB credentials must NOT live in this file. Hostinger's malware scanner
// (and every public-repo credential scraper on the internet) flags PHP
// files that contain plaintext DB passwords, and on this host that meant
// config.php kept getting quarantined → all endpoints 500'd silently.
//
// Credentials are read at runtime from a .env file outside the deploy tree,
// or from environment variables. The deploy never touches either, so a
// pushed git commit can't leak or overwrite live secrets.
//
// Search order for the .env file:
//   1. <domain root>/.env  (production: /home/.../crm.vinvault.us/.env)
//   2. <repo root>/.env    (local dev: <project>/.env, gitignored)
// First file found wins. Within each file we use a permissive parser
// (handles quoted values, # comments, blank lines).

function loadEnvFile(string $path): array
{
    if (!is_file($path) || !is_readable($path)) return [];
    $out = [];
    $lines = @file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    if ($lines === false) return [];
    foreach ($lines as $line) {
        $line = trim($line);
        if ($line === '' || $line[0] === '#') continue;
        $eq = strpos($line, '=');
        if ($eq === false) continue;
        $k = trim(substr($line, 0, $eq));
        $v = trim(substr($line, $eq + 1));
        if (strlen($v) >= 2) {
            $first = $v[0]; $last = $v[strlen($v) - 1];
            if (($first === '"' && $last === '"') || ($first === "'" && $last === "'")) {
                $v = substr($v, 1, -1);
            }
        }
        if ($k !== '') $out[$k] = $v;
    }
    return $out;
}

$envCandidates = [
    __DIR__ . '/../../.env', // public_html/api/  → /home/.../crm.vinvault.us/.env
    __DIR__ . '/../.env',    // repo/api/         → repo/.env (local dev)
];

$envValues = [];
foreach ($envCandidates as $path) {
    $envValues = array_replace(loadEnvFile($path), $envValues);
}

$cfgKeys = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASS'];
foreach ($cfgKeys as $k) {
    $val = $envValues[$k] ?? null;
    if ($val === null || $val === '') {
        $env = getenv($k);
        if ($env !== false && $env !== '') $val = $env;
    }
    if ($val === null || $val === '') {
        if (!headers_sent()) {
            http_response_code(503);
            header('Content-Type: application/json; charset=UTF-8');
        }
        echo json_encode([
            'success' => false,
            'code'    => 'env_missing',
            'message' => "Server is not configured: missing $k. Place a .env file with DB_HOST/DB_NAME/DB_USER/DB_PASS at one of: " . implode(', ', array_map('realpath', $envCandidates) ?: $envCandidates),
        ]);
        exit();
    }
    if (!defined($k)) define($k, $val);
}

/**
 * Optional .env lookup for non-required keys (Gmail SMTP, OpenPhone, etc).
 * Same search order as the required DB constants above — .env file first,
 * then process environment, then $default. Returns '' on miss so callers
 * can `if (getEnvValue('X') === '') { ...fall back to stub }` cleanly.
 */
function getEnvValue(string $key, string $default = ''): string
{
    global $envValues;
    $v = is_array($envValues ?? null) ? ($envValues[$key] ?? '') : '';
    if ($v === '') {
        $env = getenv($key);
        if ($env !== false && $env !== '') $v = $env;
    }
    return $v !== '' ? $v : $default;
}

function initSession(): void
{
    session_set_cookie_params([
        'lifetime' => 0,
        'path'     => '/',
        'secure'   => isset($_SERVER['HTTPS']),
        'httponly'  => true,
        'samesite' => 'Lax',
    ]);
    session_start();
}

function getDBConnection(): PDO
{
    $dsn = "mysql:host=" . DB_HOST . ";dbname=" . DB_NAME . ";charset=utf8mb4";

    $options = [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
        PDO::ATTR_TIMEOUT            => 5,
    ];

    try {
        return new PDO($dsn, DB_USER, DB_PASS, $options);
    } catch (PDOException $e) {
        // Without this, a DB outage manifests as a silent 500 with empty body
        // (display_errors is off in production). Catch and emit a clean JSON
        // error so the frontend can show something useful instead of just
        // "Sign in failed. Please try again."
        if (!headers_sent()) {
            http_response_code(503);
            header('Content-Type: application/json; charset=UTF-8');
        }
        echo json_encode([
            'success' => false,
            'message' => 'Database is unreachable. Try again in a minute.',
            'code'    => 'db_unreachable',
            'detail'  => $e->getMessage(),
        ]);
        exit();
    }
}

<?php

// -----------------------------------------------------------------------------
// Security response headers — applied to every JSON API response.
// -----------------------------------------------------------------------------
function sendSecurityHeaders(): void
{
    header("Content-Type: application/json; charset=UTF-8");
    if (!empty($_SERVER['HTTPS'])) {
        header("Strict-Transport-Security: max-age=31536000; includeSubDomains");
    }
    header("X-Content-Type-Options: nosniff");
    header("X-Frame-Options: DENY");
    header("Referrer-Policy: strict-origin-when-cross-origin");
    header("Permissions-Policy: camera=(), microphone=(), geolocation=()");
    // Let the SPA read the CSRF token header via XHR/fetch.
    header("Access-Control-Expose-Headers: X-CSRF-Token");
}
sendSecurityHeaders();

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

// -----------------------------------------------------------------------------
// DB credentials — sourced from gitignored api/config.local.php.
// -----------------------------------------------------------------------------
$localConfigPath = __DIR__ . '/config.local.php';
if (!file_exists($localConfigPath)) {
    http_response_code(500);
    echo json_encode([
        'error' => 'Server not configured',
        'detail' => 'api/config.local.php is missing. Copy api/config.local.php.example and fill in credentials.',
    ]);
    exit();
}
require_once $localConfigPath;

foreach (['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASS'] as $requiredConstant) {
    if (!defined($requiredConstant)) {
        http_response_code(500);
        echo json_encode([
            'error' => 'Server not configured',
            'detail' => "$requiredConstant not defined in api/config.local.php.",
        ]);
        exit();
    }
}

// -----------------------------------------------------------------------------
// Session + CSRF.
// -----------------------------------------------------------------------------
function initSession(): void
{
    // Rename the cookie so it doesn't advertise "this is PHP".
    session_name('vv_session');
    session_set_cookie_params([
        'lifetime' => 0,
        'path'     => '/',
        'secure'   => !empty($_SERVER['HTTPS']),
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    session_start();
    ensureCsrfToken();
    header('X-CSRF-Token: ' . $_SESSION['csrf_token']);
}

function ensureCsrfToken(): void
{
    if (empty($_SESSION['csrf_token'])) {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    }
}

function rotateCsrfToken(): void
{
    $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    header('X-CSRF-Token: ' . $_SESSION['csrf_token']);
}

function requireCsrfToken(): void
{
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    if (in_array($method, ['GET', 'HEAD', 'OPTIONS'], true)) {
        return;
    }
    $supplied = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    $expected = $_SESSION['csrf_token'] ?? '';
    if ($expected === '' || $supplied === '' || !hash_equals($expected, $supplied)) {
        http_response_code(403);
        echo json_encode([
            'success' => false,
            'code' => 'csrf_failed',
            'message' => 'CSRF token missing or invalid. Reload the page and try again.',
        ]);
        exit();
    }
}

function getDBConnection(): PDO
{
    $dsn = "mysql:host=" . DB_HOST . ";dbname=" . DB_NAME . ";charset=utf8mb4";

    $options = [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
    ];

    return new PDO($dsn, DB_USER, DB_PASS, $options);
}

<?php

header("Content-Type: application/json; charset=UTF-8");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

// Credentials live in api/config.local.php (gitignored).
// Copy api/config.local.php.example to api/config.local.php and fill in real values
// on every environment (local dev and production).
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
    ];

    return new PDO($dsn, DB_USER, DB_PASS, $options);
}

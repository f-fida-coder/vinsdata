<?php

if (PHP_SAPI !== 'cli') {
    header("Content-Type: application/json; charset=UTF-8");
    if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
        http_response_code(200);
        exit();
    }
}

// Use the remote MySQL host for both environments so the same config works
// from local dev and from Hostinger without depending on a localhost socket.
define('DB_HOST', 'srv2052.hstgr.io');
define('DB_NAME', 'u487877829_vins_data');
define('DB_USER', 'u487877829_vinsdata');
define('DB_PASS', 'Vins.ok12');

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

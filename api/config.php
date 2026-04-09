<?php

header("Content-Type: application/json; charset=UTF-8");

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

// Auto-detect: local dev vs Hostinger production
if ($_SERVER['SERVER_NAME'] === 'localhost' || $_SERVER['SERVER_NAME'] === '127.0.0.1') {
    define('DB_HOST', 'srv2052.hstgr.io');
    define('DB_NAME', 'u487877829_vins_data');
    define('DB_USER', 'u487877829_vinsdata');
    define('DB_PASS', 'Vins.ok12');
} else {
    define('DB_HOST', 'localhost');
    define('DB_NAME', 'u487877829_vins_data');
    define('DB_USER', 'u487877829_vinsdata');
    define('DB_PASS', 'Vins.ok12');
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

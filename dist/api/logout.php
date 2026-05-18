<?php

require_once __DIR__ . '/config.php';
initSession();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(["success" => false, "message" => "Method not allowed"]);
    exit();
}

session_unset();
session_destroy();

echo json_encode(["success" => true]);

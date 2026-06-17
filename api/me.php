<?php

require_once __DIR__ . '/config.php';
initSession();

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    http_response_code(405);
    echo json_encode(["success" => false, "message" => "Method not allowed"]);
    exit();
}

if (!isset($_SESSION['user_id'])) {
    http_response_code(401);
    echo json_encode(["success" => false, "message" => "Not authenticated"]);
    exit();
}

// Pull quo_phone_number from the users table so the frontend can drop
// the agent's own line into outreach-email templates as the callback
// CTA (replaces the shared VinVault number when set). Best-effort —
// any DB hiccup falls back to session-only fields so /me never gates
// auth on a phone-number lookup.
$quoPhone = null;
try {
    $db = getDBConnection();
    $stmt = $db->prepare('SELECT quo_phone_number FROM users WHERE id = :id');
    $stmt->execute([':id' => (int) $_SESSION['user_id']]);
    $row = $stmt->fetch();
    if ($row && !empty($row['quo_phone_number'])) {
        $quoPhone = (string) $row['quo_phone_number'];
    }
} catch (Throwable $_e) { /* fall through with quoPhone=null */ }

echo json_encode([
    "success" => true,
    "user" => [
        "id" => $_SESSION['user_id'],
        "name" => $_SESSION['user_name'],
        "role" => $_SESSION['user_role'],
        "quo_phone_number" => $quoPhone,
    ]
]);

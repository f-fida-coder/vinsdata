<?php

require_once __DIR__ . '/config.php';
initSession();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo json_encode(["success" => false, "message" => "Method not allowed"]);
    exit();
}

$input = json_decode(file_get_contents("php://input"), true);

$email = $input['email'] ?? '';
$password = $input['password'] ?? '';

if (empty($email) || empty($password)) {
    http_response_code(400);
    echo json_encode(["success" => false, "message" => "Email and password are required"]);
    exit();
}

$db = getDBConnection();

// Brute-force guard. Counts failed attempts on this (ip, email) pair
// in the last 15 minutes. After 8 fails we lock out for a sliding
// 15-minute window — same threshold Google uses on consumer login.
// The table is migrated by 031_login_attempts.sql; if it's missing
// (pre-migration boot), we soft-fail to "no rate limit" so this
// never breaks the only door into the CRM.
$clientIp = $_SERVER['REMOTE_ADDR'] ?? '';
$rateLimitFailed = false;
try {
    $countStmt = $db->prepare(
        "SELECT COUNT(*) FROM login_attempts
          WHERE ip = :ip AND email = :em AND success = 0
            AND attempted_at >= DATE_SUB(NOW(), INTERVAL 15 MINUTE)"
    );
    $countStmt->execute([':ip' => $clientIp, ':em' => $email]);
    $recentFails = (int) $countStmt->fetchColumn();
    if ($recentFails >= 8) {
        $rateLimitFailed = true;
    }
} catch (Throwable $_e) {
    // Table missing or DB blip — fail open. Logging the attempt
    // below in the same catch path so we never silently lose them.
}

if ($rateLimitFailed) {
    http_response_code(429);
    echo json_encode([
        "success" => false,
        "code"    => "rate_limited",
        "message" => "Too many failed sign-in attempts. Try again in 15 minutes."
    ]);
    exit();
}

$stmt = $db->prepare("SELECT id, name, email, password, role, quo_phone_number FROM users WHERE email = :email LIMIT 1");
$stmt->execute([':email' => $email]);
$user = $stmt->fetch();

$loginOk = $user && password_verify($password, $user['password']);

// Record the attempt (best effort — table may not exist on a fresh
// install). On success we still log so the activity table shows the
// sign-in moment.
try {
    $logStmt = $db->prepare(
        "INSERT INTO login_attempts (ip, email, success) VALUES (:ip, :em, :ok)"
    );
    $logStmt->execute([':ip' => $clientIp, ':em' => $email, ':ok' => $loginOk ? 1 : 0]);

    // Opportunistic cleanup: drop attempts older than 24h on every
    // login. Keeps the table small without a cron job.
    $db->exec("DELETE FROM login_attempts WHERE attempted_at < DATE_SUB(NOW(), INTERVAL 24 HOUR)");
} catch (Throwable $_e) { /* pre-migration boot — ignore */ }

if (!$loginOk) {
    http_response_code(401);
    echo json_encode(["success" => false, "message" => "Invalid credentials"]);
    exit();
}

$_SESSION['user_id'] = $user['id'];
$_SESSION['user_name'] = $user['name'];
$_SESSION['user_role'] = $user['role'];

echo json_encode([
    "success" => true,
    "user" => [
        "id" => $user['id'],
        "name" => $user['name'],
        "role" => $user['role'],
        "quo_phone_number" => $user['quo_phone_number'] ?: null,
    ]
]);

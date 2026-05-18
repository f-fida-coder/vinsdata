<?php

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/pipeline.php';
initSession();

if (!isset($_SESSION['user_id'])) {
    http_response_code(401);
    echo json_encode(["success" => false, "message" => "Not authenticated"]);
    exit();
}

if ($_SESSION['user_role'] !== 'admin') {
    http_response_code(403);
    echo json_encode(["success" => false, "message" => "Forbidden"]);
    exit();
}

$db = getDBConnection();

function assertValidUserRole(string $role): void
{
    if (!in_array($role, USER_ROLES, true)) {
        http_response_code(400);
        echo json_encode(["success" => false, "message" => "Invalid role '$role'"]);
        exit();
    }
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    // assigned_leads_count = total lead_states.assigned_user_id rows
    //                        pointing at this user (any status, including
    //                        deal_closed). The Users tab uses this to
    //                        show per-agent workload at a glance.
    // assigned_open_count   = same restricted to leads that are still in
    //                        flight (excludes terminal states). Drives
    //                        the "active leads" tooltip / sub-count.
    $stmt = $db->query(
        "SELECT u.id, u.name, u.email, u.phone, u.role, u.created_at,
                COALESCE(t.cnt, 0)  AS assigned_leads_count,
                COALESCE(o.cnt, 0)  AS assigned_open_count
           FROM users u
           LEFT JOIN (
             SELECT assigned_user_id, COUNT(*) AS cnt
               FROM lead_states
              WHERE assigned_user_id IS NOT NULL
              GROUP BY assigned_user_id
           ) t ON t.assigned_user_id = u.id
           LEFT JOIN (
             SELECT assigned_user_id, COUNT(*) AS cnt
               FROM lead_states
              WHERE assigned_user_id IS NOT NULL
                AND status NOT IN ('deal_closed','disqualified','do_not_call')
              GROUP BY assigned_user_id
           ) o ON o.assigned_user_id = u.id
          ORDER BY u.created_at DESC"
    );
    $rows = $stmt->fetchAll();
    foreach ($rows as &$r) {
        $r['id']                   = (int) $r['id'];
        $r['assigned_leads_count'] = (int) $r['assigned_leads_count'];
        $r['assigned_open_count']  = (int) $r['assigned_open_count'];
    }
    echo json_encode($rows);

} elseif ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $input = json_decode(file_get_contents("php://input"), true);

    $name = $input['name'] ?? '';
    $email = $input['email'] ?? '';
    $phone = $input['phone'] ?? null;
    $password = $input['password'] ?? '';
    $role = $input['role'] ?? '';

    if (empty($name) || empty($email) || empty($password) || empty($role)) {
        http_response_code(400);
        echo json_encode(["success" => false, "message" => "All fields are required"]);
        exit();
    }
    assertValidUserRole($role);

    $hash = password_hash($password, PASSWORD_BCRYPT);

    $stmt = $db->prepare("INSERT INTO users (name, email, phone, password, role) VALUES (:name, :email, :phone, :password, :role)");
    $stmt->execute([
        ':name' => $name,
        ':email' => $email,
        ':phone' => $phone,
        ':password' => $hash,
        ':role' => $role,
    ]);

    echo json_encode(["success" => true, "id" => (int) $db->lastInsertId()]);

} elseif ($_SERVER['REQUEST_METHOD'] === 'PATCH') {
    $input = json_decode(file_get_contents("php://input"), true);
    $userId = $input['id'] ?? null;

    if (empty($userId)) {
        http_response_code(400);
        echo json_encode(["success" => false, "message" => "User id is required"]);
        exit();
    }

    $fields = [];
    $params = [':id' => $userId];

    if (isset($input['name'])) { $fields[] = "name = :name"; $params[':name'] = $input['name']; }
    if (isset($input['email'])) { $fields[] = "email = :email"; $params[':email'] = $input['email']; }
    if (array_key_exists('phone', $input)) { $fields[] = "phone = :phone"; $params[':phone'] = $input['phone']; }
    if (isset($input['role'])) {
        assertValidUserRole($input['role']);
        $fields[] = "role = :role"; $params[':role'] = $input['role'];
    }
    // Optional password reset on PATCH. Admins can rotate any user's password
    // without the user being signed in. Empty / missing => password is left alone.
    if (!empty($input['password'])) {
        if (strlen($input['password']) < 6) {
            http_response_code(400);
            echo json_encode(["success" => false, "message" => "Password must be at least 6 characters"]);
            exit();
        }
        $fields[] = "password = :password";
        $params[':password'] = password_hash($input['password'], PASSWORD_BCRYPT);
    }

    if (empty($fields)) {
        http_response_code(400);
        echo json_encode(["success" => false, "message" => "No fields to update"]);
        exit();
    }

    $sql = "UPDATE users SET " . implode(', ', $fields) . " WHERE id = :id";
    $stmt = $db->prepare($sql);
    $stmt->execute($params);

    echo json_encode(["success" => true]);

} elseif ($_SERVER['REQUEST_METHOD'] === 'DELETE') {
    // Admin-only deletion. Prevent self-deletion as a safety rail — an admin
    // shouldn't be able to lock themselves out of their own panel.
    $input = json_decode(file_get_contents("php://input"), true) ?: [];
    $userId = $input['id'] ?? ($_GET['id'] ?? null);

    if (empty($userId)) {
        http_response_code(400);
        echo json_encode(["success" => false, "message" => "User id is required"]);
        exit();
    }
    if ((int) $userId === (int) $_SESSION['user_id']) {
        http_response_code(400);
        echo json_encode(["success" => false, "message" => "You cannot delete your own account"]);
        exit();
    }

    $stmt = $db->prepare("DELETE FROM users WHERE id = :id");
    $stmt->execute([':id' => $userId]);

    echo json_encode(["success" => true]);

} else {
    http_response_code(405);
    echo json_encode(["success" => false, "message" => "Method not allowed"]);
}

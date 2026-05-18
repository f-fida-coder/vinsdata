<?php

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/pipeline.php';
initSession();

requireAuth();
$db = getDBConnection();

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    pipelineFail(405, 'Method not allowed', 'method_not_allowed');
}

$leadId = isset($_GET['lead_id']) ? (int) $_GET['lead_id'] : 0;
if ($leadId <= 0) pipelineFail(400, 'lead_id is required', 'missing_fields');
loadLeadOrFail($db, $leadId);

$limit = max(1, min(500, (int) ($_GET['limit'] ?? 200)));

$stmt = $db->prepare(
    'SELECT a.id, a.activity_type, a.old_value_json, a.new_value_json, a.created_at,
            a.user_id, u.name AS user_name, u.role AS user_role,
            CASE
              WHEN a.activity_type IN (\'assigned\',\'unassigned\')
              THEN (SELECT name FROM users WHERE id = JSON_UNQUOTE(JSON_EXTRACT(a.new_value_json, \'$\')))
              ELSE NULL
            END AS new_assignee_name,
            CASE
              WHEN a.activity_type IN (\'assigned\',\'unassigned\') AND a.old_value_json IS NOT NULL
              THEN (SELECT name FROM users WHERE id = JSON_UNQUOTE(JSON_EXTRACT(a.old_value_json, \'$\')))
              ELSE NULL
            END AS old_assignee_name
       FROM lead_activities a
       JOIN users u ON u.id = a.user_id
      WHERE a.imported_lead_id = :lid
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT :limit'
);
$stmt->bindValue(':lid',   $leadId, PDO::PARAM_INT);
$stmt->bindValue(':limit', $limit,  PDO::PARAM_INT);
$stmt->execute();

$rows = array_map(function ($r) {
    $r['id']             = (int) $r['id'];
    $r['user_id']        = (int) $r['user_id'];
    $r['old_value']      = json_decode($r['old_value_json'] ?? 'null', true);
    $r['new_value']      = json_decode($r['new_value_json'] ?? 'null', true);
    unset($r['old_value_json'], $r['new_value_json']);
    return $r;
}, $stmt->fetchAll());

echo json_encode($rows);

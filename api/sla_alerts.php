<?php
// SLA alerts — read endpoint for the dashboard badge + alert list.
// Open alerts only by default; pass ?include=resolved to include resolved.

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/pipeline.php';
require_once __DIR__ . '/sla_helpers.php';
initSession();

$user = requireAuth();
$db   = getDBConnection();

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    pipelineFail(405, 'Method not allowed', 'method_not_allowed');
}

$includeResolved = ($_GET['include'] ?? '') === 'resolved';
$mine            = ($_GET['scope']   ?? '') === 'mine';
$limit           = max(1, min(200, (int) ($_GET['limit']  ?? 100)));
$offset          = max(0, (int) ($_GET['offset'] ?? 0));

$where = [];
$params = [];

if (!$includeResolved) {
    $where[] = 'a.resolved_at IS NULL';
}
if ($mine) {
    $where[] = 's.assigned_user_id = :assignee';
    $params[':assignee'] = $user['id'];
}
$whereSql = $where ? ('WHERE ' . implode(' AND ', $where)) : '';

$sql = "
    SELECT  a.id          AS alert_id,
            a.rule_id,
            a.imported_lead_id AS lead_id,
            a.fired_at,
            a.resolved_at,
            a.resolved_reason,
            r.name        AS rule_name,
            r.if_no_activity_for_days AS rule_days,
            s.status      AS lead_status,
            s.lead_temperature,
            s.assigned_user_id,
            assignee.name AS assignee_name,
            lead.norm_vin,
            lead.norm_make,
            lead.norm_model,
            lead.norm_year,
            lead.norm_state,
            lead.norm_phone_primary,
            (
                SELECT MAX(la.created_at)
                  FROM lead_activities la
                 WHERE la.imported_lead_id = lead.id
            ) AS last_activity_at
      FROM sla_alerts a
      JOIN sla_rules  r        ON r.id = a.rule_id
      JOIN imported_leads_raw lead ON lead.id = a.imported_lead_id
      JOIN lead_states s        ON s.imported_lead_id = lead.id
      LEFT JOIN users  assignee ON assignee.id = s.assigned_user_id
    $whereSql
     ORDER BY a.fired_at DESC, a.id DESC
     LIMIT $limit OFFSET $offset
";

$countSql = "SELECT COUNT(*)
                FROM sla_alerts a
                JOIN lead_states s ON s.imported_lead_id = a.imported_lead_id
                $whereSql";

$cstmt = $db->prepare($countSql);
$cstmt->execute($params);
$total = (int) $cstmt->fetchColumn();

$stmt = $db->prepare($sql);
$stmt->execute($params);
$alerts = $stmt->fetchAll();

echo json_encode([
    'success'  => true,
    'alerts'   => $alerts,
    'total'    => $total,
    'open_count' => $includeResolved ? null : $total,
    'limit'    => $limit,
    'offset'   => $offset,
]);

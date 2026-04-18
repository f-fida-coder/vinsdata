<?php

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/pipeline.php';
initSession();

$user = requireAuth();
$db   = getDBConnection();

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    pipelineFail(405, 'Method not allowed', 'method_not_allowed');
}

/** Merge a SQL-derived [{key: .., count: ..}] list with an enum, zero-filling missing keys. */
function zeroFill(array $seq, array $rows, string $keyCol = 'key', string $countCol = 'count'): array
{
    $map = [];
    foreach ($rows as $r) {
        $k = $r[$keyCol];
        $map[$k] = (int) $r[$countCol];
    }
    $out = [];
    foreach ($seq as $k) {
        $out[] = ['key' => $k, 'count' => $map[$k] ?? 0];
    }
    return $out;
}

function leadsReport(PDO $db, int $currentUserId): array
{
    $total      = (int) $db->query("SELECT COUNT(*) FROM imported_leads_raw WHERE import_status='imported'")->fetchColumn();

    $unassigned = (int) $db->query(
        "SELECT COUNT(*) FROM imported_leads_raw r
           LEFT JOIN lead_states s ON s.imported_lead_id = r.id
          WHERE r.import_status='imported' AND (s.id IS NULL OR s.assigned_user_id IS NULL)"
    )->fetchColumn();

    $today = (int) $db->query(
        "SELECT COUNT(*) FROM imported_leads_raw r
           JOIN lead_import_batches b ON b.id = r.batch_id
          WHERE r.import_status='imported' AND DATE(b.imported_at) = CURDATE()"
    )->fetchColumn();

    $thisWeek = (int) $db->query(
        "SELECT COUNT(*) FROM imported_leads_raw r
           JOIN lead_import_batches b ON b.id = r.batch_id
          WHERE r.import_status='imported' AND b.imported_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)"
    )->fetchColumn();

    $statusRows = $db->query(
        "SELECT COALESCE(s.status, 'new') AS `key`, COUNT(*) AS `count`
           FROM imported_leads_raw r
           LEFT JOIN lead_states s ON s.imported_lead_id = r.id
          WHERE r.import_status='imported'
          GROUP BY COALESCE(s.status, 'new')"
    )->fetchAll();

    $priorityRows = $db->query(
        "SELECT COALESCE(s.priority, 'medium') AS `key`, COUNT(*) AS `count`
           FROM imported_leads_raw r
           LEFT JOIN lead_states s ON s.imported_lead_id = r.id
          WHERE r.import_status='imported'
          GROUP BY COALESCE(s.priority, 'medium')"
    )->fetchAll();

    $temperatureRows = $db->query(
        "SELECT s.lead_temperature AS `key`, COUNT(*) AS `count`
           FROM imported_leads_raw r
           JOIN lead_states s ON s.imported_lead_id = r.id
          WHERE r.import_status='imported' AND s.lead_temperature IS NOT NULL
          GROUP BY s.lead_temperature"
    )->fetchAll();

    $stageRows = $db->query(
        "SELECT b.source_stage AS `key`, COUNT(*) AS `count`
           FROM imported_leads_raw r
           JOIN lead_import_batches b ON b.id = r.batch_id
          WHERE r.import_status='imported'
          GROUP BY b.source_stage"
    )->fetchAll();

    $batchRows = $db->query(
        "SELECT b.id AS batch_id, b.batch_name, COUNT(*) AS `count`
           FROM imported_leads_raw r
           JOIN lead_import_batches b ON b.id = r.batch_id
          WHERE r.import_status='imported'
          GROUP BY b.id, b.batch_name
          ORDER BY `count` DESC, b.batch_name
          LIMIT 10"
    )->fetchAll();

    $confirmedDupRelated = (int) $db->query(
        "SELECT COUNT(DISTINCT m.imported_lead_id)
           FROM lead_duplicate_group_members m
           JOIN lead_duplicate_groups g ON g.id = m.group_id
          WHERE g.review_status = 'confirmed_duplicate'"
    )->fetchColumn();

    $openTasks = (int) $db->query(
        "SELECT COUNT(*) FROM lead_tasks WHERE status = 'open'"
    )->fetchColumn();
    $tasksDueToday = (int) $db->query(
        "SELECT COUNT(*) FROM lead_tasks
          WHERE status = 'open' AND due_at IS NOT NULL AND DATE(due_at) = CURDATE()"
    )->fetchColumn();
    $tasksOverdue = (int) $db->query(
        "SELECT COUNT(*) FROM lead_tasks
          WHERE status = 'open' AND due_at IS NOT NULL AND due_at < NOW()"
    )->fetchColumn();

    // Per-user notification counts — scoped to the calling user.
    $stmt = $db->prepare(
        "SELECT COUNT(*) FROM notifications WHERE user_id = :uid AND is_read = 0"
    );
    $stmt->execute([':uid' => $currentUserId]);
    $notificationsUnread = (int) $stmt->fetchColumn();

    return [
        'total'                       => $total,
        'unassigned'                  => $unassigned,
        'imported_today'              => $today,
        'imported_this_week'          => $thisWeek,
        'by_status'                   => zeroFill(LEAD_STATUSES,     $statusRows),
        'by_priority'                 => zeroFill(LEAD_PRIORITIES,   $priorityRows),
        'by_temperature'              => zeroFill(LEAD_TEMPERATURES, $temperatureRows),
        'by_source_stage'             => zeroFill(STAGES,            $stageRows),
        'by_batch'                    => array_map(fn($r) => [
            'batch_id'   => (int) $r['batch_id'],
            'batch_name' => $r['batch_name'],
            'count'      => (int) $r['count'],
        ], $batchRows),
        'confirmed_duplicate_related' => $confirmedDupRelated,
        'open_tasks'                  => $openTasks,
        'tasks_due_today'             => $tasksDueToday,
        'tasks_overdue'               => $tasksOverdue,
        'notifications_unread'        => $notificationsUnread,
    ];
}

function duplicatesReport(PDO $db, int $currentUserId): array
{
    $total = (int) $db->query("SELECT COUNT(*) FROM lead_duplicate_groups")->fetchColumn();
    $today = (int) $db->query(
        "SELECT COUNT(*) FROM lead_duplicate_groups WHERE DATE(created_at) = CURDATE()"
    )->fetchColumn();
    $thisWeek = (int) $db->query(
        "SELECT COUNT(*) FROM lead_duplicate_groups WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)"
    )->fetchColumn();

    $statusRows = $db->query(
        "SELECT review_status AS `key`, COUNT(*) AS `count` FROM lead_duplicate_groups GROUP BY review_status"
    )->fetchAll();
    $typeRows = $db->query(
        "SELECT match_type AS `key`, COUNT(*) AS `count` FROM lead_duplicate_groups GROUP BY match_type"
    )->fetchAll();

    // Merge prep metrics — scoped to confirmed duplicate groups only.
    $confirmed = (int) $db->query(
        "SELECT COUNT(*) FROM lead_duplicate_groups WHERE review_status = 'confirmed_duplicate'"
    )->fetchColumn();
    $prepDraft = (int) $db->query(
        "SELECT COUNT(*) FROM lead_merge_prep_groups p
           JOIN lead_duplicate_groups g ON g.id = p.duplicate_group_id
          WHERE g.review_status = 'confirmed_duplicate' AND p.status = 'draft'"
    )->fetchColumn();
    $prepPrepared = (int) $db->query(
        "SELECT COUNT(*) FROM lead_merge_prep_groups p
           JOIN lead_duplicate_groups g ON g.id = p.duplicate_group_id
          WHERE g.review_status = 'confirmed_duplicate' AND p.status = 'prepared'"
    )->fetchColumn();
    $prepNotStarted = max(0, $confirmed - $prepDraft - $prepPrepared);

    $stmt = $db->prepare(
        "SELECT COUNT(*) FROM lead_merge_prep_groups p
           JOIN lead_duplicate_groups g ON g.id = p.duplicate_group_id
          WHERE g.review_status = 'confirmed_duplicate' AND p.prepared_by = :uid"
    );
    $stmt->execute([':uid' => $currentUserId]);
    $prepByMe = (int) $stmt->fetchColumn();

    return [
        'total'             => $total,
        'created_today'     => $today,
        'created_this_week' => $thisWeek,
        'by_review_status'  => zeroFill(DUPLICATE_REVIEW_STATUSES, $statusRows),
        'by_match_type'     => zeroFill(DUPLICATE_MATCH_TYPES,     $typeRows),
        'merge_prep'        => [
            'confirmed_groups'   => $confirmed,
            'not_started'        => $prepNotStarted,
            'draft'              => $prepDraft,
            'prepared'           => $prepPrepared,
            'prepared_by_me'     => $prepByMe,
        ],
    ];
}

$type = $_GET['type'] ?? null;

if ($type === 'leads') {
    echo json_encode(['leads' => leadsReport($db, (int) $user['id'])]);
} elseif ($type === 'duplicates') {
    echo json_encode(['duplicates' => duplicatesReport($db, (int) $user['id'])]);
} elseif ($type === null) {
    echo json_encode([
        'leads'      => leadsReport($db, (int) $user['id']),
        'duplicates' => duplicatesReport($db, (int) $user['id']),
    ]);
} else {
    pipelineFail(400, "Invalid type '$type'", 'invalid_type');
}

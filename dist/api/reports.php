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

function leadsReport(PDO $db, int $currentUserId, bool $isAdmin): array
{
    // Non-admins see only leads assigned to them. `ls_scope` is joined eagerly
    // so every count in this report respects that scope.
    $scopeJoin  = $isAdmin ? '' : ' JOIN lead_states ls_scope ON ls_scope.imported_lead_id = r.id AND ls_scope.assigned_user_id = :me_scope';
    $scopeParam = $isAdmin ? [] : [':me_scope' => $currentUserId];

    $runScalar = function (string $sql) use ($db, $scopeParam): int {
        $stmt = $db->prepare($sql);
        $stmt->execute($scopeParam);
        return (int) $stmt->fetchColumn();
    };
    $runRows = function (string $sql) use ($db, $scopeParam): array {
        $stmt = $db->prepare($sql);
        $stmt->execute($scopeParam);
        return $stmt->fetchAll();
    };

    $total = $runScalar(
        "SELECT COUNT(*) FROM imported_leads_raw r $scopeJoin WHERE r.import_status='imported'"
    );

    if ($isAdmin) {
        $unassigned = $runScalar(
            "SELECT COUNT(*) FROM imported_leads_raw r
               LEFT JOIN lead_states s ON s.imported_lead_id = r.id
              WHERE r.import_status='imported' AND (s.id IS NULL OR s.assigned_user_id IS NULL)"
        );
    } else {
        // By definition, scoped results are already assigned to the current user.
        $unassigned = 0;
    }

    $today = $runScalar(
        "SELECT COUNT(*) FROM imported_leads_raw r
           JOIN lead_import_batches b ON b.id = r.batch_id
           $scopeJoin
          WHERE r.import_status='imported' AND DATE(b.imported_at) = CURDATE()"
    );

    $thisWeek = $runScalar(
        "SELECT COUNT(*) FROM imported_leads_raw r
           JOIN lead_import_batches b ON b.id = r.batch_id
           $scopeJoin
          WHERE r.import_status='imported' AND b.imported_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)"
    );

    $statusRows = $runRows(
        "SELECT COALESCE(s.status, 'new') AS `key`, COUNT(*) AS `count`
           FROM imported_leads_raw r
           LEFT JOIN lead_states s ON s.imported_lead_id = r.id
           $scopeJoin
          WHERE r.import_status='imported'
          GROUP BY COALESCE(s.status, 'new')"
    );

    $priorityRows = $runRows(
        "SELECT COALESCE(s.priority, 'medium') AS `key`, COUNT(*) AS `count`
           FROM imported_leads_raw r
           LEFT JOIN lead_states s ON s.imported_lead_id = r.id
           $scopeJoin
          WHERE r.import_status='imported'
          GROUP BY COALESCE(s.priority, 'medium')"
    );

    $temperatureRows = $runRows(
        "SELECT s.lead_temperature AS `key`, COUNT(*) AS `count`
           FROM imported_leads_raw r
           JOIN lead_states s ON s.imported_lead_id = r.id
           $scopeJoin
          WHERE r.import_status='imported' AND s.lead_temperature IS NOT NULL
          GROUP BY s.lead_temperature"
    );

    $stageRows = $runRows(
        "SELECT b.source_stage AS `key`, COUNT(*) AS `count`
           FROM imported_leads_raw r
           JOIN lead_import_batches b ON b.id = r.batch_id
           $scopeJoin
          WHERE r.import_status='imported'
          GROUP BY b.source_stage"
    );

    $batchRows = $runRows(
        "SELECT b.id AS batch_id, b.batch_name, COUNT(*) AS `count`
           FROM imported_leads_raw r
           JOIN lead_import_batches b ON b.id = r.batch_id
           $scopeJoin
          WHERE r.import_status='imported'
          GROUP BY b.id, b.batch_name
          ORDER BY `count` DESC, b.batch_name
          LIMIT 10"
    );

    if ($isAdmin) {
        $confirmedDupRelated = (int) $db->query(
            "SELECT COUNT(DISTINCT m.imported_lead_id)
               FROM lead_duplicate_group_members m
               JOIN lead_duplicate_groups g ON g.id = m.group_id
              WHERE g.review_status = 'confirmed_duplicate'"
        )->fetchColumn();
    } else {
        $stmt = $db->prepare(
            "SELECT COUNT(DISTINCT m.imported_lead_id)
               FROM lead_duplicate_group_members m
               JOIN lead_duplicate_groups g ON g.id = m.group_id
               JOIN lead_states s ON s.imported_lead_id = m.imported_lead_id
              WHERE g.review_status = 'confirmed_duplicate' AND s.assigned_user_id = :uid"
        );
        $stmt->execute([':uid' => $currentUserId]);
        $confirmedDupRelated = (int) $stmt->fetchColumn();
    }

    // Task counts: admins see all, non-admins see only tasks assigned to them.
    $taskWhereUser = $isAdmin ? '' : ' AND assigned_user_id = :uid';
    $taskParams    = $isAdmin ? [] : [':uid' => $currentUserId];

    $stmt = $db->prepare("SELECT COUNT(*) FROM lead_tasks WHERE status = 'open'" . $taskWhereUser);
    $stmt->execute($taskParams);
    $openTasks = (int) $stmt->fetchColumn();

    $stmt = $db->prepare(
        "SELECT COUNT(*) FROM lead_tasks
          WHERE status = 'open' AND due_at IS NOT NULL AND DATE(due_at) = CURDATE()" . $taskWhereUser
    );
    $stmt->execute($taskParams);
    $tasksDueToday = (int) $stmt->fetchColumn();

    $stmt = $db->prepare(
        "SELECT COUNT(*) FROM lead_tasks
          WHERE status = 'open' AND due_at IS NOT NULL AND due_at < NOW()" . $taskWhereUser
    );
    $stmt->execute($taskParams);
    $tasksOverdue = (int) $stmt->fetchColumn();

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

$userRole = $user['role'] ?? null;
$isAdmin  = $userRole === 'admin';
// Marketers get the same unscoped "see all leads" treatment as admins, because
// they need cross-portfolio visibility to build campaign segments.
$unscopedForReports = $isAdmin || $userRole === 'marketer';

function marketingReport(PDO $db): array
{
    $active    = (int) $db->query(
        "SELECT COUNT(*) FROM marketing_campaigns WHERE status IN ('draft','queued','sending','partially_failed')"
    )->fetchColumn();
    $totalCampaigns = (int) $db->query("SELECT COUNT(*) FROM marketing_campaigns")->fetchColumn();

    $sent7  = (int) $db->query(
        "SELECT COUNT(*) FROM marketing_campaign_recipients
          WHERE send_status = 'sent' AND sent_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)"
    )->fetchColumn();
    $sent30 = (int) $db->query(
        "SELECT COUNT(*) FROM marketing_campaign_recipients
          WHERE send_status = 'sent' AND sent_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)"
    )->fetchColumn();
    $opened30 = (int) $db->query(
        "SELECT COUNT(*) FROM marketing_campaign_recipients
          WHERE opened_at IS NOT NULL AND opened_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)"
    )->fetchColumn();
    $clicked30 = (int) $db->query(
        "SELECT COUNT(*) FROM marketing_campaign_recipients
          WHERE clicked_at IS NOT NULL AND clicked_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)"
    )->fetchColumn();
    $bounced30 = (int) $db->query(
        "SELECT COUNT(*) FROM marketing_campaign_recipients
          WHERE send_status = 'bounced' AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)"
    )->fetchColumn();
    $suppressed = (int) $db->query("SELECT COUNT(*) FROM marketing_suppressions")->fetchColumn();

    $openRate30  = $sent30 > 0 ? round(($opened30  / $sent30) * 100, 1) : 0.0;
    $clickRate30 = $sent30 > 0 ? round(($clicked30 / $sent30) * 100, 1) : 0.0;

    return [
        'active_campaigns'  => $active,
        'total_campaigns'   => $totalCampaigns,
        'sent_7d'           => $sent7,
        'sent_30d'          => $sent30,
        'opened_30d'        => $opened30,
        'clicked_30d'       => $clicked30,
        'bounced_30d'       => $bounced30,
        'open_rate_30d'     => $openRate30,
        'click_rate_30d'    => $clickRate30,
        'suppressed_total'  => $suppressed,
    ];
}

if ($type === 'marketing') {
    if (!$isAdmin && ($user['role'] ?? null) !== 'marketer') {
        pipelineFail(403, 'Admin or marketer role required', 'marketing_forbidden');
    }
    echo json_encode(['marketing' => marketingReport($db)]);
    exit();
}

if ($type === 'leads') {
    echo json_encode(['leads' => leadsReport($db, (int) $user['id'], $unscopedForReports)]);
} elseif ($type === 'duplicates') {
    echo json_encode(['duplicates' => duplicatesReport($db, (int) $user['id'])]);
} elseif ($type === null) {
    $bundle = [
        'leads'      => leadsReport($db, (int) $user['id'], $unscopedForReports),
        'duplicates' => duplicatesReport($db, (int) $user['id']),
    ];
    if ($unscopedForReports) {
        $bundle['marketing'] = marketingReport($db);
    }
    echo json_encode($bundle);
} else {
    pipelineFail(400, "Invalid type '$type'", 'invalid_type');
}

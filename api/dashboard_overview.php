<?php
// High-level CRM pulse — one endpoint that powers the home Dashboard.
//
// Everything aggregated here is read-only and bound to the
// 'idx_ilr_import_status_deleted_at' composite index added in migration
// 025 plus the existing norm_* indexes. Designed to stay snappy at
// 500K rows: 8 indexed queries, no per-row processing.
//
// Returns a single JSON object with:
//   kpis            — top-line numbers (total leads, unassigned, hot, etc.)
//   funnel          — status → count for the active pipeline stages
//   byStatus        — every status (including the inactive ones, zero-filled)
//   byFile          — one row per source file with assigned/unassigned mix
//   byAgent         — one row per assigned user with their lead pipeline
//   byMake          — top 10 makes by lead volume
//   recentImports   — last 5 batches imported (vehicle + size + when)

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/pipeline.php';
initSession();

$user = requireAuth();
$db   = getDBConnection();

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    pipelineFail(405, 'Method not allowed', 'method_not_allowed');
}

$role    = $user['role'] ?? null;
$isAdmin = in_array($role, ['admin', 'marketer'], true);

// Agents (including acquisition agents) see their own scope only —
// the dashboard's "Total leads", funnel, files, makes are all scoped
// to their assigned slice. Admins + marketers see the full CRM.
$selfScope  = $isAdmin ? '' : 'JOIN lead_states ls_scope ON ls_scope.imported_lead_id = r.id AND ls_scope.assigned_user_id = :me';
$selfParams = $isAdmin ? [] : [':me' => (int) $user['id']];

// ---- KPIs ----
$total = (int) (function () use ($db, $selfScope, $selfParams) {
    $sql = "SELECT COUNT(*) FROM imported_leads_raw r $selfScope
             WHERE r.import_status = 'imported' AND r.deleted_at IS NULL";
    $st = $db->prepare($sql); $st->execute($selfParams); return $st->fetchColumn();
})();

$unassigned = 0;
if ($isAdmin) {
    $unassigned = (int) $db->query(
        "SELECT COUNT(*) FROM imported_leads_raw r
           LEFT JOIN lead_states s ON s.imported_lead_id = r.id
          WHERE r.import_status = 'imported' AND r.deleted_at IS NULL
            AND (s.id IS NULL OR s.assigned_user_id IS NULL)"
    )->fetchColumn();
}

$hot = (int) (function () use ($db, $selfScope, $selfParams) {
    $sql = "SELECT COUNT(*) FROM imported_leads_raw r
              JOIN lead_states s ON s.imported_lead_id = r.id
              $selfScope
             WHERE r.import_status = 'imported' AND r.deleted_at IS NULL
               AND s.lead_temperature = 'hot'";
    $st = $db->prepare($sql); $st->execute($selfParams); return $st->fetchColumn();
})();

$dealsClosedWeek = (int) (function () use ($db, $selfScope, $selfParams) {
    $sql = "SELECT COUNT(*) FROM imported_leads_raw r
              JOIN lead_states s ON s.imported_lead_id = r.id
              $selfScope
             WHERE r.import_status = 'imported' AND r.deleted_at IS NULL
               AND s.status = 'deal_closed'
               AND s.updated_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)";
    $st = $db->prepare($sql); $st->execute($selfParams); return $st->fetchColumn();
})();

// Task counts respect the same scope rule.
$taskWhereUser = $isAdmin ? '' : ' AND assigned_user_id = :uid';
$taskParams    = $isAdmin ? [] : [':uid' => (int) $user['id']];
$openTasks = (function () use ($db, $taskWhereUser, $taskParams) {
    $st = $db->prepare("SELECT COUNT(*) FROM lead_tasks WHERE status = 'open'" . $taskWhereUser);
    $st->execute($taskParams); return (int) $st->fetchColumn();
})();
$overdueTasks = (function () use ($db, $taskWhereUser, $taskParams) {
    $st = $db->prepare(
        "SELECT COUNT(*) FROM lead_tasks
          WHERE status = 'open' AND due_at IS NOT NULL AND due_at < NOW()" . $taskWhereUser
    );
    $st->execute($taskParams); return (int) $st->fetchColumn();
})();

$sentThisWeek = (int) (function () use ($db, $selfScope, $selfParams, $isAdmin, $user) {
    // Outreach is keyed by lead too; reuse the same scope rule.
    if ($isAdmin) {
        return (int) $db->query(
            "SELECT COUNT(*) FROM outbound_jobs
              WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) AND status = 'sent'"
        )->fetchColumn();
    }
    $st = $db->prepare(
        "SELECT COUNT(*) FROM outbound_jobs j
           JOIN lead_states s ON s.imported_lead_id = j.imported_lead_id
          WHERE j.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) AND j.status = 'sent'
            AND s.assigned_user_id = :uid"
    );
    $st->execute([':uid' => (int) $user['id']]);
    return $st->fetchColumn();
})();

$kpis = [
    'total'              => $total,
    'unassigned'         => $unassigned,
    'hot'                => $hot,
    'deals_closed_week'  => $dealsClosedWeek,
    'open_tasks'         => $openTasks,
    'overdue_tasks'      => $overdueTasks,
    'outreach_sent_week' => $sentThisWeek,
];

// ---- Status breakdown (drives the funnel + pie) ----
$statusRows = (function () use ($db, $selfScope, $selfParams) {
    $sql = "SELECT COALESCE(s.status, 'new') AS `key`, COUNT(*) AS `count`
              FROM imported_leads_raw r
              LEFT JOIN lead_states s ON s.imported_lead_id = r.id
              $selfScope
             WHERE r.import_status = 'imported' AND r.deleted_at IS NULL
             GROUP BY COALESCE(s.status, 'new')";
    $st = $db->prepare($sql); $st->execute($selfParams); return $st->fetchAll();
})();
$byStatus = [];
foreach ($statusRows as $r) {
    $byStatus[(string) $r['key']] = (int) $r['count'];
}
// Zero-fill every known status so the funnel doesn't have gaps.
foreach (LEAD_STATUSES as $s) {
    if (!isset($byStatus[$s])) $byStatus[$s] = 0;
}

// Active outbound pipeline — the stages that matter for "where are my
// leads sitting right now". Callback/interested are the working steps;
// deal_closed is the terminal won state. (Previously included
// 'contacted' as the second stage, but that status was collapsed into
// 'no_answer' in migration 038.)
$funnelStages = ['new', 'callback', 'interested', 'deal_closed'];
$funnel = array_map(fn($s) => ['key' => $s, 'count' => $byStatus[$s] ?? 0], $funnelStages);

// ---- Per-file breakdown ----
//
// Each file_id maps to one row with assigned / unassigned / hot / closed.
// We aggregate across all batches that came from the same file (the
// "same file uploaded N times" bug from earlier sprints means one file
// can spawn multiple batches; users still want a single per-file row).
// "Has a phone" is keyed on norm_phone_primary, the indexed canonical
// column we use everywhere else for phone-matching (duplicate scan,
// reply lookup, etc.). Leads with only a secondary/3rd/4th phone in
// the JSON payload aren't counted as "callable" by the dashboard —
// operators work the primary slot, and the % is meant to track
// workforce coverage of the actionable pool.
$fileRows = $db->query(
    "SELECT f.id AS file_id,
            COALESCE(NULLIF(f.display_name, ''), f.file_name) AS file_name,
            f.year AS file_year,
            v.id AS vehicle_id, v.make, v.model, v.`trim`, v.year AS vehicle_year, v.name AS vehicle_name,
            COUNT(r.id) AS total,
            SUM(CASE WHEN s.assigned_user_id IS NOT NULL THEN 1 ELSE 0 END) AS assigned,
            SUM(CASE WHEN s.assigned_user_id IS NULL     THEN 1 ELSE 0 END) AS unassigned,
            SUM(CASE WHEN r.norm_phone_primary IS NOT NULL AND r.norm_phone_primary <> '' THEN 1 ELSE 0 END) AS with_phone,
            SUM(CASE WHEN r.norm_phone_primary IS NOT NULL AND r.norm_phone_primary <> ''
                       AND s.assigned_user_id IS NOT NULL THEN 1 ELSE 0 END) AS assigned_with_phone,
            SUM(CASE WHEN r.norm_phone_primary IS NOT NULL AND r.norm_phone_primary <> ''
                       AND s.assigned_user_id IS NULL THEN 1 ELSE 0 END) AS unassigned_with_phone,
            SUM(CASE WHEN s.status     = 'new' OR s.status IS NULL THEN 1 ELSE 0 END) AS new_leads,
            SUM(CASE WHEN s.status     = 'interested'  THEN 1 ELSE 0 END) AS interested,
            SUM(CASE WHEN s.lead_temperature = 'hot'   THEN 1 ELSE 0 END) AS hot,
            SUM(CASE WHEN s.status     = 'deal_closed' THEN 1 ELSE 0 END) AS closed,
            -- Most recent assignment activity in this file. Uses the
            -- assigned-row updated_at so admins can spot stale files.
            MAX(CASE WHEN s.assigned_user_id IS NOT NULL THEN s.updated_at END) AS last_assigned_at,
            MAX(b.imported_at) AS last_imported_at
       FROM files f
       JOIN vehicles v                  ON v.id = f.vehicle_id
       JOIN lead_import_batches b       ON b.file_id = f.id
       JOIN imported_leads_raw r        ON r.batch_id = b.id
        AND r.import_status = 'imported' AND r.deleted_at IS NULL
       LEFT JOIN lead_states s          ON s.imported_lead_id = r.id
      GROUP BY f.id, f.display_name, f.file_name, f.year,
               v.id, v.make, v.model, v.`trim`, v.year, v.name
     HAVING total > 0
      ORDER BY total DESC, last_imported_at DESC
      LIMIT 50"
)->fetchAll();

$byFile = array_map(function ($r) {
    $total              = (int) $r['total'];
    $assigned           = (int) $r['assigned'];
    $withPhone          = (int) $r['with_phone'];
    $assignedWithPhone  = (int) $r['assigned_with_phone'];
    $unassignedWithPhone= (int) $r['unassigned_with_phone'];
    return [
        'file_id'              => (int) $r['file_id'],
        'file_name'            => $r['file_name'],
        'vehicle_id'           => (int) $r['vehicle_id'],
        'vehicle'              => trim(implode(' ', array_filter([
            $r['vehicle_year'] ?: $r['file_year'],
            $r['make'],
            $r['model'],
            $r['trim'],
        ]))) ?: $r['vehicle_name'],
        // total_all = raw imported-row count (kept for downstream
        // consumers + the per-file detail view). total = the value
        // the Files dashboard displays in the "Total" column —
        // leads with a primary phone, i.e. the callable pool.
        'total_all'            => $total,
        'total'                => $withPhone,
        'assigned'             => $assigned,
        'unassigned'           => (int) $r['unassigned'],
        // Phone-aware aggregates used by HomeDashboard for the
        // Assigned % bar (numerator/denominator) and the "+todo"
        // pill. Tracks workforce coverage of the actionable pool.
        'with_phone'           => $withPhone,
        'assigned_with_phone'  => $assignedWithPhone,
        'unassigned_with_phone'=> $unassignedWithPhone,
        'new_leads'            => (int) $r['new_leads'],
        'interested'           => (int) $r['interested'],
        'hot'                  => (int) $r['hot'],
        'closed'               => (int) $r['closed'],
        'assigned_pct'         => $withPhone > 0 ? round(($assignedWithPhone / $withPhone) * 100) : 0,
        'last_assigned_at'     => $r['last_assigned_at'],
        'last_imported_at'     => $r['last_imported_at'],
    ];
}, $fileRows);

// ---- Per-agent breakdown ----
//
// Every active user with at least one assigned lead. Agents see only
// themselves (the scope filter is implicit: they can't have anyone
// else's lead rows showing up). Admins/marketers see the full team.
// We list every operator-role user (admin / marketer / sales_agent),
// even those with zero leads assigned, so a brand-new acquisition
// agent surfaces on the dashboard the moment they're created — the
// previous INNER JOIN hid them until they had at least one lead.
//
// Pipeline-stage agents (carfax / filter / tlo) are intentionally
// hidden — their work isn't pooled lead acquisition. If you ever
// want to surface them too, widen the role filter.
$agentScopeWhere = $isAdmin ? '' : 'AND (s.assigned_user_id IS NULL OR s.assigned_user_id = :me)';
$agentParams     = $isAdmin ? [] : [':me' => (int) $user['id']];

// COUNT(r.id) instead of COUNT(s.id) so deleted-lead assignments
// don't inflate the per-agent total — the LEFT JOIN to
// imported_leads_raw with the predicate yields NULL for archived
// leads, and COUNT(non-null) skips them.
$agentSql =
    "SELECT u.id AS user_id, u.name, u.role,
            COUNT(r.id) AS total_assigned,
            SUM(CASE WHEN s.status     = 'interested'  AND r.id IS NOT NULL THEN 1 ELSE 0 END) AS interested,
            SUM(CASE WHEN s.lead_temperature = 'hot'   AND r.id IS NOT NULL THEN 1 ELSE 0 END) AS hot,
            SUM(CASE WHEN s.status     = 'deal_closed' AND r.id IS NOT NULL THEN 1 ELSE 0 END) AS closed
       FROM users u
       LEFT JOIN lead_states s          ON s.assigned_user_id = u.id
       LEFT JOIN imported_leads_raw r   ON r.id = s.imported_lead_id
        AND r.import_status = 'imported' AND r.deleted_at IS NULL
      WHERE u.role IN ('admin','marketer','sales_agent') $agentScopeWhere
      GROUP BY u.id, u.name, u.role
      ORDER BY total_assigned DESC, u.name ASC";
$agentStmt = $db->prepare($agentSql);
$agentStmt->execute($agentParams);
$agentRows = $agentStmt->fetchAll();

// Open + overdue tasks per agent in one extra query so we don't fan-out.
$agentIds = array_column($agentRows, 'user_id');
$tasksByAgent = [];
if (!empty($agentIds)) {
    $placeholders = implode(',', array_fill(0, count($agentIds), '?'));
    $stmt = $db->prepare(
        "SELECT assigned_user_id,
                SUM(CASE WHEN status='open' THEN 1 ELSE 0 END) AS open_tasks,
                SUM(CASE WHEN status='open' AND due_at IS NOT NULL AND due_at < NOW() THEN 1 ELSE 0 END) AS overdue_tasks
           FROM lead_tasks
          WHERE assigned_user_id IN ($placeholders)
          GROUP BY assigned_user_id"
    );
    $stmt->execute($agentIds);
    foreach ($stmt->fetchAll() as $r) {
        $tasksByAgent[(int) $r['assigned_user_id']] = [
            'open'    => (int) $r['open_tasks'],
            'overdue' => (int) $r['overdue_tasks'],
        ];
    }
}

// Status changes per agent today — operator-requested "productivity"
// signal. Counts every status_changed lead_activities row authored by
// the agent since midnight (local server time = UTC on this box;
// good enough for daily activity, no need for per-user timezone yet).
$statusChangesByAgent = [];
if (!empty($agentIds)) {
    $placeholders = implode(',', array_fill(0, count($agentIds), '?'));
    $stmt = $db->prepare(
        "SELECT user_id, COUNT(*) AS changes_today
           FROM lead_activities
          WHERE activity_type = 'status_changed'
            AND user_id IN ($placeholders)
            AND created_at >= CURDATE()
          GROUP BY user_id"
    );
    $stmt->execute($agentIds);
    foreach ($stmt->fetchAll() as $r) {
        $statusChangesByAgent[(int) $r['user_id']] = (int) $r['changes_today'];
    }
}

$byAgent = array_map(function ($r) use ($tasksByAgent, $statusChangesByAgent) {
    $uid = (int) $r['user_id'];
    return [
        'user_id'             => $uid,
        'name'                => $r['name'],
        'role'                => $r['role'],
        'total_assigned'      => (int) $r['total_assigned'],
        'interested'          => (int) $r['interested'],
        'hot'                 => (int) $r['hot'],
        'closed'              => (int) $r['closed'],
        'open_tasks'          => $tasksByAgent[$uid]['open']    ?? 0,
        'overdue_tasks'       => $tasksByAgent[$uid]['overdue'] ?? 0,
        'status_changes_today'=> $statusChangesByAgent[$uid]    ?? 0,
    ];
}, $agentRows);

// ---- Top makes / models by lead volume ----
//
// Source spreadsheets occasionally put a model in the make column —
// "Corvette" instead of "CHEVROLET", "911" instead of "PORSCHE".
// makeNormalizationSqlExpression() emits a CASE that consolidates
// known mis-categorizations under their parent make so the chart
// stops showing Chevrolet and Corvette as separate brands.
$makeRows = (function () use ($db, $selfScope, $selfParams) {
    $normMake = makeNormalizationSqlExpression('r.norm_make');
    $sql = "SELECT $normMake AS make, COUNT(*) AS total,
                   SUM(CASE WHEN s.lead_temperature = 'hot'   THEN 1 ELSE 0 END) AS hot,
                   SUM(CASE WHEN s.status           = 'deal_closed' THEN 1 ELSE 0 END) AS closed
              FROM imported_leads_raw r
              LEFT JOIN lead_states s ON s.imported_lead_id = r.id
              $selfScope
             WHERE r.import_status = 'imported' AND r.deleted_at IS NULL
               AND r.norm_make IS NOT NULL AND r.norm_make <> ''
             GROUP BY $normMake
             ORDER BY total DESC
             LIMIT 10";
    $st = $db->prepare($sql); $st->execute($selfParams); return $st->fetchAll();
})();
$byMake = array_map(fn($r) => [
    'make'   => $r['make'],
    'total'  => (int) $r['total'],
    'hot'    => (int) $r['hot'],
    'closed' => (int) $r['closed'],
], $makeRows);

// ---- Recent imports (last 5 batches) ----
$recentImports = $db->query(
    "SELECT b.id AS batch_id, b.batch_name, b.imported_at,
            COUNT(r.id) AS lead_count,
            v.name AS vehicle_name, v.make, v.model, v.year AS vehicle_year
       FROM lead_import_batches b
       JOIN files f       ON f.id = b.file_id
       JOIN vehicles v    ON v.id = f.vehicle_id
       LEFT JOIN imported_leads_raw r ON r.batch_id = b.id
        AND r.import_status = 'imported' AND r.deleted_at IS NULL
      GROUP BY b.id, b.batch_name, b.imported_at, v.name, v.make, v.model, v.year
      ORDER BY b.imported_at DESC
      LIMIT 5"
)->fetchAll();
$recent = array_map(fn($r) => [
    'batch_id'    => (int) $r['batch_id'],
    'batch_name'  => $r['batch_name'],
    'imported_at' => $r['imported_at'],
    'lead_count'  => (int) $r['lead_count'],
    'vehicle'     => trim(implode(' ', array_filter([$r['vehicle_year'], $r['make'], $r['model']]))) ?: $r['vehicle_name'],
], $recentImports);

// Cache for 60s — dashboard doesn't need to be real-time and the
// per-file/per-agent queries are the most expensive things here.
if (PHP_SAPI !== 'cli') {
    header('Cache-Control: private, max-age=60');
}

echo json_encode([
    'kpis'           => $kpis,
    'funnel'         => $funnel,
    'by_status'      => $byStatus,
    'by_file'        => $byFile,
    'by_agent'       => $byAgent,
    'by_make'        => $byMake,
    'recent_imports' => $recent,
    'role'           => $role,
    'is_admin'       => $isAdmin,
]);

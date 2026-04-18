<?php

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/pipeline.php';
initSession();

requireAuth();
$db = getDBConnection();

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    pipelineFail(405, 'Method not allowed', 'method_not_allowed');
}

// ---- Detail mode: ?id=X ----
if (isset($_GET['id'])) {
    $groupId = (int) $_GET['id'];
    if ($groupId <= 0) pipelineFail(400, 'id is required', 'missing_fields');

    $stmt = $db->prepare(
        'SELECT g.id, g.match_type, g.match_key, g.confidence, g.review_status,
                g.reviewed_by, g.reviewed_at, g.created_at, g.updated_at,
                u.name AS reviewed_by_name
           FROM lead_duplicate_groups g
           LEFT JOIN users u ON u.id = g.reviewed_by
          WHERE g.id = :id'
    );
    $stmt->execute([':id' => $groupId]);
    $group = $stmt->fetch();
    if (!$group) pipelineFail(404, 'Group not found', 'group_not_found');

    $memStmt = $db->prepare(
        'SELECT m.id AS membership_id, m.imported_lead_id, m.created_at AS added_at,
                r.source_row_number, r.normalized_payload_json, r.batch_id,
                b.batch_name, b.source_stage, b.imported_at,
                f.display_name AS file_display_name, f.file_name,
                v.name AS vehicle_name,
                s.status AS crm_status, s.priority AS crm_priority,
                s.assigned_user_id, au.name AS assigned_user_name
           FROM lead_duplicate_group_members m
           JOIN imported_leads_raw r     ON r.id = m.imported_lead_id
           JOIN lead_import_batches b    ON b.id = r.batch_id
           JOIN files f                  ON f.id = b.file_id
           JOIN vehicles v               ON v.id = f.vehicle_id
           LEFT JOIN lead_states s       ON s.imported_lead_id = r.id
           LEFT JOIN users au            ON au.id = s.assigned_user_id
          WHERE m.group_id = :gid
          ORDER BY r.id ASC'
    );
    $memStmt->execute([':gid' => $groupId]);
    $members = [];
    $leadIds = [];
    foreach ($memStmt->fetchAll() as $r) {
        $r['imported_lead_id']   = (int) $r['imported_lead_id'];
        $r['normalized_payload'] = json_decode($r['normalized_payload_json'] ?? 'null', true);
        unset($r['normalized_payload_json']);
        $members[] = $r;
        $leadIds[] = (int) $r['imported_lead_id'];
    }

    $labelsByLead = [];
    if (!empty($leadIds)) {
        $placeholders = implode(',', array_fill(0, count($leadIds), '?'));
        $labelStmt = $db->prepare(
            "SELECT lll.imported_lead_id, l.id, l.name, l.color
               FROM lead_label_links lll
               JOIN lead_labels l ON l.id = lll.label_id
              WHERE lll.imported_lead_id IN ($placeholders)
              ORDER BY l.name"
        );
        $labelStmt->execute($leadIds);
        foreach ($labelStmt->fetchAll() as $r) {
            $labelsByLead[(int) $r['imported_lead_id']][] = [
                'id' => (int) $r['id'], 'name' => $r['name'], 'color' => $r['color'],
            ];
        }
    }
    foreach ($members as &$m) {
        $m['labels'] = $labelsByLead[$m['imported_lead_id']] ?? [];
    }
    unset($m);

    $revStmt = $db->prepare(
        'SELECT r.id, r.decision, r.notes, r.reviewed_by, r.reviewed_at, r.created_at,
                u.name AS reviewed_by_name
           FROM lead_duplicate_reviews r
           JOIN users u ON u.id = r.reviewed_by
          WHERE r.group_id = :gid
          ORDER BY r.created_at DESC, r.id DESC'
    );
    $revStmt->execute([':gid' => $groupId]);
    $reviews = $revStmt->fetchAll();

    $group['id']          = (int) $group['id'];
    $group['confidence']  = (float) $group['confidence'];
    $group['member_count'] = count($members);
    echo json_encode([
        'group'   => $group,
        'members' => $members,
        'reviews' => $reviews,
    ]);
    exit();
}

// ---- List mode ----
$page    = max(1, (int) ($_GET['page']     ?? 1));
$perPage = (int) ($_GET['per_page'] ?? 50);
if ($perPage < 1)   $perPage = 50;
if ($perPage > 200) $perPage = 200;
$offset  = ($page - 1) * $perPage;

$where  = ['1=1'];
$params = [];

if (!empty($_GET['review_status'])) {
    if (!in_array($_GET['review_status'], DUPLICATE_REVIEW_STATUSES, true)) {
        pipelineFail(400, 'invalid review_status', 'invalid_review_status');
    }
    $where[] = 'g.review_status = :rs';
    $params[':rs'] = $_GET['review_status'];
}
if (!empty($_GET['match_type'])) {
    assertMatchType($_GET['match_type']);
    $where[] = 'g.match_type = :mt';
    $params[':mt'] = $_GET['match_type'];
}
if (isset($_GET['min_confidence']) && $_GET['min_confidence'] !== '') {
    $where[] = 'g.confidence >= :mc';
    $params[':mc'] = (float) $_GET['min_confidence'];
}
if (!empty($_GET['batch_id'])) {
    $where[] = 'EXISTS (SELECT 1 FROM lead_duplicate_group_members m
                         JOIN imported_leads_raw r ON r.id = m.imported_lead_id
                        WHERE m.group_id = g.id AND r.batch_id = :bid)';
    $params[':bid'] = (int) $_GET['batch_id'];
}
if (!empty($_GET['file_id'])) {
    $where[] = 'EXISTS (SELECT 1 FROM lead_duplicate_group_members m
                         JOIN imported_leads_raw r ON r.id = m.imported_lead_id
                         JOIN lead_import_batches b ON b.id = r.batch_id
                        WHERE m.group_id = g.id AND b.file_id = :fid)';
    $params[':fid'] = (int) $_GET['file_id'];
}
if (!empty($_GET['created_from'])) {
    $where[] = 'g.created_at >= :cf';
    $params[':cf'] = $_GET['created_from'] . ' 00:00:00';
}
if (!empty($_GET['created_to'])) {
    $where[] = 'g.created_at < DATE_ADD(:ct, INTERVAL 1 DAY)';
    $params[':ct'] = $_GET['created_to'];
}

$whereSql = implode(' AND ', $where);

$countSql = "SELECT COUNT(*) FROM lead_duplicate_groups g WHERE $whereSql";
$stmt = $db->prepare($countSql);
$stmt->execute($params);
$total = (int) $stmt->fetchColumn();

$sql = "SELECT g.id, g.match_type, g.match_key, g.confidence, g.review_status,
               g.reviewed_by, u.name AS reviewed_by_name, g.reviewed_at,
               g.created_at, g.updated_at,
               (SELECT COUNT(*) FROM lead_duplicate_group_members m WHERE m.group_id = g.id) AS member_count
          FROM lead_duplicate_groups g
          LEFT JOIN users u ON u.id = g.reviewed_by
         WHERE $whereSql
         ORDER BY g.created_at DESC, g.id DESC
         LIMIT :limit OFFSET :offset";
$stmt = $db->prepare($sql);
foreach ($params as $k => $v) {
    $stmt->bindValue($k, $v, is_int($v) ? PDO::PARAM_INT : PDO::PARAM_STR);
}
$stmt->bindValue(':limit',  $perPage, PDO::PARAM_INT);
$stmt->bindValue(':offset', $offset,  PDO::PARAM_INT);
$stmt->execute();

$groups = array_map(function ($g) {
    $g['id']           = (int) $g['id'];
    $g['confidence']   = (float) $g['confidence'];
    $g['member_count'] = (int) $g['member_count'];
    return $g;
}, $stmt->fetchAll());

echo json_encode([
    'total'    => $total,
    'page'     => $page,
    'per_page' => $perPage,
    'groups'   => $groups,
]);

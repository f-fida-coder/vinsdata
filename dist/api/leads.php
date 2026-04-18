<?php

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/pipeline.php';
initSession();

$user = requireAuth();
$db   = getDBConnection();

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    pipelineFail(405, 'Method not allowed', 'method_not_allowed');
}

function attachCrmToLeads(PDO $db, array &$leads): void
{
    if (empty($leads)) return;
    $ids = array_map(fn($l) => (int) $l['id'], $leads);
    $placeholders = implode(',', array_fill(0, count($ids), '?'));

    $stateStmt = $db->prepare(
        "SELECT s.imported_lead_id, s.status, s.priority,
                s.lead_temperature, s.price_wanted, s.price_offered,
                s.assigned_user_id, u.name AS assigned_user_name
           FROM lead_states s
           LEFT JOIN users u ON u.id = s.assigned_user_id
          WHERE s.imported_lead_id IN ($placeholders)"
    );
    $stateStmt->execute($ids);
    $stateByLead = [];
    foreach ($stateStmt->fetchAll() as $r) {
        $stateByLead[(int) $r['imported_lead_id']] = [
            'status'             => $r['status'],
            'priority'           => $r['priority'],
            'lead_temperature'   => $r['lead_temperature'],
            'price_wanted'       => $r['price_wanted']  !== null ? (float) $r['price_wanted']  : null,
            'price_offered'      => $r['price_offered'] !== null ? (float) $r['price_offered'] : null,
            'assigned_user_id'   => $r['assigned_user_id'] !== null ? (int) $r['assigned_user_id'] : null,
            'assigned_user_name' => $r['assigned_user_name'],
        ];
    }

    $labelStmt = $db->prepare(
        "SELECT lll.imported_lead_id, l.id, l.name, l.color
           FROM lead_label_links lll
           JOIN lead_labels l ON l.id = lll.label_id
          WHERE lll.imported_lead_id IN ($placeholders)
          ORDER BY l.name"
    );
    $labelStmt->execute($ids);
    $labelsByLead = [];
    foreach ($labelStmt->fetchAll() as $r) {
        $labelsByLead[(int) $r['imported_lead_id']][] = [
            'id'    => (int) $r['id'],
            'name'  => $r['name'],
            'color' => $r['color'],
        ];
    }

    foreach ($leads as &$lead) {
        $lid = (int) $lead['id'];
        $lead['crm_state'] = $stateByLead[$lid] ?? [
            'status'             => DEFAULT_LEAD_STATE['status'],
            'priority'           => DEFAULT_LEAD_STATE['priority'],
            'lead_temperature'   => null,
            'price_wanted'       => null,
            'price_offered'      => null,
            'assigned_user_id'   => null,
            'assigned_user_name' => null,
        ];
        $lead['labels'] = $labelsByLead[$lid] ?? [];
    }
}

// -- Detail mode: GET /api/leads?id=X --
if (isset($_GET['id'])) {
    $id = (int) $_GET['id'];
    $stmt = $db->prepare(
        'SELECT r.id, r.batch_id, r.source_row_number, r.raw_payload_json, r.normalized_payload_json,
                r.import_status, r.error_message, r.created_at,
                b.batch_name, b.source_stage, b.imported_at, b.mapping_json, b.notes AS batch_notes,
                b.mapping_template_id,
                f.id AS file_id, f.display_name AS file_display_name, f.file_name,
                f.current_stage AS file_current_stage, f.status AS file_status,
                a.id AS artifact_id, a.original_filename AS artifact_name, a.stage AS artifact_stage,
                a.file_size AS artifact_file_size, a.uploaded_at AS artifact_uploaded_at,
                v.id AS vehicle_id, v.name AS vehicle_name,
                u.id AS imported_by_id, u.name AS imported_by_name,
                t.template_name
           FROM imported_leads_raw r
           JOIN lead_import_batches b ON b.id = r.batch_id
           JOIN files f               ON f.id = b.file_id
           JOIN file_artifacts a      ON a.id = b.artifact_id
           JOIN vehicles v            ON v.id = f.vehicle_id
           JOIN users u               ON u.id = b.imported_by
           LEFT JOIN column_mapping_templates t ON t.id = b.mapping_template_id
          WHERE r.id = :id'
    );
    $stmt->execute([':id' => $id]);
    $row = $stmt->fetch();
    if (!$row) pipelineFail(404, 'Lead not found', 'lead_not_found');

    $row['raw_payload']        = json_decode($row['raw_payload_json']        ?? 'null', true);
    $row['normalized_payload'] = json_decode($row['normalized_payload_json'] ?? 'null', true);
    $row['mapping']            = json_decode($row['mapping_json']            ?? 'null', true);
    unset($row['raw_payload_json'], $row['normalized_payload_json'], $row['mapping_json']);

    $detailWrapper = [$row];
    attachCrmToLeads($db, $detailWrapper);
    $row = $detailWrapper[0];

    echo json_encode($row);
    exit();
}

// -- List mode --

$isCsv = ($_GET['format'] ?? null) === 'csv';

$page     = max(1, (int) ($_GET['page']     ?? 1));
$perPage  = (int) ($_GET['per_page']  ?? 50);
if ($perPage < 1)   $perPage = 50;
if ($perPage > 200) $perPage = 200;

if ($isCsv) {
    // Exports ignore pagination; cap at 10k rows to protect memory / download size.
    $page    = 1;
    $perPage = 10000;
}
$offset = ($page - 1) * $perPage;

$where  = ['r.import_status = :imp_status'];
$params = [':imp_status' => 'imported'];

// Exact IDs
foreach (['batch_id' => 'b.id', 'file_id' => 'b.file_id', 'artifact_id' => 'b.artifact_id', 'vehicle_id' => 'f.vehicle_id'] as $q => $col) {
    if (!empty($_GET[$q])) {
        $where[] = "$col = :$q";
        $params[":$q"] = (int) $_GET[$q];
    }
}

// Stage
if (!empty($_GET['source_stage'])) {
    assertStage($_GET['source_stage']);
    $where[] = 'b.source_stage = :source_stage';
    $params[':source_stage'] = $_GET['source_stage'];
}

// CRM filters
$needsStateJoin = false;
$needsLabelJoin = false;

if (!empty($_GET['status'])) {
    assertLeadStatus($_GET['status']);
    $where[] = 's.status = :status';
    $params[':status'] = $_GET['status'];
    $needsStateJoin = true;
}
if (!empty($_GET['priority'])) {
    assertLeadPriority($_GET['priority']);
    $where[] = 's.priority = :priority';
    $params[':priority'] = $_GET['priority'];
    $needsStateJoin = true;
}
if (isset($_GET['lead_temperature']) && $_GET['lead_temperature'] !== '') {
    if ($_GET['lead_temperature'] === 'unset') {
        $where[] = '(s.lead_temperature IS NULL)';
    } else {
        assertLeadTemperature($_GET['lead_temperature']);
        $where[] = 's.lead_temperature = :lead_temperature';
        $params[':lead_temperature'] = $_GET['lead_temperature'];
    }
    $needsStateJoin = true;
}
if (isset($_GET['assigned_user_id']) && $_GET['assigned_user_id'] !== '') {
    if ($_GET['assigned_user_id'] === 'unassigned') {
        $where[] = '(s.assigned_user_id IS NULL)';
        $needsStateJoin = true;
    } else {
        $where[] = 's.assigned_user_id = :assigned_user_id';
        $params[':assigned_user_id'] = (int) $_GET['assigned_user_id'];
        $needsStateJoin = true;
    }
}
if (!empty($_GET['label_id'])) {
    $where[] = 'EXISTS (SELECT 1 FROM lead_label_links lll WHERE lll.imported_lead_id = r.id AND lll.label_id = :label_id)';
    $params[':label_id'] = (int) $_GET['label_id'];
    $needsLabelJoin = true; // keeps the reference; EXISTS handles the join inline
}

// Task-based filters — each is a single EXISTS against lead_tasks.
if (isset($_GET['has_open_tasks']) && $_GET['has_open_tasks'] !== '') {
    if ($_GET['has_open_tasks'] === '1' || $_GET['has_open_tasks'] === 'true') {
        $where[] = "EXISTS (SELECT 1 FROM lead_tasks lt WHERE lt.imported_lead_id = r.id AND lt.status = 'open')";
    } elseif ($_GET['has_open_tasks'] === '0' || $_GET['has_open_tasks'] === 'false') {
        $where[] = "NOT EXISTS (SELECT 1 FROM lead_tasks lt WHERE lt.imported_lead_id = r.id AND lt.status = 'open')";
    }
}
if (!empty($_GET['tasks_due_today'])) {
    $where[] = "EXISTS (SELECT 1 FROM lead_tasks lt
                         WHERE lt.imported_lead_id = r.id AND lt.status = 'open'
                           AND lt.due_at IS NOT NULL AND DATE(lt.due_at) = CURDATE())";
}
if (!empty($_GET['tasks_overdue'])) {
    $where[] = "EXISTS (SELECT 1 FROM lead_tasks lt
                         WHERE lt.imported_lead_id = r.id AND lt.status = 'open'
                           AND lt.due_at IS NOT NULL AND lt.due_at < NOW())";
}

// Imported date range (on batch.imported_at)
if (!empty($_GET['imported_from'])) {
    $where[] = 'b.imported_at >= :imported_from';
    $params[':imported_from'] = $_GET['imported_from'] . ' 00:00:00';
}
if (!empty($_GET['imported_to'])) {
    $where[] = 'b.imported_at < DATE_ADD(:imported_to, INTERVAL 1 DAY)';
    $params[':imported_to'] = $_GET['imported_to'];
}

// Exact normalized fields backed by indexed generated columns
$exactCols = [
    'vin'            => 'r.norm_vin',
    'phone_primary'  => 'r.norm_phone_primary',
    'email_primary'  => 'r.norm_email_primary',
    'state'          => 'r.norm_state',
    'make'           => 'r.norm_make',
    'model'          => 'r.norm_model',
    'year'           => 'r.norm_year',
];
foreach ($exactCols as $q => $col) {
    if (isset($_GET[$q]) && $_GET[$q] !== '') {
        $where[] = "$col = :$q";
        $params[":$q"] = $_GET[$q];
    }
}

// Partial normalized fields (LIKE) — inline JSON_UNQUOTE because they aren't indexed.
$likeCols = [
    'first_name'  => "JSON_UNQUOTE(JSON_EXTRACT(r.normalized_payload_json, '$.first_name'))",
    'last_name'   => "JSON_UNQUOTE(JSON_EXTRACT(r.normalized_payload_json, '$.last_name'))",
    'full_name'   => "JSON_UNQUOTE(JSON_EXTRACT(r.normalized_payload_json, '$.full_name'))",
    'city'        => "JSON_UNQUOTE(JSON_EXTRACT(r.normalized_payload_json, '$.city'))",
    'zip_code'    => "JSON_UNQUOTE(JSON_EXTRACT(r.normalized_payload_json, '$.zip_code'))",
];
foreach ($likeCols as $q => $expr) {
    if (isset($_GET[$q]) && $_GET[$q] !== '') {
        $where[] = "$expr LIKE :$q";
        $params[":$q"] = '%' . $_GET[$q] . '%';
    }
}

// Global search across the most useful normalized fields
if (isset($_GET['q']) && $_GET['q'] !== '') {
    $q = '%' . $_GET['q'] . '%';
    $searchCols = [
        'r.norm_vin',
        "JSON_UNQUOTE(JSON_EXTRACT(r.normalized_payload_json, '$.first_name'))",
        "JSON_UNQUOTE(JSON_EXTRACT(r.normalized_payload_json, '$.last_name'))",
        "JSON_UNQUOTE(JSON_EXTRACT(r.normalized_payload_json, '$.full_name'))",
        'r.norm_phone_primary',
        'r.norm_email_primary',
        "JSON_UNQUOTE(JSON_EXTRACT(r.normalized_payload_json, '$.full_address'))",
        "JSON_UNQUOTE(JSON_EXTRACT(r.normalized_payload_json, '$.city'))",
        'r.norm_state',
        'r.norm_make',
        'r.norm_model',
        'CAST(r.norm_year AS CHAR)',
    ];
    $where[] = '(' . implode(' OR ', array_map(fn($c) => "$c LIKE :q", $searchCols)) . ')';
    $params[':q'] = $q;
}

$whereSql = implode(' AND ', $where);

$baseFrom = 'FROM imported_leads_raw r
             JOIN lead_import_batches b ON b.id = r.batch_id
             JOIN files f               ON f.id = b.file_id
             JOIN file_artifacts a      ON a.id = b.artifact_id
             JOIN vehicles v            ON v.id = f.vehicle_id
             JOIN users u               ON u.id = b.imported_by';

// Conditionally join lead_states only when a state-backed filter is active.
// The selected rows get CRM data attached later via a separate lookup.
if ($needsStateJoin) {
    $baseFrom .= ' LEFT JOIN lead_states s ON s.imported_lead_id = r.id';
}
unset($needsLabelJoin); // reserved for future use

// Total count
$countSql = "SELECT COUNT(*) $baseFrom WHERE $whereSql";
$stmt = $db->prepare($countSql);
$stmt->execute($params);
$total = (int) $stmt->fetchColumn();

// Page rows
$dataSql = "SELECT r.id, r.batch_id, r.source_row_number, r.normalized_payload_json, r.created_at,
                   b.batch_name, b.source_stage, b.imported_at,
                   f.id AS file_id, f.display_name AS file_display_name, f.file_name,
                   a.id AS artifact_id, a.original_filename AS artifact_name,
                   v.id AS vehicle_id, v.name AS vehicle_name,
                   u.name AS imported_by_name
            $baseFrom
            WHERE $whereSql
            ORDER BY b.imported_at DESC, r.source_row_number ASC
            LIMIT :limit OFFSET :offset";

$stmt = $db->prepare($dataSql);
foreach ($params as $k => $v) {
    $stmt->bindValue($k, $v, is_int($v) ? PDO::PARAM_INT : PDO::PARAM_STR);
}
$stmt->bindValue(':limit',  $perPage, PDO::PARAM_INT);
$stmt->bindValue(':offset', $offset,  PDO::PARAM_INT);
$stmt->execute();

$leads = array_map(function ($r) {
    $r['normalized_payload'] = json_decode($r['normalized_payload_json'] ?? 'null', true);
    unset($r['normalized_payload_json']);
    return $r;
}, $stmt->fetchAll());

attachCrmToLeads($db, $leads);

if ($isCsv) {
    // Strip the JSON Content-Type header set by config.php.
    if (function_exists('header_remove')) header_remove('Content-Type');
    $filename = 'leads_' . date('Ymd_His') . '.csv';
    header('Content-Type: text/csv; charset=UTF-8');
    header('Content-Disposition: attachment; filename="' . $filename . '"');
    $out = fopen('php://output', 'w');
    // UTF-8 BOM so Excel renders accented characters correctly.
    fwrite($out, "\xEF\xBB\xBF");
    fputcsv($out, [
        'name', 'vin', 'phone_primary', 'phone_secondary', 'email_primary',
        'full_address', 'city', 'state', 'zip_code',
        'make', 'model', 'year', 'mileage',
        'status', 'priority', 'temperature', 'price_wanted', 'price_offered',
        'agent', 'labels',
        'source_file', 'batch', 'source_stage', 'source_row_number', 'imported_at',
    ]);
    foreach ($leads as $lead) {
        $np = $lead['normalized_payload'] ?? [];
        $name = $np['full_name'] ?? trim((string) (($np['first_name'] ?? '') . ' ' . ($np['last_name'] ?? '')));
        $labels = array_map(fn($l) => $l['name'], $lead['labels'] ?? []);
        $crm   = $lead['crm_state'] ?? [];
        fputcsv($out, [
            $name,
            $np['vin']             ?? '',
            $np['phone_primary']   ?? '',
            $np['phone_secondary'] ?? '',
            $np['email_primary']   ?? '',
            $np['full_address']    ?? '',
            $np['city']            ?? '',
            $np['state']           ?? '',
            $np['zip_code']        ?? '',
            $np['make']            ?? '',
            $np['model']           ?? '',
            $np['year']            ?? '',
            $np['mileage']         ?? '',
            $crm['status']             ?? 'new',
            $crm['priority']           ?? 'medium',
            $crm['lead_temperature']   ?? '',
            $crm['price_wanted']       !== null && $crm['price_wanted']  !== '' ? $crm['price_wanted']  : '',
            $crm['price_offered']      !== null && $crm['price_offered'] !== '' ? $crm['price_offered'] : '',
            $crm['assigned_user_name'] ?? '',
            implode('; ', $labels),
            $lead['file_display_name'] ?? $lead['file_name'] ?? '',
            $lead['batch_name']        ?? '',
            $lead['source_stage']      ?? '',
            $lead['source_row_number'] ?? '',
            $lead['imported_at']       ?? '',
        ]);
    }
    fclose($out);
    exit();
}

echo json_encode([
    'total'    => $total,
    'page'     => $page,
    'per_page' => $perPage,
    'leads'    => $leads,
]);

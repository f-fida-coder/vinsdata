<?php

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/pipeline.php';
initSession();

$user = requireAuth();
$db   = getDBConnection();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    pipelineFail(405, 'Method not allowed', 'method_not_allowed');
}
assertAdmin($user);

// Throttle expensive duplicate scans: max 5 per admin per 5 minutes.
enforceRateLimit($db, 'duplicate_scan', (int) $user['id'], 5, 300);

$input     = json_decode(file_get_contents('php://input'), true) ?? [];
$batchId   = isset($input['batch_id']) ? (int) $input['batch_id'] : 0;
$fileId    = isset($input['file_id'])  ? (int) $input['file_id']  : 0;

$scopeWhere  = "r.import_status = 'imported'";
$scopeParams = [];
if ($batchId > 0) {
    $scopeWhere .= ' AND r.batch_id = :bid';
    $scopeParams[':bid'] = $batchId;
}
if ($fileId > 0) {
    $scopeWhere .= ' AND b.file_id = :fid';
    $scopeParams[':fid'] = $fileId;
}

$baseFrom = 'FROM imported_leads_raw r JOIN lead_import_batches b ON b.id = r.batch_id';

/**
 * Returns [[match_key, lead_ids[]]], skipping NULL / blank keys and singletons.
 * $keyExpr must be the canonicalized SQL expression producing the key.
 */
function runRule(PDO $db, string $baseFrom, string $scopeWhere, array $scopeParams, string $keyExpr): array
{
    $sql = "SELECT $keyExpr AS k, JSON_ARRAYAGG(r.id) AS ids
            $baseFrom
            WHERE $scopeWhere
              AND $keyExpr IS NOT NULL AND $keyExpr <> ''
            GROUP BY $keyExpr
            HAVING COUNT(DISTINCT r.id) > 1";
    $stmt = $db->prepare($sql);
    $stmt->execute($scopeParams);
    $rows = $stmt->fetchAll();
    $out = [];
    foreach ($rows as $row) {
        $ids = array_values(array_unique(array_map('intval', json_decode($row['ids'], true) ?: [])));
        if (count($ids) < 2) continue;
        $out[] = ['key' => $row['k'], 'ids' => $ids];
    }
    return $out;
}

$rules = [
    'vin' => "UPPER(r.norm_vin)",
    'phone' => "REGEXP_REPLACE(r.norm_phone_primary, '[^0-9]', '')",
    'email' => "LOWER(r.norm_email_primary)",
    'address_last_name' => "CONCAT(
        LOWER(TRIM(JSON_UNQUOTE(JSON_EXTRACT(r.normalized_payload_json, '$.full_address')))),
        '||',
        LOWER(TRIM(JSON_UNQUOTE(JSON_EXTRACT(r.normalized_payload_json, '$.last_name'))))
    )",
    'name_phone' => "CONCAT(
        LOWER(TRIM(JSON_UNQUOTE(JSON_EXTRACT(r.normalized_payload_json, '$.first_name')))),
        '||',
        LOWER(TRIM(JSON_UNQUOTE(JSON_EXTRACT(r.normalized_payload_json, '$.last_name')))),
        '||',
        REGEXP_REPLACE(r.norm_phone_primary, '[^0-9]', '')
    )",
];

// Guard: skip composite rules where any sub-key is empty. We do that by requiring
// that the key contains no leading/trailing empty segment. Cheapest: after runRule,
// filter by regex in PHP.
$nonEmptyComposite = function (string $key): bool {
    foreach (explode('||', $key) as $p) { if ($p === '') return false; }
    return true;
};

$summary = [
    'scanned_rows'  => 0,
    'created'       => 0,
    'updated'       => 0,
    'members_added' => 0,
    'by_type'       => [],
];

$countStmt = $db->prepare("SELECT COUNT(*) $baseFrom WHERE $scopeWhere");
$countStmt->execute($scopeParams);
$summary['scanned_rows'] = (int) $countStmt->fetchColumn();

$upsertGroup = $db->prepare(
    'INSERT INTO lead_duplicate_groups (match_type, match_key, confidence)
     VALUES (:t, :k, :c)
     ON DUPLICATE KEY UPDATE match_key = VALUES(match_key)'
);
$selectGroupId = $db->prepare('SELECT id FROM lead_duplicate_groups WHERE match_type = :t AND match_key = :k');
$insertMember  = $db->prepare('INSERT IGNORE INTO lead_duplicate_group_members (group_id, imported_lead_id) VALUES (:g, :l)');

try {
    $db->beginTransaction();

    foreach ($rules as $type => $keyExpr) {
        $candidates = runRule($db, $baseFrom, $scopeWhere, $scopeParams, $keyExpr);

        $perType = ['candidates' => count($candidates), 'created' => 0, 'updated' => 0, 'members_added' => 0];

        foreach ($candidates as $cand) {
            $k = (string) $cand['key'];
            if (in_array($type, ['address_last_name','name_phone'], true) && !$nonEmptyComposite($k)) {
                continue;
            }

            $upsertGroup->execute([':t' => $type, ':k' => $k, ':c' => DUPLICATE_CONFIDENCE[$type]]);

            // rowCount: 1 on INSERT, 2 on UPDATE for ON DUPLICATE KEY. Existing groups return 2.
            $wasNew = $upsertGroup->rowCount() === 1;

            $selectGroupId->execute([':t' => $type, ':k' => $k]);
            $groupId = (int) $selectGroupId->fetchColumn();

            $membersAddedThisGroup = 0;
            foreach ($cand['ids'] as $lid) {
                $insertMember->execute([':g' => $groupId, ':l' => $lid]);
                if ($insertMember->rowCount() === 1) $membersAddedThisGroup++;
            }

            if ($wasNew) $perType['created']++;
            elseif ($membersAddedThisGroup > 0) $perType['updated']++;
            $perType['members_added'] += $membersAddedThisGroup;
        }

        $summary['created']       += $perType['created'];
        $summary['updated']       += $perType['updated'];
        $summary['members_added'] += $perType['members_added'];
        $summary['by_type'][$type] = $perType;
    }

    $summary['total_groups'] = (int) $db->query('SELECT COUNT(*) FROM lead_duplicate_groups')->fetchColumn();
    $db->commit();
} catch (Throwable $e) {
    $db->rollBack();
    pipelineFail(500, 'Scan failed: ' . $e->getMessage(), 'db_error');
}

echo json_encode(['success' => true, 'summary' => $summary]);

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
                s.tier_override, s.vehicle_color, s.vehicle_odometer,
                s.known_phone_slot,
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
            'tier_override'      => $r['tier_override'],
            'vehicle_color'      => $r['vehicle_color'],
            'vehicle_odometer'   => $r['vehicle_odometer'] !== null ? (int) $r['vehicle_odometer'] : null,
            'known_phone_slot'   => $r['known_phone_slot'],
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
            'tier_override'      => null,
            'vehicle_color'      => null,
            'vehicle_odometer'   => null,
            'known_phone_slot'   => null,
            'assigned_user_id'   => null,
            'assigned_user_name' => null,
        ];
        $lead['labels'] = $labelsByLead[$lid] ?? [];
    }
}

/**
 * Group leads by digit-only phone_primary and attach a `related_count`
 * (other live leads sharing the same number). One round-trip regardless
 * of page size — cheaper than a per-row subquery embedded in the data
 * SQL, and the norm_phone_primary index makes the lookup fast.
 *
 * Leads without a phone get related_count = 0 — we don't match on name
 * alone because that's too noisy at the carfax-import scale.
 */
function attachRelatedCounts(PDO $db, array &$leads): void
{
    if (empty($leads)) return;

    // Collect the canonical phone for every lead on the page.
    $phoneByLead = [];
    foreach ($leads as $l) {
        $raw = $l['normalized_payload']['phone_primary'] ?? null;
        if (!$raw) continue;
        $digits = preg_replace('/[^0-9]/', '', (string) $raw);
        if ($digits === '') continue;
        $phoneByLead[(int) $l['id']] = $digits;
    }
    if (empty($phoneByLead)) {
        foreach ($leads as &$l) $l['related_count'] = 0;
        return;
    }

    // One query: total live leads per phone across the whole table.
    $uniqPhones = array_values(array_unique($phoneByLead));
    $placeholders = implode(',', array_fill(0, count($uniqPhones), '?'));
    $stmt = $db->prepare(
        "SELECT REGEXP_REPLACE(norm_phone_primary, '[^0-9]', '') p, COUNT(*) c
           FROM imported_leads_raw
          WHERE import_status = 'imported'
            AND deleted_at IS NULL
            AND norm_phone_primary IS NOT NULL
            AND REGEXP_REPLACE(norm_phone_primary, '[^0-9]', '') IN ($placeholders)
          GROUP BY p"
    );
    $stmt->execute($uniqPhones);
    $totalByPhone = [];
    foreach ($stmt->fetchAll() as $r) $totalByPhone[(string) $r['p']] = (int) $r['c'];

    foreach ($leads as &$l) {
        $lid = (int) $l['id'];
        $phone = $phoneByLead[$lid] ?? null;
        $l['related_count'] = $phone === null ? 0 : max(0, ($totalByPhone[$phone] ?? 1) - 1);
    }
}

// -- Detail mode: GET /api/leads?id=X --
if (isset($_GET['id'])) {
    $id = (int) $_GET['id'];
    $stmt = $db->prepare(
        'SELECT r.id, r.batch_id, r.source_row_number, r.raw_payload_json, r.normalized_payload_json,
                r.import_status, r.error_message, r.created_at,
                r.deleted_at, r.deleted_by,
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
           LEFT JOIN file_artifacts a ON a.id = b.artifact_id
           JOIN vehicles v            ON v.id = f.vehicle_id
           JOIN users u               ON u.id = b.imported_by
           LEFT JOIN column_mapping_templates t ON t.id = b.mapping_template_id
          WHERE r.id = :id'
    );
    $stmt->execute([':id' => $id]);
    $row = $stmt->fetch();
    if (!$row) pipelineFail(404, 'Lead not found', 'lead_not_found');
    // Archived leads still load fine via detail GET — the drawer needs
    // to show them so an operator can hit "Restore." The list endpoint
    // filters them out by default (see further down).

    $row['raw_payload']        = json_decode($row['raw_payload_json']        ?? 'null', true);
    $row['normalized_payload'] = json_decode($row['normalized_payload_json'] ?? 'null', true);
    $row['mapping']            = json_decode($row['mapping_json']            ?? 'null', true);
    unset($row['raw_payload_json'], $row['normalized_payload_json'], $row['mapping_json']);

    $detailWrapper = [$row];
    attachCrmToLeads($db, $detailWrapper);
    $row = $detailWrapper[0];

    // Sibling vehicles — every other live lead owned by the same person
    // (digit-only phone match against this lead's phone_primary). Returns
    // a compact row per sibling so the drawer can render "Also owns N
    // other vehicles" without an extra round trip. Sorted newest-import
    // first so the most recent intel surfaces at the top.
    $rawPhone = $row['normalized_payload']['phone_primary'] ?? null;
    $row['related_leads'] = [];
    if ($rawPhone) {
        $digits = preg_replace('/[^0-9]/', '', (string) $rawPhone);
        if ($digits !== '') {
            $sibStmt = $db->prepare(
                "SELECT r.id, r.source_row_number, r.normalized_payload_json,
                        b.batch_name, b.imported_at,
                        f.display_name AS file_display_name, f.file_name,
                        s.status AS crm_status, u.name AS assigned_user_name
                   FROM imported_leads_raw r
                   JOIN lead_import_batches b ON b.id = r.batch_id
                   JOIN files f               ON f.id = b.file_id
                   LEFT JOIN lead_states s    ON s.imported_lead_id = r.id
                   LEFT JOIN users u          ON u.id = s.assigned_user_id
                  WHERE r.import_status = 'imported'
                    AND r.deleted_at IS NULL
                    AND r.id <> :self
                    AND r.norm_phone_primary IS NOT NULL
                    AND REGEXP_REPLACE(r.norm_phone_primary, '[^0-9]', '') = :digits
                  ORDER BY b.imported_at DESC, r.source_row_number ASC
                  LIMIT 50"
            );
            $sibStmt->execute([':self' => $id, ':digits' => $digits]);
            foreach ($sibStmt->fetchAll() as $sib) {
                $np = json_decode($sib['normalized_payload_json'] ?? 'null', true) ?: [];
                $row['related_leads'][] = [
                    'id'                 => (int) $sib['id'],
                    'source_row_number'  => (int) $sib['source_row_number'],
                    'vin'                => $np['vin'] ?? null,
                    'year'               => $np['year'] ?? null,
                    'make'               => $np['make'] ?? null,
                    'model'              => $np['model'] ?? null,
                    'mileage'            => $np['mileage'] ?? null,
                    'batch_name'         => $sib['batch_name'],
                    'imported_at'        => $sib['imported_at'],
                    'file_display_name'  => $sib['file_display_name'] ?: $sib['file_name'],
                    'status'             => $sib['crm_status'] ?: 'new',
                    'assigned_user_name' => $sib['assigned_user_name'],
                ];
            }
        }
    }

    // Agents (including acquisition agents) may only view leads
    // assigned to them. Admins and marketers see all.
    $r = $user['role'] ?? null;
    if ($r !== 'admin' && $r !== 'marketer') {
        $assignee = $row['crm_state']['assigned_user_id'] ?? null;
        if ((int) $assignee !== (int) $user['id']) {
            pipelineFail(403, 'Lead not assigned to you', 'lead_forbidden');
        }
    }

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

// Soft-delete filter. Default is "live" leads only; the Archived view
// flips include_archived=1 to show only deleted rows, and admin can
// pass include_archived=both to see everything (used by reports).
$includeArchived = $_GET['include_archived'] ?? '';
if ($includeArchived === '1' || $includeArchived === 'only') {
    $where[] = 'r.deleted_at IS NOT NULL';
} elseif ($includeArchived !== 'both') {
    $where[] = 'r.deleted_at IS NULL';
}

// Empty-contact filter. Roughly half of TLO-imported rows come back
// with no phone / email / name (the TLO lookup failed — VIN field is
// literally "No"). Those rows are noise in the working surface
// because there's no one to call. Default to hiding them; the
// operator can flip include_empty=1 to bring them back for a triage
// pass (e.g. to re-run the TLO step).
//
// A lead is "has contact" if any of these is non-empty:
//   norm_phone_primary, norm_email_primary,
//   phone_secondary, "Phone Number 3", "Phone Number 4",
//   "Email 2" / Email2
//
// CSV exports never filter — admin wants the full set there.
if (!$isCsv) {
    $includeEmpty = $_GET['include_empty'] ?? '';
    if ($includeEmpty !== '1' && $includeEmpty !== 'true') {
        $hasContact = "(
            (r.norm_phone_primary IS NOT NULL AND r.norm_phone_primary <> '')
         OR (r.norm_email_primary IS NOT NULL AND r.norm_email_primary <> '')
         OR (JSON_UNQUOTE(JSON_EXTRACT(r.normalized_payload_json, '\$.phone_secondary')) IS NOT NULL
             AND JSON_UNQUOTE(JSON_EXTRACT(r.normalized_payload_json, '\$.phone_secondary')) <> '')
         OR (JSON_UNQUOTE(JSON_EXTRACT(r.normalized_payload_json, '\$.\"Phone Number 3\"')) IS NOT NULL
             AND JSON_UNQUOTE(JSON_EXTRACT(r.normalized_payload_json, '\$.\"Phone Number 3\"')) <> '')
         OR (JSON_UNQUOTE(JSON_EXTRACT(r.normalized_payload_json, '\$.\"Phone Number 4\"')) IS NOT NULL
             AND JSON_UNQUOTE(JSON_EXTRACT(r.normalized_payload_json, '\$.\"Phone Number 4\"')) <> '')
         OR (JSON_UNQUOTE(JSON_EXTRACT(r.normalized_payload_json, '\$.\"Email 2\"')) IS NOT NULL
             AND JSON_UNQUOTE(JSON_EXTRACT(r.normalized_payload_json, '\$.\"Email 2\"')) <> '')
         OR (JSON_UNQUOTE(JSON_EXTRACT(r.normalized_payload_json, '\$.Email2')) IS NOT NULL
             AND JSON_UNQUOTE(JSON_EXTRACT(r.normalized_payload_json, '\$.Email2')) <> '')
        )";
        $where[] = $hasContact;
    }
}

// Exact IDs
foreach (['batch_id' => 'b.id', 'file_id' => 'b.file_id', 'artifact_id' => 'b.artifact_id', 'vehicle_id' => 'f.vehicle_id'] as $q => $col) {
    if (!empty($_GET[$q])) {
        $where[] = "$col = :$q";
        $params[":$q"] = (int) $_GET[$q];
    }
}

// has_phone=1 restricts to leads with a non-empty primary phone — the
// same definition the Files dashboard's "Assigned %" denominator uses.
// Mirrors the click-through path from "+N todo" on HomeDashboard so
// the destination lead list matches what the percentage is counting.
if (!empty($_GET['has_phone']) && ($_GET['has_phone'] === '1' || $_GET['has_phone'] === 'true')) {
    $where[] = "(r.norm_phone_primary IS NOT NULL AND r.norm_phone_primary <> '')";
}

// Stage
if (!empty($_GET['source_stage'])) {
    assertStage($_GET['source_stage']);
    $where[] = 'b.source_stage = :source_stage';
    $params[':source_stage'] = $_GET['source_stage'];
}

// CRM filters
// lead_states is now ALWAYS joined because the tier expression coalesces
// with s.tier_override. Keep the flag so the variable name stays
// self-documenting at the call site.
$needsStateJoin = true;
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
$userRole    = $user['role'] ?? null;
$isAdmin     = $userRole === 'admin';
$isMarketer  = $userRole === 'marketer';
// Every agent role — including Acquisition Agents (sales_agent) — is
// scoped to leads assigned to them. Admins + marketers see the full
// pool. Acquisition agents are still owner-of-the-lead operators;
// they just don't browse pools that aren't theirs.
$isAgentOnly = !$isAdmin && !$isMarketer;
if ($isAgentOnly) {
    // Agents only ever see leads assigned to them — request params are
    // ignored here.
    $where[] = 's.assigned_user_id = :me';
    $params[':me'] = (int) $user['id'];
    $needsStateJoin = true;
} elseif (isset($_GET['assigned_user_id']) && $_GET['assigned_user_id'] !== '') {
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

// Filter by tier (auto-computed from normalized payload). Accept single value or CSV.
if (isset($_GET['tier']) && $_GET['tier'] !== '') {
    $rawTiers = is_array($_GET['tier']) ? $_GET['tier'] : explode(',', (string) $_GET['tier']);
    $tiers = [];
    foreach ($rawTiers as $t) {
        $t = trim($t);
        if ($t === '') continue;
        assertLeadTier($t);
        $tiers[] = $t;
    }
    if (!empty($tiers)) {
        // Build the predicate directly using the same SQL expression used in SELECT.
        // We can't reference the aliased column in WHERE, so inline the CASE.
        $expr = leadTierSqlExpression('__tier');
        // Strip the "AS __tier" alias for use in WHERE.
        $expr = preg_replace('/\s+AS\s+__tier$/', '', $expr);
        $ph = [];
        foreach ($tiers as $i => $t) {
            $ph[] = ":tier_$i";
            $params[":tier_$i"] = $t;
        }
        $where[] = "$expr IN (" . implode(',', $ph) . ")";
    }
}

// Empty / has-value filter. Lets operators slice by "has a phone", "no
// email", "missing Age", etc. without knowing the exact value.
//
// Param shape (repeatable via CSV):
//   empty_field=phone_primary,email_primary
//   empty_op=is_empty | is_not_empty   (default is_not_empty)
//
// For each field we pick the cheapest expression:
//   - Promoted/indexed columns (vin, phone_primary, email_primary, state,
//     make, model, year) hit norm_* directly.
//   - Everything else falls through to a JSON_EXTRACT on
//     normalized_payload_json (raw payload key, case-sensitive).
//
// Only [A-Za-z0-9_ -] keys are accepted so this can't be coerced into
// SQL injection through the JSON path.
$emptyPromoted = [
    'vin'           => 'r.norm_vin',
    'phone_primary' => 'r.norm_phone_primary',
    'email_primary' => 'r.norm_email_primary',
    'state'         => 'r.norm_state',
    'make'          => 'r.norm_make',
    'model'         => 'r.norm_model',
    'year'          => 'r.norm_year',
];
$emptyOp = ($_GET['empty_op'] ?? 'is_not_empty');
if (!in_array($emptyOp, ['is_empty', 'is_not_empty'], true)) $emptyOp = 'is_not_empty';
if (isset($_GET['empty_field']) && $_GET['empty_field'] !== '') {
    $rawFields = is_array($_GET['empty_field'])
        ? $_GET['empty_field']
        : explode(',', (string) $_GET['empty_field']);
    foreach ($rawFields as $field) {
        $field = trim($field);
        if ($field === '' || !preg_match('/^[A-Za-z0-9_ \-().,;\/=]{1,80}$/', $field)) continue;
        if (isset($emptyPromoted[$field])) {
            $col = $emptyPromoted[$field];
            $where[] = $emptyOp === 'is_empty'
                ? "($col IS NULL OR $col = '')"
                : "($col IS NOT NULL AND $col <> '')";
        } else {
            // Quote the key inside the JSON path so spaces / parens /
            // semicolons (e.g. "Lien Holder (Y/N; If Y, then list out)")
            // are tolerated. MariaDB additionally requires forward slashes
            // to be backslash-escaped inside the path — without that, the
            // path silently matches nothing.
            $escapedKey = str_replace('/', '\\/', $field);
            $path = "'$.\"" . $escapedKey . "\"'";
            $expr = "JSON_UNQUOTE(JSON_EXTRACT(r.normalized_payload_json, $path))";
            $where[] = $emptyOp === 'is_empty'
                ? "($expr IS NULL OR $expr = '')"
                : "($expr IS NOT NULL AND $expr <> '')";
        }
    }
}

// Filter by campaign membership.
if (!empty($_GET['in_campaign_id'])) {
    $where[] = 'EXISTS (SELECT 1 FROM marketing_campaign_recipients mcr WHERE mcr.imported_lead_id = r.id AND mcr.campaign_id = :in_campaign_id)';
    $params[':in_campaign_id'] = (int) $_GET['in_campaign_id'];
}

// NumberOfOwners numeric range — stored as a JSON string in normalized_payload.
$numOwnersExpr = "CAST(JSON_UNQUOTE(JSON_EXTRACT(r.normalized_payload_json, '$.NumberOfOwners')) AS UNSIGNED)";
if (isset($_GET['number_of_owners_min']) && $_GET['number_of_owners_min'] !== '') {
    $where[] = "$numOwnersExpr >= :noo_min";
    $params[':noo_min'] = (int) $_GET['number_of_owners_min'];
}
if (isset($_GET['number_of_owners_max']) && $_GET['number_of_owners_max'] !== '') {
    $where[] = "$numOwnersExpr <= :noo_max";
    $params[':noo_max'] = (int) $_GET['number_of_owners_max'];
}

// Partial normalized fields (LIKE) — inline JSON_UNQUOTE because they aren't
// indexed. JSON_UNQUOTE returns utf8mb4_bin (case-sensitive), so apply an
// explicit case-insensitive collation for predictable name/city matching.
// MariaDB 10.6 quirk: JSON_UNQUOTE returns its result in utf8mb3 regardless
// of the underlying column's charset, so applying `COLLATE utf8mb4_general_ci`
// directly throws ER_COLLATION_CHARSET_MISMATCH (1253). Wrap the output in
// CONVERT(... USING utf8mb4) to force utf8mb4 first, then apply the collation.
// MariaDB 10.10+ already returns utf8mb4 here, so the CONVERT is a no-op there.
$jsonCi = fn($field) => "CONVERT(JSON_UNQUOTE(JSON_EXTRACT(r.normalized_payload_json, '$." . $field . "')) USING utf8mb4) COLLATE utf8mb4_general_ci";
$likeCols = [
    'first_name'  => $jsonCi('first_name'),
    'last_name'   => $jsonCi('last_name'),
    'full_name'   => $jsonCi('full_name'),
    'city'        => $jsonCi('city'),
    'zip_code'    => $jsonCi('zip_code'),
];
foreach ($likeCols as $q => $expr) {
    if (isset($_GET[$q]) && $_GET[$q] !== '') {
        $where[] = "$expr LIKE :$q";
        $params[":$q"] = '%' . $_GET[$q] . '%';
    }
}

// Trim is stored verbatim inside normalized_payload_json as "Trim".
// Exact match (case-insensitive via the collation override) so picking
// from the filter dropdown returns a deterministic set.
if (isset($_GET['trim']) && $_GET['trim'] !== '') {
    $where[] = $jsonCi('Trim') . ' = :trim';
    $params[':trim'] = $_GET['trim'];
}

// Global search across every field connected to a lead. JSON-extracted text
// is utf8mb4_bin (case-sensitive); apply utf8mb4_general_ci so "john" matches
// "John Smith". The norm_* columns inherit the table's case-insensitive
// collation already, so they don't need an explicit COLLATE.
// Phones get a digit-only variant so "(555) 123-4567" matches "5551234567".
//
// Coverage:
//   - VIN (norm + raw payload)
//   - All 4 phone slots (primary indexed column + 3 JSON-payload slots),
//     each searched as raw text AND as digit-stripped so "(555) 123-4567"
//     matches "5551234567"
//   - Both email slots (norm_email_primary + Email2 from CarFax)
//   - Names (first / last / full / CarFax MostRecentOwner)
//   - Address fields (full_address / city / state / zip)
//   - Vehicle facets (make / model / year / Trim)
//   - Cross-table: lead_notes content, lead_labels names, attached
//     bill_of_sale buyer/seller fields. Done via EXISTS subqueries so
//     they don't break the list-mode JOINs above.
if (isset($_GET['q']) && $_GET['q'] !== '') {
    $qRaw    = (string) $_GET['q'];
    $qDigits = preg_replace('/[^0-9]/', '', $qRaw);

    $textCols = [
        // Vehicle identity
        'r.norm_vin',
        'r.norm_make',
        'r.norm_model',
        'CAST(r.norm_year AS CHAR)',
        $jsonCi('Trim'),
        // Names
        $jsonCi('first_name'),
        $jsonCi('last_name'),
        $jsonCi('full_name'),
        $jsonCi('MostRecentOwner'),
        // Emails (both slots)
        'r.norm_email_primary',
        $jsonCi('Email2'),
        // Address
        $jsonCi('full_address'),
        $jsonCi('city'),
        $jsonCi('zip_code'),
        'r.norm_state',
        // Phones — raw text match (handles e.g. "+15551234567" lookups)
        'r.norm_phone_primary',
        $jsonCi('phone_secondary'),
        $jsonCi('phone_3'),
        $jsonCi('phone_4'),
    ];
    // Use a unique placeholder per OR clause. PDO with native prepares
    // (ATTR_EMULATE_PREPARES=false) treats each placeholder occurrence as a
    // distinct bind point — reusing the same `:q` produced HY093 here even
    // though it works for some queries.
    $ors = [];
    $like = '%' . $qRaw . '%';
    foreach ($textCols as $i => $col) {
        $ph = ":q$i";
        $ors[] = "$col LIKE $ph";
        $params[$ph] = $like;
    }

    // Digit-only phone variant — applied to all 4 phone slots. Lets
    // operators search "5551234567" or "555-123-4567" interchangeably.
    if ($qDigits !== '') {
        $phoneCols = [
            "REGEXP_REPLACE(r.norm_phone_primary, '[^0-9]', '')",
            "REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(r.normalized_payload_json, '\$.phone_secondary')), '[^0-9]', '')",
            "REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(r.normalized_payload_json, '\$.phone_3')),         '[^0-9]', '')",
            "REGEXP_REPLACE(JSON_UNQUOTE(JSON_EXTRACT(r.normalized_payload_json, '\$.phone_4')),         '[^0-9]', '')",
        ];
        foreach ($phoneCols as $i => $col) {
            $ph = ":qd$i";
            $ors[] = "$col LIKE $ph";
            $params[$ph] = '%' . $qDigits . '%';
        }
    }

    // Cross-table coverage — wrapped in EXISTS so they don't fan-out
    // the row count for leads with many notes / labels.
    //
    // NOTE: with PDO native prepares (ATTR_EMULATE_PREPARES=false), bound
    // parameters arrive as MYSQL_TYPE_VAR_STRING with the *binary* charset,
    // regardless of the connection's `charset=utf8mb4` setting. Applying
    // `COLLATE utf8mb4_general_ci` to a bound parameter therefore throws
    // ER_COLLATION_CHARSET_MISMATCH (1253). Put the COLLATE on the column
    // side instead — the columns are already utf8mb4, so this gives us the
    // case-insensitive comparison without crossing a binary/utf8mb4 boundary.
    //
    // Notes content. Catches "the buyer said he wants $30k" type queries.
    $ors[] = 'EXISTS (SELECT 1 FROM lead_notes ln WHERE ln.imported_lead_id = r.id AND ln.note COLLATE utf8mb4_general_ci LIKE :q_note)';
    $params[':q_note'] = $like;

    // Label names. Catches operator-set tags like "hot weekend list".
    $ors[] = 'EXISTS (SELECT 1 FROM lead_label_links lll JOIN lead_labels lbl ON lbl.id = lll.label_id WHERE lll.imported_lead_id = r.id AND lbl.name COLLATE utf8mb4_general_ci LIKE :q_label)';
    $params[':q_label'] = $like;

    // Attached Bill of Sale fields — buyer + seller name/address.
    $ors[] = 'EXISTS (SELECT 1 FROM bill_of_sale bos WHERE bos.imported_lead_id = r.id
              AND (bos.buyer_name    COLLATE utf8mb4_general_ci LIKE :q_bos_bn
                OR bos.buyer_address COLLATE utf8mb4_general_ci LIKE :q_bos_ba
                OR bos.seller_name   COLLATE utf8mb4_general_ci LIKE :q_bos_sn))';
    $params[':q_bos_bn'] = $like;
    $params[':q_bos_ba'] = $like;
    $params[':q_bos_sn'] = $like;

    $where[] = '(' . implode(' OR ', $ors) . ')';
}

$whereSql = implode(' AND ', $where);

$baseFrom = 'FROM imported_leads_raw r
             JOIN lead_import_batches b ON b.id = r.batch_id
             JOIN files f               ON f.id = b.file_id
             LEFT JOIN file_artifacts a ON a.id = b.artifact_id
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
try {
    $stmt = $db->prepare($countSql);
    $stmt->execute($params);
    $total = (int) $stmt->fetchColumn();
} catch (PDOException $e) {
    pipelineFail(500, 'Leads query failed: ' . $e->getMessage(), 'leads_query_failed');
}

// Preview-count mode: used by the marketing composer to show a live recipient
// estimate without paying to fetch full rows. Also returns quick per-channel
// reachability counts so the UI can surface "X leads have an email".
if (!empty($_GET['preview_count'])) {
    $reachWhere  = $where;
    $reachWhere[] = "JSON_UNQUOTE(JSON_EXTRACT(r.normalized_payload_json, '$.email_primary')) IS NOT NULL
                     AND JSON_UNQUOTE(JSON_EXTRACT(r.normalized_payload_json, '$.email_primary')) <> ''";
    $sqlE = "SELECT COUNT(*) $baseFrom WHERE " . implode(' AND ', $reachWhere);
    $st = $db->prepare($sqlE);
    $st->execute($params);
    $withEmail = (int) $st->fetchColumn();

    $reachWhereP  = $where;
    $reachWhereP[] = "JSON_UNQUOTE(JSON_EXTRACT(r.normalized_payload_json, '$.phone_primary')) IS NOT NULL
                      AND JSON_UNQUOTE(JSON_EXTRACT(r.normalized_payload_json, '$.phone_primary')) <> ''";
    $sqlP = "SELECT COUNT(*) $baseFrom WHERE " . implode(' AND ', $reachWhereP);
    $st = $db->prepare($sqlP);
    $st->execute($params);
    $withPhone = (int) $st->fetchColumn();

    echo json_encode([
        'total'              => $total,
        'reachable_by_email' => $withEmail,
        'reachable_by_phone' => $withPhone,
    ]);
    exit();
}

// Sort — operator picks one or two column headers in the table. Default
// keeps the historical order (newest imports first, then row order inside
// a batch). Multi-column sort lets the user "look at the newest McLarens
// AND sort by Age desc" without losing the batch grouping.
//
// Param shape:
//   sort=Age              dir=desc                  (single)
//   sort=tier,Age         dir=asc,desc              (multi — paired by index)
//   sort=Age              dir=asc                   (single)
//
// Native columns and indexed norm_* fields are sorted directly. Anything
// else is read out of normalized_payload_json with a numeric CAST so "Age"
// / "NumberOfOwners" / "ServiceRecordCount" sort like numbers even though
// JSON stores them as strings. Trailing comma strip handles "154,123".

$rawSort = isset($_GET['sort']) ? trim((string) $_GET['sort']) : '';
$rawDir  = (string) ($_GET['dir'] ?? '');
$sortFields = $rawSort === '' ? [] : array_values(array_filter(array_map('trim', explode(',', $rawSort)), fn($s) => $s !== ''));
$sortDirs   = $rawDir  === '' ? [] : array_map('strtolower', array_map('trim', explode(',', $rawDir)));
// Cap at 2 sort keys — anything beyond is operator fat-finger or abuse.
if (count($sortFields) > 2) $sortFields = array_slice($sortFields, 0, 2);

// Workflow-ordered sort for status: instead of alphabetical
// (callback / contacted / deal_closed / ...), order by where the
// lead sits in the operational pipeline so a "sort by Status" pass
// surfaces actionable rows (new, contacted, callback, interested)
// at the top and terminal / cold states (disqualified, do_not_call)
// at the bottom. NULL status (rows without a lead_states row yet)
// is grouped with 'new' since that's effectively what they are.
// Mirrors the src/lib/crm.js LEAD_STATUSES array order.
$statusOrderSql =
    "FIELD(COALESCE(s.status,'new'),"
    . "'new','contacted','callback','interested',"
    . "'verbal_commitment','pending_close',"
    . "'value_gap','no_answer','voicemail_left','wrong_number','not_interested',"
    . "'nurture','marketing','deal_closed','disqualified','do_not_call'"
    . ")";

$nativeSorts = [
    'imported_at'       => 'b.imported_at',
    'created_at'        => 'r.created_at',
    'source_row_number' => 'r.source_row_number',
    'vin'               => 'r.norm_vin',
    'phone_primary'     => 'r.norm_phone_primary',
    'email_primary'     => 'r.norm_email_primary',
    'state'             => 'r.norm_state',
    'make'              => 'r.norm_make',
    'model'             => 'r.norm_model',
    'year'              => 'r.norm_year',
    'tier'              => 'tier',
    'status'            => $statusOrderSql,
    'priority'          => 's.priority',
    'lead_temperature'  => 's.lead_temperature',
    'price_wanted'      => 's.price_wanted',
    'price_offered'     => 's.price_offered',
    'batch_name'        => 'b.batch_name',
    'source_file'       => 'f.display_name',
];

$orderParts = [];
foreach ($sortFields as $i => $field) {
    $dir = $sortDirs[$i] ?? ($sortDirs[0] ?? 'desc');
    if (!in_array($dir, ['asc', 'desc'], true)) $dir = 'desc';
    $dirSql = strtoupper($dir);

    if (isset($nativeSorts[$field])) {
        // tier is the aliased CASE — MySQL accepts the alias in ORDER BY.
        $orderParts[] = $nativeSorts[$field] . " $dirSql";
    } elseif (preg_match('/^[A-Za-z0-9_ \-().,;\/=]{1,80}$/', $field)) {
        // Dynamic JSON-payload sort. Numeric cast (DECIMAL handles ints
        // + floats). Empty / unparseable values land last regardless of
        // direction so the top of a "highest Age" sort is always real
        // data. Tiebreaker by text so identical numerics stay stable.
        // Forward slash must be backslash-escaped for MariaDB's JSON path
        // parser (matches the empty_field builder above).
        $escapedKey = str_replace('/', '\\/', $field);
        $path = "'$.\"" . $escapedKey . "\"'";
        $rawExpr = "JSON_UNQUOTE(JSON_EXTRACT(r.normalized_payload_json, $path))";
        $numExpr = "CAST(REPLACE(REPLACE($rawExpr, ',', ''), ' ', '') AS DECIMAL(20,2))";
        $orderParts[] = "($numExpr IS NULL) ASC";
        $orderParts[] = "$numExpr $dirSql";
        $orderParts[] = "$rawExpr $dirSql";
    }
    // Unknown field → silently skip; falls back to default tail below.
}
// Always include a stable tail so paging through identical rows doesn't
// re-order between page hits.
$orderParts[] = "b.imported_at DESC";
$orderParts[] = "r.source_row_number ASC";
$orderBy = implode(', ', $orderParts);

// Page rows. Include the computed `tier` column so frontends don't need to
// re-derive it from the normalized payload.
$tierExpr = leadTierSqlExpression('tier');
$dataSql = "SELECT r.id, r.batch_id, r.source_row_number, r.normalized_payload_json, r.created_at,
                   b.batch_name, b.source_stage, b.imported_at,
                   f.id AS file_id, f.display_name AS file_display_name, f.file_name,
                   a.id AS artifact_id, a.original_filename AS artifact_name,
                   v.id AS vehicle_id, v.name AS vehicle_name,
                   u.name AS imported_by_name,
                   $tierExpr
            $baseFrom
            WHERE $whereSql
            ORDER BY $orderBy
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
attachRelatedCounts($db, $leads);

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

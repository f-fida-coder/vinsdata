<?php
// Deal — acquisition + resale tracking. One row per lead (1:1).
//
// GET ?lead_id=X       — return the deal (or null if no row exists yet)
// POST / PUT / PATCH   — upsert on (imported_lead_id). Caller passes lead_id
//                        plus any subset of the deal fields to update.

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/pipeline.php';
initSession();

$user = requireAuth();
$db   = getDBConnection();

const DEAL_FIELDS = [
    'purchase_price', 'transport_cost', 'selling_fees', 'other_cost',
    'purchase_date', 'listed_date', 'sold_date',
    'sale_price', 'buyer_name', 'buyer_notes',
    'notes',
];
const DEAL_DECIMAL_FIELDS = ['purchase_price', 'transport_cost', 'selling_fees', 'other_cost', 'sale_price'];
const DEAL_DATE_FIELDS    = ['purchase_date', 'listed_date', 'sold_date'];

function formatDeal(?array $row): ?array
{
    if (!$row) return null;
    foreach (DEAL_DECIMAL_FIELDS as $f) {
        $row[$f] = $row[$f] === null ? null : (float) $row[$f];
    }
    foreach (['id', 'imported_lead_id', 'created_by'] as $f) {
        if (isset($row[$f])) $row[$f] = $row[$f] === null ? null : (int) $row[$f];
    }
    // Days on market (computed): sold - listed, or sold - purchase as a
    // fallback if the team skipped a separate list date.
    $row['days_on_market'] = null;
    if (!empty($row['sold_date'])) {
        $end = new DateTimeImmutable($row['sold_date']);
        $startStr = $row['listed_date'] ?: $row['purchase_date'];
        if ($startStr) {
            $start = new DateTimeImmutable($startStr);
            $row['days_on_market'] = max(0, (int) $end->diff($start)->format('%a'));
        }
    }
    // Net profit: sale_price - sum(costs). Null until sale is recorded.
    $row['net_profit'] = null;
    if (isset($row['sale_price']) && $row['sale_price'] !== null) {
        $costs = 0.0;
        foreach (['purchase_price', 'transport_cost', 'selling_fees', 'other_cost'] as $cf) {
            if ($row[$cf] !== null) $costs += (float) $row[$cf];
        }
        $row['net_profit'] = (float) $row['sale_price'] - $costs;
    }
    return $row;
}

function readDealForLead(PDO $db, int $leadId): ?array
{
    $stmt = $db->prepare('SELECT * FROM deals WHERE imported_lead_id = :lead');
    $stmt->execute([':lead' => $leadId]);
    $row = $stmt->fetch();
    return $row ?: null;
}

function assertLeadExists(PDO $db, int $leadId): void
{
    $stmt = $db->prepare('SELECT id FROM imported_leads_raw WHERE id = :id');
    $stmt->execute([':id' => $leadId]);
    if (!$stmt->fetch()) {
        pipelineFail(404, 'Lead not found', 'lead_not_found');
    }
}

function normalizeDealInput(array $input): array
{
    $patch = [];
    foreach (DEAL_FIELDS as $field) {
        if (!array_key_exists($field, $input)) continue;
        $value = $input[$field];

        if ($value === '' || $value === null) {
            $patch[$field] = null;
            continue;
        }

        if (in_array($field, DEAL_DECIMAL_FIELDS, true)) {
            if (!is_numeric($value)) {
                pipelineFail(400, "$field must be numeric", 'invalid_field');
            }
            $patch[$field] = round((float) $value, 2);
        } elseif (in_array($field, DEAL_DATE_FIELDS, true)) {
            // Accept YYYY-MM-DD; reject anything else.
            if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $value)) {
                pipelineFail(400, "$field must be a YYYY-MM-DD date", 'invalid_field');
            }
            $patch[$field] = $value;
        } else {
            $patch[$field] = is_string($value) ? trim($value) : (string) $value;
        }
    }
    return $patch;
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $leadId = (int) ($_GET['lead_id'] ?? 0);
    if ($leadId <= 0) pipelineFail(400, 'lead_id is required', 'missing_fields');
    assertLeadExists($db, $leadId);
    $deal = readDealForLead($db, $leadId);
    echo json_encode(['success' => true, 'deal' => formatDeal($deal)]);
    exit();
}

if (in_array($_SERVER['REQUEST_METHOD'], ['POST', 'PUT', 'PATCH'], true)) {
    $input = json_decode(file_get_contents('php://input'), true) ?? [];
    $leadId = (int) ($input['lead_id'] ?? 0);
    if ($leadId <= 0) pipelineFail(400, 'lead_id is required', 'missing_fields');
    assertLeadExists($db, $leadId);

    $patch = normalizeDealInput($input);

    $existing = readDealForLead($db, $leadId);

    if (!$existing) {
        // Insert: every column starts at NULL unless the patch sets it.
        $cols = ['imported_lead_id', 'created_by'];
        $vals = [':lead', ':user'];
        $params = [':lead' => $leadId, ':user' => $user['id']];
        foreach ($patch as $f => $v) {
            $cols[] = $f;
            $vals[] = ':' . $f;
            $params[':' . $f] = $v;
        }
        $sql = 'INSERT INTO deals (' . implode(', ', $cols) . ') VALUES (' . implode(', ', $vals) . ')';
        $stmt = $db->prepare($sql);
        $stmt->execute($params);
    } else {
        if (empty($patch)) {
            // No changes — return the existing deal unchanged.
            echo json_encode(['success' => true, 'deal' => formatDeal($existing)]);
            exit();
        }
        $set = [];
        $params = [':lead' => $leadId];
        foreach ($patch as $f => $v) {
            $set[] = "$f = :$f";
            $params[':' . $f] = $v;
        }
        $sql = 'UPDATE deals SET ' . implode(', ', $set) . ' WHERE imported_lead_id = :lead';
        $stmt = $db->prepare($sql);
        $stmt->execute($params);
    }

    $deal = readDealForLead($db, $leadId);
    echo json_encode(['success' => true, 'deal' => formatDeal($deal)]);
    exit();
}

pipelineFail(405, 'Method not allowed', 'method_not_allowed');

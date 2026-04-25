<?php
// Filter rule engine helpers — predicate definition, evaluation, persistence.
//
// The evaluator runs against a lead's normalized data. Rules may read from
// either the generated norm_* columns on imported_leads_raw (fast, indexed)
// or from the JSON payload (slower, flexible). FILTER_RULE_FIELDS declares
// which fields are readable and from which source.
//
// Writes to filter_rule_results only for matches (rejected or flagged). A
// lead with no filter_rule_results row after evaluation is considered to
// have passed all active rules. Review decisions for flagged rows are
// recorded back on the same filter_rule_results row via review_status.

require_once __DIR__ . '/pipeline.php';

const FILTER_RULE_FIELDS = [
    'vin'              => ['type' => 'string', 'source' => 'norm'],
    'phone_primary'    => ['type' => 'string', 'source' => 'norm'],
    'email_primary'    => ['type' => 'string', 'source' => 'norm'],
    'state'            => ['type' => 'string', 'source' => 'norm'],
    'make'             => ['type' => 'string', 'source' => 'norm'],
    'model'            => ['type' => 'string', 'source' => 'norm'],
    'year'             => ['type' => 'number', 'source' => 'norm'],
    'mileage'          => ['type' => 'number', 'source' => 'payload'],
    'number_of_owners' => ['type' => 'number', 'source' => 'payload'],
    'title_brand'      => ['type' => 'string', 'source' => 'payload'],
    'city'             => ['type' => 'string', 'source' => 'payload'],
    'zip_code'         => ['type' => 'string', 'source' => 'payload'],
];

const FILTER_RULE_OPS = [
    'eq', 'neq', 'lt', 'gt', 'lte', 'gte',
    'in', 'not_in',
    'contains', 'starts_with',
    'is_null', 'is_not_null',
];

function assertValidPredicate(array $p): void
{
    $field = $p['field'] ?? null;
    $op    = $p['op'] ?? null;

    if (!is_string($field) || !array_key_exists($field, FILTER_RULE_FIELDS)) {
        pipelineFail(400, "Unknown predicate field '$field'", 'invalid_predicate');
    }
    if (!is_string($op) || !in_array($op, FILTER_RULE_OPS, true)) {
        pipelineFail(400, "Unknown predicate op '$op'", 'invalid_predicate');
    }

    $needsValue = !in_array($op, ['is_null', 'is_not_null'], true);
    if ($needsValue && !array_key_exists('value', $p)) {
        pipelineFail(400, "Predicate op '$op' requires a value", 'invalid_predicate');
    }
    if (in_array($op, ['in', 'not_in'], true) && !is_array($p['value'] ?? null)) {
        pipelineFail(400, "Predicate op '$op' requires an array value", 'invalid_predicate');
    }
}

/**
 * Resolve a predicate field's value against a loaded lead row. $row should
 * include the generated norm_* columns and a decoded normalized_payload
 * (or normalized_payload_json, which will be decoded lazily).
 *
 * Returns null when the field is missing or empty.
 */
function readFilterFieldValue(array $row, string $field): ?string
{
    $meta = FILTER_RULE_FIELDS[$field] ?? null;
    if ($meta === null) return null;

    if ($meta['source'] === 'norm') {
        $column = 'norm_' . $field;
        $value = $row[$column] ?? null;
    } else {
        // payload source
        $payload = $row['normalized_payload'] ?? null;
        if ($payload === null && isset($row['normalized_payload_json'])) {
            $payload = json_decode((string) $row['normalized_payload_json'], true) ?: [];
        }
        $value = is_array($payload) ? ($payload[$field] ?? null) : null;
    }

    if ($value === null) return null;
    $str = is_string($value) ? $value : (string) $value;
    if (trim($str) === '') return null;
    return $str;
}

/** Evaluate a single predicate against a field value. Pure function. */
function evaluatePredicate(?string $value, string $op, $expected): bool
{
    if ($op === 'is_null')     return $value === null || $value === '';
    if ($op === 'is_not_null') return $value !== null && $value !== '';

    // null never matches any non-null predicate.
    if ($value === null) return false;

    switch ($op) {
        case 'eq':
            return strcasecmp($value, (string) $expected) === 0;
        case 'neq':
            return strcasecmp($value, (string) $expected) !== 0;
        case 'lt':
            return is_numeric($value) && is_numeric($expected) && ((float) $value <  (float) $expected);
        case 'gt':
            return is_numeric($value) && is_numeric($expected) && ((float) $value >  (float) $expected);
        case 'lte':
            return is_numeric($value) && is_numeric($expected) && ((float) $value <= (float) $expected);
        case 'gte':
            return is_numeric($value) && is_numeric($expected) && ((float) $value >= (float) $expected);
        case 'in':
            if (!is_array($expected)) return false;
            foreach ($expected as $cand) if (strcasecmp($value, (string) $cand) === 0) return true;
            return false;
        case 'not_in':
            if (!is_array($expected)) return false;
            foreach ($expected as $cand) if (strcasecmp($value, (string) $cand) === 0) return false;
            return true;
        case 'contains':
            return is_string($expected) && stripos($value, $expected) !== false;
        case 'starts_with':
            return is_string($expected) && stripos($value, $expected) === 0;
    }
    return false;
}

/** Load all active filter rules, decoded. */
function loadActiveFilterRules(PDO $db): array
{
    $stmt = $db->query(
        'SELECT id, name, predicate_json, action
           FROM filter_rules
          WHERE active = 1
          ORDER BY id'
    );
    $rules = [];
    foreach ($stmt->fetchAll() as $r) {
        $rules[] = [
            'id'        => (int) $r['id'],
            'name'      => $r['name'],
            'predicate' => json_decode((string) $r['predicate_json'], true) ?: [],
            'action'    => $r['action'],
        ];
    }
    return $rules;
}

/**
 * Evaluate active rules against a single lead row and persist matches.
 *
 * $leadRow must include: id, norm_vin, norm_phone_primary, norm_email_primary,
 *   norm_state, norm_make, norm_model, norm_year, and either
 *   normalized_payload (array) or normalized_payload_json (string).
 *
 * Returns ['verdict' => 'passed'|'flagged'|'rejected', 'matches' => [...]].
 * Previously-recorded results for the lead are cleared before the new run
 * so re-evaluation stays idempotent.
 */
function evaluateFilterRulesForLead(PDO $db, array $leadRow, array $rules = null): array
{
    $rules = $rules ?? loadActiveFilterRules($db);
    $leadId = (int) $leadRow['id'];

    $matches = [];
    $rejected = false;
    $flagged = false;

    foreach ($rules as $rule) {
        $p = $rule['predicate'];
        $field = $p['field'] ?? null;
        $op    = $p['op'] ?? null;
        if (!$field || !$op) continue;
        $value = readFilterFieldValue($leadRow, $field);
        $expected = $p['value'] ?? null;
        if (!evaluatePredicate($value, $op, $expected)) continue;

        $resultKind = $rule['action'] === 'reject' ? 'rejected' : 'flagged';
        if ($resultKind === 'rejected') $rejected = true; else $flagged = true;

        $matches[] = [
            'rule_id'   => $rule['id'],
            'rule_name' => $rule['name'],
            'action'    => $rule['action'],
            'result'    => $resultKind,
        ];
    }

    // Replace prior results for this lead so a re-run is clean. Review decisions
    // on the old rows are lost intentionally — re-evaluation means reset.
    $del = $db->prepare('DELETE FROM filter_rule_results WHERE imported_lead_id = :id');
    $del->execute([':id' => $leadId]);

    if ($matches) {
        $ins = $db->prepare(
            'INSERT INTO filter_rule_results (imported_lead_id, rule_id, result, review_status)
             VALUES (:lead, :rule, :result, :review)'
        );
        foreach ($matches as $m) {
            $ins->execute([
                ':lead'   => $leadId,
                ':rule'   => $m['rule_id'],
                ':result' => $m['result'],
                ':review' => $m['result'] === 'flagged' ? 'pending' : null,
            ]);
        }
    }

    $verdict = $rejected ? 'rejected' : ($flagged ? 'flagged' : 'passed');
    return ['verdict' => $verdict, 'matches' => $matches];
}

/**
 * Run the evaluator against every imported lead tied to a file's carfax-stage
 * artifact. Used by advance.php when a file moves carfax -> filter, and
 * available as a manual admin action.
 *
 * Returns a summary: how many leads evaluated, how many rejected/flagged.
 */
function evaluateFilterRulesForFile(PDO $db, int $fileId): array
{
    $stmt = $db->prepare(
        "SELECT r.id,
                r.norm_vin, r.norm_phone_primary, r.norm_email_primary,
                r.norm_state, r.norm_make, r.norm_model, r.norm_year,
                r.normalized_payload_json
           FROM imported_leads_raw r
           JOIN lead_import_batches b ON b.id = r.batch_id
          WHERE b.file_id = :fid
            AND b.source_stage = 'carfax'
            AND r.import_status = 'imported'"
    );
    $stmt->execute([':fid' => $fileId]);

    $rules = loadActiveFilterRules($db);
    $counts = ['evaluated' => 0, 'passed' => 0, 'flagged' => 0, 'rejected' => 0];

    while ($row = $stmt->fetch()) {
        $result = evaluateFilterRulesForLead($db, $row, $rules);
        $counts['evaluated']++;
        $counts[$result['verdict']]++;
    }

    return $counts;
}

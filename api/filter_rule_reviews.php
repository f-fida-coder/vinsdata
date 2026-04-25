<?php
// Manual review queue for leads flagged by the VIN Filter rule engine.
//
// GET  — list flagged results with lead + rule context. Default status=pending.
// POST — record a review decision (accept or reject) on one flagged result.

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/pipeline.php';
initSession();

$user = requireAuth();
$db   = getDBConnection();

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $status = $_GET['status'] ?? 'pending';
    if (!in_array($status, ['pending', 'accepted', 'rejected', 'all'], true)) {
        pipelineFail(400, "Invalid status '$status'", 'invalid_status');
    }

    $limit  = max(1, min(200, (int) ($_GET['limit']  ?? 50)));
    $offset = max(0, (int) ($_GET['offset'] ?? 0));

    $where = "fr.result = 'flagged'";
    $params = [];
    if ($status !== 'all') {
        $where .= ' AND fr.review_status = :status';
        $params[':status'] = $status;
    }

    $countStmt = $db->prepare("SELECT COUNT(*) FROM filter_rule_results fr WHERE $where");
    $countStmt->execute($params);
    $total = (int) $countStmt->fetchColumn();

    $sql = "
        SELECT fr.id               AS result_id,
               fr.imported_lead_id AS lead_id,
               fr.rule_id,
               fr.result,
               fr.review_status,
               fr.reviewed_by,
               fr.reviewed_at,
               fr.created_at,
               reviewer.name       AS reviewer_name,
               rule.name           AS rule_name,
               rule.action         AS rule_action,
               r.norm_vin, r.norm_make, r.norm_model, r.norm_year,
               r.norm_state, r.norm_phone_primary, r.norm_email_primary,
               r.normalized_payload_json,
               r.batch_id,
               b.batch_name, b.file_id,
               f.display_name AS file_display_name
          FROM filter_rule_results fr
          JOIN filter_rules rule         ON rule.id = fr.rule_id
          JOIN imported_leads_raw r      ON r.id    = fr.imported_lead_id
          JOIN lead_import_batches b     ON b.id    = r.batch_id
          JOIN files f                   ON f.id    = b.file_id
          LEFT JOIN users reviewer       ON reviewer.id = fr.reviewed_by
         WHERE $where
         ORDER BY fr.created_at DESC, fr.id DESC
         LIMIT $limit OFFSET $offset
    ";
    $stmt = $db->prepare($sql);
    $stmt->execute($params);

    $rows = [];
    foreach ($stmt->fetchAll() as $row) {
        $payload = json_decode((string) ($row['normalized_payload_json'] ?? 'null'), true);
        unset($row['normalized_payload_json']);
        $row['normalized_payload'] = is_array($payload) ? $payload : [];
        $rows[] = $row;
    }

    echo json_encode([
        'success' => true,
        'reviews' => $rows,
        'total'   => $total,
        'limit'   => $limit,
        'offset'  => $offset,
    ]);
    exit();
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $input = json_decode(file_get_contents('php://input'), true) ?? [];

    $resultId = (int) ($input['result_id'] ?? 0);
    $decision = $input['decision'] ?? null;

    if ($resultId <= 0) {
        pipelineFail(400, 'result_id is required', 'missing_fields');
    }
    if (!in_array($decision, ['accept', 'reject'], true)) {
        pipelineFail(400, "decision must be 'accept' or 'reject'", 'invalid_decision');
    }

    $stmt = $db->prepare('SELECT id, result, review_status FROM filter_rule_results WHERE id = :id');
    $stmt->execute([':id' => $resultId]);
    $existing = $stmt->fetch();
    if (!$existing) pipelineFail(404, 'Result not found', 'result_not_found');
    if ($existing['result'] !== 'flagged') {
        pipelineFail(409, 'Only flagged results can be reviewed', 'not_flagged');
    }

    $nextStatus = $decision === 'accept' ? 'accepted' : 'rejected';

    $upd = $db->prepare(
        'UPDATE filter_rule_results
            SET review_status = :s,
                reviewed_by   = :u,
                reviewed_at   = NOW()
          WHERE id = :id'
    );
    $upd->execute([
        ':s'  => $nextStatus,
        ':u'  => $user['id'],
        ':id' => $resultId,
    ]);

    echo json_encode(['success' => true, 'review_status' => $nextStatus]);
    exit();
}

pipelineFail(405, 'Method not allowed', 'method_not_allowed');

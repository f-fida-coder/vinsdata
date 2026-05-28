<?php
// Investor ↔ car linkages.
//
//   GET    /api/investor_leads?investor_id=X → cars this investor backs
//   GET    /api/investor_leads?lead_id=X     → investors backing this car
//   POST   /api/investor_leads               → link investor to car
//                                              { investor_id, lead_id,
//                                                investment_amount?, share_pct?, notes? }
//   PUT    /api/investor_leads               → update terms (body.id)
//   DELETE /api/investor_leads               → remove linkage (body.id)
//
// Admin-only. The JV-agreement send flow lives in /api/jv_agreement (next).

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/pipeline.php';
initSession();

$user = requireAuth();
if (($user['role'] ?? null) !== 'admin') {
    pipelineFail(403, 'Investor linkage is admin-only', 'admin_required');
}
$db = getDBConnection();

function formatInvestorLead(array $r): array
{
    return [
        'id'                 => (int) $r['id'],
        'investor_id'        => (int) $r['investor_id'],
        'investor_name'      => $r['investor_name'] ?? null,
        'investor_email'     => $r['investor_email'] ?? null,
        'investor_entity'    => $r['investor_entity'] ?? null,
        'imported_lead_id'   => (int) $r['imported_lead_id'],
        'lead_name'          => $r['lead_name'] ?? null,
        'lead_vehicle'       => $r['lead_vehicle'] ?? null,
        'lead_vin'           => $r['lead_vin'] ?? null,
        'investment_amount'  => $r['investment_amount'] !== null ? (float) $r['investment_amount'] : null,
        'share_pct'          => $r['share_pct']         !== null ? (float) $r['share_pct']         : null,
        'notes'              => $r['notes'],
        'jv_status'          => $r['jv_status'],
        'jv_sent_at'         => $r['jv_sent_at'],
        'jv_signed_at'       => $r['jv_signed_at'],
        'jv_opensign_doc_id' => $r['jv_opensign_doc_id'],
        'jv_pdf_path'        => $r['jv_pdf_path'],
        'created_at'         => $r['created_at'],
        'updated_at'         => $r['updated_at'],
    ];
}

$method = $_SERVER['REQUEST_METHOD'];

// Shared SELECT — joins investor + lead context so the UI doesn't fan out.
$baseSelect = "
    SELECT il.*,
           inv.name        AS investor_name,
           inv.email       AS investor_email,
           inv.entity_name AS investor_entity,
           JSON_UNQUOTE(JSON_EXTRACT(r.normalized_payload_json, '\$.full_name')) AS lead_name,
           CONCAT_WS(' ',
               JSON_UNQUOTE(JSON_EXTRACT(r.normalized_payload_json, '\$.year')),
               JSON_UNQUOTE(JSON_EXTRACT(r.normalized_payload_json, '\$.make')),
               JSON_UNQUOTE(JSON_EXTRACT(r.normalized_payload_json, '\$.model'))
           ) AS lead_vehicle,
           JSON_UNQUOTE(JSON_EXTRACT(r.normalized_payload_json, '\$.vin')) AS lead_vin
      FROM investor_leads il
      JOIN investors inv          ON inv.id = il.investor_id
      JOIN imported_leads_raw r   ON r.id   = il.imported_lead_id
";

if ($method === 'GET') {
    $investorId = isset($_GET['investor_id']) ? (int) $_GET['investor_id'] : 0;
    $leadId     = isset($_GET['lead_id'])     ? (int) $_GET['lead_id']     : 0;

    if ($investorId > 0) {
        $stmt = $db->prepare("$baseSelect WHERE il.investor_id = :iid ORDER BY il.created_at DESC");
        $stmt->execute([':iid' => $investorId]);
    } elseif ($leadId > 0) {
        $stmt = $db->prepare("$baseSelect WHERE il.imported_lead_id = :lid ORDER BY il.created_at DESC");
        $stmt->execute([':lid' => $leadId]);
    } else {
        $stmt = $db->query("$baseSelect ORDER BY il.created_at DESC LIMIT 200");
    }
    $rows = array_map('formatInvestorLead', $stmt->fetchAll());
    echo json_encode(['success' => true, 'rows' => $rows]);
    exit();
}

if ($method === 'POST') {
    $input = json_decode(file_get_contents('php://input'), true) ?? [];
    $investorId = (int) ($input['investor_id'] ?? 0);
    $leadId     = (int) ($input['lead_id']     ?? 0);
    if ($investorId <= 0) pipelineFail(400, 'investor_id is required', 'missing_investor');
    if ($leadId     <= 0) pipelineFail(400, 'lead_id is required',     'missing_lead');

    $amount = $input['investment_amount'] ?? null;
    $share  = $input['share_pct']         ?? null;
    $notes  = isset($input['notes']) ? trim((string) $input['notes']) : null;

    if ($amount !== null && $amount !== '' && (!is_numeric($amount) || (float) $amount < 0)) {
        pipelineFail(400, 'investment_amount must be a non-negative number', 'invalid_amount');
    }
    if ($share !== null && $share !== '' && (!is_numeric($share) || (float) $share < 0 || (float) $share > 100)) {
        pipelineFail(400, 'share_pct must be 0–100', 'invalid_share_pct');
    }

    try {
        $stmt = $db->prepare(
            'INSERT INTO investor_leads
               (investor_id, imported_lead_id, investment_amount, share_pct, notes, created_by)
             VALUES (:iid, :lid, :amt, :shr, :no, :u)'
        );
        $stmt->execute([
            ':iid' => $investorId,
            ':lid' => $leadId,
            ':amt' => ($amount === null || $amount === '') ? null : (float) $amount,
            ':shr' => ($share  === null || $share  === '') ? null : (float) $share,
            ':no'  => $notes !== '' ? $notes : null,
            ':u'   => (int) $user['id'],
        ]);
    } catch (PDOException $e) {
        // Duplicate (investor + car) → friendly error.
        if ($e->getCode() === '23000') {
            pipelineFail(409, 'This investor is already linked to this car', 'duplicate_linkage');
        }
        throw $e;
    }
    echo json_encode(['success' => true, 'id' => (int) $db->lastInsertId()]);
    exit();
}

if ($method === 'PUT') {
    $input = json_decode(file_get_contents('php://input'), true) ?? [];
    $id = (int) ($input['id'] ?? 0);
    if ($id <= 0) pipelineFail(400, 'id is required', 'missing_id');

    $fields = [];
    $params = [':id' => $id];

    if (array_key_exists('investment_amount', $input)) {
        $v = $input['investment_amount'];
        if ($v !== null && $v !== '' && (!is_numeric($v) || (float) $v < 0)) {
            pipelineFail(400, 'investment_amount must be a non-negative number', 'invalid_amount');
        }
        $fields[] = 'investment_amount = :amt';
        $params[':amt'] = ($v === null || $v === '') ? null : (float) $v;
    }
    if (array_key_exists('share_pct', $input)) {
        $v = $input['share_pct'];
        if ($v !== null && $v !== '' && (!is_numeric($v) || (float) $v < 0 || (float) $v > 100)) {
            pipelineFail(400, 'share_pct must be 0–100', 'invalid_share_pct');
        }
        $fields[] = 'share_pct = :shr';
        $params[':shr'] = ($v === null || $v === '') ? null : (float) $v;
    }
    if (array_key_exists('notes', $input)) {
        $n = trim((string) $input['notes']);
        $fields[] = 'notes = :no';
        $params[':no'] = $n !== '' ? $n : null;
    }
    if (empty($fields)) {
        echo json_encode(['success' => true, 'unchanged' => true]);
        exit();
    }
    $stmt = $db->prepare('UPDATE investor_leads SET ' . implode(', ', $fields) . ' WHERE id = :id');
    $stmt->execute($params);
    echo json_encode(['success' => true]);
    exit();
}

if ($method === 'DELETE') {
    $input = json_decode(file_get_contents('php://input'), true) ?? [];
    $id = (int) ($input['id'] ?? 0);
    if ($id <= 0) pipelineFail(400, 'id is required', 'missing_id');
    $db->prepare('DELETE FROM investor_leads WHERE id = :id')->execute([':id' => $id]);
    echo json_encode(['success' => true]);
    exit();
}

pipelineFail(405, 'Method not allowed', 'method_not_allowed');

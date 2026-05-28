<?php
// JV agreement send — flips the investor_leads row's jv_status to 'sent'
// and stamps jv_sent_at. The actual PDF generation + OpenSign push is
// wired in the next iteration; this endpoint is the API contract the
// frontend "Send JV Agreement" button targets so the state machine is
// already in place for the document flow.
//
//   POST /api/jv_agreement
//     { investor_lead_id }
//
// Returns { success, investor_lead } with the updated row.

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/pipeline.php';
initSession();

$user = requireAuth();
if (($user['role'] ?? null) !== 'admin') {
    pipelineFail(403, 'JV agreement is admin-only', 'admin_required');
}
$db = getDBConnection();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    pipelineFail(405, 'Method not allowed', 'method_not_allowed');
}

$input = json_decode(file_get_contents('php://input'), true) ?? [];
$id = (int) ($input['investor_lead_id'] ?? 0);
if ($id <= 0) pipelineFail(400, 'investor_lead_id is required', 'missing_id');

$stmt = $db->prepare('SELECT * FROM investor_leads WHERE id = :id');
$stmt->execute([':id' => $id]);
$row = $stmt->fetch();
if (!$row) pipelineFail(404, 'Investor linkage not found', 'not_found');

// Idempotent — if already signed, just return current state.
if ($row['jv_status'] === 'signed') {
    echo json_encode(['success' => true, 'already_signed' => true, 'investor_lead' => $row]);
    exit();
}

// Today: just stamp 'sent'. The actual PDF generation + OpenSign push
// is wired next pass (see TODO in CHANGELOG). Once wired, this same
// endpoint will additionally:
//   1. Render the JV PDF from the lead + investor data + investor_leads
//      terms (investment_amount, share_pct).
//   2. Pre-populate the VinVault signature block from app_secrets
//      (same as bos_email.php does today).
//   3. POST to OpenSign /v1/createDocument and store the returned
//      Document.objectId in jv_opensign_doc_id.
$db->prepare(
    "UPDATE investor_leads
        SET jv_status  = 'sent',
            jv_sent_at = NOW()
      WHERE id = :id"
)->execute([':id' => $id]);

$stmt = $db->prepare('SELECT * FROM investor_leads WHERE id = :id');
$stmt->execute([':id' => $id]);
echo json_encode(['success' => true, 'investor_lead' => $stmt->fetch()]);

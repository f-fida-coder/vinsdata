<?php
// Per-lead one-off email / SMS send.
//
// POST { kind: 'email'|'sms', lead_id, to, body, subject? }
//   Resolves lead context, enqueues an outbound_jobs row, dispatches via
//   the configured provider (today: stub), logs a contact activity onto
//   the lead's timeline. Returns the job + result so the UI can show
//   confirmation or failure inline.
//
// GET ?lead_id=X
//   Lists all outbound_jobs rows for a lead (for the lead drawer's
//   outreach history view).

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/pipeline.php';
require_once __DIR__ . '/outbound_helpers.php';
initSession();

$user = requireAuth();
$db   = getDBConnection();

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $leadId = (int) ($_GET['lead_id'] ?? 0);
    if ($leadId <= 0) pipelineFail(400, 'lead_id is required', 'missing_fields');

    // Outbound jobs (operator-sent SMS/email to the customer)
    $stmt = $db->prepare(
        'SELECT id, kind, provider, to_address, subject, body, status, fail_reason, sent_at, created_at
           FROM outbound_jobs
          WHERE imported_lead_id = :lead
          ORDER BY created_at DESC, id DESC
          LIMIT 200'
    );
    $stmt->execute([':lead' => $leadId]);
    $jobs = $stmt->fetchAll();

    // Inbound replies from the customer. The OpenPhone webhook writes
    // a contact_logged activity with payload.channel='sms' +
    // payload.direction='inbound' + payload.body=<reply text> each
    // time a lead texts back. We synthesize a job-shaped row for each
    // so the dispatch panel's Activity log can render both streams
    // through the same component path.
    // The webhook writes the inbound SMS payload to new_value_json
    // (per pipeline.php's logLeadActivity signature — oldValue=null,
    // newValue=<payload>). NOT a column called payload_json — that's
    // what tripped the first version of this query.
    $actStmt = $db->prepare(
        "SELECT id, new_value_json, created_at
           FROM lead_activities
          WHERE imported_lead_id = :lead
            AND activity_type    = 'contact_logged'
            AND JSON_EXTRACT(new_value_json, '$.direction') = 'inbound'
            AND JSON_EXTRACT(new_value_json, '$.channel')   = 'sms'
          ORDER BY created_at DESC, id DESC
          LIMIT 100"
    );
    $actStmt->execute([':lead' => $leadId]);
    $inbound = [];
    foreach ($actStmt->fetchAll() as $a) {
        $payload = json_decode($a['new_value_json'] ?? 'null', true) ?: [];
        $inbound[] = [
            'id'         => 'in-' . (int) $a['id'],
            'kind'       => 'sms',
            'direction'  => 'inbound',
            'provider'   => $payload['provider']           ?? 'openphone',
            'to_address' => $payload['sender']             ?? null,
            'subject'    => null,
            'body'       => $payload['body']               ?? null,
            'status'     => 'received',
            'fail_reason'=> null,
            'sent_at'    => $a['created_at'],
            'created_at' => $a['created_at'],
        ];
    }

    // Tag outbound rows so the frontend can render direction without
    // guessing. Pre-existing rows lack the field; default to outbound.
    foreach ($jobs as &$j) { if (!isset($j['direction'])) $j['direction'] = 'outbound'; }
    echo json_encode(['success' => true, 'jobs' => array_merge($jobs, $inbound)]);
    exit();
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    pipelineFail(405, 'Method not allowed', 'method_not_allowed');
}

$input = json_decode(file_get_contents('php://input'), true) ?? [];

$leadId  = (int) ($input['lead_id'] ?? 0);
$kind    = $input['kind']    ?? '';
$to      = trim((string) ($input['to']      ?? ''));
$subject = isset($input['subject']) ? trim((string) $input['subject']) : null;
$body    = trim((string) ($input['body']    ?? ''));

if ($leadId <= 0) pipelineFail(400, 'lead_id is required', 'missing_fields');

// Confirm the lead exists (and is real).
$lookup = $db->prepare('SELECT id FROM imported_leads_raw WHERE id = :id');
$lookup->execute([':id' => $leadId]);
if (!$lookup->fetch()) pipelineFail(404, 'Lead not found', 'lead_not_found');

$result = enqueueAndDispatchOutbound($db, [
    'kind'             => $kind,
    'to'               => $to,
    'subject'          => $subject,
    'body'             => $body,
    'imported_lead_id' => $leadId,
    'created_by'       => (int) $user['id'],
]);

echo json_encode(array_merge(['success' => true], $result));

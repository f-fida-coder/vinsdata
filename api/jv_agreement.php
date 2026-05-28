<?php
// Send a JV Agreement for e-signature via the self-hosted OpenSign
// instance at OPENSIGN_BASE_URL. Mirrors api/opensign.php (BoS flow),
// adapted for the investor_leads row.
//
// POST { investor_lead_id: int, to?: string, subject?: string, body?: string }
//   1. Renders the JV PDF (Mitchell Briggs pre-signed on Vin Vault side)
//   2. Uploads to OpenSign:  POST /api/app/files/<name>.pdf
//   3. Creates a _User + contracts_Contactbook for the investor signer
//   4. Creates a contracts_Document with a signature placeholder on the
//      investor's signature line (page 2, lower half)
//   5. Builds the signing URL: <BASE>/login/<base64(docId/email/contactId/false)>
//   6. Emails the signing link to the investor via Gmail SMTP
//   7. Marks investor_leads: jv_opensign_doc_id, jv_status='sent', jv_sent_at=NOW()
//
// All OPENSIGN_* secrets must be configured. Missing config returns
// 503 with a clear message; the React drawer surfaces it.
//
// Idempotent — if the row is already in jv_status='signed', returns
// the current state without re-sending.

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/pipeline.php';
require_once __DIR__ . '/jv_helpers.php';
require_once __DIR__ . '/lib/smtp.php';
require_once __DIR__ . '/outbound_helpers.php';
initSession();

$user = requireAuth();
if (($user['role'] ?? null) !== 'admin') {
    pipelineFail(403, 'JV agreement is admin-only', 'admin_required');
}
$db = getDBConnection();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    pipelineFail(405, 'Method not allowed', 'method_not_allowed');
}

// ---- Config check up front. Anything missing → bail before doing work. ----
$baseUrl        = rtrim(getEnvValue('OPENSIGN_BASE_URL'),   '/');
$appId          = getEnvValue('OPENSIGN_APP_ID');
$masterKey      = getEnvValue('OPENSIGN_MASTER_KEY');
$serviceUserId  = getEnvValue('OPENSIGN_SERVICE_USER_ID');
$serviceExtUser = getEnvValue('OPENSIGN_SERVICE_EXTUSER_ID');
if ($baseUrl === '' || $appId === '' || $masterKey === '' || $serviceUserId === '' || $serviceExtUser === '') {
    pipelineFail(
        503,
        'OpenSign is not configured. Set OPENSIGN_BASE_URL, OPENSIGN_APP_ID, OPENSIGN_MASTER_KEY, OPENSIGN_SERVICE_USER_ID, and OPENSIGN_SERVICE_EXTUSER_ID in Outbound Integrations.',
        'opensign_not_configured'
    );
}

$input          = json_decode(file_get_contents('php://input'), true) ?? [];
$investorLeadId = (int) ($input['investor_lead_id'] ?? 0);
$to             = trim((string) ($input['to']      ?? ''));
$subject        = trim((string) ($input['subject'] ?? ''));
$body           = trim((string) ($input['body']    ?? ''));

if ($investorLeadId <= 0) pipelineFail(400, 'investor_lead_id is required', 'missing_id');

// Idempotency check — if already signed, just echo current state. The
// caller's button text will reflect "Signed" already; this is the API
// guard for race conditions / double-clicks.
$rowStmt = $db->prepare('SELECT * FROM investor_leads WHERE id = :id');
$rowStmt->execute([':id' => $investorLeadId]);
$existing = $rowStmt->fetch();
if (!$existing) pipelineFail(404, 'Investor linkage not found', 'not_found');
if ($existing['jv_status'] === 'signed') {
    echo json_encode(['success' => true, 'already_signed' => true, 'investor_lead' => $existing]);
    exit();
}

// ---- Load the joined data + render the PDF. ----
$data = fetchJvData($db, $investorLeadId);

// Fall back to the investor's saved email if the caller didn't override.
if ($to === '') {
    $to = trim((string) ($data['investor_email'] ?? ''));
}
if ($to === '' || !filter_var($to, FILTER_VALIDATE_EMAIL)) {
    pipelineFail(400, 'Investor email is required to send the JV agreement', 'missing_email');
}

try {
    $pdfBytes = renderJvAgreementPdf($data);
} catch (Throwable $e) {
    pipelineFail(500, 'PDF generation failed: ' . $e->getMessage(), 'pdf_error');
}

// ---- Persist a copy on disk for audit + downstream PDF download. ----
$jvDir = __DIR__ . '/uploads/jv';
if (!is_dir($jvDir)) {
    @mkdir($jvDir, 0775, true);
}
$pdfFilename = 'JV-' . ($data['vehicle_vin'] ?: ('lead-' . $data['imported_lead_id'])) . '-' . date('Ymd-His') . '.pdf';
$pdfDiskPath = $jvDir . '/' . $pdfFilename;
@file_put_contents($pdfDiskPath, $pdfBytes);
// Relative path stored on the row so the frontend can build a download URL.
$pdfPathRel = 'api/uploads/jv/' . $pdfFilename;

// ---- HTTP helper. Parse REST returns JSON; surface its `error` on non-2xx. ----
$parseRequest = function (string $method, string $path, $body, array $extraHeaders = []) use ($baseUrl, $appId, $masterKey) {
    $url = $baseUrl . '/api/app' . $path;
    $ch  = curl_init($url);
    $headers = array_merge([
        'X-Parse-Application-Id: ' . $appId,
        'X-Parse-Master-Key: '      . $masterKey,
    ], $extraHeaders);
    curl_setopt_array($ch, [
        CURLOPT_CUSTOMREQUEST  => $method,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 30,
        CURLOPT_HTTPHEADER     => $headers,
        CURLOPT_POSTFIELDS     => $body,
    ]);
    $resp = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err  = curl_error($ch);
    curl_close($ch);
    if ($resp === false) {
        throw new RuntimeException("OpenSign request failed: $err");
    }
    $json = json_decode($resp, true);
    if ($code >= 400) {
        $msg = is_array($json) ? ($json['error'] ?? $resp) : $resp;
        throw new RuntimeException("OpenSign $method $path returned HTTP $code: $msg");
    }
    return $json ?: [];
};

// ---- 1. Upload PDF to OpenSign. ----
try {
    $upload = $parseRequest('POST', '/files/' . rawurlencode($pdfFilename), $pdfBytes, [
        'Content-Type: application/pdf',
    ]);
    $fileUrl = $upload['url'] ?? '';
    if ($fileUrl === '') throw new RuntimeException('Upload returned no url');
} catch (Throwable $e) {
    pipelineFail(502, 'OpenSign upload failed: ' . $e->getMessage(), 'opensign_upload_failed');
}

// ---- 2. Ensure a _User exists for the investor + create/find Contactbook. ----
//
// Same convention as opensign.php — username = email (lowercased),
// password = email (same string). Signer never logs in with that pwd;
// the embedded /login/<base64> flow mints its own session.
$investorDisplayName = trim((string) ($data['investor_name'] ?? '')) ?: 'Investor';
$signerEmail         = strtolower($to);
$serviceUserPtr      = ['__type' => 'Pointer', 'className' => '_User', 'objectId' => $serviceUserId];

$signerUserId = null;
try {
    $whereU = json_encode(['username' => $signerEmail]);
    $userQuery = $parseRequest(
        'GET',
        '/users?where=' . rawurlencode($whereU) . '&limit=1',
        null,
        ['Content-Type: application/json']
    );
    if (!empty($userQuery['results'][0]['objectId'])) {
        $signerUserId = $userQuery['results'][0]['objectId'];
    } else {
        $newUser = $parseRequest('POST', '/users', json_encode([
            'name'     => $investorDisplayName,
            'username' => $signerEmail,
            'email'    => $signerEmail,
            'password' => $signerEmail,
        ]), [
            'Content-Type: application/json',
        ]);
        $signerUserId = $newUser['objectId'] ?? null;
        if (!$signerUserId) throw new RuntimeException('Signer _User create returned no objectId');
    }
} catch (Throwable $e) {
    pipelineFail(502, 'OpenSign signer user create failed: ' . $e->getMessage(), 'opensign_user_failed');
}

$signerUserPtr = ['__type' => 'Pointer', 'className' => '_User', 'objectId' => $signerUserId];
$contactAcl = [
    $serviceUserId => ['read' => true, 'write' => true],
    $signerUserId  => ['read' => true, 'write' => true],
];

$contactId = null;
try {
    $where = json_encode([
        'Email'      => $signerEmail,
        'CreatedBy'  => $serviceUserPtr,
        'IsDeleted'  => ['$ne' => true],
    ]);
    $query  = $parseRequest(
        'GET',
        '/classes/contracts_Contactbook?where=' . rawurlencode($where) . '&limit=1',
        null,
        ['Content-Type: application/json']
    );
    if (!empty($query['results'][0]['objectId'])) {
        $contactId = $query['results'][0]['objectId'];
        $existingContact = $query['results'][0];
        $needsPatch = empty($existingContact['UserId']) || empty($existingContact['ACL']);
        if ($needsPatch) {
            $parseRequest('PUT', '/classes/contracts_Contactbook/' . rawurlencode($contactId), json_encode([
                'UserId' => $signerUserPtr,
                'ACL'    => $contactAcl,
            ]), [
                'Content-Type: application/json',
            ]);
        }
    } else {
        $created = $parseRequest('POST', '/classes/contracts_Contactbook', json_encode([
            'Name'      => $investorDisplayName,
            'Email'     => $signerEmail,
            'UserRole'  => 'contracts_Guest',
            'IsDeleted' => false,
            'CreatedBy' => $serviceUserPtr,
            'UserId'    => $signerUserPtr,
            'ACL'       => $contactAcl,
        ]), [
            'Content-Type: application/json',
        ]);
        $contactId = $created['objectId'] ?? null;
        if (!$contactId) throw new RuntimeException('Contactbook insert returned no objectId');
    }
} catch (Throwable $e) {
    pipelineFail(502, 'OpenSign contact create failed: ' . $e->getMessage(), 'opensign_contact_failed');
}

// ---- 3. Create the Document linking PDF + signer. ----
$vehDesc = trim(implode(' ', array_filter([
    $data['vehicle_year']  ?? null,
    $data['vehicle_make']  ?? null,
    $data['vehicle_model'] ?? null,
]))) ?: 'Vehicle';
$docName = 'JV Agreement — ' . $vehDesc;

// Placeholder lives on page 2, on the INVESTOR signature line. The
// signature block is rendered after the Operator (pre-signed) block,
// so it falls ~mid-bottom of page 2. Coordinates are PDF points from
// the top-left of Letter (612 × 792).
$placeholderId  = uniqid('jvp_', true);
$widgetKey      = (int) (microtime(true) * 1000);
$placeholders   = [[
    'Id'           => $placeholderId,
    'Role'         => 'signer',
    'signerObjId'  => $contactId,
    'signerPtr'    => ['__type' => 'Pointer', 'className' => 'contracts_Contactbook', 'objectId' => $contactId],
    'email'        => $signerEmail,
    'blockColor'   => '#93a3db',
    'placeHolder'  => [[
        'pageNumber' => 2,
        'pos'        => [[
            'key'       => $widgetKey,
            'xPosition' => 170,
            'yPosition' => 600,
            'width'     => 240,
            'height'    => 48,
            'Width'     => 240,
            'Height'    => 48,
            'isStamp'   => false,
            'type'      => 'signature',
            'options'   => ['name' => 'Signature'],
        ]],
    ]],
]];

try {
    $doc = $parseRequest('POST', '/classes/contracts_Document', json_encode([
        'Name'                => $docName,
        'URL'                 => $fileUrl,
        'Note'                => 'Joint Venture Agreement for ' . $vehDesc . '. Please sign the Investor signature line.',
        'TimeToCompleteDays'  => 15,
        'RemindOnceInEvery'   => 5,
        'AutomaticReminders'  => false,
        'SendinOrder'         => false,
        'IsCompleted'         => false,
        'CreatedBy'           => $serviceUserPtr,
        'ExtUserPtr'          => ['__type' => 'Pointer', 'className' => 'contracts_Users', 'objectId' => $serviceExtUser],
        'Signers'             => [['__type' => 'Pointer', 'className' => 'contracts_Contactbook', 'objectId' => $contactId]],
        'Placeholders'        => $placeholders,
    ]), [
        'Content-Type: application/json',
    ]);
    $docId = $doc['objectId'] ?? null;
    if (!$docId) throw new RuntimeException('Document insert returned no objectId');
} catch (Throwable $e) {
    pipelineFail(502, 'OpenSign document create failed: ' . $e->getMessage(), 'opensign_document_failed');
}

// ---- 4. Build the signing URL (same /login/<base64> indirection
//         as the BoS flow, for the same localStorage-clear reason). ----
$base64Payload = base64_encode($docId . '/' . $signerEmail . '/' . $contactId . '/false');
$signingUrl    = $baseUrl . '/login/' . rawurlencode($base64Payload);

// ---- 5. Email the signing link via Gmail SMTP. ----
$investorFirst = '';
if ($investorDisplayName !== '') {
    $investorFirst = trim(explode(' ', $investorDisplayName)[0] ?? '');
}
if ($subject === '') {
    $subject = $vehDesc !== 'Vehicle'
        ? "Please sign the JV Agreement for the $vehDesc"
        : 'Please sign the Joint Venture Agreement';
}
if ($body === '') {
    $greeting = $investorFirst !== '' ? "Hi $investorFirst," : 'Hi,';
    $body = "$greeting\n\n"
          . "The Joint Venture Agreement for the $vehDesc is ready for your signature. The Vin Vault side is already signed — please click the link below to review and countersign:\n\n"
          . "  $signingUrl\n\n"
          . "Reply to this email with any questions or corrections before signing.";
} elseif (strpos($body, $signingUrl) === false) {
    $body .= "\n\n----\nSigning link:\n  $signingUrl";
}

$gmailUser = getEnvValue('GMAIL_SMTP_USER');
$gmailPass = getEnvValue('GMAIL_SMTP_PASS');
$emailOk   = false;
$emailErr  = null;
$result    = []; // referenced below in the lead-activity log even when SMTP path skipped

if ($gmailUser === '' || $gmailPass === '') {
    $emailErr = 'Gmail SMTP not configured — copy the link manually.';
} else {
    $fromEmail   = getEnvValue('GMAIL_FROM_EMAIL', $gmailUser);
    $fromName    = getEnvValue('GMAIL_FROM_NAME',  '');
    $sig         = buildEmailSignature($db, (int) $user['id']);
    $textWithSig = $sig['text'] !== '' ? $body . "\n\n" . $sig['text'] : $body;

    $result = sendSmtpMessage([
        'host'       => 'smtp.gmail.com',
        'port'       => 587,
        'username'   => $gmailUser,
        'password'   => $gmailPass,
        'from_email' => $fromEmail,
        'from_name'  => $fromName,
        'to'         => $to,
        'subject'    => $subject,
        'body_text'  => $textWithSig,
    ]);
    $emailOk  = !empty($result['ok']);
    $emailErr = $emailOk ? null : ($result['error'] ?? 'unknown');
}

// ---- 6. Mark the investor_leads row + log activity. ----
try {
    $db->prepare(
        "UPDATE investor_leads
            SET jv_status          = 'sent',
                jv_sent_at         = NOW(),
                jv_opensign_doc_id = :doc,
                jv_pdf_path        = :pdf
          WHERE id = :id"
    )->execute([
        ':doc' => $docId,
        ':pdf' => $pdfPathRel,
        ':id'  => $investorLeadId,
    ]);
} catch (Throwable $e) {
    error_log('[jv_agreement] status update failed: ' . $e->getMessage());
}

// Best-effort lead-activity log so the JV send shows up on the lead
// drawer's timeline alongside texts / emails / BoS sends.
if (!empty($data['imported_lead_id'])) {
    try {
        logLeadActivity(
            $db,
            (int) $data['imported_lead_id'],
            (int) $user['id'],
            'contact_logged',
            null,
            [
                'channel'             => 'email',
                'direction'           => 'outbound',
                'outcome'             => $emailOk ? 'completed' : 'failed',
                'subject'             => $subject,
                'provider'            => 'opensign+gmail',
                'provider_message_id' => $result['message_id'] ?? null,
                'kind'                => 'jv_agreement_esign',
                'investor_lead_id'    => $investorLeadId,
                'investor_id'         => (int) ($data['investor_id'] ?? 0),
                'opensign_doc_id'     => $docId,
                'signing_url'         => $signingUrl,
            ]
        );
    } catch (Throwable $_e) {
        // Best-effort.
    }
}

// Return the updated row so the React drawer can re-render without
// a follow-up fetch.
$rowStmt = $db->prepare('SELECT * FROM investor_leads WHERE id = :id');
$rowStmt->execute([':id' => $investorLeadId]);
$updated = $rowStmt->fetch();

echo json_encode([
    'success'         => true,
    'email_delivered' => $emailOk,
    'reason'          => $emailErr,
    'signing_url'     => $signingUrl,
    'opensign_doc_id' => $docId,
    'contact_id'      => $contactId,
    'to'              => $to,
    'subject'         => $subject,
    'pdf_path'        => $pdfPathRel,
    'investor_lead'   => $updated,
]);

<?php
// Send a Bill of Sale for e-signature via the self-hosted OpenSign
// instance at OPENSIGN_BASE_URL.
//
// POST { lead_id?: int, id?: int, to: string, subject?: string, body?: string }
//   1. Renders the BoS as a PDF (lead-attached or standalone)
//   2. Uploads it to OpenSign:  POST /api/app/files/<name>.pdf
//   3. Creates a contracts_Contactbook entry for the signer (the seller —
//      the lead, after the buyer/seller swap in defaultsFromLead)
//   4. Creates a contracts_Document linking the PDF + signer, owned by
//      the configured OPENSIGN_SERVICE_USER_ID
//   5. Builds the signing URL: <BASE>/load/recipientSignPdf/<docId>/<contactId>
//   6. Emails the signing link to the seller via Gmail SMTP — same
//      provider stack as bos_email.php, just a different body (link
//      instead of an attached PDF)
//   7. Marks the BoS row: signature_request_id = doc objectId,
//      signature_status = 'sent', signature_sent_at = NOW()
//
// All four OPENSIGN_* secrets must be set (see api/app_secrets.php).
// Missing config returns 503 with a clear message; the React modal
// surfaces it as a configuration error.

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/pipeline.php';
require_once __DIR__ . '/bos_helpers.php';
require_once __DIR__ . '/lib/smtp.php';
require_once __DIR__ . '/outbound_helpers.php';
initSession();

$user = requireAuth();
$db   = getDBConnection();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    pipelineFail(405, 'Method not allowed', 'method_not_allowed');
}

// ---- Config check up front. Anything missing → bail before doing work. ----
$baseUrl       = rtrim(getEnvValue('OPENSIGN_BASE_URL'),   '/');
$appId         = getEnvValue('OPENSIGN_APP_ID');
$masterKey     = getEnvValue('OPENSIGN_MASTER_KEY');
$serviceUserId = getEnvValue('OPENSIGN_SERVICE_USER_ID');
if ($baseUrl === '' || $appId === '' || $masterKey === '' || $serviceUserId === '') {
    pipelineFail(
        503,
        'OpenSign is not configured. Set OPENSIGN_BASE_URL, OPENSIGN_APP_ID, OPENSIGN_MASTER_KEY, and OPENSIGN_SERVICE_USER_ID in Outbound Integrations.',
        'opensign_not_configured'
    );
}

$input  = json_decode(file_get_contents('php://input'), true) ?? [];
$leadId = (int) ($input['lead_id'] ?? 0);
$bosId  = (int) ($input['id']      ?? 0);
$to     = trim((string) ($input['to']      ?? ''));
$subject= trim((string) ($input['subject'] ?? ''));
$body   = trim((string) ($input['body']    ?? ''));

if ($to === '') pipelineFail(400, 'Recipient email (to) is required', 'missing_to');

// ---- Fetch the BoS row (same dispatch as bos_email.php). ----
if ($bosId > 0) {
    $stmt = $db->prepare('SELECT * FROM bill_of_sale WHERE id = :id');
    $stmt->execute([':id' => $bosId]);
    $bos = $stmt->fetch();
    if (!$bos) pipelineFail(404, 'Bill of Sale not found', 'bos_not_found');
    $leadId = $bos['imported_lead_id'] !== null ? (int) $bos['imported_lead_id'] : 0;
} elseif ($leadId > 0) {
    loadLeadOrFail($db, $leadId);
    $bos = fetchBoS($db, $leadId);
    if (!$bos) pipelineFail(400, 'Fill out the Bill of Sale first, then send for signature.', 'bos_not_saved');
    $bosId = (int) $bos['id'];
} else {
    pipelineFail(400, 'Either id or lead_id is required', 'missing_id');
}

// ---- Render the PDF (Mitchell Briggs pre-signed). ----
try {
    $pdfBytes = renderBillOfSalePdf($bos);
} catch (Throwable $e) {
    pipelineFail(500, 'PDF generation failed: ' . $e->getMessage(), 'pdf_error');
}

$pdfFilename = 'BoS-' . ($bos['vehicle_vin'] ?: ('bos-' . $bosId)) . '-' . date('Ymd') . '.pdf';

// ---- HTTP helper. Parse REST returns JSON; we surface its `error` on non-2xx. ----
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

// ---- 2. Create Contactbook entry for the signer. ----
//
// Reuse-by-email: OpenSign treats Contactbook entries as unique per
// (CreatedBy + Email + IsDeleted=false). We could query first to avoid
// duplicates, but Parse will happily insert another row — and operators
// would see multiple "Test Signer" rows in the OpenSign UI. Cheap
// dedupe: query first.
$sellerName = trim((string) ($bos['seller_name'] ?? '')) ?: 'Seller';
$serviceUserPtr = ['__type' => 'Pointer', 'className' => '_User', 'objectId' => $serviceUserId];

$contactId = null;
try {
    $where = json_encode([
        'Email'      => strtolower($to),
        'CreatedBy'  => $serviceUserPtr,
        'IsDeleted'  => ['$ne' => true],
    ]);
    $query  = $parseRequest('GET', '/classes/contracts_Contactbook?where=' . rawurlencode($where) . '&limit=1', null, [
        'Content-Type: application/json',
    ]);
    if (!empty($query['results'][0]['objectId'])) {
        $contactId = $query['results'][0]['objectId'];
    } else {
        $created = $parseRequest('POST', '/classes/contracts_Contactbook', json_encode([
            'Name'      => $sellerName,
            'Email'     => strtolower($to),
            'UserRole'  => 'contracts_Guest',
            'IsDeleted' => false,
            'CreatedBy' => $serviceUserPtr,
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
    $bos['vehicle_year']  ?? null,
    $bos['vehicle_make']  ?? null,
    $bos['vehicle_model'] ?? null,
]))) ?: 'Vehicle';
$docName = 'Bill of Sale — ' . $vehDesc;

try {
    $doc = $parseRequest('POST', '/classes/contracts_Document', json_encode([
        'Name'                => $docName,
        'URL'                 => $fileUrl,
        'Note'                => 'Bill of Sale for ' . $vehDesc . '. Please sign the Seller Signature lines.',
        'TimeToCompleteDays'  => 15,
        'RemindOnceInEvery'   => 5,
        'AutomaticReminders'  => false,
        'SendinOrder'         => false,
        'IsCompleted'         => false,
        'CreatedBy'           => $serviceUserPtr,
        'Signers'             => [['__type' => 'Pointer', 'className' => 'contracts_Contactbook', 'objectId' => $contactId]],
    ]), [
        'Content-Type: application/json',
    ]);
    $docId = $doc['objectId'] ?? null;
    if (!$docId) throw new RuntimeException('Document insert returned no objectId');
} catch (Throwable $e) {
    pipelineFail(502, 'OpenSign document create failed: ' . $e->getMessage(), 'opensign_document_failed');
}

// ---- 4. Build the signing URL. ----
$signingUrl = $baseUrl . '/load/recipientSignPdf/' . rawurlencode($docId) . '/' . rawurlencode($contactId);

// ---- 5. Email the signing link via Gmail SMTP. ----
// We send through the CRM's existing Gmail provider so deliverability is
// known-good and the From address matches every other operator-sent
// message. OpenSign's own emailer would work too but it's a separate
// channel we'd have to monitor.
$sellerFirst = '';
if ($sellerName !== '') {
    $sellerFirst = trim(explode(' ', $sellerName)[0] ?? '');
}
if ($subject === '') {
    $subject = $vehDesc !== 'Vehicle'
        ? "Please sign the Bill of Sale for your $vehDesc"
        : 'Please sign the Motor Vehicle Bill of Sale';
}
if ($body === '') {
    $greeting = $sellerFirst !== '' ? "Hi $sellerFirst," : 'Hi,';
    $body = "$greeting\n\n"
          . "The Bill of Sale for your $vehDesc is ready for your signature. The buyer side is already signed on our end — please click the link below to review and sign:\n\n"
          . "  $signingUrl\n\n"
          . "Reply to this email with any questions or corrections before signing.";
} elseif (strpos($body, $signingUrl) === false) {
    // The operator typed their own body (e.g. the old "PDF attached, sign
    // and email back" text from the modal default). That text doesn't
    // mention there's a link to click, so we append the signing URL as
    // its own paragraph rather than rewriting their copy.
    $body .= "\n\n----\nSigning link:\n  $signingUrl";
}

$gmailUser = getEnvValue('GMAIL_SMTP_USER');
$gmailPass = getEnvValue('GMAIL_SMTP_PASS');
if ($gmailUser === '' || $gmailPass === '') {
    // OpenSign objects are created; we just can't deliver the email.
    // Surface the signing URL so the operator can paste it manually.
    echo json_encode([
        'success'         => true,
        'email_delivered' => false,
        'reason'          => 'Gmail SMTP not configured — copy the link below manually.',
        'signing_url'     => $signingUrl,
        'opensign_doc_id' => $docId,
        'contact_id'      => $contactId,
    ]);
    exit();
}

$fromEmail = getEnvValue('GMAIL_FROM_EMAIL', $gmailUser);
$fromName  = getEnvValue('GMAIL_FROM_NAME',  '');
$sig       = buildEmailSignature($db, (int) $user['id']);
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

$emailOk = !empty($result['ok']);

// ---- 6. Mark the BoS row + log activity. ----
try {
    $db->prepare(
        'UPDATE bill_of_sale
            SET signature_request_id = :req,
                signature_status     = \'sent\',
                signature_sent_at    = NOW()
          WHERE id = :id'
    )->execute([':req' => $docId, ':id' => $bosId]);
} catch (Throwable $e) {
    error_log('[opensign] status update failed: ' . $e->getMessage());
}

if ($leadId > 0) {
    try {
        logLeadActivity(
            $db,
            $leadId,
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
                'kind'                => 'bill_of_sale_esign',
                'bos_id'              => $bosId,
                'opensign_doc_id'     => $docId,
                'signing_url'         => $signingUrl,
            ]
        );
    } catch (Throwable $_e) {
        // Best-effort.
    }
}

echo json_encode([
    'success'         => true,
    'email_delivered' => $emailOk,
    'reason'          => $emailOk ? null : ($result['error'] ?? 'unknown'),
    'signing_url'     => $signingUrl,
    'opensign_doc_id' => $docId,
    'contact_id'      => $contactId,
    'to'              => $to,
    'subject'         => $subject,
]);

<?php
// Email a Bill of Sale PDF to the buyer.
//
// POST { lead_id?: int, id?: int, to: string, subject?: string, body?: string }
//   Renders the BoS as a PDF (lead-attached or standalone) and emails
//   it via Gmail SMTP with the PDF attached. Marks the BoS row as
//   signature_status='sent' + signature_sent_at=NOW so the list view
//   + drawer reflect "Awaiting signature."
//
// This is the manual-send path that bridges us to OpenSign v2: the
// buyer gets the PDF in their inbox, signs it offline, and emails it
// back. When OpenSign self-hosting lands, this same "Send" button
// flips to the embedded-signing flow without operator-facing changes.

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

$input  = json_decode(file_get_contents('php://input'), true) ?? [];
$leadId = (int) ($input['lead_id'] ?? 0);
$bosId  = (int) ($input['id']      ?? 0);
$to     = trim((string) ($input['to']      ?? ''));
$subject= trim((string) ($input['subject'] ?? ''));
$body   = trim((string) ($input['body']    ?? ''));

if ($to === '') pipelineFail(400, 'Recipient email (to) is required', 'missing_to');

// Fetch the BoS row. Two paths:
//   - id given → standalone or lead-attached, fetched by primary key
//   - lead_id given → upsert-by-lead path; use defaults if no row yet
if ($bosId > 0) {
    $stmt = $db->prepare('SELECT * FROM bill_of_sale WHERE id = :id');
    $stmt->execute([':id' => $bosId]);
    $bos = $stmt->fetch();
    if (!$bos) pipelineFail(404, 'Bill of Sale not found', 'bos_not_found');
    $leadId = $bos['imported_lead_id'] !== null ? (int) $bos['imported_lead_id'] : 0;
} elseif ($leadId > 0) {
    loadLeadOrFail($db, $leadId);
    $bos = fetchBoS($db, $leadId);
    if (!$bos) {
        // Render a fresh PDF from the lead's data but don't auto-save.
        // The operator should hit Save first; refusing here keeps the
        // status-flow honest (can't be "sent" before there's a row).
        pipelineFail(400, 'Fill out the Bill of Sale first, then email.', 'bos_not_saved');
    }
    $bosId = (int) $bos['id'];
} else {
    pipelineFail(400, 'Either id or lead_id is required', 'missing_id');
}

// Default the subject + body if the caller didn't provide them. The
// buyer's first name (if known) goes in the greeting.
$buyerFirst = '';
if (!empty($bos['buyer_name'])) {
    $buyerFirst = trim(explode(' ', trim($bos['buyer_name']))[0] ?? '');
}
$vehicleDesc = trim(implode(' ', array_filter([$bos['vehicle_year'] ?? null, $bos['vehicle_make'] ?? null, $bos['vehicle_model'] ?? null])));
if ($subject === '') {
    $subject = $vehicleDesc !== ''
        ? "Bill of Sale for your $vehicleDesc"
        : 'Your Motor Vehicle Bill of Sale';
}
if ($body === '') {
    $greeting = $buyerFirst !== '' ? "Hi $buyerFirst," : 'Hi,';
    $vehLine  = $vehicleDesc !== '' ? "the sale of your $vehicleDesc" : 'this vehicle sale';
    $body = "$greeting\n\n"
          . "Attached is the Motor Vehicle Bill of Sale for $vehLine. Please review the details, sign + date both signature lines (Authorization + Odometer Disclosure), and send a signed copy back when you're ready.\n\n"
          . "Reply to this email with any questions or corrections before signing.";
}

// Render the PDF.
try {
    $pdfBytes = renderBillOfSalePdf($bos);
} catch (Throwable $e) {
    pipelineFail(500, 'PDF generation failed: ' . $e->getMessage(), 'pdf_error');
}

$pdfFilename = 'BoS-' . ($bos['vehicle_vin'] ?: ('bos-' . $bosId)) . '-' . date('Ymd') . '.pdf';

// Send via Gmail SMTP. Reuses the same provider stack as the per-lead
// Outreach composer — auto-picks the configured Gmail account; falls
// back to stub if .env / app_secrets aren't set (returns ok with a
// stub message-id so the status flow still completes for dev).
$gmailUser = getEnvValue('GMAIL_SMTP_USER');
$gmailPass = getEnvValue('GMAIL_SMTP_PASS');
if ($gmailUser === '' || $gmailPass === '') {
    pipelineFail(503, 'Gmail SMTP not configured. Set GMAIL_SMTP_USER + GMAIL_SMTP_PASS in Outbound integrations.', 'email_not_configured');
}

$fromEmail = getEnvValue('GMAIL_FROM_EMAIL', $gmailUser);
$fromName  = getEnvValue('GMAIL_FROM_NAME',  '');

// Append the branded signature to the plain-text body. We don't render
// the HTML alternative here — the attachment IS the main content; the
// body text is just a cover note. Signature gets pulled from the same
// helper the Outreach composer uses so it matches everywhere.
$sig = buildEmailSignature($db, (int) $user['id']);
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
    'attachments' => [[
        'filename'     => $pdfFilename,
        'content'      => $pdfBytes,
        'content_type' => 'application/pdf',
    ]],
]);

if (empty($result['ok'])) {
    pipelineFail(502, 'Email send failed: ' . ($result['error'] ?? 'unknown'), 'send_failed');
}

// Mark the BoS as sent for signature.
try {
    $db->prepare(
        'UPDATE bill_of_sale
            SET signature_status   = \'sent\',
                signature_sent_at  = NOW()
          WHERE id = :id'
    )->execute([':id' => $bosId]);
} catch (Throwable $e) {
    // Send succeeded; status flip is best-effort. Log but don't fail.
    error_log('[bos_email] status update failed: ' . $e->getMessage());
}

// Log on the lead's timeline if this BoS is lead-attached.
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
                'outcome'             => 'completed',
                'subject'             => $subject,
                'provider'            => 'gmail',
                'provider_message_id' => $result['message_id'] ?? null,
                'kind'                => 'bill_of_sale',
                'bos_id'              => $bosId,
            ]
        );
    } catch (Throwable $_e) {
        // Activity log failure shouldn't block the user.
    }
}

echo json_encode([
    'success'    => true,
    'message_id' => $result['message_id'] ?? null,
    'bos_id'     => $bosId,
    'to'         => $to,
    'subject'    => $subject,
    'pdf_size'   => strlen($pdfBytes),
]);

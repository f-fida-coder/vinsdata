<?php
// Pure-function email helpers — sendEmailViaSendGrid + SendGrid REST
// path + Gmail SMTP fallback. Extracted from marketing_send.php so the
// transport_notify path (and any other consumer that just needs the
// email send function) can require_once these without ALSO running the
// marketing_send request handler, which would 401/405 every non-POST.
//
// Idempotent guards (function_exists) make it safe for marketing_send.php
// itself to require this file at the top of its dispatcher — the older
// inline copies in marketing_send.php are skipped on the second pass.

require_once __DIR__ . '/pipeline.php';

if (!function_exists('sendEmailViaSendGrid')) {
function sendEmailViaSendGrid(string $to, ?string $subject, string $body, ?string $fromOverride): string
{
    $sendgridKey = getEnvValue('SENDGRID_API_KEY');
    if ($sendgridKey !== '') {
        return sendEmailViaSendGridApi($to, $subject, $body, $fromOverride, $sendgridKey);
    }

    // No SendGrid → use the Gmail SMTP fallback. Lazy-load so we don't
    // pull in the SMTP client (and the outbound helpers) for callers
    // that only use the SendGrid path.
    return sendEmailViaGmailFallback($to, $subject, $body, $fromOverride);
}
}

if (!function_exists('sendEmailViaSendGridApi')) {
function sendEmailViaSendGridApi(string $to, ?string $subject, string $body, ?string $fromOverride, string $apiKey): string
{
    $from = $fromOverride
        ?: getEnvValue('MARKETING_EMAIL_FROM',
            // Best-effort default: use the Gmail sender if it's set so a
            // half-configured server (SendGrid key but no MARKETING_EMAIL_FROM)
            // still has something to send AS.
            defined('MARKETING_EMAIL_FROM') ? MARKETING_EMAIL_FROM : '');
    if ($from === '') {
        $gmailUser = getEnvValue('GMAIL_SMTP_USER');
        $gmailName = getEnvValue('GMAIL_FROM_NAME');
        if ($gmailUser !== '') {
            $from = $gmailName !== '' ? "\"$gmailName\" <$gmailUser>" : $gmailUser;
        }
    }
    if ($from === '') throw new RuntimeException('MARKETING_EMAIL_FROM is not configured');

    // Parse "Name <email>" form if present.
    $fromEmail = $from;
    $fromName  = null;
    if (preg_match('/^\s*"?([^"<]+)"?\s*<([^>]+)>\s*$/', $from, $m)) {
        $fromName  = trim($m[1]);
        $fromEmail = trim($m[2]);
    }

    $payload = [
        'personalizations' => [['to' => [['email' => $to]]]],
        'from'             => array_filter(['email' => $fromEmail, 'name' => $fromName]),
        'subject'          => $subject ?? '(no subject)',
        'content'          => [['type' => 'text/plain', 'value' => $body]],
    ];

    $ch = curl_init('https://api.sendgrid.com/v3/mail/send');
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => json_encode($payload),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HEADER         => true,
        CURLOPT_TIMEOUT        => 15,
        CURLOPT_HTTPHEADER     => [
            'Authorization: Bearer ' . $apiKey,
            'Content-Type: application/json',
        ],
    ]);
    $response = curl_exec($ch);
    if ($response === false) {
        $err = curl_error($ch);
        curl_close($ch);
        throw new RuntimeException("SendGrid curl error: $err");
    }
    $code       = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $headerSize = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    $headers    = substr($response, 0, $headerSize);
    $respBody   = substr($response, $headerSize);
    curl_close($ch);

    if ($code < 200 || $code >= 300) {
        throw new RuntimeException("SendGrid HTTP $code: " . substr($respBody, 0, 200));
    }
    if (preg_match('/^x-message-id:\s*(\S+)/mi', $headers, $m)) {
        return trim($m[1]);
    }
    return 'sendgrid-' . substr(bin2hex(random_bytes(8)), 0, 16);
}
}

if (!function_exists('sendEmailViaGmailFallback')) {
function sendEmailViaGmailFallback(string $to, ?string $subject, string $body, ?string $fromOverride): string
{
    $user = getEnvValue('GMAIL_SMTP_USER');
    $pass = getEnvValue('GMAIL_SMTP_PASS');
    if ($user === '' || $pass === '') {
        throw new RuntimeException('Email not configured: neither SENDGRID_API_KEY nor GMAIL_SMTP_USER/PASS are set');
    }

    // Honor "Name <email>" From overrides for back-compat with callers
    // that pass a sender_identity.
    $fromEmail = getEnvValue('GMAIL_FROM_EMAIL', $user);
    $fromName  = getEnvValue('GMAIL_FROM_NAME',  '');
    if ($fromOverride) {
        if (preg_match('/^\s*"?([^"<]+)"?\s*<([^>]+)>\s*$/', $fromOverride, $m)) {
            $fromName  = trim($m[1]);
            $fromEmail = trim($m[2]);
        } else {
            $fromEmail = $fromOverride;
        }
    }

    require_once __DIR__ . '/lib/smtp.php';
    $result = sendSmtpMessage([
        'host'       => 'smtp.gmail.com',
        'port'       => 587,
        'username'   => $user,
        'password'   => $pass,
        'from_email' => $fromEmail,
        'from_name'  => $fromName,
        'to'         => $to,
        'subject'    => (string) ($subject ?? ''),
        'body_text'  => $body,
    ]);

    if (empty($result['ok'])) {
        throw new RuntimeException('Gmail SMTP send failed: ' . ($result['error'] ?? 'unknown'));
    }
    return $result['message_id'] ?? ('gmail-' . substr(bin2hex(random_bytes(8)), 0, 16));
}
}

<?php
// Outbound dispatcher — per-lead email/SMS jobs.
//
// Adapter pattern: each provider implements (job) -> {ok, message_id, fail_reason}.
// Three providers are wired:
//   - 'stub'      — pretends to send. Default until creds are set.
//   - 'gmail'     — SMTP via Gmail / Workspace app password (api/lib/smtp.php).
//   - 'openphone' — REST POST to api.openphone.com for SMS.
//
// Provider is picked per-job from the `provider` column. Callers that
// don't set one get whatever resolveOutboundProvider() picks based on
// the .env config.
//
// Single entry point: dispatchOutboundJob(PDO, jobId) — looks up the job,
// runs the right adapter, updates status / sent_at / message_id, logs a
// contact_logged activity. Caller doesn't care what provider it was.
//
// All credentials come from the .env file via getEnvValue() — no
// constants in code, no plaintext keys in the repo.

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/pipeline.php';
require_once __DIR__ . '/lib/smtp.php';

const OUTBOUND_PROVIDER_DEFAULT = 'stub';
const OUTBOUND_MAX_ATTEMPTS     = 5;

/**
 * Pick the live provider for a kind based on what .env has configured.
 * Falls back to 'stub' when creds are missing so a fresh checkout still
 * exercises the UX flow without burning real sends on dev clicks.
 */
function resolveOutboundProvider(string $kind): string
{
    if ($kind === 'email') {
        if (getEnvValue('GMAIL_SMTP_USER') !== '' && getEnvValue('GMAIL_SMTP_PASS') !== '') {
            return 'gmail';
        }
        return 'stub';
    }
    if ($kind === 'sms') {
        if (getEnvValue('OPENPHONE_API_KEY') !== '' && getEnvValue('OPENPHONE_PHONE_NUMBER_ID') !== '') {
            return 'openphone';
        }
        return 'stub';
    }
    return 'stub';
}

/**
 * Stub provider — pretends to send. Returns a synthetic message id so
 * the whole UX flow lights up before any real provider is wired.
 */
function dispatchStubJob(array $job): array
{
    return ['ok' => true, 'message_id' => 'stub-' . bin2hex(random_bytes(8))];
}

/**
 * Gmail SMTP — submission via smtp.gmail.com:587 with STARTTLS + an
 * account App Password. Multipart/alternative with a styled vinvault
 * signature appended at send time.
 */
function dispatchGmailJob(array $job): array
{
    if ($job['kind'] !== 'email') {
        return ['ok' => false, 'fail_reason' => 'gmail_provider_email_only'];
    }
    $user = getEnvValue('GMAIL_SMTP_USER');
    $pass = getEnvValue('GMAIL_SMTP_PASS');
    if ($user === '' || $pass === '') {
        return ['ok' => false, 'fail_reason' => 'gmail_not_configured'];
    }

    $fromEmail = getEnvValue('GMAIL_FROM_EMAIL', $user);
    $fromName  = getEnvValue('GMAIL_FROM_NAME',  '');

    // Pull sender's first name + signature from DB to compose the sign-off.
    $db = getDBConnection();
    $sig = buildEmailSignature($db, (int) ($job['created_by'] ?? 0));

    $rawBody  = (string) ($job['body'] ?? '');
    $textBody = $sig['text'] !== '' ? $rawBody . "\n\n" . $sig['text'] : $rawBody;
    $htmlBody = renderEmailHtmlBody($rawBody, $sig['html']);

    $result = sendSmtpMessage([
        'host'       => 'smtp.gmail.com',
        'port'       => 587,
        'username'   => $user,
        'password'   => $pass,
        'from_email' => $fromEmail,
        'from_name'  => $fromName,
        'to'         => $job['to_address'],
        'subject'    => (string) ($job['subject'] ?? ''),
        'body_text'  => $textBody,
        'body_html'  => $htmlBody,
    ]);

    return [
        'ok'          => !empty($result['ok']),
        'message_id'  => $result['message_id'] ?? null,
        'fail_reason' => empty($result['ok']) ? ($result['error'] ?? 'gmail_send_failed') : null,
    ];
}

/**
 * OpenPhone — REST POST to /v1/messages with the API key in the
 * Authorization header (no Bearer prefix, per OpenPhone docs).
 */
function dispatchOpenPhoneJob(array $job): array
{
    if ($job['kind'] !== 'sms') {
        return ['ok' => false, 'fail_reason' => 'openphone_provider_sms_only'];
    }
    $apiKey = getEnvValue('OPENPHONE_API_KEY');
    $phoneId = getEnvValue('OPENPHONE_PHONE_NUMBER_ID');
    if ($apiKey === '' || $phoneId === '') {
        return ['ok' => false, 'fail_reason' => 'openphone_not_configured'];
    }

    $payload = json_encode([
        'phoneNumberId' => $phoneId,
        'to'            => [$job['to_address']],
        'content'       => (string) ($job['body'] ?? ''),
    ]);

    $ch = curl_init('https://api.openphone.com/v1/messages');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $payload,
        CURLOPT_HTTPHEADER     => [
            'Authorization: ' . $apiKey,
            'Content-Type: application/json',
        ],
        CURLOPT_TIMEOUT        => 20,
    ]);
    $body = curl_exec($ch);
    $http = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err  = curl_error($ch);
    curl_close($ch);

    if ($body === false) {
        return ['ok' => false, 'fail_reason' => "openphone_curl_error: $err"];
    }
    $decoded = json_decode($body, true);

    if ($http >= 200 && $http < 300) {
        $msgId = $decoded['data']['id'] ?? null;
        return ['ok' => true, 'message_id' => $msgId];
    }
    $reason = $decoded['message']
        ?? $decoded['errors'][0]['message']
        ?? "openphone_http_$http";
    return ['ok' => false, 'fail_reason' => substr((string) $reason, 0, 400)];
}

const PROVIDER_DISPATCHERS = [
    'stub'      => 'dispatchStubJob',
    'gmail'     => 'dispatchGmailJob',
    'openphone' => 'dispatchOpenPhoneJob',
];

// -----------------------------------------------------------------------------
// Email signature builder
// -----------------------------------------------------------------------------

/**
 * Returns {text, html} for the email sign-off block. First name comes
 * from users.name; brand fields come from .env (SIGNATURE_*) with
 * sensible vinvault.us defaults.
 */
function buildEmailSignature(PDO $db, int $userId): array
{
    $firstName = '';
    if ($userId > 0) {
        $stmt = $db->prepare('SELECT name FROM users WHERE id = :id');
        $stmt->execute([':id' => $userId]);
        $row = $stmt->fetch();
        if ($row && !empty($row['name'])) {
            $firstName = trim(explode(' ', trim($row['name']))[0] ?? '');
        }
    }

    $brandUrl = getEnvValue('SIGNATURE_BRAND_URL',     'https://vinvault.us');
    $logoUrl  = getEnvValue('SIGNATURE_LOGO_URL',      'https://crm.vinvault.us/brand/vinvault-logo.svg');
    $email    = getEnvValue('SIGNATURE_CONTACT_EMAIL', 'admin@vinvault.us');
    $phone    = getEnvValue('SIGNATURE_CONTACT_PHONE', '(469) 971-2609');

    $brandHost = preg_replace('#^https?://#', '', $brandUrl);

    // --- Plain text ------------------------------------------------------
    $textParts = ['Best,'];
    if ($firstName !== '') $textParts[] = $firstName;
    $textParts[] = '';
    $textParts[] = $brandHost;
    if ($email !== '' || $phone !== '') {
        $textParts[] = trim($email . ($email !== '' && $phone !== '' ? ' | ' : '') . $phone);
    }
    $text = implode("\n", $textParts);

    // --- HTML ------------------------------------------------------------
    $h = function ($v) { return htmlspecialchars((string) $v, ENT_QUOTES | ENT_HTML5, 'UTF-8'); };

    $logoHtml = $logoUrl !== ''
        ? '<div style="margin-top:10px;"><img src="' . $h($logoUrl) . '" alt="VINVAULT" width="160" height="40" '
          . 'style="display:block; max-width:160px; height:auto; border:0; outline:none; text-decoration:none;"></div>'
        : '';

    $contactBits = [];
    if ($email !== '') {
        $contactBits[] = '<a href="mailto:' . $h($email) . '" style="color:#71717a; text-decoration:none;">' . $h($email) . '</a>';
    }
    if ($phone !== '') {
        $telHref = preg_replace('/\D+/', '', $phone);
        $contactBits[] = '<a href="tel:' . $h('+1' . $telHref) . '" style="color:#71717a; text-decoration:none;">' . $h($phone) . '</a>';
    }
    $contactLine = implode(' &nbsp;|&nbsp; ', $contactBits);

    $html = ''
        . '<div style="margin-top:32px; padding-top:16px; border-top:1px solid #e4e4e7; '
        .              'font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Helvetica,Arial,sans-serif; '
        .              'color:#18181b; font-size:14px; line-height:1.5;">'
        .   '<div>Best,'
        .     ($firstName !== '' ? '<br>' . $h($firstName) : '')
        .   '</div>'
        .   '<div style="margin-top:14px;">'
        .     '<a href="' . $h($brandUrl) . '" style="color:#0A0A0A; text-decoration:none; font-weight:600; letter-spacing:0.04em;">'
        .       $h($brandHost)
        .     '</a>'
        .   '</div>'
        .   $logoHtml
        .   ($contactLine !== '' ? '<div style="font-size:12px; color:#71717a; margin-top:8px;">' . $contactLine . '</div>' : '')
        . '</div>';

    return ['text' => $text, 'html' => $html];
}

function renderEmailHtmlBody(string $rawBody, string $signatureHtml): string
{
    $h = htmlspecialchars($rawBody, ENT_QUOTES | ENT_HTML5, 'UTF-8');
    $paragraphs = preg_split("/\n{2,}/", $h);
    $bodyHtml = '';
    foreach ($paragraphs as $p) {
        $bodyHtml .= '<p style="margin:0 0 12px 0;">' . str_replace("\n", '<br>', $p) . '</p>';
    }
    return '<!DOCTYPE html><html><body style="margin:0; padding:0; '
         . 'font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Helvetica,Arial,sans-serif; '
         . 'font-size:15px; line-height:1.55; color:#18181b;">'
         . '<div style="max-width:600px; margin:0 auto; padding:16px;">'
         . $bodyHtml . $signatureHtml
         . '</div></body></html>';
}

// -----------------------------------------------------------------------------
// Job lifecycle
// -----------------------------------------------------------------------------

function dispatchOutboundJob(PDO $db, int $jobId): array
{
    $stmt = $db->prepare('SELECT * FROM outbound_jobs WHERE id = :id');
    $stmt->execute([':id' => $jobId]);
    $job = $stmt->fetch();
    if (!$job) return ['ok' => false, 'reason' => 'job_not_found'];
    if ($job['status'] === 'sent') {
        return ['ok' => true, 'reason' => 'already_sent', 'message_id' => $job['provider_message_id']];
    }

    $provider = $job['provider'] ?: OUTBOUND_PROVIDER_DEFAULT;
    $dispatcher = PROVIDER_DISPATCHERS[$provider] ?? null;
    if (!$dispatcher) {
        markJobFailed($db, $jobId, "Unknown provider '$provider'");
        return ['ok' => false, 'reason' => 'unknown_provider'];
    }

    $db->prepare('UPDATE outbound_jobs SET status=\'sending\', attempts = attempts + 1 WHERE id = :id')
       ->execute([':id' => $jobId]);

    try {
        $result = $dispatcher($job);
    } catch (Throwable $e) {
        $result = ['ok' => false, 'fail_reason' => $e->getMessage()];
    }

    if (!empty($result['ok'])) {
        $upd = $db->prepare(
            'UPDATE outbound_jobs
                SET status=\'sent\', provider_message_id = :mid, sent_at = NOW(), fail_reason = NULL
              WHERE id = :id'
        );
        $upd->execute([':id' => $jobId, ':mid' => $result['message_id'] ?? null]);

        // Activity-log onto the lead — best-effort, soft-fail.
        if ($job['imported_lead_id'] && function_exists('logLeadActivity')) {
            try {
                logLeadActivity(
                    $db,
                    (int) $job['imported_lead_id'],
                    (int) ($job['created_by'] ?: 0) ?: 0,
                    'contact_logged',
                    null,
                    [
                        'channel'             => $job['kind'] === 'sms' ? 'sms' : 'email',
                        'outcome'             => 'completed',
                        'subject'             => $job['subject'],
                        'provider'            => $provider,
                        'provider_message_id' => $result['message_id'] ?? null,
                    ]
                );
            } catch (Throwable $_e) { /* silent */ }
        }

        return ['ok' => true, 'message_id' => $result['message_id'] ?? null];
    }

    $reason = $result['fail_reason'] ?? 'unknown_error';
    markJobFailed($db, $jobId, $reason);
    return ['ok' => false, 'reason' => $reason];
}

function markJobFailed(PDO $db, int $jobId, string $reason): void
{
    $db->prepare(
        'UPDATE outbound_jobs
            SET status = IF(attempts >= :maxa, \'failed\', \'pending\'),
                fail_reason = :r,
                run_at = IF(attempts >= :maxa2, run_at, DATE_ADD(NOW(), INTERVAL POW(2, attempts) MINUTE))
          WHERE id = :id'
    )->execute([
        ':maxa'  => OUTBOUND_MAX_ATTEMPTS,
        ':maxa2' => OUTBOUND_MAX_ATTEMPTS,
        ':r'     => substr($reason, 0, 500),
        ':id'    => $jobId,
    ]);
}

/**
 * Enqueue + dispatch in one shot. Used by api/lead_send.php for one-off
 * operator-driven sends. Returns the new job row + dispatch result.
 */
function enqueueAndDispatchOutbound(PDO $db, array $params): array
{
    $kind     = $params['kind']     ?? '';
    $to       = $params['to']       ?? '';
    $body     = $params['body']     ?? '';
    $subject  = $params['subject']  ?? null;
    $leadId   = $params['imported_lead_id'] ?? null;
    $userId   = $params['created_by'] ?? null;
    $provider = $params['provider'] ?? resolveOutboundProvider($kind);

    if (!in_array($kind, ['email', 'sms'], true)) {
        pipelineFail(400, "Invalid kind '$kind' (must be email or sms)", 'invalid_kind');
    }
    if (trim((string) $to) === '')   pipelineFail(400, 'to_address is required', 'missing_to');
    if (trim((string) $body) === '') pipelineFail(400, 'body is required', 'missing_body');
    if ($kind === 'email' && trim((string) ($subject ?? '')) === '') {
        pipelineFail(400, 'subject is required for email', 'missing_subject');
    }
    if (!array_key_exists($provider, PROVIDER_DISPATCHERS)) {
        pipelineFail(400, "Unknown provider '$provider'", 'unknown_provider');
    }

    $stmt = $db->prepare(
        'INSERT INTO outbound_jobs
           (kind, provider, imported_lead_id, to_address, subject, body, status, run_at, created_by)
         VALUES
           (:kind, :provider, :lead, :to, :subject, :body, \'pending\', NOW(), :user)'
    );
    $stmt->execute([
        ':kind' => $kind, ':provider' => $provider, ':lead' => $leadId,
        ':to' => $to, ':subject' => $subject, ':body' => $body, ':user' => $userId,
    ]);
    $id = (int) $db->lastInsertId();
    $result = dispatchOutboundJob($db, $id);

    $row = $db->prepare('SELECT * FROM outbound_jobs WHERE id = :id');
    $row->execute([':id' => $id]);
    return ['job' => $row->fetch(), 'result' => $result];
}

<?php
// Admin-only secrets management endpoint.
//
// GET  → returns the list of recognized keys + masked values + which
//        ones are currently set. Plaintext values NEVER leave this
//        endpoint, so the UI can show "••••6e30" without exposing the
//        full key on every page load.
// PUT  → set or clear a single key. Body: { key, value }. An empty
//        string value clears the row.
//
// Whitelist-driven: only the keys in OUTBOUND_SECRET_KEYS can be
// written through this endpoint, so an attacker (or accidental UI
// submission) can't sneak arbitrary key/value pairs into config.

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/pipeline.php';
initSession();

$user = requireAuth();
assertAdmin($user);
$db = getDBConnection();
$method = $_SERVER['REQUEST_METHOD'];

const OUTBOUND_SECRET_KEYS = [
    // Gmail SMTP
    'GMAIL_SMTP_USER',
    'GMAIL_SMTP_PASS',
    'GMAIL_FROM_EMAIL',
    'GMAIL_FROM_NAME',
    // OpenPhone
    'OPENPHONE_API_KEY',
    'OPENPHONE_PHONE_NUMBER_ID',
    'OPENPHONE_WEBHOOK_SECRET',
    // Email signature overrides
    'SIGNATURE_BRAND_URL',
    'SIGNATURE_LOGO_URL',
    'SIGNATURE_CONTACT_EMAIL',
    'SIGNATURE_CONTACT_PHONE',
];

/** Show last 4 chars; the rest as dots. Empty → empty. */
function maskSecret(string $v): string
{
    if ($v === '') return '';
    $len = strlen($v);
    if ($len <= 4) return str_repeat('•', $len);
    return str_repeat('•', max(0, $len - 4)) . substr($v, -4);
}

if ($method === 'GET') {
    $stmt = $db->query('SELECT `key`, `value`, updated_at, updated_by FROM app_secrets');
    $stored = [];
    foreach ($stmt->fetchAll() as $r) {
        $stored[$r['key']] = $r;
    }

    $out = [];
    foreach (OUTBOUND_SECRET_KEYS as $k) {
        // Honor .env / env-var presence too — those rows are "set"
        // even if app_secrets is empty. Don't reveal the plaintext.
        $envHas  = (getEnvValue($k) !== '');
        $dbRow   = $stored[$k] ?? null;
        $hasDb   = $dbRow !== null && $dbRow['value'] !== '';
        $out[] = [
            'key'        => $k,
            'is_set'     => $envHas,
            'masked'     => $envHas ? maskSecret(getEnvValue($k)) : '',
            'source'     => $hasDb ? 'db' : ($envHas ? 'env' : null),
            'updated_at' => $dbRow['updated_at'] ?? null,
            'updated_by' => $dbRow['updated_by'] ?? null,
        ];
    }
    echo json_encode($out);
    exit();
}

if ($method === 'PUT') {
    $input = json_decode(file_get_contents('php://input'), true) ?? [];
    $key = (string) ($input['key'] ?? '');
    $val = $input['value'] ?? '';
    if (!in_array($key, OUTBOUND_SECRET_KEYS, true)) {
        pipelineFail(400, "Unknown secret key '$key'", 'unknown_key');
    }
    $val = is_string($val) ? trim($val) : '';

    if ($val === '') {
        // Empty value → delete the row entirely. This re-exposes any
        // .env / env-var fallback if one is set on the server.
        $db->prepare('DELETE FROM app_secrets WHERE `key` = :k')->execute([':k' => $key]);
    } else {
        $db->prepare(
            'INSERT INTO app_secrets (`key`, `value`, updated_by)
             VALUES (:k, :v, :uid)
             ON DUPLICATE KEY UPDATE
               `value` = VALUES(`value`),
               updated_by = VALUES(updated_by)'
        )->execute([':k' => $key, ':v' => $val, ':uid' => $user['id']]);
    }

    logLeadActivity_optional($db, $user['id'], $key, $val !== '');

    echo json_encode([
        'success' => true,
        'key'     => $key,
        'is_set'  => $val !== '',
        'masked'  => maskSecret($val),
    ]);
    exit();
}

pipelineFail(405, 'Method not allowed', 'method_not_allowed');

/**
 * Soft-call the audit logger — we log secret changes for traceability
 * but the lead_activities table is per-lead, not global. So we don't
 * have a great home for this event yet; just error_log it.
 */
function logLeadActivity_optional(PDO $db, int $userId, string $key, bool $isSet): void
{
    error_log(sprintf(
        '[app_secrets] user %d %s key %s at %s',
        $userId,
        $isSet ? 'set' : 'cleared',
        $key,
        gmdate('c')
    ));
}

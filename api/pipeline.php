<?php

// File pipeline constants and validators. Single source of truth.

const STAGES = ['generated', 'carfax', 'filter', 'tlo'];

const NEXT_STAGE = [
    'generated' => 'carfax',
    'carfax'    => 'filter',
    'filter'    => 'tlo',
    'tlo'       => null,
];

// Roles allowed to upload the artifact for a given stage and to advance INTO that stage.
// Admin is always permitted.
const STAGE_ROLES = [
    'generated' => ['admin'],
    'carfax'    => ['admin', 'carfax'],
    'filter'    => ['admin', 'filter'],
    'tlo'       => ['admin', 'tlo'],
];

const STATUSES = ['active', 'completed', 'blocked', 'flagged'];

const ALLOWED_EXTENSIONS = ['pdf', 'png', 'jpg', 'jpeg', 'xlsx', 'xls', 'csv'];
const SPREADSHEET_EXTENSIONS = ['xlsx', 'xls', 'csv'];

// Normalized lead fields — single source of truth for the import mapping layer.
// `_ignore` is a sentinel that tells the importer to drop a column entirely.
const NORMALIZED_FIELDS = [
    'vin', 'first_name', 'last_name', 'full_name',
    'phone_primary', 'phone_secondary', 'email_primary',
    'full_address', 'city', 'state', 'zip_code',
    'make', 'model', 'year', 'mileage',
    '_ignore',
];
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB

function pipelineFail(int $code, string $message, ?string $errCode = null): void
{
    http_response_code($code);
    echo json_encode(['success' => false, 'code' => $errCode ?? 'error', 'message' => $message]);
    exit();
}

function requireAuth(): array
{
    if (!isset($_SESSION['user_id'])) {
        pipelineFail(401, 'Not authenticated', 'unauthenticated');
    }
    requireCsrfToken();
    return [
        'id'   => (int) $_SESSION['user_id'],
        'role' => $_SESSION['user_role'] ?? null,
    ];
}

function assertStage(?string $stage): string
{
    if (!in_array($stage, STAGES, true)) {
        pipelineFail(400, 'Invalid stage', 'invalid_stage');
    }
    return $stage;
}

function assertRoleForStage(string $role, string $stage): void
{
    $allowed = STAGE_ROLES[$stage] ?? [];
    if (!in_array($role, $allowed, true)) {
        pipelineFail(403, "Role '$role' cannot act on stage '$stage'", 'role_forbidden');
    }
}

function loadFileOrFail(PDO $db, int $fileId): array
{
    $stmt = $db->prepare('SELECT * FROM files WHERE id = :id');
    $stmt->execute([':id' => $fileId]);
    $file = $stmt->fetch();
    if (!$file) {
        pipelineFail(404, 'File not found', 'file_not_found');
    }
    return $file;
}

function assertActive(array $file): void
{
    if (($file['status'] ?? 'active') !== 'active') {
        pipelineFail(409, "File is {$file['status']} and cannot be modified", 'file_not_active');
    }
}

const USER_ROLES = ['admin', 'carfax', 'filter', 'tlo', 'marketer'];

function assertAdminOrMarketer(array $user): void
{
    $role = $user['role'] ?? null;
    if ($role !== 'admin' && $role !== 'marketer') {
        pipelineFail(403, 'Admin or marketer role required', 'marketing_forbidden');
    }
}

function assertAdmin(array $user): void
{
    if (($user['role'] ?? null) !== 'admin') {
        pipelineFail(403, 'Admin role required', 'admin_required');
    }
}

/**
 * Sliding-window rate limit. Counts how many times this (scope, user) pair
 * has been recorded inside the last $windowSeconds; if at or over $maxRequests,
 * exits with 429. Otherwise inserts a new event row and returns.
 *
 * Cleanup is opportunistic: 1% of calls also delete events older than 1 day
 * to keep the table small without needing a cron.
 */
function enforceRateLimit(PDO $db, string $scope, int $userId, int $maxRequests, int $windowSeconds): void
{
    $cutoff = date('Y-m-d H:i:s', time() - $windowSeconds);
    $count = $db->prepare(
        'SELECT COUNT(*) FROM rate_limit_events
          WHERE scope = :s AND user_id = :u AND created_at >= :c'
    );
    $count->execute([':s' => $scope, ':u' => $userId, ':c' => $cutoff]);
    $hits = (int) $count->fetchColumn();

    if ($hits >= $maxRequests) {
        $retryAfter = $windowSeconds; // Conservative; client can retry after the full window
        header("Retry-After: $retryAfter");
        http_response_code(429);
        echo json_encode([
            'success' => false,
            'code'    => 'rate_limited',
            'message' => "Too many '$scope' requests. Try again in $retryAfter seconds.",
            'window_seconds' => $windowSeconds,
            'limit'   => $maxRequests,
        ]);
        exit();
    }

    $insert = $db->prepare(
        'INSERT INTO rate_limit_events (scope, user_id) VALUES (:s, :u)'
    );
    $insert->execute([':s' => $scope, ':u' => $userId]);

    // Opportunistic cleanup of rows older than 1 day. Cheap; runs ~1% of calls.
    if (random_int(1, 100) === 1) {
        $db->exec(
            "DELETE FROM rate_limit_events WHERE created_at < DATE_SUB(NOW(), INTERVAL 1 DAY)"
        );
    }
}

function validateUploadedArtifact(array $phpFile): void
{
    if (($phpFile['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        pipelineFail(400, 'File upload failed', 'upload_error');
    }
    if ($phpFile['size'] > MAX_UPLOAD_BYTES) {
        pipelineFail(413, 'File too large', 'file_too_large');
    }
    $ext = strtolower(pathinfo($phpFile['name'], PATHINFO_EXTENSION));
    if (!in_array($ext, ALLOWED_EXTENSIONS, true)) {
        pipelineFail(415, 'Unsupported file type', 'unsupported_type');
    }
}

function storeUploadedFile(string $uploadDir, array $phpFile): array
{
    $ext = strtolower(pathinfo($phpFile['name'], PATHINFO_EXTENSION));
    $storedName = uniqid('', true) . '_' . bin2hex(random_bytes(8)) . ($ext ? '.' . $ext : '');
    $destination = $uploadDir . $storedName;
    if (!move_uploaded_file($phpFile['tmp_name'], $destination)) {
        pipelineFail(500, 'Failed to store file', 'store_failed');
    }
    return [
        'stored_name'  => $storedName,
        'destination'  => $destination,
        'relative_path' => 'api/uploads/' . $storedName,
    ];
}

function fileExtension(string $filename): string
{
    return strtolower(pathinfo($filename, PATHINFO_EXTENSION));
}

/**
 * Evaluates whether a (file, artifact) pair is eligible to be used as the source
 * of a final-import batch. Returns ['eligible' => bool, 'reason' => ?string, 'code' => ?string,
 * 'file' => array|null, 'artifact' => array|null].
 */
function checkImportEligibility(PDO $db, int $fileId, int $artifactId): array
{
    $stmt = $db->prepare('SELECT * FROM files WHERE id = :id');
    $stmt->execute([':id' => $fileId]);
    $file = $stmt->fetch();
    if (!$file) {
        return ['eligible' => false, 'code' => 'file_not_found', 'reason' => 'File not found', 'file' => null, 'artifact' => null];
    }

    $stmt = $db->prepare('SELECT * FROM file_artifacts WHERE id = :id');
    $stmt->execute([':id' => $artifactId]);
    $artifact = $stmt->fetch();
    if (!$artifact) {
        return ['eligible' => false, 'code' => 'artifact_not_found', 'reason' => 'Artifact not found', 'file' => $file, 'artifact' => null];
    }

    if ((int) $artifact['file_id'] !== (int) $file['id']) {
        return ['eligible' => false, 'code' => 'artifact_mismatch', 'reason' => 'Artifact does not belong to this file', 'file' => $file, 'artifact' => $artifact];
    }
    if ($file['current_stage'] !== 'tlo') {
        return ['eligible' => false, 'code' => 'file_stage_invalid', 'reason' => 'File must be at TLO stage', 'file' => $file, 'artifact' => $artifact];
    }
    if (!in_array($file['status'], ['completed', 'active'], true)) {
        return ['eligible' => false, 'code' => 'file_not_eligible', 'reason' => "File status '{$file['status']}' is not importable", 'file' => $file, 'artifact' => $artifact];
    }
    if ($artifact['stage'] !== 'tlo') {
        return ['eligible' => false, 'code' => 'artifact_stage_invalid', 'reason' => 'Only TLO-stage artifacts can be imported', 'file' => $file, 'artifact' => $artifact];
    }

    $ext = fileExtension($artifact['original_filename']);
    if (!in_array($ext, SPREADSHEET_EXTENSIONS, true)) {
        return ['eligible' => false, 'code' => 'unsupported_file_type', 'reason' => "Artifact must be xlsx/xls/csv (got .$ext)", 'file' => $file, 'artifact' => $artifact];
    }

    return ['eligible' => true, 'code' => null, 'reason' => null, 'file' => $file, 'artifact' => $artifact];
}

// ----- CRM actions layer -----

const LEAD_STATUSES = [
    'new','contacted','callback','interested','not_interested',
    'wrong_number','no_answer','voicemail_left','deal_closed',
    'nurture','disqualified','do_not_call',
    'marketing',
];
const LEAD_PRIORITIES = ['low','medium','high'];
const LEAD_TEMPERATURES = ['no_answer','cold','warm','hot','closed'];

// -- Tier classification --------------------------------------------------
// Tiers are auto-computed from the normalized payload (number of owners +
// mileage). Tier 1 is the highest-quality lead. To tune the thresholds,
// change both `LEAD_TIER_THRESHOLDS` (used in PHP) and the matching block in
// `leadTierSqlExpression()` below.
const LEAD_TIERS = ['tier_1','tier_2','tier_3'];
const LEAD_TIER_THRESHOLDS = [
    // Evaluated in order; first match wins.
    ['key' => 'tier_1', 'max_owners' => 1, 'max_miles' => 100000],
    ['key' => 'tier_2', 'max_owners' => 2, 'max_miles' => 150000],
    // Everything else falls through to tier_3.
];

/**
 * Classify a lead into Tier 1/2/3 from its normalized payload.
 *
 * Missing or non-numeric data → `tier_3` (worst tier). Accepts both
 * `mileage` (post-mapping) and `LastReportedMiles` (raw CSV header).
 */
function computeLeadTier(array $np): string
{
    $rawOwners = $np['NumberOfOwners'] ?? $np['number_of_owners'] ?? null;
    $rawMiles  = $np['mileage'] ?? $np['LastReportedMiles'] ?? null;
    $owners = is_numeric(str_replace([',',' '], '', (string) $rawOwners)) ? (int) str_replace([',',' '], '', (string) $rawOwners) : null;
    $miles  = is_numeric(str_replace([',',' '], '', (string) $rawMiles))  ? (int) str_replace([',',' '], '', (string) $rawMiles)  : null;
    foreach (LEAD_TIER_THRESHOLDS as $t) {
        if ($owners !== null && $owners <= $t['max_owners']
            && $miles  !== null && $miles  <= $t['max_miles']) {
            return $t['key'];
        }
    }
    return 'tier_3';
}

/**
 * SQL expression that computes the same tier for use inside `leads.php`
 * WHERE/SELECT clauses. Keep this in sync with `computeLeadTier()`.
 * Produces a column aliased as `tier`.
 */
function leadTierSqlExpression(string $alias = 'tier'): string
{
    $ownersExpr = "COALESCE(
        CAST(JSON_UNQUOTE(JSON_EXTRACT(r.normalized_payload_json, '$.NumberOfOwners')) AS UNSIGNED),
        CAST(JSON_UNQUOTE(JSON_EXTRACT(r.normalized_payload_json, '$.number_of_owners')) AS UNSIGNED),
        99
    )";
    // Miles can arrive with commas in the source (\"154,123\"). REPLACE them
    // before CAST. JSON_UNQUOTE on a missing key returns NULL → UNSIGNED cast
    // of NULL is 0 — we use COALESCE to force 'unknown' → 99999999.
    $milesExpr = "COALESCE(
        CAST(REPLACE(JSON_UNQUOTE(JSON_EXTRACT(r.normalized_payload_json, '$.mileage')), ',', '') AS UNSIGNED),
        CAST(REPLACE(JSON_UNQUOTE(JSON_EXTRACT(r.normalized_payload_json, '$.LastReportedMiles')), ',', '') AS UNSIGNED),
        99999999
    )";

    $cases = [];
    foreach (LEAD_TIER_THRESHOLDS as $t) {
        $cases[] = "WHEN $ownersExpr <= {$t['max_owners']} AND $milesExpr <= {$t['max_miles']} THEN '{$t['key']}'";
    }
    $cases[] = "ELSE 'tier_3'";
    return "(CASE " . implode(' ', $cases) . " END) AS $alias";
}

function assertLeadTier(string $tier): void
{
    if (!in_array($tier, LEAD_TIERS, true)) {
        pipelineFail(400, "Invalid tier '$tier'", 'invalid_tier');
    }
}
const LEAD_ACTIVITY_TYPES = [
    'status_changed','priority_changed','assigned','unassigned',
    'label_added','label_removed',
    'note_added','note_edited','note_deleted',
    'temperature_changed','price_wanted_changed','price_offered_changed',
    'task_created','task_updated','task_completed','task_cancelled','task_reopened',
    'contact_logged',
    'merge_prep_updated',
    'moved_to_marketing','campaign_sent','campaign_opened','campaign_clicked',
    'campaign_replied','campaign_bounced','opted_out',
];

const MARKETING_CHANNELS          = ['email','sms','whatsapp'];
const MARKETING_CAMPAIGN_STATUSES = ['draft','queued','sending','sent','partially_failed','cancelled'];
const MARKETING_SEND_STATUSES     = ['pending','sending','sent','failed','skipped','bounced','opted_out'];
const MARKETING_SUPPRESSION_REASONS = ['unsubscribe','bounce','complaint','manual_dnc','legal'];

const MERGE_PREP_STATUSES = ['draft','prepared'];

const LEAD_TASK_TYPES    = ['callback','follow_up','review','verify_contact','custom'];
const LEAD_TASK_STATUSES = ['open','completed','cancelled'];
const CONTACT_CHANNELS   = ['phone','email','sms','whatsapp','other'];
const CONTACT_OUTCOMES   = [
    'attempted','connected','no_answer','voicemail','wrong_number',
    'follow_up_needed','completed','other',
];

const NOTIFICATION_TYPES = [
    'task_overdue','task_due_today','task_due_soon','task_assigned','task_reopened',
];

// "Due soon" window, in hours, used by the scanner.
const DUE_SOON_HOURS = 3;

const DEFAULT_LEAD_STATE = [
    'status'           => 'new',
    'priority'         => 'medium',
    'assigned_user_id' => null,
    'lead_temperature' => null,
    'price_wanted'     => null,
    'price_offered'    => null,
];

function assertLeadStatus(string $status): void
{
    if (!in_array($status, LEAD_STATUSES, true)) {
        pipelineFail(400, "Invalid status '$status'", 'invalid_status');
    }
}

function assertLeadPriority(string $priority): void
{
    if (!in_array($priority, LEAD_PRIORITIES, true)) {
        pipelineFail(400, "Invalid priority '$priority'", 'invalid_priority');
    }
}

function assertLeadTemperature(?string $temperature): void
{
    if ($temperature === null) return;
    if (!in_array($temperature, LEAD_TEMPERATURES, true)) {
        pipelineFail(400, "Invalid lead_temperature '$temperature'", 'invalid_temperature');
    }
}

function assertTaskType(string $type): void
{
    if (!in_array($type, LEAD_TASK_TYPES, true)) {
        pipelineFail(400, "Invalid task_type '$type'", 'invalid_task_type');
    }
}

function assertContactChannel(string $channel): void
{
    if (!in_array($channel, CONTACT_CHANNELS, true)) {
        pipelineFail(400, "Invalid channel '$channel'", 'invalid_channel');
    }
}

function assertContactOutcome(string $outcome): void
{
    if (!in_array($outcome, CONTACT_OUTCOMES, true)) {
        pipelineFail(400, "Invalid outcome '$outcome'", 'invalid_outcome');
    }
}

function assertMarketingChannel(string $channel): void
{
    if (!in_array($channel, MARKETING_CHANNELS, true)) {
        pipelineFail(400, "Invalid marketing channel '$channel'", 'invalid_marketing_channel');
    }
}

function assertSuppressionReason(string $reason): void
{
    if (!in_array($reason, MARKETING_SUPPRESSION_REASONS, true)) {
        pipelineFail(400, "Invalid suppression reason '$reason'", 'invalid_suppression_reason');
    }
}

/**
 * Normalize a contact identifier for suppression lookup.
 * Email: lowercased, trimmed. Phone: digits only (loose E.164; leading + preserved if present).
 */
function normalizeContactIdentifier(string $type, string $value): string
{
    $value = trim($value);
    if ($type === 'email') return strtolower($value);
    if ($type === 'phone') {
        $keepPlus = str_starts_with($value, '+') ? '+' : '';
        return $keepPlus . preg_replace('/\D+/', '', $value);
    }
    return $value;
}

/**
 * Read a shared secret used to sign unsubscribe tokens. Falls back to a
 * per-install hash of the DB DSN so links work without extra config, but the
 * user should set MARKETING_UNSUBSCRIBE_SECRET in config for rotation safety.
 */
function marketingTokenSecret(): string
{
    if (defined('MARKETING_UNSUBSCRIBE_SECRET') && MARKETING_UNSUBSCRIBE_SECRET !== '') {
        return MARKETING_UNSUBSCRIBE_SECRET;
    }
    $fallback = defined('DB_NAME') ? DB_NAME : 'vin_dashboard';
    return 'marketing:' . hash('sha256', $fallback);
}

/** Sign "<campaign_id>:<recipient_id>" so an opt-out link can't be forged. */
function signUnsubscribeToken(int $campaignId, int $recipientId): string
{
    $payload = $campaignId . ':' . $recipientId;
    $sig = hash_hmac('sha256', $payload, marketingTokenSecret());
    // URL-safe base64 of "payload|sig" — short, readable, opaque.
    return rtrim(strtr(base64_encode($payload . '|' . $sig), '+/', '-_'), '=');
}

/** Returns [campaignId, recipientId] or null if the token is invalid/tampered. */
function parseUnsubscribeToken(string $token): ?array
{
    $decoded = base64_decode(strtr($token, '-_', '+/'), true);
    if ($decoded === false || !str_contains($decoded, '|')) return null;
    [$payload, $sig] = explode('|', $decoded, 2);
    $expected = hash_hmac('sha256', $payload, marketingTokenSecret());
    if (!hash_equals($expected, $sig)) return null;
    $parts = explode(':', $payload);
    if (count($parts) !== 2) return null;
    return [(int) $parts[0], (int) $parts[1]];
}

/**
 * Parses a datetime string (e.g. "2026-04-18T10:00" from datetime-local) into
 * the DATETIME format MySQL expects. Returns null for null/empty.
 */
function parseDatetime($value, string $field): ?string
{
    if ($value === null || $value === '') return null;
    $value = str_replace('T', ' ', (string) $value);
    $ts = strtotime($value);
    if ($ts === false) {
        pipelineFail(400, "$field is not a valid date/time", 'invalid_datetime');
    }
    return date('Y-m-d H:i:s', $ts);
}

/** Parses an optional price value. Accepts null, '' (=null), numeric strings, or numbers. */
function parseLeadPrice($value, string $field): ?string
{
    if ($value === null || $value === '') return null;
    if (!is_numeric($value)) {
        pipelineFail(400, "$field must be numeric", 'invalid_price');
    }
    $num = (float) $value;
    if ($num < 0) {
        pipelineFail(400, "$field must be non-negative", 'invalid_price');
    }
    if ($num > 9999999999.99) {
        pipelineFail(400, "$field is too large", 'invalid_price');
    }
    // Normalize to 2-decimal string for stable diffing against DB values.
    return number_format($num, 2, '.', '');
}

function loadLeadOrFail(PDO $db, int $leadId): array
{
    $stmt = $db->prepare('SELECT id FROM imported_leads_raw WHERE id = :id');
    $stmt->execute([':id' => $leadId]);
    $row = $stmt->fetch();
    if (!$row) pipelineFail(404, 'Lead not found', 'lead_not_found');
    return $row;
}

// ----- Duplicate detection -----

const DUPLICATE_MATCH_TYPES = ['vin','phone','email','address_last_name','name_phone'];
const DUPLICATE_REVIEW_STATUSES = ['pending','confirmed_duplicate','not_duplicate','ignored'];
const DUPLICATE_DECISIONS      = ['pending','confirmed_duplicate','not_duplicate','ignored'];

const DUPLICATE_CONFIDENCE = [
    'vin'               => 0.95,
    'email'             => 0.90,
    'phone'             => 0.85,
    'name_phone'        => 0.85,
    'address_last_name' => 0.70,
];

function assertMatchType(?string $type): void
{
    if (!in_array($type, DUPLICATE_MATCH_TYPES, true)) {
        pipelineFail(400, "Invalid match_type '$type'", 'invalid_match_type');
    }
}

function assertReviewDecision(?string $decision): void
{
    if (!in_array($decision, DUPLICATE_DECISIONS, true)) {
        pipelineFail(400, "Invalid decision '$decision'", 'invalid_decision');
    }
}

function logLeadActivity(PDO $db, int $leadId, int $userId, string $type, $oldValue = null, $newValue = null): void
{
    if (!in_array($type, LEAD_ACTIVITY_TYPES, true)) {
        pipelineFail(500, "Unknown activity type '$type'", 'invalid_activity_type');
    }
    $stmt = $db->prepare(
        'INSERT INTO lead_activities (imported_lead_id, user_id, activity_type, old_value_json, new_value_json)
         VALUES (:lead, :user, :type, :old, :new)'
    );
    $stmt->execute([
        ':lead' => $leadId,
        ':user' => $userId,
        ':type' => $type,
        ':old'  => $oldValue === null ? null : json_encode($oldValue),
        ':new'  => $newValue === null ? null : json_encode($newValue),
    ]);

    // Auto-resolve any open SLA alerts for this lead. Activity = no longer
    // stale, so the rule should re-evaluate from scratch on the next cron pass.
    // Soft-fail if the SLA tables don't exist yet (pre-migration installs).
    try {
        $u = $db->prepare(
            "UPDATE sla_alerts
                SET resolved_at = NOW(), resolved_reason = :reason
              WHERE imported_lead_id = :lead AND resolved_at IS NULL"
        );
        $u->execute([':lead' => $leadId, ':reason' => 'activity:' . $type]);
    } catch (Throwable $_e) {
        // sla_alerts not present; ignore.
    }
}

// ----- Notifications -----

/**
 * Insert a notification for a user. Uses INSERT IGNORE against the UNIQUE
 * (user_id, dedupe_key) constraint, so calling this repeatedly with the same
 * dedupe_key is a no-op. Callers don't need to check first.
 */
function createNotification(
    PDO $db,
    int $userId,
    string $type,
    string $dedupeKey,
    string $title,
    ?string $message = null,
    ?int $relatedLeadId = null,
    ?int $relatedTaskId = null
): void {
    if (!in_array($type, NOTIFICATION_TYPES, true)) {
        pipelineFail(500, "Unknown notification type '$type'", 'invalid_notification_type');
    }
    $stmt = $db->prepare(
        'INSERT IGNORE INTO notifications
            (user_id, type, title, message, related_lead_id, related_task_id, dedupe_key)
         VALUES (:uid, :type, :title, :msg, :lid, :tid, :key)'
    );
    $stmt->execute([
        ':uid'   => $userId,
        ':type'  => $type,
        ':title' => $title,
        ':msg'   => $message,
        ':lid'   => $relatedLeadId,
        ':tid'   => $relatedTaskId,
        ':key'   => $dedupeKey,
    ]);
}

/**
 * Scanner: inspects open lead_tasks and creates overdue / due_today / due_soon
 * notifications for each task's assignee (or creator if unassigned). Idempotent
 * by virtue of the UNIQUE (user_id, dedupe_key) constraint.
 */
function scanTaskReminders(PDO $db): int
{
    $created = 0;

    $nowDate = date('Y-m-d');
    $dueSoonWindowSeconds = DUE_SOON_HOURS * 3600;

    // Pull all open tasks with a due_at. One query, small payload.
    $stmt = $db->query(
        "SELECT t.id, t.title, t.imported_lead_id, t.assigned_user_id, t.created_by,
                t.due_at,
                TIMESTAMPDIFF(SECOND, NOW(), t.due_at) AS seconds_until_due,
                DATE(t.due_at) = CURDATE() AS is_today,
                f.display_name AS lead_display_name
           FROM lead_tasks t
           JOIN imported_leads_raw r  ON r.id = t.imported_lead_id
           JOIN lead_import_batches b ON b.id = r.batch_id
           JOIN files f               ON f.id = b.file_id
          WHERE t.status = 'open'
            AND t.due_at IS NOT NULL"
    );
    $rows = $stmt->fetchAll();

    foreach ($rows as $t) {
        $taskId   = (int) $t['id'];
        $leadId   = (int) $t['imported_lead_id'];
        $target   = $t['assigned_user_id'] !== null ? (int) $t['assigned_user_id'] : (int) $t['created_by'];
        $secsLeft = (int) $t['seconds_until_due'];
        $leadName = $t['lead_display_name'] ?: 'Lead';
        $title    = $t['title'];

        if ($secsLeft < 0) {
            createNotification(
                $db, $target, 'task_overdue',
                "task_overdue:$taskId",
                "Overdue: $title",
                "On {$leadName}. Was due " . $t['due_at'],
                $leadId, $taskId
            );
            $created++;
        } elseif ($secsLeft <= $dueSoonWindowSeconds) {
            // Due within the next DUE_SOON_HOURS.
            createNotification(
                $db, $target, 'task_due_soon',
                "task_due_soon:$taskId",
                "Due soon: $title",
                "On {$leadName}. Due " . $t['due_at'],
                $leadId, $taskId
            );
            $created++;
        } elseif ((int) $t['is_today'] === 1) {
            createNotification(
                $db, $target, 'task_due_today',
                "task_due_today:$taskId:$nowDate",
                "Due today: $title",
                "On {$leadName}. Due " . $t['due_at'],
                $leadId, $taskId
            );
            $created++;
        }
    }

    return $created;
}

function recordHistory(PDO $db, int $fileId, ?string $fromStage, string $toStage, string $actionType, ?int $artifactId, int $performedBy, ?string $remarks = null): void
{
    $stmt = $db->prepare(
        'INSERT INTO file_stage_history (file_id, from_stage, to_stage, action_type, artifact_id, performed_by, remarks)
         VALUES (:file_id, :from_stage, :to_stage, :action_type, :artifact_id, :performed_by, :remarks)'
    );
    $stmt->execute([
        ':file_id'      => $fileId,
        ':from_stage'   => $fromStage,
        ':to_stage'     => $toStage,
        ':action_type'  => $actionType,
        ':artifact_id'  => $artifactId,
        ':performed_by' => $performedBy,
        ':remarks'      => $remarks,
    ]);
}

<?php

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/pipeline.php';
initSession();

$user = requireAuth();
$db   = getDBConnection();

const CAMPAIGN_RECIPIENT_CAP = 500;

/**
 * Translate a segment filter array (same shape as /api/leads query params)
 * into WHERE/params suitable for a query over `imported_leads_raw r` joined
 * to `lead_import_batches b`. Only a curated subset of filters is supported —
 * see docs above. Unknown keys are silently ignored.
 *
 * Returns [whereClauses[], params[], needsStateJoin].
 */
function buildCampaignSegmentWhere(array $f): array
{
    $where  = ["r.import_status = 'imported'"];
    $params = [];
    $needsStateJoin = false;

    foreach (['batch_id' => 'b.id', 'file_id' => 'b.file_id', 'vehicle_id' => 'f.vehicle_id'] as $k => $col) {
        if (!empty($f[$k])) {
            $where[] = "$col = :$k";
            $params[":$k"] = (int) $f[$k];
        }
    }
    if (!empty($f['source_stage'])) {
        $where[] = 'b.source_stage = :source_stage';
        $params[':source_stage'] = $f['source_stage'];
    }
    foreach (['state' => 'r.norm_state', 'make' => 'r.norm_make', 'year' => 'r.norm_year'] as $k => $col) {
        if (!empty($f[$k])) {
            $where[] = "$col = :$k";
            $params[":$k"] = (string) $f[$k];
        }
    }
    if (!empty($f['status'])) {
        $where[] = 's.status = :status';
        $params[':status'] = $f['status'];
        $needsStateJoin = true;
    }
    if (!empty($f['priority'])) {
        $where[] = 's.priority = :priority';
        $params[':priority'] = $f['priority'];
        $needsStateJoin = true;
    }
    if (!empty($f['lead_temperature'])) {
        $where[] = 's.lead_temperature = :lead_temperature';
        $params[':lead_temperature'] = $f['lead_temperature'];
        $needsStateJoin = true;
    }
    if (!empty($f['assigned_user_id'])) {
        $where[] = 's.assigned_user_id = :assigned_user_id';
        $params[':assigned_user_id'] = (int) $f['assigned_user_id'];
        $needsStateJoin = true;
    }
    if (!empty($f['label_id'])) {
        $where[] = 'EXISTS (SELECT 1 FROM lead_label_links lll WHERE lll.imported_lead_id = r.id AND lll.label_id = :label_id)';
        $params[':label_id'] = (int) $f['label_id'];
    }
    if (isset($f['number_of_owners_min']) && $f['number_of_owners_min'] !== '') {
        $where[] = "CAST(JSON_UNQUOTE(JSON_EXTRACT(r.normalized_payload_json, '$.NumberOfOwners')) AS UNSIGNED) >= :noo_min";
        $params[':noo_min'] = (int) $f['number_of_owners_min'];
    }
    if (isset($f['number_of_owners_max']) && $f['number_of_owners_max'] !== '') {
        $where[] = "CAST(JSON_UNQUOTE(JSON_EXTRACT(r.normalized_payload_json, '$.NumberOfOwners')) AS UNSIGNED) <= :noo_max";
        $params[':noo_max'] = (int) $f['number_of_owners_max'];
    }
    if (isset($f['tier']) && $f['tier'] !== '') {
        $rawTiers = is_array($f['tier']) ? $f['tier'] : explode(',', (string) $f['tier']);
        $tiers = [];
        foreach ($rawTiers as $t) {
            $t = trim($t);
            if ($t !== '' && in_array($t, LEAD_TIERS, true)) $tiers[] = $t;
        }
        if (!empty($tiers)) {
            $tierExpr = preg_replace('/\s+AS\s+__tier$/', '', leadTierSqlExpression('__tier'));
            $ph = [];
            foreach ($tiers as $i => $t) {
                $ph[] = ":tier_$i";
                $params[":tier_$i"] = $t;
            }
            $where[] = "$tierExpr IN (" . implode(',', $ph) . ")";
        }
    }

    return [$where, $params, $needsStateJoin];
}

/**
 * Resolve a segment to actual recipient rows.
 *
 * For each lead we pick a primary contact: email for email campaigns,
 * phone for SMS/WhatsApp. Rows without the right contact field are dropped.
 *
 * Returns: [ ['lead_id' => int, 'to' => string, 'first_name' => ..., 'last_name' => ..., 'normalized' => [...] ], ... ]
 */
function resolveCampaignRecipients(PDO $db, array $filters, string $channel, int $cap): array
{
    [$where, $params, $needsStateJoin] = buildCampaignSegmentWhere($filters);

    $contactField = $channel === 'email'
        ? "JSON_UNQUOTE(JSON_EXTRACT(r.normalized_payload_json, '$.email_primary'))"
        : "JSON_UNQUOTE(JSON_EXTRACT(r.normalized_payload_json, '$.phone_primary'))";

    $where[] = "$contactField IS NOT NULL AND $contactField <> ''";

    $from = 'FROM imported_leads_raw r
             JOIN lead_import_batches b ON b.id = r.batch_id
             JOIN files f               ON f.id = b.file_id';
    if ($needsStateJoin) {
        $from .= ' LEFT JOIN lead_states s ON s.imported_lead_id = r.id';
    }

    $sql = "SELECT r.id, r.normalized_payload_json, $contactField AS contact
            $from
            WHERE " . implode(' AND ', $where) . "
            ORDER BY r.id ASC
            LIMIT " . (int) $cap;

    $stmt = $db->prepare($sql);
    foreach ($params as $k => $v) {
        $stmt->bindValue($k, $v, is_int($v) ? PDO::PARAM_INT : PDO::PARAM_STR);
    }
    $stmt->execute();

    $out = [];
    foreach ($stmt->fetchAll() as $r) {
        $np = json_decode($r['normalized_payload_json'] ?? 'null', true) ?: [];
        $out[] = [
            'lead_id'    => (int) $r['id'],
            'to'         => (string) $r['contact'],
            'first_name' => (string) ($np['first_name'] ?? ''),
            'last_name'  => (string) ($np['last_name']  ?? ''),
            'full_name'  => (string) ($np['full_name']  ?? trim(($np['first_name'] ?? '') . ' ' . ($np['last_name'] ?? ''))),
            'vehicle'    => trim(implode(' ', array_filter([$np['year'] ?? null, $np['make'] ?? null, $np['model'] ?? null]))),
            'vin'        => (string) ($np['vin']   ?? ''),
            'city'       => (string) ($np['city']  ?? ''),
            'state'      => (string) ($np['state'] ?? ''),
        ];
    }
    return $out;
}

/** Return the set of suppressed identifiers for a given list of contact values. */
function loadSuppressionSet(PDO $db, string $type, array $identifiers): array
{
    if (empty($identifiers)) return [];
    $identifiers = array_values(array_unique(array_map(
        fn($v) => normalizeContactIdentifier($type, $v),
        $identifiers
    )));
    $ph = implode(',', array_fill(0, count($identifiers), '?'));
    $stmt = $db->prepare("SELECT identifier FROM marketing_suppressions WHERE identifier_type = ? AND identifier IN ($ph)");
    $stmt->execute(array_merge([$type], $identifiers));
    $set = [];
    foreach ($stmt->fetchAll() as $r) {
        $set[$r['identifier']] = true;
    }
    return $set;
}

/** Render a template body/subject by substituting {{vars}}. Unknown vars render literally. */
function renderMarketingContent(string $template, array $vars): string
{
    return preg_replace_callback(
        '/\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}/i',
        function ($m) use ($vars) {
            $key = strtolower($m[1]);
            if (array_key_exists($key, $vars) && $vars[$key] !== '' && $vars[$key] !== null) {
                return htmlspecialchars((string) $vars[$key], ENT_QUOTES, 'UTF-8');
            }
            return $m[0];
        },
        $template
    );
}

function formatCampaign(array $row, ?array $counts = null): array
{
    return [
        'id'                 => (int) $row['id'],
        'name'               => $row['name'],
        'channel'            => $row['channel'],
        'template_id'        => $row['template_id'] !== null ? (int) $row['template_id'] : null,
        'subject_snapshot'   => $row['subject_snapshot'],
        'body_snapshot'      => $row['body_snapshot'],
        'sender_identity'    => $row['sender_identity'],
        'segment'            => json_decode($row['segment_json'] ?? 'null', true) ?? new stdClass(),
        'status'             => $row['status'],
        'stats'              => json_decode($row['stats_json']   ?? 'null', true) ?? new stdClass(),
        'scheduled_at'       => $row['scheduled_at'],
        'started_at'         => $row['started_at'],
        'completed_at'       => $row['completed_at'],
        'created_by'         => (int) $row['created_by'],
        'created_by_name'    => $row['created_by_name'] ?? null,
        'created_at'         => $row['created_at'],
        'updated_at'         => $row['updated_at'],
        'recipient_count'    => $counts['recipient_count']    ?? null,
        'sent_count'         => $counts['sent_count']         ?? null,
        'failed_count'       => $counts['failed_count']       ?? null,
        'opted_out_count'    => $counts['opted_out_count']    ?? null,
        'pending_count'      => $counts['pending_count']      ?? null,
    ];
}

function loadCampaignOrFail(PDO $db, int $id): array
{
    $stmt = $db->prepare(
        'SELECT c.*, u.name AS created_by_name
           FROM marketing_campaigns c
           LEFT JOIN users u ON u.id = c.created_by
          WHERE c.id = :id'
    );
    $stmt->execute([':id' => $id]);
    $row = $stmt->fetch();
    if (!$row) pipelineFail(404, 'Campaign not found', 'campaign_not_found');
    return $row;
}

function loadCampaignCounts(PDO $db, int $id): array
{
    $stmt = $db->prepare(
        "SELECT
            COUNT(*)                                          AS recipient_count,
            SUM(send_status = 'sent')                         AS sent_count,
            SUM(send_status = 'failed' OR send_status = 'bounced') AS failed_count,
            SUM(send_status = 'opted_out' OR send_status = 'skipped') AS opted_out_count,
            SUM(send_status = 'pending' OR send_status = 'sending') AS pending_count
           FROM marketing_campaign_recipients
          WHERE campaign_id = :id"
    );
    $stmt->execute([':id' => $id]);
    $row = $stmt->fetch() ?: [];
    return [
        'recipient_count' => (int) ($row['recipient_count'] ?? 0),
        'sent_count'      => (int) ($row['sent_count']      ?? 0),
        'failed_count'    => (int) ($row['failed_count']    ?? 0),
        'opted_out_count' => (int) ($row['opted_out_count'] ?? 0),
        'pending_count'   => (int) ($row['pending_count']   ?? 0),
    ];
}

// ---- GET handlers ----

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    // Campaign detail
    if (isset($_GET['id'])) {
        $id = (int) $_GET['id'];
        $row = loadCampaignOrFail($db, $id);
        echo json_encode(formatCampaign($row, loadCampaignCounts($db, $id)));
        exit();
    }

    // Recipients of a campaign (paginated)
    if (isset($_GET['recipients_for'])) {
        $id = (int) $_GET['recipients_for'];
        loadCampaignOrFail($db, $id);
        $page    = max(1, (int) ($_GET['page'] ?? 1));
        $perPage = max(1, min(200, (int) ($_GET['per_page'] ?? 50)));
        $offset  = ($page - 1) * $perPage;

        $where  = ['r.campaign_id = :id'];
        $params = [':id' => $id];
        if (!empty($_GET['send_status'])) {
            $where[] = 'r.send_status = :st';
            $params[':st'] = $_GET['send_status'];
        }
        $whereSql = implode(' AND ', $where);

        $stmt = $db->prepare("SELECT COUNT(*) FROM marketing_campaign_recipients r WHERE $whereSql");
        $stmt->execute($params);
        $total = (int) $stmt->fetchColumn();

        $stmt = $db->prepare(
            "SELECT r.*, l.normalized_payload_json
               FROM marketing_campaign_recipients r
               JOIN imported_leads_raw l ON l.id = r.imported_lead_id
              WHERE $whereSql
              ORDER BY r.id ASC
              LIMIT :lim OFFSET :off"
        );
        foreach ($params as $k => $v) $stmt->bindValue($k, $v);
        $stmt->bindValue(':lim', $perPage, PDO::PARAM_INT);
        $stmt->bindValue(':off', $offset,  PDO::PARAM_INT);
        $stmt->execute();
        $rows = array_map(function ($r) {
            $np = json_decode($r['normalized_payload_json'] ?? 'null', true) ?: [];
            $name = $np['full_name'] ?? trim(($np['first_name'] ?? '') . ' ' . ($np['last_name'] ?? ''));
            return [
                'id'                  => (int) $r['id'],
                'imported_lead_id'    => (int) $r['imported_lead_id'],
                'lead_name'           => $name ?: null,
                'resolved_to'         => $r['resolved_to'],
                'send_status'         => $r['send_status'],
                'provider_message_id' => $r['provider_message_id'],
                'fail_reason'         => $r['fail_reason'],
                'sent_at'             => $r['sent_at'],
                'opened_at'           => $r['opened_at'],
                'clicked_at'          => $r['clicked_at'],
                'replied_at'          => $r['replied_at'],
            ];
        }, $stmt->fetchAll());

        echo json_encode(['total' => $total, 'page' => $page, 'per_page' => $perPage, 'recipients' => $rows]);
        exit();
    }

    // List of campaigns
    $sql = 'SELECT c.*, u.name AS created_by_name
              FROM marketing_campaigns c
              LEFT JOIN users u ON u.id = c.created_by
             WHERE 1=1';
    $params = [];
    if (!empty($_GET['status'])) {
        $sql .= ' AND c.status = :st';
        $params[':st'] = $_GET['status'];
    }
    if (!empty($_GET['channel'])) {
        assertMarketingChannel($_GET['channel']);
        $sql .= ' AND c.channel = :ch';
        $params[':ch'] = $_GET['channel'];
    }
    if (!empty($_GET['mine']) && $_GET['mine'] === '1') {
        $sql .= ' AND c.created_by = :me';
        $params[':me'] = (int) $user['id'];
    }
    $sql .= ' ORDER BY c.created_at DESC LIMIT 500';
    $stmt = $db->prepare($sql);
    $stmt->execute($params);
    $rows = $stmt->fetchAll();

    // Bulk-load counts in one pass so the list page can show "X of Y sent".
    $ids = array_map(fn($r) => (int) $r['id'], $rows);
    $countsById = [];
    if (!empty($ids)) {
        $ph = implode(',', array_fill(0, count($ids), '?'));
        $cs = $db->prepare(
            "SELECT campaign_id,
                    COUNT(*) AS recipient_count,
                    SUM(send_status='sent') AS sent_count,
                    SUM(send_status IN ('failed','bounced')) AS failed_count,
                    SUM(send_status IN ('opted_out','skipped')) AS opted_out_count,
                    SUM(send_status IN ('pending','sending')) AS pending_count
               FROM marketing_campaign_recipients
              WHERE campaign_id IN ($ph)
              GROUP BY campaign_id"
        );
        $cs->execute($ids);
        foreach ($cs->fetchAll() as $r) {
            $countsById[(int) $r['campaign_id']] = [
                'recipient_count' => (int) $r['recipient_count'],
                'sent_count'      => (int) $r['sent_count'],
                'failed_count'    => (int) $r['failed_count'],
                'opted_out_count' => (int) $r['opted_out_count'],
                'pending_count'   => (int) $r['pending_count'],
            ];
        }
    }

    echo json_encode(array_map(
        fn($r) => formatCampaign($r, $countsById[(int) $r['id']] ?? null),
        $rows
    ));
    exit();
}

// ---- POST: create draft ----

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    assertAdminOrMarketer($user);
    $input = json_decode(file_get_contents('php://input'), true) ?? [];

    $name     = trim((string) ($input['name'] ?? ''));
    $channel  = (string) ($input['channel']   ?? '');
    $segment  = is_array($input['segment']   ?? null) ? $input['segment']   : [];
    $scheduledAt = parseDatetime($input['scheduled_at'] ?? null, 'scheduled_at');
    $senderIdentity = isset($input['sender_identity']) ? trim((string) $input['sender_identity']) : null;

    if ($name === '')              pipelineFail(400, 'name is required', 'missing_fields');
    if (mb_strlen($name) > 200)    pipelineFail(400, 'name too long',    'name_too_long');
    assertMarketingChannel($channel);

    // Body/subject from either: template_id or inline body+subject.
    $templateId = isset($input['template_id']) ? (int) $input['template_id'] : null;
    $body       = isset($input['body'])    ? (string) $input['body']    : '';
    $subject    = isset($input['subject']) ? (string) $input['subject'] : '';

    if ($templateId) {
        $stmt = $db->prepare('SELECT * FROM marketing_templates WHERE id = :id');
        $stmt->execute([':id' => $templateId]);
        $tpl = $stmt->fetch();
        if (!$tpl) pipelineFail(404, 'Template not found', 'template_not_found');
        if ($tpl['channel'] !== $channel) {
            pipelineFail(400, "Template channel '{$tpl['channel']}' doesn't match campaign channel '$channel'", 'channel_mismatch');
        }
        $body    = (string) $tpl['body'];
        $subject = (string) ($tpl['subject'] ?? '');
    }
    if ($body === '') pipelineFail(400, 'body (or template_id) is required', 'missing_fields');
    if ($channel === 'email' && $subject === '') pipelineFail(400, 'subject is required for email', 'missing_fields');

    // Resolve recipients now so the recipient list is the single source of truth.
    $leads = resolveCampaignRecipients($db, $segment, $channel, CAMPAIGN_RECIPIENT_CAP);
    if (empty($leads)) {
        pipelineFail(422, 'The selected segment matched 0 leads with a usable contact', 'empty_segment');
    }

    // Suppression lookup in one query.
    $idType = $channel === 'email' ? 'email' : 'phone';
    $suppressed = loadSuppressionSet($db, $idType, array_map(fn($l) => $l['to'], $leads));

    try {
        $db->beginTransaction();

        $stmt = $db->prepare(
            'INSERT INTO marketing_campaigns
               (name, channel, template_id, subject_snapshot, body_snapshot, sender_identity, segment_json, status, scheduled_at, created_by)
             VALUES
               (:n, :ch, :tpl, :sub, :body, :sender, :seg, "draft", :sched, :by)'
        );
        $stmt->execute([
            ':n'      => $name,
            ':ch'     => $channel,
            ':tpl'    => $templateId,
            ':sub'    => $channel === 'email' ? $subject : null,
            ':body'   => $body,
            ':sender' => $senderIdentity,
            ':seg'    => json_encode($segment),
            ':sched'  => $scheduledAt,
            ':by'     => (int) $user['id'],
        ]);
        $campaignId = (int) $db->lastInsertId();

        $ins = $db->prepare(
            'INSERT INTO marketing_campaign_recipients
               (campaign_id, imported_lead_id, resolved_to, rendered_subject, rendered_body, send_status)
             VALUES (:c, :l, :to, :subj, :body, :st)'
        );
        $enqueued = 0; $skippedOptOut = 0;
        foreach ($leads as $lead) {
            $normalizedContact = normalizeContactIdentifier($idType, $lead['to']);
            $isSuppressed = isset($suppressed[$normalizedContact]);
            $vars = [
                'first_name' => $lead['first_name'],
                'last_name'  => $lead['last_name'],
                'full_name'  => $lead['full_name'],
                'vehicle'    => $lead['vehicle'],
                'vin'        => $lead['vin'],
                'city'       => $lead['city'],
                'state'      => $lead['state'],
                // unsubscribe_url is rendered at send time, not here, so the token
                // carries the real recipient id (unknown until after INSERT).
                'unsubscribe_url' => '{{unsubscribe_url}}',
            ];
            $renderedSubject = $channel === 'email' ? renderMarketingContent($subject, $vars) : null;
            $renderedBody    = renderMarketingContent($body, $vars);
            $ins->execute([
                ':c'    => $campaignId,
                ':l'    => $lead['lead_id'],
                ':to'   => $lead['to'],
                ':subj' => $renderedSubject,
                ':body' => $renderedBody,
                ':st'   => $isSuppressed ? 'opted_out' : 'pending',
            ]);
            if ($isSuppressed) $skippedOptOut++; else $enqueued++;
        }

        // Seed stats_json with initial counts.
        $stats = [
            'resolved'     => count($leads),
            'enqueued'     => $enqueued,
            'opted_out'    => $skippedOptOut,
            'sent'         => 0,
            'failed'       => 0,
        ];
        $stmt = $db->prepare('UPDATE marketing_campaigns SET stats_json = :s WHERE id = :id');
        $stmt->execute([':s' => json_encode($stats), ':id' => $campaignId]);

        $db->commit();
    } catch (Throwable $e) {
        $db->rollBack();
        pipelineFail(500, 'Failed to create campaign: ' . $e->getMessage(), 'db_error');
    }

    echo json_encode(formatCampaign(loadCampaignOrFail($db, $campaignId), loadCampaignCounts($db, $campaignId)));
    exit();
}

// ---- PATCH: update draft / schedule / cancel ----

if ($_SERVER['REQUEST_METHOD'] === 'PATCH' || $_SERVER['REQUEST_METHOD'] === 'PUT') {
    assertAdminOrMarketer($user);
    $input = json_decode(file_get_contents('php://input'), true) ?? [];
    $id = (int) ($input['id'] ?? 0);
    if ($id <= 0) pipelineFail(400, 'id is required', 'missing_fields');
    $row = loadCampaignOrFail($db, $id);

    // Cancellation can happen on draft or queued; body/name edits only on draft.
    if (array_key_exists('cancel', $input) && $input['cancel']) {
        if (!in_array($row['status'], ['draft','queued'], true)) {
            pipelineFail(409, 'Only draft/queued campaigns can be cancelled', 'invalid_state');
        }
        $stmt = $db->prepare("UPDATE marketing_campaigns SET status = 'cancelled' WHERE id = :id");
        $stmt->execute([':id' => $id]);
        echo json_encode(formatCampaign(loadCampaignOrFail($db, $id), loadCampaignCounts($db, $id)));
        exit();
    }

    if ($row['status'] !== 'draft') {
        pipelineFail(409, 'Only draft campaigns can be edited', 'invalid_state');
    }

    $fields = [];
    $params = [':id' => $id];
    if (array_key_exists('name', $input)) {
        $name = trim((string) $input['name']);
        if ($name === '')           pipelineFail(400, 'name cannot be empty', 'missing_fields');
        if (mb_strlen($name) > 200) pipelineFail(400, 'name too long',       'name_too_long');
        $fields[] = 'name = :n'; $params[':n'] = $name;
    }
    if (array_key_exists('scheduled_at', $input)) {
        $fields[] = 'scheduled_at = :sched';
        $params[':sched'] = parseDatetime($input['scheduled_at'], 'scheduled_at');
    }
    if (array_key_exists('sender_identity', $input)) {
        $fields[] = 'sender_identity = :sender';
        $params[':sender'] = $input['sender_identity'] === null ? null : trim((string) $input['sender_identity']);
    }
    if (empty($fields)) pipelineFail(400, 'No changes provided', 'no_changes');

    $stmt = $db->prepare('UPDATE marketing_campaigns SET ' . implode(', ', $fields) . ' WHERE id = :id');
    $stmt->execute($params);
    echo json_encode(formatCampaign(loadCampaignOrFail($db, $id), loadCampaignCounts($db, $id)));
    exit();
}

// ---- DELETE: remove a draft/cancelled campaign ----

if ($_SERVER['REQUEST_METHOD'] === 'DELETE') {
    assertAdminOrMarketer($user);
    $input = json_decode(file_get_contents('php://input'), true) ?? [];
    $id = (int) ($input['id'] ?? $_GET['id'] ?? 0);
    if ($id <= 0) pipelineFail(400, 'id is required', 'missing_fields');
    $row = loadCampaignOrFail($db, $id);
    if (!in_array($row['status'], ['draft','cancelled'], true)) {
        pipelineFail(409, 'Only draft or cancelled campaigns can be deleted', 'invalid_state');
    }
    // ON DELETE CASCADE removes recipients.
    $stmt = $db->prepare('DELETE FROM marketing_campaigns WHERE id = :id');
    $stmt->execute([':id' => $id]);
    echo json_encode(['success' => true, 'id' => $id]);
    exit();
}

pipelineFail(405, 'Method not allowed', 'method_not_allowed');

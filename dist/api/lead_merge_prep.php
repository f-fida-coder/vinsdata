<?php

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/pipeline.php';
initSession();

$user = requireAuth();
$db   = getDBConnection();

/**
 * Load duplicate group by id and assert it's confirmed_duplicate — the only
 * prep-eligible state. Other states surface a typed error so the UI can guide
 * the user back to the Duplicate Review page.
 */
function loadConfirmedDuplicateGroup(PDO $db, int $groupId): array
{
    $stmt = $db->prepare(
        'SELECT id, match_type, match_key, confidence, review_status,
                created_at, updated_at
           FROM lead_duplicate_groups WHERE id = :id'
    );
    $stmt->execute([':id' => $groupId]);
    $row = $stmt->fetch();
    if (!$row) pipelineFail(404, 'Duplicate group not found', 'group_not_found');
    if ($row['review_status'] !== 'confirmed_duplicate') {
        pipelineFail(409, 'Prep workspace only operates on confirmed duplicate groups', 'group_not_prepared_eligible');
    }
    return $row;
}

function formatPrepRow(?array $row): array
{
    if (!$row) {
        return [
            'id' => null,
            'status' => 'not_started',
            'preferred_primary_lead_id' => null,
            'review_notes' => null,
            'prepared_by' => null,
            'prepared_by_name' => null,
            'prepared_at' => null,
            'created_by' => null,
            'created_by_name' => null,
            'created_at' => null,
            'updated_at' => null,
        ];
    }
    return [
        'id'                         => (int) $row['id'],
        'status'                     => $row['status'],
        'preferred_primary_lead_id'  => $row['preferred_primary_lead_id'] !== null ? (int) $row['preferred_primary_lead_id'] : null,
        'review_notes'               => $row['review_notes'],
        'prepared_by'                => $row['prepared_by'] !== null ? (int) $row['prepared_by'] : null,
        'prepared_by_name'           => $row['prepared_by_name'] ?? null,
        'prepared_at'                => $row['prepared_at'] ?? null,
        'created_by'                 => (int) $row['created_by'],
        'created_by_name'            => $row['created_by_name'] ?? null,
        'created_at'                 => $row['created_at'] ?? null,
        'updated_at'                 => $row['updated_at'] ?? null,
    ];
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    // ---- Detail mode: ?duplicate_group_id=X ----
    if (isset($_GET['duplicate_group_id'])) {
        $groupId = (int) $_GET['duplicate_group_id'];
        if ($groupId <= 0) pipelineFail(400, 'duplicate_group_id is required', 'missing_fields');

        $group = loadConfirmedDuplicateGroup($db, $groupId);

        // Prep row (may not exist yet).
        $prepStmt = $db->prepare(
            'SELECT p.*, c.name AS created_by_name, pb.name AS prepared_by_name
               FROM lead_merge_prep_groups p
               JOIN users c ON c.id = p.created_by
               LEFT JOIN users pb ON pb.id = p.prepared_by
              WHERE p.duplicate_group_id = :gid'
        );
        $prepStmt->execute([':gid' => $groupId]);
        $prep = $prepStmt->fetch() ?: null;

        // Members with denormalized CRM/source data.
        $memStmt = $db->prepare(
            "SELECT m.imported_lead_id,
                    r.normalized_payload_json, r.source_row_number,
                    b.batch_name, b.source_stage, b.imported_at,
                    f.display_name AS file_display_name, f.file_name,
                    v.name AS vehicle_name,
                    s.status AS crm_status, s.priority AS crm_priority,
                    s.lead_temperature, s.price_wanted, s.price_offered,
                    s.assigned_user_id, au.name AS assigned_user_name,
                    (SELECT COUNT(*) FROM lead_notes n WHERE n.imported_lead_id = r.id) AS notes_count,
                    (SELECT COUNT(*) FROM lead_tasks t WHERE t.imported_lead_id = r.id) AS tasks_total,
                    (SELECT COUNT(*) FROM lead_tasks t WHERE t.imported_lead_id = r.id AND t.status = 'open') AS tasks_open
               FROM lead_duplicate_group_members m
               JOIN imported_leads_raw r  ON r.id = m.imported_lead_id
               JOIN lead_import_batches b ON b.id = r.batch_id
               JOIN files f               ON f.id = b.file_id
               JOIN vehicles v            ON v.id = f.vehicle_id
               LEFT JOIN lead_states s    ON s.imported_lead_id = r.id
               LEFT JOIN users au         ON au.id = s.assigned_user_id
              WHERE m.group_id = :gid
              ORDER BY r.id ASC"
        );
        $memStmt->execute([':gid' => $groupId]);
        $members = [];
        $leadIds = [];
        foreach ($memStmt->fetchAll() as $r) {
            $r['imported_lead_id']   = (int) $r['imported_lead_id'];
            $r['normalized_payload'] = json_decode($r['normalized_payload_json'] ?? 'null', true);
            unset($r['normalized_payload_json']);
            $r['price_wanted']   = $r['price_wanted']  !== null ? (float) $r['price_wanted']  : null;
            $r['price_offered']  = $r['price_offered'] !== null ? (float) $r['price_offered'] : null;
            $r['notes_count']    = (int) $r['notes_count'];
            $r['tasks_open']     = (int) $r['tasks_open'];
            $r['tasks_total']    = (int) $r['tasks_total'];
            $members[] = $r;
            $leadIds[] = (int) $r['imported_lead_id'];
        }

        // Labels attached to the members.
        $labelsByLead = [];
        if (!empty($leadIds)) {
            $ph = implode(',', array_fill(0, count($leadIds), '?'));
            $lStmt = $db->prepare(
                "SELECT lll.imported_lead_id, l.id, l.name, l.color
                   FROM lead_label_links lll
                   JOIN lead_labels l ON l.id = lll.label_id
                  WHERE lll.imported_lead_id IN ($ph)
                  ORDER BY l.name"
            );
            $lStmt->execute($leadIds);
            foreach ($lStmt->fetchAll() as $r) {
                $labelsByLead[(int) $r['imported_lead_id']][] = [
                    'id' => (int) $r['id'], 'name' => $r['name'], 'color' => $r['color'],
                ];
            }
        }
        foreach ($members as &$m) { $m['labels'] = $labelsByLead[$m['imported_lead_id']] ?? []; }
        unset($m);

        // Prep choices (may not exist yet).
        $choices = [];
        if ($prep) {
            $cStmt = $db->prepare(
                'SELECT imported_lead_id, keep_for_reference, likely_best_phone,
                        likely_best_email, likely_best_address, notes, created_at, updated_at
                   FROM lead_merge_prep_choices WHERE prep_group_id = :pid'
            );
            $cStmt->execute([':pid' => $prep['id']]);
            foreach ($cStmt->fetchAll() as $c) {
                $choices[(int) $c['imported_lead_id']] = [
                    'imported_lead_id'     => (int) $c['imported_lead_id'],
                    'keep_for_reference'   => (bool) $c['keep_for_reference'],
                    'likely_best_phone'    => (bool) $c['likely_best_phone'],
                    'likely_best_email'    => (bool) $c['likely_best_email'],
                    'likely_best_address'  => (bool) $c['likely_best_address'],
                    'notes'                => $c['notes'],
                ];
            }
        }

        echo json_encode([
            'group'   => [
                'id'            => (int) $group['id'],
                'match_type'    => $group['match_type'],
                'match_key'     => $group['match_key'],
                'confidence'    => (float) $group['confidence'],
                'review_status' => $group['review_status'],
                'member_count'  => count($members),
            ],
            'prep'    => formatPrepRow($prep),
            'members' => $members,
            'choices' => array_values($choices),
        ]);
        exit();
    }

    // ---- List mode ----
    $page    = max(1, (int) ($_GET['page']     ?? 1));
    $perPage = (int) ($_GET['per_page'] ?? 50);
    if ($perPage < 1)   $perPage = 50;
    if ($perPage > 200) $perPage = 200;
    $offset = ($page - 1) * $perPage;

    $where  = ["g.review_status = 'confirmed_duplicate'"];
    $params = [];

    if (!empty($_GET['match_type'])) {
        assertMatchType($_GET['match_type']);
        $where[] = 'g.match_type = :mt';
        $params[':mt'] = $_GET['match_type'];
    }
    if (!empty($_GET['batch_id'])) {
        $where[] = 'EXISTS (SELECT 1 FROM lead_duplicate_group_members m
                             JOIN imported_leads_raw r ON r.id = m.imported_lead_id
                            WHERE m.group_id = g.id AND r.batch_id = :bid)';
        $params[':bid'] = (int) $_GET['batch_id'];
    }
    if (!empty($_GET['file_id'])) {
        $where[] = 'EXISTS (SELECT 1 FROM lead_duplicate_group_members m
                             JOIN imported_leads_raw r ON r.id = m.imported_lead_id
                             JOIN lead_import_batches b ON b.id = r.batch_id
                            WHERE m.group_id = g.id AND b.file_id = :fid)';
        $params[':fid'] = (int) $_GET['file_id'];
    }
    if (!empty($_GET['prepared_by'])) {
        $where[] = 'p.prepared_by = :pb';
        $params[':pb'] = (int) $_GET['prepared_by'];
    }

    if (!empty($_GET['prep_status'])) {
        switch ($_GET['prep_status']) {
            case 'not_started': $where[] = 'p.id IS NULL'; break;
            case 'draft':       $where[] = "p.status = 'draft'"; break;
            case 'prepared':    $where[] = "p.status = 'prepared'"; break;
            default: pipelineFail(400, 'Invalid prep_status', 'invalid_prep_status');
        }
    }

    $whereSql = implode(' AND ', $where);

    $baseFrom = 'FROM lead_duplicate_groups g
                 LEFT JOIN lead_merge_prep_groups p ON p.duplicate_group_id = g.id';

    $countSql = "SELECT COUNT(*) $baseFrom WHERE $whereSql";
    $cStmt = $db->prepare($countSql);
    $cStmt->execute($params);
    $total = (int) $cStmt->fetchColumn();

    $sql = "SELECT g.id, g.match_type, g.match_key, g.confidence, g.created_at AS group_created_at,
                   p.id AS prep_id, p.status AS prep_status, p.preferred_primary_lead_id,
                   p.prepared_by, p.prepared_at, pu.name AS prepared_by_name,
                   (SELECT COUNT(*) FROM lead_duplicate_group_members m WHERE m.group_id = g.id) AS member_count,
                   pr_payload.name_preview AS preferred_primary_name
              $baseFrom
              LEFT JOIN users pu ON pu.id = p.prepared_by
              LEFT JOIN (
                SELECT r.id AS lead_id,
                       COALESCE(
                         NULLIF(TRIM(JSON_UNQUOTE(JSON_EXTRACT(r.normalized_payload_json, '$.full_name'))), ''),
                         TRIM(CONCAT_WS(' ',
                           NULLIF(JSON_UNQUOTE(JSON_EXTRACT(r.normalized_payload_json, '$.first_name')), ''),
                           NULLIF(JSON_UNQUOTE(JSON_EXTRACT(r.normalized_payload_json, '$.last_name')), '')
                         ))
                       ) AS name_preview
                  FROM imported_leads_raw r
              ) pr_payload ON pr_payload.lead_id = p.preferred_primary_lead_id
             WHERE $whereSql
             ORDER BY (p.status IS NULL) DESC, g.created_at DESC, g.id DESC
             LIMIT :limit OFFSET :offset";
    $stmt = $db->prepare($sql);
    foreach ($params as $k => $v) {
        $stmt->bindValue($k, $v, is_int($v) ? PDO::PARAM_INT : PDO::PARAM_STR);
    }
    $stmt->bindValue(':limit',  $perPage, PDO::PARAM_INT);
    $stmt->bindValue(':offset', $offset,  PDO::PARAM_INT);
    $stmt->execute();

    $groups = array_map(function ($g) {
        return [
            'duplicate_group_id'         => (int) $g['id'],
            'match_type'                 => $g['match_type'],
            'match_key'                  => $g['match_key'],
            'confidence'                 => (float) $g['confidence'],
            'member_count'               => (int) $g['member_count'],
            'group_created_at'           => $g['group_created_at'],
            'prep_id'                    => $g['prep_id'] !== null ? (int) $g['prep_id'] : null,
            'prep_status'                => $g['prep_status'] ?? 'not_started',
            'preferred_primary_lead_id'  => $g['preferred_primary_lead_id'] !== null ? (int) $g['preferred_primary_lead_id'] : null,
            'preferred_primary_name'     => $g['preferred_primary_name'] ?? null,
            'prepared_by'                => $g['prepared_by'] !== null ? (int) $g['prepared_by'] : null,
            'prepared_by_name'           => $g['prepared_by_name'] ?? null,
            'prepared_at'                => $g['prepared_at'] ?? null,
        ];
    }, $stmt->fetchAll());

    echo json_encode([
        'total'    => $total,
        'page'     => $page,
        'per_page' => $perPage,
        'groups'   => $groups,
    ]);
    exit();
}

if ($_SERVER['REQUEST_METHOD'] === 'PUT') {
    $input   = json_decode(file_get_contents('php://input'), true) ?? [];
    $groupId = (int) ($input['duplicate_group_id'] ?? 0);
    if ($groupId <= 0) pipelineFail(400, 'duplicate_group_id is required', 'missing_fields');

    $group = loadConfirmedDuplicateGroup($db, $groupId);

    // Collect member lead IDs for validation + activity fan-out.
    $memStmt = $db->prepare('SELECT imported_lead_id FROM lead_duplicate_group_members WHERE group_id = :gid');
    $memStmt->execute([':gid' => $groupId]);
    $memberIds = array_map('intval', $memStmt->fetchAll(PDO::FETCH_COLUMN));
    $memberIdSet = array_fill_keys($memberIds, true);
    if (count($memberIds) < 2) {
        pipelineFail(409, 'Duplicate group has fewer than 2 members', 'group_members_missing');
    }

    // Validate preferred_primary_lead_id
    $hasPrimary = array_key_exists('preferred_primary_lead_id', $input);
    $newPrimary = null;
    if ($hasPrimary) {
        $newPrimary = $input['preferred_primary_lead_id'];
        $newPrimary = ($newPrimary === null || $newPrimary === '') ? null : (int) $newPrimary;
        if ($newPrimary !== null && !isset($memberIdSet[$newPrimary])) {
            pipelineFail(422, 'preferred_primary_lead_id is not a member of this group', 'primary_not_member');
        }
    }

    // Validate status + review_notes + choices shape
    $hasStatus = array_key_exists('status', $input);
    $newStatus = null;
    if ($hasStatus) {
        $newStatus = $input['status'];
        if (!in_array($newStatus, MERGE_PREP_STATUSES, true)) {
            pipelineFail(400, 'Invalid status', 'invalid_status');
        }
    }

    $hasNotes = array_key_exists('review_notes', $input);
    $newNotes = null;
    if ($hasNotes) {
        $raw = $input['review_notes'];
        if ($raw !== null) $raw = trim((string) $raw);
        if ($raw !== null && mb_strlen($raw) > 5000) pipelineFail(400, 'review_notes too long', 'notes_too_long');
        $newNotes = $raw === '' ? null : $raw;
    }

    $hasChoices = array_key_exists('choices', $input);
    $newChoices = [];
    if ($hasChoices) {
        if (!is_array($input['choices'])) pipelineFail(400, 'choices must be an array', 'invalid_choices');
        foreach ($input['choices'] as $c) {
            if (!is_array($c))                               pipelineFail(400, 'invalid choice entry', 'invalid_choices');
            $lid = (int) ($c['imported_lead_id'] ?? 0);
            if ($lid <= 0 || !isset($memberIdSet[$lid]))     pipelineFail(422, 'choice.imported_lead_id must be a member', 'choice_not_member');
            $notes = isset($c['notes']) ? trim((string) $c['notes']) : null;
            if ($notes !== null && mb_strlen($notes) > 2000) pipelineFail(400, 'choice.notes too long', 'notes_too_long');
            $newChoices[$lid] = [
                'keep_for_reference'  => !empty($c['keep_for_reference'])  ? 1 : 0,
                'likely_best_phone'   => !empty($c['likely_best_phone'])   ? 1 : 0,
                'likely_best_email'   => !empty($c['likely_best_email'])   ? 1 : 0,
                'likely_best_address' => !empty($c['likely_best_address']) ? 1 : 0,
                'notes'               => $notes === '' ? null : $notes,
            ];
        }
    }

    // Load (or create) prep row inside a transaction. Diff against current to
    // decide what activity rows to emit.
    $changedFields  = [];
    $changedChoices = [];

    try {
        $db->beginTransaction();

        $stmt = $db->prepare('SELECT * FROM lead_merge_prep_groups WHERE duplicate_group_id = :gid FOR UPDATE');
        $stmt->execute([':gid' => $groupId]);
        $existing = $stmt->fetch();

        if (!$existing) {
            // Create a fresh prep row in draft status.
            $insertStmt = $db->prepare(
                'INSERT INTO lead_merge_prep_groups (duplicate_group_id, created_by) VALUES (:gid, :by)'
            );
            $insertStmt->execute([':gid' => $groupId, ':by' => $user['id']]);
            $prepId = (int) $db->lastInsertId();
            $existing = [
                'id'                        => $prepId,
                'duplicate_group_id'        => $groupId,
                'preferred_primary_lead_id' => null,
                'review_notes'              => null,
                'status'                    => 'draft',
                'prepared_by'               => null,
                'prepared_at'               => null,
                'created_by'                => (int) $user['id'],
            ];
            $changedFields['created'] = ['from' => null, 'to' => 'draft'];
        }
        $prepId = (int) $existing['id'];

        // Decide final values based on what the caller sent.
        $finalPrimary = $hasPrimary ? $newPrimary : ($existing['preferred_primary_lead_id'] !== null ? (int) $existing['preferred_primary_lead_id'] : null);
        $finalNotes   = $hasNotes   ? $newNotes   : $existing['review_notes'];
        $finalStatus  = $hasStatus  ? $newStatus  : $existing['status'];

        if ($finalStatus === 'prepared' && $finalPrimary === null) {
            $db->rollBack();
            pipelineFail(422, 'A preferred primary lead must be chosen before marking prepared', 'primary_required');
        }

        // Capture diffs.
        $curPrimary = $existing['preferred_primary_lead_id'] !== null ? (int) $existing['preferred_primary_lead_id'] : null;
        if ($hasPrimary && $finalPrimary !== $curPrimary) {
            $changedFields['preferred_primary_lead_id'] = ['from' => $curPrimary, 'to' => $finalPrimary];
        }
        if ($hasNotes && ($existing['review_notes'] ?? null) !== $finalNotes) {
            $changedFields['review_notes'] = true; // presence flag — avoid stuffing long text into every activity row
        }
        if ($hasStatus && $existing['status'] !== $finalStatus) {
            $changedFields['status'] = ['from' => $existing['status'], 'to' => $finalStatus];
        }

        // Apply group-level update if anything changed.
        $shouldUpdatePreparer = $hasStatus && $finalStatus === 'prepared' && $existing['status'] !== 'prepared';
        if (!empty($changedFields) || $shouldUpdatePreparer) {
            $sql = 'UPDATE lead_merge_prep_groups
                       SET preferred_primary_lead_id = :primary,
                           review_notes              = :notes,
                           status                    = :status';
            if ($shouldUpdatePreparer) {
                $sql .= ', prepared_by = :preparer, prepared_at = NOW()';
            } elseif ($hasStatus && $finalStatus !== 'prepared') {
                // Moving back to draft clears the preparer.
                $sql .= ', prepared_by = NULL, prepared_at = NULL';
            }
            $sql .= ' WHERE id = :id';
            $upd = $db->prepare($sql);
            $bind = [
                ':primary' => $finalPrimary,
                ':notes'   => $finalNotes,
                ':status'  => $finalStatus,
                ':id'      => $prepId,
            ];
            if ($shouldUpdatePreparer) $bind[':preparer'] = $user['id'];
            $upd->execute($bind);
        }

        // Upsert per-member choices. Compare vs existing rows for this prep group.
        if ($hasChoices) {
            $curStmt = $db->prepare(
                'SELECT imported_lead_id, keep_for_reference, likely_best_phone,
                        likely_best_email, likely_best_address, notes
                   FROM lead_merge_prep_choices WHERE prep_group_id = :pid'
            );
            $curStmt->execute([':pid' => $prepId]);
            $curChoices = [];
            foreach ($curStmt->fetchAll() as $c) {
                $curChoices[(int) $c['imported_lead_id']] = [
                    'keep_for_reference'  => (int) $c['keep_for_reference'],
                    'likely_best_phone'   => (int) $c['likely_best_phone'],
                    'likely_best_email'   => (int) $c['likely_best_email'],
                    'likely_best_address' => (int) $c['likely_best_address'],
                    'notes'               => $c['notes'],
                ];
            }

            $insertChoice = $db->prepare(
                'INSERT INTO lead_merge_prep_choices
                   (prep_group_id, imported_lead_id, keep_for_reference, likely_best_phone,
                    likely_best_email, likely_best_address, notes)
                 VALUES (:pid, :lid, :kr, :bp, :be, :ba, :notes)
                 ON DUPLICATE KEY UPDATE
                   keep_for_reference  = VALUES(keep_for_reference),
                   likely_best_phone   = VALUES(likely_best_phone),
                   likely_best_email   = VALUES(likely_best_email),
                   likely_best_address = VALUES(likely_best_address),
                   notes               = VALUES(notes)'
            );

            foreach ($newChoices as $lid => $fields) {
                $cur = $curChoices[$lid] ?? null;
                $diff = [];
                foreach (['keep_for_reference','likely_best_phone','likely_best_email','likely_best_address'] as $k) {
                    $curVal = (int) ($cur[$k] ?? 0);
                    $newVal = (int) $fields[$k];
                    if ($curVal !== $newVal) $diff[$k] = ['from' => (bool) $curVal, 'to' => (bool) $newVal];
                }
                if (($cur['notes'] ?? null) !== $fields['notes']) {
                    $diff['notes'] = true;
                }
                if (!empty($diff)) {
                    $changedChoices[$lid] = $diff;
                }
                $insertChoice->execute([
                    ':pid' => $prepId,
                    ':lid' => $lid,
                    ':kr'  => $fields['keep_for_reference'],
                    ':bp'  => $fields['likely_best_phone'],
                    ':be'  => $fields['likely_best_email'],
                    ':ba'  => $fields['likely_best_address'],
                    ':notes' => $fields['notes'],
                ]);
            }
        }

        // Emit one merge_prep_updated activity per member lead if anything changed.
        if (!empty($changedFields) || !empty($changedChoices)) {
            $payload = [
                'prep_group_id'      => $prepId,
                'duplicate_group_id' => $groupId,
                'changed_fields'     => $changedFields,
                'choices_changed'    => $changedChoices,
            ];
            foreach ($memberIds as $lid) {
                logLeadActivity($db, $lid, (int) $user['id'], 'merge_prep_updated', null, $payload);
            }
        }

        $db->commit();
    } catch (Throwable $e) {
        if ($db->inTransaction()) $db->rollBack();
        if ($e instanceof PDOException) {
            pipelineFail(500, 'Save failed: ' . $e->getMessage(), 'db_error');
        }
        throw $e;
    }

    echo json_encode([
        'success'            => true,
        'prep_id'            => $prepId,
        'changed_fields'     => array_keys($changedFields),
        'choices_changed'    => array_keys($changedChoices),
        'member_count'       => count($memberIds),
    ]);
    exit();
}

pipelineFail(405, 'Method not allowed', 'method_not_allowed');

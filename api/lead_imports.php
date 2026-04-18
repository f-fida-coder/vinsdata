<?php

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/pipeline.php';
initSession();

$user = requireAuth();
$db   = getDBConnection();

/** Applies a header→field mapping to a raw row, producing a normalized object. */
function applyMapping(array $raw, array $mapping): array
{
    $normalized = [];
    foreach ($mapping as $header => $field) {
        if ($field === '_ignore') continue;
        if (!array_key_exists($header, $raw)) continue;
        $value = $raw[$header];
        if (is_string($value)) $value = trim($value);
        if ($value === '' || $value === null) continue;
        // Last-write-wins if multiple headers map to the same normalized field.
        $normalized[$field] = $value;
    }
    return $normalized;
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    if (isset($_GET['id'])) {
        $id = (int) $_GET['id'];
        $stmt = $db->prepare(
            'SELECT b.*, u.name AS imported_by_name, f.display_name AS file_display_name,
                    a.original_filename AS artifact_name, t.template_name
               FROM lead_import_batches b
               JOIN users u ON u.id = b.imported_by
               JOIN files f ON f.id = b.file_id
               JOIN file_artifacts a ON a.id = b.artifact_id
               LEFT JOIN column_mapping_templates t ON t.id = b.mapping_template_id
              WHERE b.id = :id'
        );
        $stmt->execute([':id' => $id]);
        $batch = $stmt->fetch();
        if (!$batch) pipelineFail(404, 'Batch not found', 'batch_not_found');
        $batch['mapping_json'] = json_decode($batch['mapping_json'] ?? 'null', true);
        echo json_encode($batch);
        exit();
    }

    $sql = 'SELECT b.id, b.file_id, b.artifact_id, b.batch_name, b.source_stage,
                   b.total_rows, b.imported_rows, b.duplicate_rows, b.failed_rows,
                   b.mapping_template_id, b.imported_at, b.notes,
                   u.name AS imported_by_name,
                   a.original_filename AS artifact_name,
                   t.template_name
              FROM lead_import_batches b
              JOIN users u ON u.id = b.imported_by
              JOIN file_artifacts a ON a.id = b.artifact_id
              LEFT JOIN column_mapping_templates t ON t.id = b.mapping_template_id
             WHERE 1=1';
    $params = [];
    if (!empty($_GET['file_id'])) {
        $sql .= ' AND b.file_id = :fid';
        $params[':fid'] = (int) $_GET['file_id'];
    }
    if (!empty($_GET['artifact_id'])) {
        $sql .= ' AND b.artifact_id = :aid';
        $params[':aid'] = (int) $_GET['artifact_id'];
    }
    $sql .= ' ORDER BY b.imported_at DESC, b.id DESC';
    $stmt = $db->prepare($sql);
    $stmt->execute($params);
    echo json_encode($stmt->fetchAll());
    exit();
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    assertAdmin($user);
    $input = json_decode(file_get_contents('php://input'), true) ?? [];

    $fileId     = (int) ($input['file_id']     ?? 0);
    $artifactId = (int) ($input['artifact_id'] ?? 0);
    $batchName  = trim($input['batch_name']    ?? '');
    $templateId = isset($input['mapping_template_id']) ? (int) $input['mapping_template_id'] : null;
    $mapping    = $input['mapping_json'] ?? null;
    $rows       = $input['rows']         ?? [];
    $notes      = $input['notes']        ?? null;

    if ($fileId <= 0 || $artifactId <= 0) {
        pipelineFail(400, 'file_id and artifact_id are required', 'missing_fields');
    }
    if ($batchName === '') {
        pipelineFail(400, 'batch_name is required', 'missing_batch_name');
    }
    if (!is_array($mapping) || empty($mapping)) {
        pipelineFail(400, 'mapping_json must be a non-empty object', 'invalid_mapping');
    }
    foreach ($mapping as $h => $f) {
        if (!is_string($h) || !is_string($f) || !in_array($f, NORMALIZED_FIELDS, true)) {
            pipelineFail(400, 'Invalid mapping entry: ' . json_encode([$h => $f]), 'invalid_mapping');
        }
    }
    if (!is_array($rows) || count($rows) === 0) {
        pipelineFail(400, 'rows is empty', 'empty_rows');
    }

    $elig = checkImportEligibility($db, $fileId, $artifactId);
    if (!$elig['eligible']) {
        pipelineFail(422, $elig['reason'], $elig['code']);
    }
    $file     = $elig['file'];
    $artifact = $elig['artifact'];

    if ($templateId !== null) {
        $stmt = $db->prepare('SELECT id FROM column_mapping_templates WHERE id = :id');
        $stmt->execute([':id' => $templateId]);
        if (!$stmt->fetch()) {
            pipelineFail(404, 'mapping_template_id not found', 'template_not_found');
        }
    }

    // Validate row shape + drop entirely-empty rows before insert
    $cleanRows = [];
    foreach ($rows as $r) {
        if (!is_array($r)) continue;
        $rowNumber = (int) ($r['row_number'] ?? 0);
        $raw       = $r['raw'] ?? $r['raw_payload'] ?? null;
        if ($rowNumber <= 0 || !is_array($raw)) continue;
        $hasValue = false;
        foreach ($raw as $v) {
            if ($v !== null && $v !== '') { $hasValue = true; break; }
        }
        if (!$hasValue) continue;
        $cleanRows[] = ['row_number' => $rowNumber, 'raw' => $raw];
    }
    if (count($cleanRows) === 0) {
        pipelineFail(422, 'All rows were empty after cleaning', 'empty_rows');
    }

    try {
        $db->beginTransaction();

        $stmt = $db->prepare(
            'INSERT INTO lead_import_batches
               (file_id, artifact_id, batch_name, source_stage, total_rows, imported_rows,
                duplicate_rows, failed_rows, imported_by, imported_at, mapping_template_id, mapping_json, notes)
             VALUES
               (:file_id, :artifact_id, :batch_name, :source_stage, :total, 0, 0, 0,
                :by, NOW(), :tpl, :mapping, :notes)'
        );
        $stmt->execute([
            ':file_id'      => $fileId,
            ':artifact_id'  => $artifactId,
            ':batch_name'   => $batchName,
            ':source_stage' => $artifact['stage'],
            ':total'        => count($cleanRows),
            ':by'           => $user['id'],
            ':tpl'          => $templateId,
            ':mapping'      => json_encode($mapping),
            ':notes'        => $notes,
        ]);
        $batchId = (int) $db->lastInsertId();

        $insertRow = $db->prepare(
            'INSERT INTO imported_leads_raw
               (batch_id, source_row_number, raw_payload_json, normalized_payload_json, import_status, error_message)
             VALUES (:bid, :rn, :raw, :norm, :status, :err)'
        );

        $imported = 0; $failed = 0; $skipped = 0;
        foreach ($cleanRows as $row) {
            $normalized = applyMapping($row['raw'], $mapping);
            $status     = 'imported';
            $err        = null;
            if (empty($normalized)) {
                $status = 'skipped';
                $err    = 'All mapped fields were empty after normalization';
            }
            $insertRow->execute([
                ':bid'    => $batchId,
                ':rn'     => $row['row_number'],
                ':raw'    => json_encode($row['raw']),
                ':norm'   => json_encode($normalized),
                ':status' => $status,
                ':err'    => $err,
            ]);
            if ($status === 'imported') $imported++;
            elseif ($status === 'skipped') $skipped++;
            else $failed++;
        }

        $upd = $db->prepare(
            'UPDATE lead_import_batches
                SET imported_rows = :imp, failed_rows = :fail
              WHERE id = :id'
        );
        $upd->execute([
            ':imp'  => $imported,
            ':fail' => $failed,
            ':id'   => $batchId,
        ]);

        $db->commit();
    } catch (Throwable $e) {
        $db->rollBack();
        pipelineFail(500, 'Import failed: ' . $e->getMessage(), 'db_error');
    }

    echo json_encode([
        'success'         => true,
        'batch_id'        => $batchId,
        'total_rows'      => count($cleanRows),
        'imported_rows'   => $imported,
        'skipped_rows'    => $skipped,
        'failed_rows'     => $failed,
        'duplicate_rows'  => 0,
    ]);
    exit();
}

pipelineFail(405, 'Method not allowed', 'method_not_allowed');

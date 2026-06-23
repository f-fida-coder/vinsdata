<?php

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/pipeline.php';
require_once __DIR__ . '/bos_helpers.php';
initSession();

$user = requireAuth();
$db   = getDBConnection();
$method = $_SERVER['REQUEST_METHOD'];

// fetchBoS / defaultsFromLead / renderBillOfSalePdf live in bos_helpers.php
// so other endpoints (e.g. bos_email.php) can reuse them without pulling
// in this file's request dispatcher. The local definitions below are
// kept guarded with function_exists() in bos_helpers.php — they're a
// no-op now since they're already declared there.


// List mode — all bills of sale across leads, joined with enough lead
// context for the Bill of Sale tab to render a useful table.
//
//   GET /api/bill_of_sale?list=1
//
// Returns: [{ id, imported_lead_id, lead_name, vehicle_vin, vehicle_make,
//             vehicle_model, vehicle_year, buyer_name, payment_type,
//             payment_amount, has_signature, status, updated_at }, ...]
if ($method === 'GET' && isset($_GET['list'])) {
    $stmt = $db->query(
        "SELECT b.id, b.imported_lead_id,
                b.vehicle_vin, b.vehicle_make, b.vehicle_model, b.vehicle_year,
                b.buyer_name, b.payment_type, b.payment_amount,
                b.signed_at, b.signature_request_id, b.signature_status,
                b.signed_pdf_url,
                b.created_at, b.updated_at,
                JSON_UNQUOTE(JSON_EXTRACT(r.normalized_payload_json, '$.full_name'))   AS lead_full_name,
                JSON_UNQUOTE(JSON_EXTRACT(r.normalized_payload_json, '$.first_name'))  AS lead_first_name,
                JSON_UNQUOTE(JSON_EXTRACT(r.normalized_payload_json, '$.last_name'))   AS lead_last_name,
                u.name AS created_by_name
           FROM bill_of_sale b
           LEFT JOIN imported_leads_raw r ON r.id = b.imported_lead_id
           LEFT JOIN users u ON u.id = b.created_by
          ORDER BY b.updated_at DESC, b.id DESC"
    );
    $rows = $stmt->fetchAll();
    foreach ($rows as &$r) {
        $r['id']               = (int) $r['id'];
        // Keep NULL for standalone BoSes — coercing to 0 made the frontend
        // think every row was attached to "lead 0" and broke routing into
        // the lead drawer / PDF preview links.
        $r['imported_lead_id'] = $r['imported_lead_id'] !== null ? (int) $r['imported_lead_id'] : null;
        $r['payment_amount']   = $r['payment_amount'] !== null ? (float) $r['payment_amount'] : null;
        $r['vehicle_year']     = $r['vehicle_year']   !== null ? (int) $r['vehicle_year']   : null;
        $lead = trim((string) ($r['lead_full_name'] ?: trim(($r['lead_first_name'] ?? '') . ' ' . ($r['lead_last_name'] ?? ''))));
        $r['lead_name'] = $lead !== '' ? $lead : null;
        unset($r['lead_full_name'], $r['lead_first_name'], $r['lead_last_name']);

        // Derive a display status. Real signature flow lands in v2.
        if (!empty($r['signed_at'])) {
            $r['status'] = 'signed';
        } elseif (!empty($r['signature_request_id'])) {
            $r['status'] = 'awaiting_signature';
        } elseif (!empty($r['buyer_name']) && $r['payment_amount']) {
            $r['status'] = 'ready_to_send';
        } else {
            $r['status'] = 'draft';
        }
    }
    unset($r);
    echo json_encode($rows);
    exit();
}

if ($method === 'GET') {
    // Standalone BoS: GET ?id=N fetches a row by primary key (lead may be null).
    // Lead-attached: GET ?lead_id=N keeps the existing per-lead behavior.
    $bosId  = (int) ($_GET['id'] ?? 0);
    $leadId = (int) ($_GET['lead_id'] ?? 0);
    $format = $_GET['format'] ?? 'json';

    if ($bosId > 0) {
        $stmt = $db->prepare('SELECT * FROM bill_of_sale WHERE id = :id');
        $stmt->execute([':id' => $bosId]);
        $row = $stmt->fetch();
        if (!$row) pipelineFail(404, 'Bill of Sale not found', 'bos_not_found');
        // Reuse fetchBoS's casting for consistent JSON shape.
        $row['id']                      = (int) $row['id'];
        $row['imported_lead_id']        = $row['imported_lead_id'] !== null ? (int) $row['imported_lead_id'] : null;
        $row['payment_amount']          = $row['payment_amount']  !== null ? (float) $row['payment_amount']  : null;
        $row['trade_amount']            = $row['trade_amount']    !== null ? (float) $row['trade_amount']    : null;
        $row['gift_value']              = $row['gift_value']      !== null ? (float) $row['gift_value']      : null;
        $row['odometer_accurate']       = (bool) $row['odometer_accurate'];
        $row['odometer_exceeds_limits'] = (bool) $row['odometer_exceeds_limits'];
        $row['odometer_not_actual']     = (bool) $row['odometer_not_actual'];
    } elseif ($leadId > 0) {
        loadLeadOrFail($db, $leadId);
        $row = fetchBoS($db, $leadId) ?: defaultsFromLead($db, $leadId, $user['name'] ?? null);
    } else {
        pipelineFail(400, 'Either id or lead_id is required', 'missing_id');
    }

    if ($format === 'pdf') {
        try {
            $pdf = renderBillOfSalePdf($row);
        } catch (Throwable $e) {
            pipelineFail(500, 'PDF generation failed: ' . $e->getMessage(), 'pdf_error');
        }
        // Only log to a lead's timeline when this BoS is actually
        // attached to one. Standalone BoSes don't touch any lead.
        if (!empty($row['imported_lead_id'])) {
            $existing = fetchBoS($db, (int) $row['imported_lead_id']);
            if ($existing) {
                logLeadActivity($db, (int) $row['imported_lead_id'], $user['id'], 'bill_of_sale_generated', null, ['vin' => $row['vehicle_vin']]);
            }
        }
        $filename = 'BoS-' . ($row['vehicle_vin'] ?: ($row['id'] ? ('bos-' . $row['id']) : ('lead-' . $leadId))) . '-' . date('Ymd') . '.pdf';
        // Default to inline so the EmailBoSModal preview iframe renders
        // the PDF in-browser. Opt into download via ?download=1 (used
        // by the explicit "Download PDF" button in the BoS list row).
        // Inline PDFs still let the user save via the browser's PDF
        // viewer toolbar.
        $disposition = !empty($_GET['download']) ? 'attachment' : 'inline';
        if (PHP_SAPI !== 'cli') {
            // Reset the JSON content-type header set by config.php.
            header_remove('Content-Type');
            header('Content-Type: application/pdf');
            header('Content-Disposition: ' . $disposition . '; filename="' . $filename . '"');
            header('Content-Length: ' . strlen($pdf));
        }
        echo $pdf;
        exit();
    }
    echo json_encode($row);
    exit();
}

if ($method === 'PUT') {
    $input = json_decode(file_get_contents('php://input'), true) ?? [];
    $bosId  = (int) ($input['id'] ?? 0);
    $leadId = (int) ($input['lead_id'] ?? 0);
    // Standalone mode: either an existing standalone BoS (id given, no lead)
    // or a brand-new one (no id, lead_id explicitly null / 0). Lead-attached
    // mode preserves the original lead_id-only path so existing UI works.
    $standalone = $bosId > 0 || $leadId <= 0;
    if (!$standalone) {
        loadLeadOrFail($db, $leadId);
    }

    if (!empty($input['payment_type']) && !in_array($input['payment_type'], BOS_PAYMENT_TYPES, true)) {
        pipelineFail(400, 'Invalid payment_type', 'invalid_payment_type');
    }
    if (!empty($input['taxes_paid_by']) && !in_array($input['taxes_paid_by'], BOS_TAXES_PAID_BY, true)) {
        pipelineFail(400, 'Invalid taxes_paid_by', 'invalid_taxes_paid_by');
    }
    // additional_terms cap. Generous limit since the Odometer block
    // now lives on its own page (forced page-break in bos_helpers.php),
    // so this section is no longer competing for page-2 budget.
    // 1500 chars ~ 250 words ~ 18-20 wrapped lines at 11pt — enough
    // room for a substantive clause-by-clause statement without
    // ballooning the page count. Hard wall keeps the UI sensible and
    // prevents a runaway paste-of-an-entire-contract scenario.
    if (isset($input['additional_terms']) && $input['additional_terms'] !== null) {
        $at = (string) $input['additional_terms'];
        if (mb_strlen($at) > 1500) {
            pipelineFail(400, 'Additional terms must be 1500 characters or fewer (got ' . mb_strlen($at) . ').', 'additional_terms_too_long');
        }
    }

    $columns = [
        'sale_county','sale_state','sale_date',
        'buyer_name','buyer_address','seller_name','seller_address',
        'vehicle_make','vehicle_model','vehicle_body_type','vehicle_year','vehicle_color','vehicle_odometer','vehicle_vin',
        'payment_type','payment_amount','trade_amount',
        'trade_make','trade_model','trade_body_type','trade_year','trade_color','trade_odometer',
        'gift_value','other_terms','additional_terms','taxes_paid_by',
        'odometer_accurate','odometer_exceeds_limits','odometer_not_actual',
    ];

    // Standalone path = direct INSERT or UPDATE-by-id, since the
    // ON-DUPLICATE-KEY upsert depends on imported_lead_id being the
    // unique-conflict target.
    if ($standalone) {
        // Collect just the field bindings here. :uid + :id get added
        // per-branch below so PDO doesn't reject "extra" params under
        // emulate_prepares=false (which is what HY093 was complaining
        // about — the UPDATE branch never references :uid).
        $fieldVals = [];
        $fieldParams = [];
        foreach ($columns as $k) {
            if (!array_key_exists($k, $input)) continue;
            $v = $input[$k];
            if (in_array($k, ['odometer_accurate','odometer_exceeds_limits','odometer_not_actual'], true)) {
                $v = $v ? 1 : 0;
            } elseif (in_array($k, ['payment_amount','trade_amount','gift_value'], true)) {
                $v = ($v === '' || $v === null) ? null : (float) $v;
            } elseif ($k === 'vehicle_year' || $k === 'trade_year') {
                // Years come in as strings (free-text input) or numbers.
                // Clamp to a SMALLINT-ish range so a typo like "20020"
                // can't blow up the column type.
                if ($v === '' || $v === null) {
                    $v = null;
                } else {
                    $n = (int) (is_string($v) ? trim($v) : $v);
                    $v = ($n >= 1900 && $n <= 2100) ? $n : null;
                }
            } elseif ($k === 'vehicle_odometer' || $k === 'trade_odometer') {
                // Stored as VARCHAR(50) on the BoS table but the form
                // posts user-typed strings — strip commas + spaces so
                // "87,500" round-trips cleanly.
                if ($v === '' || $v === null) {
                    $v = null;
                } else {
                    $v = is_string($v) ? trim(str_replace([',', ' '], '', $v)) : (string) $v;
                }
            } else {
                $v = ($v === '' || $v === null) ? null : (is_string($v) ? trim($v) : $v);
            }
            $fieldVals[$k]       = $v;
            $fieldParams[":$k"]  = $v;
        }

        try {
            if ($bosId > 0) {
                // Update existing standalone (or any) BoS by primary key.
                if (empty($fieldVals)) {
                    echo json_encode(['success' => true, 'unchanged' => true]);
                    exit();
                }
                $sets = [];
                foreach (array_keys($fieldVals) as $k) $sets[] = "$k = :$k";
                $params = $fieldParams + [':id' => $bosId];
                $sql = 'UPDATE bill_of_sale SET ' . implode(', ', $sets) . ' WHERE id = :id';
                $db->prepare($sql)->execute($params);
            } else {
                // Insert new standalone row (imported_lead_id stays NULL).
                $cols = ['created_by'];
                $vals = [':uid'];
                foreach (array_keys($fieldVals) as $k) {
                    $cols[] = $k;
                    $vals[] = ":$k";
                }
                $params = $fieldParams + [':uid' => $user['id']];
                $sql = 'INSERT INTO bill_of_sale (' . implode(',', $cols) . ') VALUES (' . implode(',', $vals) . ')';
                $db->prepare($sql)->execute($params);
                $bosId = (int) $db->lastInsertId();
            }
        } catch (Throwable $e) {
            pipelineFail(500, 'Bill of Sale save failed: ' . $e->getMessage(), 'db_error');
        }

        $sel = $db->prepare('SELECT * FROM bill_of_sale WHERE id = :id');
        $sel->execute([':id' => $bosId]);
        $row = $sel->fetch();
        echo json_encode(['success' => true, 'bill_of_sale' => $row]);
        exit();
    }

    // ----- Lead-attached path (original upsert-by-lead behavior) -----
    $cols = ['imported_lead_id', 'created_by'];
    $vals = [':lid', ':uid'];
    $sets = [];
    $params = [':lid' => $leadId, ':uid' => $user['id']];
    foreach ($columns as $k) {
        if (!array_key_exists($k, $input)) continue;
        $v = $input[$k];
        if (in_array($k, ['odometer_accurate','odometer_exceeds_limits','odometer_not_actual'], true)) {
            $v = $v ? 1 : 0;
        } elseif (in_array($k, ['payment_amount','trade_amount','gift_value'], true)) {
            $v = ($v === '' || $v === null) ? null : (float) $v;
        } elseif ($k === 'vehicle_year' || $k === 'trade_year') {
            if ($v === '' || $v === null) {
                $v = null;
            } else {
                $n = (int) (is_string($v) ? trim($v) : $v);
                $v = ($n >= 1900 && $n <= 2100) ? $n : null;
            }
        } elseif ($k === 'vehicle_odometer' || $k === 'trade_odometer') {
            $v = ($v === '' || $v === null) ? null : (is_string($v) ? trim(str_replace([',', ' '], '', $v)) : (string) $v);
        } else {
            $v = ($v === '' || $v === null) ? null : (is_string($v) ? trim($v) : $v);
        }
        $cols[] = $k;
        $vals[] = ":$k";
        $sets[] = "$k = VALUES($k)";
        $params[":$k"] = $v;
    }

    if (count($cols) <= 2) {
        echo json_encode(['success' => true, 'unchanged' => true]);
        exit();
    }

    $sql = 'INSERT INTO bill_of_sale (' . implode(',', $cols) . ') VALUES (' . implode(',', $vals) . ') '
         . 'ON DUPLICATE KEY UPDATE ' . implode(', ', $sets);
    try {
        $db->prepare($sql)->execute($params);
        logLeadActivity($db, $leadId, $user['id'], 'bill_of_sale_updated', null, ['payment_type' => $input['payment_type'] ?? null]);
    } catch (Throwable $e) {
        pipelineFail(500, 'Bill of Sale save failed: ' . $e->getMessage(), 'db_error');
    }
    echo json_encode(['success' => true, 'bill_of_sale' => fetchBoS($db, $leadId)]);
    exit();
}

if ($method === 'DELETE') {
    // Hard delete a BoS row. Standalone or lead-attached, doesn't matter.
    // No soft-delete here — BoSes are working drafts; if you don't want
    // one anymore you delete it.
    $input = json_decode(file_get_contents('php://input'), true) ?? [];
    $bosId = (int) ($input['id'] ?? 0);
    if ($bosId <= 0) pipelineFail(400, 'id is required', 'missing_id');

    $stmt = $db->prepare('SELECT imported_lead_id FROM bill_of_sale WHERE id = :id');
    $stmt->execute([':id' => $bosId]);
    $row = $stmt->fetch();
    if (!$row) pipelineFail(404, 'Bill of Sale not found', 'bos_not_found');

    try {
        $db->beginTransaction();
        $db->prepare('DELETE FROM bill_of_sale WHERE id = :id')->execute([':id' => $bosId]);
        if (!empty($row['imported_lead_id'])) {
            // Best-effort timeline entry; failure here doesn't undo the delete.
            try {
                logLeadActivity($db, (int) $row['imported_lead_id'], $user['id'], 'bill_of_sale_updated', ['action' => 'deleted', 'bos_id' => $bosId], null);
            } catch (Throwable $_e) { /* swallow */ }
        }
        $db->commit();
    } catch (Throwable $e) {
        if ($db->inTransaction()) $db->rollBack();
        pipelineFail(500, 'Bill of Sale delete failed: ' . $e->getMessage(), 'db_error');
    }
    echo json_encode(['success' => true, 'deleted_id' => $bosId]);
    exit();
}

pipelineFail(405, 'Method not allowed', 'method_not_allowed');

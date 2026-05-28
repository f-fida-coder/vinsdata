<?php
// Manual car add for the Investors workspace. Admin-only.
//
// When applying an investor to a car, the operator picks from the
// lead search. But some JV cars never went through the upload pipeline
// (private acquisitions, auction buys, cars sourced outside the CRM).
// This endpoint lets the admin drop a minimal car row directly so the
// investor linkage + JV agreement still have something to point at.
//
// Mirrors api/lead_manual.php's "synthetic file + batch" pattern so
// these rows live in their own audit-able file ("Investor JV cars")
// rather than mixing into the regular Manual lead add file. Owner
// contact info is OPTIONAL here — the investor cares about the
// vehicle, not necessarily about reaching the prior owner.
//
// POST body:
//   year, make, model, vin       string  (VIN required; year+make+model strongly preferred)
//   owner_name                   string  (optional — used as the "lead name" on the row)
//   owner_phone, owner_email     string  (optional)
//   mileage, color               string  (optional)
//   target_purchase_price        number  (optional — stored on lead_states.price_offered
//                                         so the JV PDF's "Target Purchase Price"
//                                         line pre-fills correctly)
//   notes                        string  (optional)
//
// Returns { success, lead_id } — the React caller takes that lead_id
// and immediately POSTs /api/investor_leads to link the investor.

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/pipeline.php';
initSession();

$user = requireAuth();
if (($user['role'] ?? null) !== 'admin') {
    pipelineFail(403, 'Manual investor car add is admin-only', 'admin_required');
}
$db = getDBConnection();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    pipelineFail(405, 'Method not allowed', 'method_not_allowed');
}

$input = json_decode(file_get_contents('php://input'), true) ?? [];

$vin   = strtoupper(trim((string) ($input['vin']   ?? '')));
$year  = trim((string) ($input['year']  ?? ''));
$make  = trim((string) ($input['make']  ?? ''));
$model = trim((string) ($input['model'] ?? ''));
$trim  = trim((string) ($input['trim']  ?? ''));
$color = trim((string) ($input['color'] ?? ''));

$mileage = $input['mileage'] ?? null;
if (is_string($mileage)) {
    $mileage = trim(str_replace([',', ' '], '', $mileage));
    if ($mileage === '') $mileage = null;
}
if ($mileage !== null && !is_numeric($mileage)) {
    pipelineFail(400, 'mileage must be numeric', 'invalid_mileage');
}

$ownerName  = trim((string) ($input['owner_name']  ?? ''));
$ownerPhone = trim((string) ($input['owner_phone'] ?? ''));
$ownerEmail = trim((string) ($input['owner_email'] ?? ''));
$notes      = trim((string) ($input['notes']       ?? ''));

$targetPrice = $input['target_purchase_price'] ?? null;
if ($targetPrice !== null && $targetPrice !== '') {
    if (!is_numeric($targetPrice) || (float) $targetPrice < 0) {
        pipelineFail(400, 'target_purchase_price must be a non-negative number', 'invalid_price');
    }
    $targetPrice = (float) $targetPrice;
} else {
    $targetPrice = null;
}

// VIN is the only hard requirement — the JV agreement keys off it
// (filename, signing reference, PDF body line). Year/Make/Model are
// strongly encouraged because they show up on the JV cover. We surface
// a clear 400 instead of silently rendering "_____________" everywhere.
if ($vin === '') {
    pipelineFail(400, 'VIN is required', 'missing_vin');
}
if ($year === '' && $make === '' && $model === '') {
    pipelineFail(400, 'At least one of year, make, or model is required', 'missing_vehicle');
}

// Build the normalized payload the same shape the upload pipeline writes.
$payload = [];
if ($vin       !== '') $payload['vin']           = $vin;
if ($year      !== '') $payload['year']          = $year;
if ($make      !== '') $payload['make']          = $make;
if ($model     !== '') $payload['model']         = $model;
if ($trim      !== '') $payload['Trim']          = $trim;
if ($color     !== '') $payload['color']         = $color;
if ($mileage !== null && $mileage !== '') $payload['mileage'] = (string) $mileage;
if ($ownerName  !== '') $payload['full_name']    = $ownerName;
if ($ownerPhone !== '') $payload['phone_primary'] = $ownerPhone;
if ($ownerEmail !== '') $payload['email_primary'] = $ownerEmail;

try {
    $db->beginTransaction();

    // 1. Lazy-create the synthetic vehicle for investor JV cars. Keyed
    //    on the literal name so concurrent admins can't dupe it.
    $stmt = $db->prepare("SELECT id FROM vehicles WHERE name = 'Investor JV cars' LIMIT 1");
    $stmt->execute();
    $vehicleId = (int) ($stmt->fetchColumn() ?: 0);
    if ($vehicleId === 0) {
        $db->prepare(
            "INSERT INTO vehicles (name, make, model, year, `trim`, is_active, notes)
             VALUES ('Investor JV cars', NULL, NULL, NULL, NULL, 1,
                     'Placeholder vehicle for cars added through the Investors workspace manual-add flow. Real make/model/year live in each lead row\'s normalized_payload_json.')"
        )->execute();
        $vehicleId = (int) $db->lastInsertId();
    }

    // 2. Lazy-create the synthetic file.
    $stmt = $db->prepare("SELECT id FROM files WHERE base_name = 'Investor JV cars' LIMIT 1");
    $stmt->execute();
    $fileId = (int) ($stmt->fetchColumn() ?: 0);
    if ($fileId === 0) {
        $db->prepare(
            "INSERT INTO files (vehicle_id, base_name, display_name, file_name,
                                year, version, current_stage, status, created_by, added_by)
             VALUES (:vid, 'Investor JV cars', 'Investor JV cars', 'Investor JV cars',
                     NULL, NULL, 'manual', 'active', :uid_created, :uid_added)"
        )->execute([
            ':vid'         => $vehicleId,
            ':uid_created' => (int) $user['id'],
            ':uid_added'   => (int) $user['id'],
        ]);
        $fileId = (int) $db->lastInsertId();
    }

    // 3. Lazy-create today's ongoing batch (same shape as lead_manual).
    $stmt = $db->prepare(
        "SELECT id FROM lead_import_batches
          WHERE file_id = :fid AND source_stage = 'manual'
            AND DATE(imported_at) = CURDATE()
          ORDER BY id DESC LIMIT 1"
    );
    $stmt->execute([':fid' => $fileId]);
    $batchId = (int) ($stmt->fetchColumn() ?: 0);
    if ($batchId === 0) {
        $today = (new DateTime('now'))->format('Y-m-d');
        $db->prepare(
            "INSERT INTO lead_import_batches
               (file_id, artifact_id, batch_name, source_stage,
                total_rows, imported_rows, duplicate_rows, failed_rows,
                imported_by, imported_at, mapping_template_id, mapping_json, notes)
             VALUES
               (:fid, NULL, :name, 'manual',
                0, 0, 0, 0,
                :uid, NOW(), NULL, NULL, 'Investor JV cars — ongoing batch')"
        )->execute([
            ':fid'  => $fileId,
            ':name' => 'Investor JV cars — ' . $today,
            ':uid'  => (int) $user['id'],
        ]);
        $batchId = (int) $db->lastInsertId();
    }

    // 4. Insert the lead row.
    $stmt = $db->prepare(
        "SELECT COALESCE(MAX(source_row_number), 0) + 1 FROM imported_leads_raw WHERE batch_id = :bid"
    );
    $stmt->execute([':bid' => $batchId]);
    $rowNumber = (int) $stmt->fetchColumn();

    $db->prepare(
        "INSERT INTO imported_leads_raw
           (batch_id, source_row_number, raw_payload_json, normalized_payload_json, import_status, error_message)
         VALUES (:bid, :rn, :raw, :norm, 'imported', NULL)"
    )->execute([
        ':bid'  => $batchId,
        ':rn'   => $rowNumber,
        ':raw'  => json_encode($payload),
        ':norm' => json_encode($payload),
    ]);
    $leadId = (int) $db->lastInsertId();

    // 5. Bump batch totals for accurate file-level counts.
    $db->prepare(
        "UPDATE lead_import_batches
            SET total_rows    = total_rows + 1,
                imported_rows = imported_rows + 1
          WHERE id = :bid"
    )->execute([':bid' => $batchId]);

    // 6. Lead state. We mark these as 'closed' temperature + status so
    //    they don't pollute pipeline/leads views for sales agents.
    //    price_offered carries the target purchase price for the JV PDF.
    $db->prepare(
        "INSERT INTO lead_states (imported_lead_id, assigned_user_id, status, priority, price_offered)
         VALUES (:lid, :uid, 'new', 'low', :price)"
    )->execute([
        ':lid'   => $leadId,
        ':uid'   => (int) $user['id'],
        ':price' => $targetPrice,
    ]);

    // 7. Optional inline note.
    if ($notes !== '') {
        $db->prepare(
            "INSERT INTO lead_notes (imported_lead_id, user_id, note) VALUES (:lid, :uid, :note)"
        )->execute([':lid' => $leadId, ':uid' => (int) $user['id'], ':note' => mb_substr($notes, 0, 5000)]);
        logLeadActivity($db, $leadId, (int) $user['id'], 'note_added', null, ['preview' => mb_substr($notes, 0, 140)]);
    }

    $db->commit();
} catch (Throwable $e) {
    if ($db->inTransaction()) $db->rollBack();
    pipelineFail(500, 'Failed to add investor car: ' . $e->getMessage(), 'db_error');
}

echo json_encode([
    'success'  => true,
    'lead_id'  => $leadId,
    'batch_id' => $batchId,
    'file_id'  => $fileId,
]);

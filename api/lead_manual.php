<?php
// Manual lead add. Drops a single hand-entered lead into the CRM
// without going through the upload pipeline. Used for walk-ins,
// referrals, anything the operator picks up off-spreadsheet.
//
// All manual leads land in a synthetic file called "Manual lead add"
// (one row in `files`, one in `vehicles`, lazy-created on first use)
// and a single ongoing batch with source_stage='manual'. The file
// shows up in the Files dropdown alongside spreadsheet uploads so
// admins can filter / audit / report on hand-entered leads.
//
// POST body:
//   first_name, last_name      string (at least one required)
//   phone_primary, email       string (at least one required so the
//                              empty-contact filter doesn't hide it)
//   address, city, state, zip  string (optional)
//   vin                        string (optional, normalized to upper)
//   year, make, model, trim    string (optional)
//   mileage                    int    (optional)
//   notes                      string (optional, attached as a lead note)
//   assign_to_self             bool   (optional, defaults to true so
//                                       the creator can see their own
//                                       new lead under the agent-only
//                                       visibility filter)

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/pipeline.php';
initSession();

$user = requireAuth();
$db   = getDBConnection();

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    pipelineFail(405, 'Method not allowed', 'method_not_allowed');
}

// Who can create manual leads. Pipeline-stage agents (carfax/filter/
// tlo) don't get this affordance — they work the upload pipeline.
$role = $user['role'] ?? null;
if (!in_array($role, ['admin', 'marketer', 'sales_agent'], true)) {
    pipelineFail(403, 'Only admins, marketers, and acquisition agents can add manual leads', 'forbidden');
}

$input = json_decode(file_get_contents('php://input'), true) ?? [];

// Field extraction + light normalization.
$firstName = trim((string) ($input['first_name'] ?? ''));
$lastName  = trim((string) ($input['last_name']  ?? ''));
$fullName  = trim($firstName . ' ' . $lastName);

$phone     = trim((string) ($input['phone_primary'] ?? $input['phone'] ?? ''));
$email     = trim((string) ($input['email_primary'] ?? $input['email'] ?? ''));
$address   = trim((string) ($input['full_address'] ?? $input['address'] ?? ''));
$city      = trim((string) ($input['city']    ?? ''));
$state     = strtoupper(trim((string) ($input['state']   ?? '')));
$zip       = trim((string) ($input['zip_code'] ?? $input['zip'] ?? ''));

$vin       = strtoupper(trim((string) ($input['vin'] ?? '')));
$year      = trim((string) ($input['year']  ?? ''));
$make      = trim((string) ($input['make']  ?? ''));
$model     = trim((string) ($input['model'] ?? ''));
$trim      = trim((string) ($input['trim']  ?? ''));
$mileage   = $input['mileage'] ?? null;
if (is_string($mileage)) {
    $mileage = trim(str_replace([',', ' '], '', $mileage));
    if ($mileage === '') $mileage = null;
}
if ($mileage !== null && !is_numeric($mileage)) {
    pipelineFail(400, 'mileage must be numeric', 'invalid_mileage');
}

$notes     = trim((string) ($input['notes'] ?? ''));
$assignToSelf = !array_key_exists('assign_to_self', $input) || !empty($input['assign_to_self']);

// We require a name (any half) AND at least one contact channel.
// Without contact info the lead is the same useless ghost the
// empty-contact filter hides on the leads page.
if ($fullName === '') {
    pipelineFail(400, 'First or last name is required', 'missing_name');
}
if ($phone === '' && $email === '') {
    pipelineFail(400, 'At least a phone or email is required', 'missing_contact');
}

// Build the normalized payload exactly the way the lead-import flow
// would write it — keeps the leads page renderer happy without a
// special case for manual leads.
$payload = [];
if ($firstName !== '') $payload['first_name']   = $firstName;
if ($lastName  !== '') $payload['last_name']    = $lastName;
if ($fullName  !== '') $payload['full_name']    = $fullName;
if ($phone     !== '') $payload['phone_primary']= $phone;
if ($email     !== '') $payload['email_primary']= $email;
if ($address   !== '') $payload['full_address'] = $address;
if ($city      !== '') $payload['city']         = $city;
if ($state     !== '') $payload['state']        = $state;
if ($zip       !== '') $payload['zip_code']     = $zip;
if ($vin       !== '') $payload['vin']          = $vin;
if ($year      !== '') $payload['year']         = $year;
if ($make      !== '') $payload['make']         = $make;
if ($model     !== '') $payload['model']        = $model;
if ($trim      !== '') $payload['Trim']         = $trim;
if ($mileage !== null && $mileage !== '') $payload['mileage'] = (string) $mileage;

try {
    $db->beginTransaction();

    // 1. Lazy-create the synthetic vehicle. We key on the literal name
    //    so multiple admins can't accidentally produce duplicates.
    $stmt = $db->prepare("SELECT id FROM vehicles WHERE name = 'Manual entries' LIMIT 1");
    $stmt->execute();
    $vehicleId = (int) ($stmt->fetchColumn() ?: 0);
    if ($vehicleId === 0) {
        $db->prepare(
            "INSERT INTO vehicles (name, make, model, year, `trim`, is_active, notes)
             VALUES ('Manual entries', NULL, NULL, NULL, NULL, 1,
                     'Placeholder vehicle for the Manual lead add file. Leads under this file carry their real make/model/year in normalized_payload_json.')"
        )->execute();
        $vehicleId = (int) $db->lastInsertId();
    }

    // 2. Lazy-create the synthetic file. base_name + display_name match
    //    so it surfaces with a friendly label in the Files filter
    //    dropdown.
    $stmt = $db->prepare("SELECT id FROM files WHERE base_name = 'Manual lead add' LIMIT 1");
    $stmt->execute();
    $fileId = (int) ($stmt->fetchColumn() ?: 0);
    if ($fileId === 0) {
        // Two distinct placeholders for created_by + added_by — PDO
        // with ATTR_EMULATE_PREPARES=false (config.php) rejects the
        // same name appearing twice in one statement (HY093).
        $db->prepare(
            "INSERT INTO files (vehicle_id, base_name, display_name, file_name,
                                year, version, current_stage, status, created_by, added_by)
             VALUES (:vid, 'Manual lead add', 'Manual lead add', 'Manual lead add',
                     NULL, NULL, 'manual', 'active', :uid_created, :uid_added)"
        )->execute([
            ':vid'         => $vehicleId,
            ':uid_created' => (int) $user['id'],
            ':uid_added'   => (int) $user['id'],
        ]);
        $fileId = (int) $db->lastInsertId();
    }

    // 3. Lazy-create today's ongoing batch under that file. We reuse
    //    today's batch so a single day's manual additions stay grouped
    //    instead of producing 50 tiny rows in the batch dropdown.
    $stmt = $db->prepare(
        "SELECT id FROM lead_import_batches
          WHERE file_id = :fid AND source_stage = 'manual'
            AND DATE(imported_at) = CURDATE()
          ORDER BY id DESC LIMIT 1"
    );
    $stmt->execute([':fid' => $fileId]);
    $batchId = (int) ($stmt->fetchColumn() ?: 0);
    if ($batchId === 0) {
        // No artifact for a manual batch — keep artifact_id NULL so the
        // file_artifacts FK stays clean. lead_import_batches.artifact_id
        // already permits NULL on the schema (set during migration).
        $today = (new DateTime('now'))->format('Y-m-d');
        $db->prepare(
            "INSERT INTO lead_import_batches
               (file_id, artifact_id, batch_name, source_stage,
                total_rows, imported_rows, duplicate_rows, failed_rows,
                imported_by, imported_at, mapping_template_id, mapping_json, notes)
             VALUES
               (:fid, NULL, :name, 'manual',
                0, 0, 0, 0,
                :uid, NOW(), NULL, NULL, 'Manual lead add — ongoing batch')"
        )->execute([
            ':fid'  => $fileId,
            ':name' => 'Manual lead add — ' . $today,
            ':uid'  => (int) $user['id'],
        ]);
        $batchId = (int) $db->lastInsertId();
    }

    // 4. Insert the lead row. source_row_number is just sequential per
    //    batch — pull the next number for today's batch.
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
        ':raw'  => json_encode($payload),  // raw = normalized for manual
        ':norm' => json_encode($payload),
    ]);
    $leadId = (int) $db->lastInsertId();

    // 5. Bump batch totals so the file-level lead_count stays accurate.
    $db->prepare(
        "UPDATE lead_import_batches
            SET total_rows    = total_rows + 1,
                imported_rows = imported_rows + 1
          WHERE id = :bid"
    )->execute([':bid' => $batchId]);

    // 6. Lead state + assignment. Creator becomes the assignee by
    //    default so an acquisition agent can see their own walk-in
    //    immediately (visibility filter requires assigned_user_id =
    //    self for agent roles).
    if ($assignToSelf) {
        $db->prepare(
            "INSERT INTO lead_states (imported_lead_id, assigned_user_id, status, priority)
             VALUES (:lid, :uid, 'new', 'medium')"
        )->execute([':lid' => $leadId, ':uid' => (int) $user['id']]);

        logLeadActivity($db, $leadId, (int) $user['id'], 'assigned', null, (int) $user['id']);
    }

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
    pipelineFail(500, 'Failed to add lead: ' . $e->getMessage(), 'db_error');
}

echo json_encode([
    'success'   => true,
    'lead_id'   => $leadId,
    'batch_id'  => $batchId,
    'file_id'   => $fileId,
]);

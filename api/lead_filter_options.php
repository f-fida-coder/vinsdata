<?php

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/pipeline.php';
initSession();

requireAuth();
$db = getDBConnection();

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    pipelineFail(405, 'Method not allowed', 'method_not_allowed');
}

// Only surface values for batches that actually have imported rows.
// We also pull lead_count so the dropdown can show "<name> · n rows" —
// the upload pipeline lets the same file be uploaded multiple times,
// which produces a fresh batch row per upload with the same name, and
// without a count + timestamp suffix the dropdown becomes a wall of
// duplicates.
$batches = $db->query(
    'SELECT b.id, b.batch_name, b.imported_at, COUNT(r.id) AS lead_count
       FROM lead_import_batches b
       JOIN imported_leads_raw r ON r.batch_id = b.id AND r.import_status = "imported" AND r.deleted_at IS NULL
      GROUP BY b.id, b.batch_name, b.imported_at
      ORDER BY b.imported_at DESC, b.id DESC'
)->fetchAll();

$files = $db->query(
    'SELECT DISTINCT f.id, f.display_name, v.name AS vehicle_name
       FROM lead_import_batches b
       JOIN files f    ON f.id = b.file_id
       JOIN vehicles v ON v.id = f.vehicle_id
       JOIN imported_leads_raw r ON r.batch_id = b.id AND r.import_status = "imported" AND r.deleted_at IS NULL
      ORDER BY f.display_name'
)->fetchAll();

$vehicles = $db->query(
    'SELECT DISTINCT v.id, v.name
       FROM lead_import_batches b
       JOIN files f    ON f.id = b.file_id
       JOIN vehicles v ON v.id = f.vehicle_id
       JOIN imported_leads_raw r ON r.batch_id = b.id AND r.import_status = "imported" AND r.deleted_at IS NULL
      ORDER BY v.name'
)->fetchAll();

$stages = $db->query(
    'SELECT DISTINCT source_stage
       FROM lead_import_batches b
       JOIN imported_leads_raw r ON r.batch_id = b.id AND r.import_status = "imported" AND r.deleted_at IS NULL
      ORDER BY source_stage'
)->fetchAll(PDO::FETCH_COLUMN);

$states = $db->query(
    "SELECT DISTINCT norm_state
       FROM imported_leads_raw
      WHERE import_status = 'imported' AND deleted_at IS NULL AND norm_state IS NOT NULL AND norm_state <> ''
      ORDER BY norm_state"
)->fetchAll(PDO::FETCH_COLUMN);

$makes = $db->query(
    "SELECT DISTINCT norm_make
       FROM imported_leads_raw
      WHERE import_status = 'imported' AND deleted_at IS NULL AND norm_make IS NOT NULL AND norm_make <> ''
      ORDER BY norm_make"
)->fetchAll(PDO::FETCH_COLUMN);

$models = $db->query(
    "SELECT DISTINCT norm_model
       FROM imported_leads_raw
      WHERE import_status = 'imported' AND deleted_at IS NULL AND norm_model IS NOT NULL AND norm_model <> ''
      ORDER BY norm_model"
)->fetchAll(PDO::FETCH_COLUMN);

$years = $db->query(
    "SELECT DISTINCT norm_year
       FROM imported_leads_raw
      WHERE import_status = 'imported' AND deleted_at IS NULL AND norm_year IS NOT NULL
      ORDER BY norm_year DESC"
)->fetchAll(PDO::FETCH_COLUMN);

// Trim lives in normalized_payload_json (CarFax + TLO populate it as "Trim").
// There is no promoted column for it, so DISTINCT here means a full
// table scan against imported_leads_raw. Cap with LIMIT so a 500K-row
// table doesn't melt the dropdown loader; almost no real vehicle trim
// catalog has more than a couple hundred distinct values anyway.
$trims = $db->query(
    "SELECT DISTINCT JSON_UNQUOTE(JSON_EXTRACT(normalized_payload_json, '$.Trim')) AS t
       FROM imported_leads_raw
      WHERE import_status = 'imported' AND deleted_at IS NULL
        AND JSON_EXTRACT(normalized_payload_json, '$.Trim') IS NOT NULL
        AND JSON_UNQUOTE(JSON_EXTRACT(normalized_payload_json, '$.Trim')) <> ''
      ORDER BY t
      LIMIT 500"
)->fetchAll(PDO::FETCH_COLUMN);

$users = $db->query(
    'SELECT id, name, role FROM users ORDER BY name'
)->fetchAll();

$labels = $db->query(
    'SELECT id, name, color FROM lead_labels ORDER BY name'
)->fetchAll();

// No client-side cache here. The endpoint feeds agent / label / batch
// dropdowns that need to surface new rows immediately after admin
// adds a user / label / import — a 5-minute cache would leave the
// dropdown showing a stale set until the browser cache expired. The
// queries are small + indexed; serving fresh on every mount is fine.
if (PHP_SAPI !== 'cli') {
    header('Cache-Control: no-store');
}

echo json_encode([
    'batches'    => $batches,
    'files'      => $files,
    'vehicles'   => $vehicles,
    'stages'     => $stages,
    'states'     => $states,
    'makes'      => $makes,
    'models'     => $models,
    'years'      => array_map('intval', $years),
    'trims'      => $trims,
    'users'      => $users,
    'labels'     => $labels,
    'statuses'     => LEAD_STATUSES,
    'priorities'   => LEAD_PRIORITIES,
    'temperatures' => LEAD_TEMPERATURES,
]);

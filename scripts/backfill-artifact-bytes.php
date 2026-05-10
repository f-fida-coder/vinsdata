<?php
/**
 * One-time backfill: walk file_artifacts rows that have file_bytes IS NULL,
 * find a matching file in api/uploads/<stored_filename> on the local disk,
 * and copy its bytes into the DB column.
 *
 * Run this from the machine that actually has the orphaned files (the dev
 * Mac, in this case). Because config.php points at the production DB
 * regardless of environment, running locally writes straight into prod.
 *
 * Usage:
 *   php scripts/backfill-artifact-bytes.php          # dry-run
 *   php scripts/backfill-artifact-bytes.php --apply  # actually update
 */

require_once __DIR__ . '/../api/config.php';

$apply = in_array('--apply', $argv, true);
$uploadDir = __DIR__ . '/../api/uploads/';

$db = getDBConnection();
echo "Connected to " . DB_NAME . " @ " . DB_HOST . "\n";
echo "Local upload dir: " . realpath($uploadDir) . "\n";
echo $apply ? "Mode: APPLY (will write to DB)\n\n" : "Mode: DRY-RUN (use --apply to commit)\n\n";

$rows = $db->query(
    'SELECT id, stored_filename, original_filename, file_size
       FROM file_artifacts
      WHERE file_bytes IS NULL
      ORDER BY id'
)->fetchAll();

echo "Rows missing blob: " . count($rows) . "\n\n";

$found = 0; $missing = 0; $updated = 0; $skipped = 0;
foreach ($rows as $r) {
    $path = $uploadDir . $r['stored_filename'];
    if (!is_file($path)) {
        echo sprintf("  [%4d] MISSING  %-40s (%s)\n", $r['id'], $r['stored_filename'], $r['original_filename']);
        $missing++;
        continue;
    }
    $found++;
    $bytes = file_get_contents($path);
    $diskSize = strlen($bytes);
    $expected = (int) $r['file_size'];
    if ($expected > 0 && $diskSize !== $expected) {
        echo sprintf("  [%4d] SIZE-MISMATCH  disk=%d db=%d  %s — skipping for safety\n", $r['id'], $diskSize, $expected, $r['stored_filename']);
        $skipped++;
        continue;
    }
    if (!$apply) {
        echo sprintf("  [%4d] WOULD-WRITE %d bytes  %s\n", $r['id'], $diskSize, $r['original_filename']);
        continue;
    }
    try {
        $upd = $db->prepare('UPDATE file_artifacts SET file_bytes = :b WHERE id = :id');
        $upd->bindValue(':b',  $bytes, PDO::PARAM_LOB);
        $upd->bindValue(':id', (int) $r['id'], PDO::PARAM_INT);
        $upd->execute();
        $updated++;
        echo sprintf("  [%4d] UPDATED %d bytes  %s\n", $r['id'], $diskSize, $r['original_filename']);
    } catch (PDOException $e) {
        echo sprintf("  [%4d] FAIL  %s — %s\n", $r['id'], $r['stored_filename'], $e->getMessage());
        $skipped++;
    }
}

echo "\n";
echo "Found on disk:  $found\n";
echo "Missing:        $missing\n";
echo "Updated:        $updated\n";
echo "Skipped:        $skipped\n";

if (!$apply && $found > 0) {
    echo "\nDry run complete. Re-run with --apply to write these to the DB.\n";
}

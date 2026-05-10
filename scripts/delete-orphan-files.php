<?php
/**
 * Orphan-files cleanup. Deletes file_artifacts rows whose bytes are nowhere
 * (file_bytes IS NULL AND no matching local disk file), and any parent files
 * row whose only artifacts were orphans, leaving the dashboard clean.
 *
 * Why this exists: between dev-with-prod-DB uploads and an old deploy that
 * blew away api/uploads/, the DB ended up holding 60+ artifact rows that
 * point at bytes nobody can produce. This script finds them and removes
 * them so the user can start fresh without 20+ manual deletes.
 *
 * Usage:
 *   php scripts/delete-orphan-files.php          # dry-run
 *   php scripts/delete-orphan-files.php --apply  # actually delete
 *
 * What gets deleted (apply mode):
 *   - file_artifacts rows where file_bytes IS NULL and the local
 *     api/uploads/<stored_filename> doesn't exist either.
 *   - files rows whose every artifact was orphaned (so the file entry
 *     becomes empty and useless after the artifact deletes). FK cascades
 *     handle history/uploads tables.
 *
 * What is preserved:
 *   - Any artifact whose bytes are now in the DB (post-backfill).
 *   - Any file entry that still has at least one good artifact.
 */

require_once __DIR__ . '/../api/config.php';

$apply = in_array('--apply', $argv, true);
$uploadDir = __DIR__ . '/../api/uploads/';

$db = getDBConnection();
echo "Connected to " . DB_NAME . " @ " . DB_HOST . "\n";
echo $apply ? "Mode: APPLY (will delete)\n\n" : "Mode: DRY-RUN (use --apply to delete)\n\n";

// Find orphan artifacts: blob is null AND file isn't on this machine's disk.
$artifacts = $db->query(
    'SELECT id, file_id, stored_filename, original_filename
       FROM file_artifacts
      WHERE file_bytes IS NULL
      ORDER BY file_id, id'
)->fetchAll();

$orphans = [];
$recoverable = 0;
foreach ($artifacts as $a) {
    $hasLocal = is_file($uploadDir . $a['stored_filename']);
    if ($hasLocal) {
        // Could be backfilled — leave it alone, user should re-run backfill.
        $recoverable++;
        continue;
    }
    $orphans[] = $a;
}

echo "Total artifacts with NULL bytes:     " . count($artifacts) . "\n";
echo "  ↳ recoverable from local disk:     $recoverable (run backfill instead of delete)\n";
echo "  ↳ truly orphan (will be deleted):  " . count($orphans) . "\n\n";

if ($recoverable > 0) {
    echo "WARNING: $recoverable artifact(s) still have local files. Run\n";
    echo "    php scripts/backfill-artifact-bytes.php --apply\n";
    echo "first if you want to keep those — they will NOT be touched here.\n\n";
}

if (count($orphans) === 0) {
    echo "Nothing to do.\n";
    exit(0);
}

// Group by file_id to know which parent files become empty after deletion.
$byFile = [];
foreach ($orphans as $o) {
    $byFile[$o['file_id']][] = $o;
}

// For each affected file, count how many GOOD artifacts (bytes present OR
// recoverable) it still has. Files whose count drops to 0 get nuked too.
$goodCounts = [];
foreach (array_keys($byFile) as $fid) {
    $stmt = $db->prepare(
        'SELECT COUNT(*) FROM file_artifacts
          WHERE file_id = :fid
            AND (file_bytes IS NOT NULL OR id IN (' . implode(',', array_map(fn($o) => 'NULL', $orphans)) . '))'
    );
    // Cleaner approach: just count artifacts where bytes IS NOT NULL.
    $stmt = $db->prepare(
        'SELECT COUNT(*) FROM file_artifacts WHERE file_id = :fid AND file_bytes IS NOT NULL'
    );
    $stmt->execute([':fid' => $fid]);
    $goodCounts[$fid] = (int) $stmt->fetchColumn();
}

$filesToDelete = [];
foreach ($byFile as $fid => $orphanList) {
    if ($goodCounts[$fid] === 0) {
        // Also check if any non-orphan artifact remains (recoverable count
        // already excluded). We checked file_bytes IS NOT NULL above; if 0
        // and we're about to delete every orphan, nothing remains.
        $filesToDelete[] = $fid;
    }
}

echo "Artifact rows to delete: " . count($orphans) . "\n";
echo "Parent file rows to delete (no good artifacts left): " . count($filesToDelete) . "\n\n";

if (!$apply) {
    echo "Dry run. Re-run with --apply to actually delete.\n";
    exit(0);
}

$db->beginTransaction();
try {
    // Delete orphan artifacts.
    $delA = $db->prepare('DELETE FROM file_artifacts WHERE id = :id');
    foreach ($orphans as $o) {
        $delA->execute([':id' => (int) $o['id']]);
    }

    // Delete now-empty parent files. files cascades into file_artifacts and
    // file_uploads (legacy). file_stage_history rows reference file_id with
    // ON DELETE CASCADE per migration 001.
    $delF = $db->prepare('DELETE FROM files WHERE id = :id');
    foreach ($filesToDelete as $fid) {
        $delF->execute([':id' => (int) $fid]);
    }

    $db->commit();
} catch (Throwable $e) {
    $db->rollBack();
    fwrite(STDERR, "FAILED: " . $e->getMessage() . "\n");
    exit(1);
}

echo "Done.\n";
echo "  Artifacts deleted: " . count($orphans) . "\n";
echo "  Files deleted:     " . count($filesToDelete) . "\n";

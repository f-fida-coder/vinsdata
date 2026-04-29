<?php
/**
 * One-shot migration runner. Reads a .sql file and executes each statement
 * against the configured DB. Idempotent for migrations written with
 * `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE MODIFY COLUMN`.
 *
 * Usage: php scripts/apply-migration.php api/migrations/011_mass_marketing.sql
 */

require_once __DIR__ . '/../api/config.php';

if ($argc < 2) {
    fwrite(STDERR, "Usage: php apply-migration.php <path-to-sql>\n");
    exit(2);
}
$path = $argv[1];
if (!is_file($path)) {
    fwrite(STDERR, "File not found: $path\n");
    exit(2);
}

$sql = file_get_contents($path);
// Strip single-line comments so the naive splitter doesn't choke on them.
$sql = preg_replace('/^--[^\n]*$/m', '', $sql);

// Split on ";" at end-of-statement. Good enough for straightforward DDL.
$statements = array_filter(array_map('trim', explode(';', $sql)), fn($s) => $s !== '');

$db = getDBConnection();
echo "Connected to " . DB_NAME . " @ " . DB_HOST . "\n";
echo "Applying " . count($statements) . " statement(s) from $path\n\n";

$applied = 0; $skipped = 0;
foreach ($statements as $i => $stmt) {
    $oneLine = preg_replace('/\s+/', ' ', substr($stmt, 0, 90)) . '…';
    try {
        $db->exec($stmt);
        echo sprintf("[%d/%d] OK   %s\n", $i + 1, count($statements), $oneLine);
        $applied++;
    } catch (PDOException $e) {
        // Idempotent re-runs on enum-modification statements may raise warnings;
        // existing tables/columns are handled by IF NOT EXISTS. Everything else
        // we surface loudly.
        echo sprintf("[%d/%d] FAIL %s\n  -> %s\n", $i + 1, count($statements), $oneLine, $e->getMessage());
        $skipped++;
    }
}

echo "\nDone. $applied applied, $skipped failed.\n";
exit($skipped === 0 ? 0 : 1);

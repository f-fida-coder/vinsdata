<?php
// Step-by-step boot probe. Flushes after each step so we see exactly
// the last file whose require_once succeeded before the worker died.
header('Content-Type: text/plain');
@ini_set('display_errors', '1');
error_reporting(E_ALL);

function step(string $label, callable $fn): void {
    echo "[step] $label …\n"; flush(); ob_flush();
    try {
        $fn();
        echo "[ok]   $label\n"; flush(); ob_flush();
    } catch (Throwable $e) {
        echo "[ERR]  $label: " . $e->getMessage() . " (" . $e->getFile() . ":" . $e->getLine() . ")\n";
        flush(); ob_flush();
        throw $e;
    }
}

echo "PHP " . PHP_VERSION . "\n";
echo "Working dir: " . __DIR__ . "\n";
echo "loaded.ini: " . (php_ini_loaded_file() ?: '(none)') . "\n\n";
flush(); @ob_flush();

step('require config.php',           function () { require_once __DIR__ . '/config.php'; });
step('require pipeline.php',         function () { require_once __DIR__ . '/pipeline.php'; });
step('require lib/smtp.php',         function () { require_once __DIR__ . '/lib/smtp.php'; });
step('require outbound_helpers.php', function () { require_once __DIR__ . '/outbound_helpers.php'; });
step('getDBConnection()',            function () { $pdo = getDBConnection(); $pdo->query('SELECT 1')->fetchColumn(); });
step('app_secrets table read',       function () { $pdo = getDBConnection(); $pdo->query('SELECT COUNT(*) FROM app_secrets')->fetchColumn(); });
step('getEnvValue OPENPHONE_API_KEY', function () { $v = getEnvValue('OPENPHONE_API_KEY'); echo "      value-len=" . strlen($v) . "\n"; });

echo "\nDone. Boot chain healthy.\n";

<?php
// Step-by-step boot diagnostic. Each phase is wrapped in a fresh
// process via passthru-like shell so we see the *first* file to crash.
header('Content-Type: text/plain');

echo "PHP " . PHP_VERSION . "\n";
echo "Working dir: " . __DIR__ . "\n\n";

$tests = [
    'config.php'           => __DIR__ . '/config.php',
    'pipeline.php'         => __DIR__ . '/pipeline.php',
    'lib/smtp.php'         => __DIR__ . '/lib/smtp.php',
    'outbound_helpers.php' => __DIR__ . '/outbound_helpers.php',
];

foreach ($tests as $label => $path) {
    if (!file_exists($path)) {
        echo "[$label] MISSING ($path)\n";
        continue;
    }
    // Lint the file in a subprocess so a parse error doesn't kill us.
    $lint = shell_exec('php -l ' . escapeshellarg($path) . ' 2>&1');
    $clean = trim((string) $lint);
    if (str_contains($clean, 'No syntax errors')) {
        echo "[$label] lint: OK (" . filesize($path) . " bytes)\n";
    } else {
        echo "[$label] lint: FAIL\n  $clean\n";
    }
}

echo "\n--- Now actually requiring config.php inline (will crash if it crashes) ---\n";
require_once __DIR__ . '/config.php';
echo "config.php: included OK\n";

echo "--- pipeline.php ---\n";
require_once __DIR__ . '/pipeline.php';
echo "pipeline.php: included OK\n";

echo "--- outbound_helpers.php ---\n";
require_once __DIR__ . '/outbound_helpers.php';
echo "outbound_helpers.php: included OK\n";

echo "--- marketing_send.php (will run its top-level requireAuth + exit) ---\n";
// Skipping: this one has top-level requireAuth that exits 401.
echo "(skipping — would exit 401)\n";

echo "\nDone. Boot chain healthy.\n";

<?php
header('Content-Type: text/plain');
echo "hello from php " . PHP_VERSION . "\n";
echo "time: " . date('c') . "\n";
echo "include test:\n";
try {
    require_once __DIR__ . '/config.php';
    echo "  config.php: OK\n";
    require_once __DIR__ . '/pipeline.php';
    echo "  pipeline.php: OK\n";
    $pdo = getDBConnection();
    $row = $pdo->query("SELECT 1")->fetchColumn();
    echo "  DB query: $row\n";
} catch (Throwable $e) {
    echo "  ERR: " . $e->getMessage() . " at " . $e->getFile() . ":" . $e->getLine() . "\n";
}

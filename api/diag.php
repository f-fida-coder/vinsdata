<?php
// Diagnostic endpoint. Safe to leave in; returns JSON about server state.
header('Content-Type: application/json');
ini_set('display_errors', '1');
error_reporting(E_ALL);

$out = [
    'php_version' => PHP_VERSION,
    'file_exists_config' => file_exists(__DIR__ . '/config.php'),
    'file_size_config' => @filesize(__DIR__ . '/config.php'),
    'pdo_loaded' => extension_loaded('pdo_mysql'),
    'server_name' => $_SERVER['SERVER_NAME'] ?? null,
    'doc_root' => $_SERVER['DOCUMENT_ROOT'] ?? null,
    'script' => __FILE__,
];

try {
    require_once __DIR__ . '/config.php';
    $out['config_loaded'] = true;
    $out['db_host'] = defined('DB_HOST') ? DB_HOST : null;
    try {
        $db = getDBConnection();
        $out['db_connect'] = 'ok';
        $row = $db->query('SELECT 1 AS ok')->fetch();
        $out['db_query'] = $row;

        $uploadDir = __DIR__ . '/uploads/';
        $out['upload_dir']         = $uploadDir;
        $out['upload_dir_exists']  = is_dir($uploadDir);
        $out['upload_dir_writable'] = is_writable($uploadDir);
        $files = @scandir($uploadDir) ?: [];
        $files = array_values(array_filter($files, fn($f) => $f !== '.' && $f !== '..' && $f !== '.htaccess'));
        $out['upload_dir_count']   = count($files);
        $out['upload_dir_sample']  = array_slice($files, 0, 5);

        // Check whether the latest artifact's stored file is actually present.
        $latest = $db->query('SELECT id, stored_filename FROM file_artifacts ORDER BY id DESC LIMIT 1')->fetch();
        if ($latest) {
            $path = $uploadDir . $latest['stored_filename'];
            $out['latest_artifact']        = $latest;
            $out['latest_artifact_on_disk']= file_exists($path);
            $out['latest_artifact_path']   = $path;
        }
    } catch (Throwable $e) {
        $out['db_connect'] = 'FAIL';
        $out['db_error'] = $e->getMessage();
    }
} catch (Throwable $e) {
    $out['config_loaded'] = false;
    $out['config_error'] = $e->getMessage();
}

echo json_encode($out, JSON_PRETTY_PRINT);

<?php
// Feature-flag registry.
//
// GET  /api/feature_flags          → any authenticated user. Returns
//                                     [{key,label,description,enabled}].
//                                     The frontend hydrates a context
//                                     with this on app load.
// PUT  /api/feature_flags          → admin only. Body: { key, enabled }.
//                                     Toggles a single flag.
//
// Storage is the `feature_flags` table (migration 030). Soft-fails
// to an empty list if the table doesn't exist yet so a pre-migration
// deploy boots cleanly.

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/pipeline.php';
initSession();

$user = requireAuth();
$db   = getDBConnection();

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    // Cache for 30s on the client — flags don't change rapidly and the
    // hydrate-once-on-mount pattern doesn't need real-time freshness.
    if (PHP_SAPI !== 'cli') {
        header('Cache-Control: private, max-age=30');
    }
    try {
        $rows = $db->query(
            'SELECT `key`, enabled, label, description, updated_at
               FROM feature_flags
              ORDER BY `key`'
        )->fetchAll();
    } catch (Throwable $e) {
        // Table missing or DB blip — return an empty set instead of
        // 500'ing the whole frontend hydration.
        $rows = [];
    }
    $out = array_map(function ($r) {
        return [
            'key'         => $r['key'],
            'enabled'     => (bool) $r['enabled'],
            'label'       => $r['label'],
            'description' => $r['description'],
            'updated_at'  => $r['updated_at'],
        ];
    }, $rows);
    echo json_encode(['flags' => $out]);
    exit();
}

if ($_SERVER['REQUEST_METHOD'] === 'PUT') {
    if (($user['role'] ?? null) !== 'admin') {
        pipelineFail(403, 'Only admins can toggle feature flags', 'admin_required');
    }

    $input = json_decode(file_get_contents('php://input'), true) ?? [];
    $key     = trim((string) ($input['key']     ?? ''));
    $enabled = !empty($input['enabled']) ? 1 : 0;

    if ($key === '' || !preg_match('/^[A-Z][A-Z0-9_]{1,79}$/', $key)) {
        pipelineFail(400, 'key must be UPPER_SNAKE_CASE', 'bad_key');
    }

    // Don't allow creating arbitrary flags from the UI — only existing
    // (seeded) keys can be toggled. Prevents typos from sprinkling
    // unknown keys into the table where nothing reads them.
    $exists = $db->prepare('SELECT 1 FROM feature_flags WHERE `key` = :k');
    $exists->execute([':k' => $key]);
    if (!$exists->fetchColumn()) {
        pipelineFail(404, "Unknown feature flag '$key'", 'flag_not_found');
    }

    $stmt = $db->prepare(
        'UPDATE feature_flags
            SET enabled = :en, updated_by = :uid
          WHERE `key` = :k'
    );
    $stmt->execute([':en' => $enabled, ':uid' => (int) $user['id'], ':k' => $key]);

    echo json_encode(['success' => true, 'key' => $key, 'enabled' => (bool) $enabled]);
    exit();
}

pipelineFail(405, 'Method not allowed', 'method_not_allowed');

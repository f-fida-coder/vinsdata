<?php

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/pipeline.php';
initSession();

$user = requireAuth();
$db   = getDBConnection();

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    // Optional side-effect: run the reminder scanner before returning. Scans are
    // idempotent via the UNIQUE(user_id, dedupe_key) constraint.
    if (!empty($_GET['scan'])) {
        try { scanTaskReminders($db); }
        catch (Throwable $e) {
            // Swallow scan errors silently — the list read should still succeed.
            error_log('Notification scan failed: ' . $e->getMessage());
        }
    }

    $limit = max(1, min(200, (int) ($_GET['limit'] ?? 50)));

    $stmt = $db->prepare(
        'SELECT n.id, n.type, n.title, n.message, n.is_read, n.read_at, n.created_at,
                n.related_lead_id, n.related_task_id,
                f.display_name AS related_lead_name,
                t.title        AS related_task_title,
                t.due_at       AS related_task_due_at,
                t.status       AS related_task_status
           FROM notifications n
           LEFT JOIN imported_leads_raw r ON r.id = n.related_lead_id
           LEFT JOIN lead_import_batches b ON b.id = r.batch_id
           LEFT JOIN files f ON f.id = b.file_id
           LEFT JOIN lead_tasks t ON t.id = n.related_task_id
          WHERE n.user_id = :uid
          ORDER BY n.is_read ASC, n.created_at DESC, n.id DESC
          LIMIT :limit'
    );
    $stmt->bindValue(':uid',   $user['id'], PDO::PARAM_INT);
    $stmt->bindValue(':limit', $limit,      PDO::PARAM_INT);
    $stmt->execute();

    $rows = array_map(function ($r) {
        $r['id']              = (int) $r['id'];
        $r['is_read']         = (int) $r['is_read'] === 1;
        $r['related_lead_id'] = $r['related_lead_id'] !== null ? (int) $r['related_lead_id'] : null;
        $r['related_task_id'] = $r['related_task_id'] !== null ? (int) $r['related_task_id'] : null;
        return $r;
    }, $stmt->fetchAll());

    $unreadCount = (int) $db->query(
        'SELECT COUNT(*) FROM notifications WHERE user_id = ' . (int) $user['id'] . ' AND is_read = 0'
    )->fetchColumn();
    $overdueCount = (int) $db->query(
        "SELECT COUNT(*) FROM notifications
          WHERE user_id = " . (int) $user['id'] . "
            AND is_read = 0
            AND type = 'task_overdue'"
    )->fetchColumn();

    echo json_encode([
        'unread_count'  => $unreadCount,
        'overdue_count' => $overdueCount,
        'notifications' => $rows,
    ]);
    exit();
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    // Mark as read. Body: { ids?: [...], mark_all?: true }
    $input = json_decode(file_get_contents('php://input'), true) ?? [];
    $markAll = !empty($input['mark_all']);
    $ids     = $input['ids'] ?? null;

    if ($markAll) {
        $stmt = $db->prepare(
            'UPDATE notifications SET is_read = 1, read_at = NOW()
              WHERE user_id = :uid AND is_read = 0'
        );
        $stmt->execute([':uid' => $user['id']]);
        echo json_encode(['success' => true, 'marked' => $stmt->rowCount()]);
        exit();
    }

    if (!is_array($ids) || empty($ids)) {
        pipelineFail(400, 'ids array or mark_all is required', 'missing_fields');
    }
    $intIds = array_values(array_filter(array_map('intval', $ids)));
    if (empty($intIds)) pipelineFail(400, 'ids contained no valid integers', 'missing_fields');

    $placeholders = implode(',', array_fill(0, count($intIds), '?'));
    $stmt = $db->prepare(
        "UPDATE notifications SET is_read = 1, read_at = NOW()
          WHERE user_id = ? AND id IN ($placeholders)"
    );
    $stmt->execute(array_merge([$user['id']], $intIds));
    echo json_encode(['success' => true, 'marked' => $stmt->rowCount()]);
    exit();
}

pipelineFail(405, 'Method not allowed', 'method_not_allowed');

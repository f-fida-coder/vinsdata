<?php

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/pipeline.php';
initSession();

$user = requireAuth();
$db   = getDBConnection();

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $leadId = isset($_GET['lead_id']) ? (int) $_GET['lead_id'] : 0;
    if ($leadId <= 0) pipelineFail(400, 'lead_id is required', 'missing_fields');
    loadLeadOrFail($db, $leadId);

    $stmt = $db->prepare(
        'SELECT c.id, c.imported_lead_id, c.user_id, u.name AS user_name,
                c.channel, c.outcome, c.notes, c.happened_at, c.created_at
           FROM lead_contact_logs c
           JOIN users u ON u.id = c.user_id
          WHERE c.imported_lead_id = :lid
          ORDER BY c.happened_at DESC, c.id DESC'
    );
    $stmt->execute([':lid' => $leadId]);
    $rows = array_map(function ($r) {
        $r['id']               = (int) $r['id'];
        $r['imported_lead_id'] = (int) $r['imported_lead_id'];
        $r['user_id']          = (int) $r['user_id'];
        return $r;
    }, $stmt->fetchAll());
    echo json_encode($rows);
    exit();
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $input = json_decode(file_get_contents('php://input'), true) ?? [];
    $leadId  = (int) ($input['lead_id'] ?? 0);
    $channel = $input['channel'] ?? '';
    $outcome = $input['outcome'] ?? '';
    $notes   = isset($input['notes']) ? trim((string) $input['notes']) : null;
    $happened = parseDatetime($input['happened_at'] ?? null, 'happened_at');

    if ($leadId <= 0) pipelineFail(400, 'lead_id is required', 'missing_fields');
    assertContactChannel($channel);
    assertContactOutcome($outcome);
    if ($notes !== null && mb_strlen($notes) > 5000) pipelineFail(400, 'notes too long', 'notes_too_long');
    loadLeadOrFail($db, $leadId);

    try {
        $db->beginTransaction();
        $stmt = $db->prepare(
            'INSERT INTO lead_contact_logs (imported_lead_id, user_id, channel, outcome, notes, happened_at)
             VALUES (:lid, :uid, :ch, :oc, :notes, COALESCE(:happened, NOW()))'
        );
        $stmt->execute([
            ':lid'      => $leadId,
            ':uid'      => $user['id'],
            ':ch'       => $channel,
            ':oc'       => $outcome,
            ':notes'    => $notes,
            ':happened' => $happened,
        ]);
        $logId = (int) $db->lastInsertId();
        logLeadActivity($db, $leadId, $user['id'], 'contact_logged', null, [
            'log_id'      => $logId,
            'channel'     => $channel,
            'outcome'     => $outcome,
            'happened_at' => $happened,
            'notes_preview' => $notes !== null ? mb_substr($notes, 0, 140) : null,
        ]);
        $db->commit();
    } catch (Throwable $e) {
        if ($db->inTransaction()) $db->rollBack();
        pipelineFail(500, 'Log contact failed: ' . $e->getMessage(), 'db_error');
    }

    echo json_encode(['success' => true, 'id' => $logId]);
    exit();
}

pipelineFail(405, 'Method not allowed', 'method_not_allowed');

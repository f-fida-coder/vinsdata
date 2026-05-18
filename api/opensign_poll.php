<?php
// Poll OpenSign for completed signatures.
//
// GET  /api/opensign_poll          → auth: any logged-in user (read-only)
// POST /api/opensign_poll          → same; reserved for cron triggers
//
// Scans every bill_of_sale row that's still in `signature_status='sent'`
// with a `signature_request_id`, batch-queries OpenSign for those
// documents, and flips any whose `SignedUrl` is now populated to
// `signature_status='signed'` + `signed_at=NOW()`.
//
// Returns a small summary so the BoS page can show "n signatures
// updated" toasts. Heavy poll runs (>50 pending) are still cheap — we
// batch with one `$in` query, not N round trips.
//
// Idempotent: re-running with no new signatures is a no-op.

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/pipeline.php';
initSession();

$user = requireAuth();
$db   = getDBConnection();

$baseUrl   = rtrim(getEnvValue('OPENSIGN_BASE_URL'), '/');
$appId     = getEnvValue('OPENSIGN_APP_ID');
$masterKey = getEnvValue('OPENSIGN_MASTER_KEY');
if ($baseUrl === '' || $appId === '' || $masterKey === '') {
    pipelineFail(503, 'OpenSign is not configured.', 'opensign_not_configured');
}

// Pull every awaiting-signature BoS that has an OpenSign doc id. Cap
// the batch at 200 to keep the URL length sane (the `$in` clause goes
// in the querystring); anything over that is the cron's problem.
$pending = $db->query(
    "SELECT id, imported_lead_id, signature_request_id, vehicle_vin
       FROM bill_of_sale
      WHERE signature_status = 'sent'
        AND signature_request_id IS NOT NULL
      ORDER BY signature_sent_at ASC
      LIMIT 200"
)->fetchAll();

if (empty($pending)) {
    echo json_encode(['polled' => 0, 'signed' => 0, 'updates' => []]);
    exit();
}

$docIds  = array_map(fn ($r) => $r['signature_request_id'], $pending);
$byBosId = [];
foreach ($pending as $r) {
    $byBosId[$r['signature_request_id']] = $r;
}

// Batch query OpenSign. We ask for the small set of fields we care
// about with `keys=` so the response stays small.
$where  = json_encode(['objectId' => ['$in' => $docIds]]);
$query  = http_build_query([
    'where' => $where,
    'limit' => count($docIds),
    'keys'  => 'objectId,SignedUrl,IsCompleted,Signers',
]);
$url    = $baseUrl . '/api/app/classes/contracts_Document?' . $query;

$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 30,
    CURLOPT_HTTPHEADER     => [
        'X-Parse-Application-Id: ' . $appId,
        'X-Parse-Master-Key: '      . $masterKey,
    ],
]);
$resp  = curl_exec($ch);
$code  = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$cErr  = curl_error($ch);
curl_close($ch);

if ($resp === false || $code >= 400) {
    pipelineFail(
        502,
        'OpenSign query failed (HTTP ' . $code . ($cErr ? ' / ' . $cErr : '') . ')',
        'opensign_query_failed'
    );
}

$data    = json_decode($resp, true) ?: [];
$results = $data['results'] ?? [];

$updates = [];
foreach ($results as $doc) {
    $docId     = $doc['objectId']   ?? null;
    $signedUrl = $doc['SignedUrl']  ?? null;
    if (!$docId || !$signedUrl) continue;

    $bos = $byBosId[$docId] ?? null;
    if (!$bos) continue;

    // Flip status. signed_at = NOW; signed_pdf_url stored so the BoS
    // list can render a "View signed" link without another roundtrip.
    try {
        $db->prepare(
            "UPDATE bill_of_sale
                SET signature_status = 'signed',
                    signed_at        = NOW(),
                    signed_pdf_url   = :u
              WHERE id = :id
                AND signature_status = 'sent'"
        )->execute([':u' => $signedUrl, ':id' => $bos['id']]);

        // Activity log — only when there's a lead to log against.
        if (!empty($bos['imported_lead_id'])) {
            try {
                logLeadActivity(
                    $db,
                    (int) $bos['imported_lead_id'],
                    (int) $user['id'],
                    'contact_logged',
                    null,
                    [
                        'channel'         => 'esign',
                        'direction'       => 'inbound',
                        'outcome'         => 'completed',
                        'kind'            => 'bill_of_sale_signed',
                        'provider'        => 'opensign',
                        'bos_id'          => (int) $bos['id'],
                        'opensign_doc_id' => $docId,
                        'signed_url'      => $signedUrl,
                        'vin'             => $bos['vehicle_vin'],
                    ]
                );
            } catch (Throwable $_e) {
                // Activity log failure shouldn't block the status flip.
            }
        }

        $updates[] = [
            'bos_id'          => (int) $bos['id'],
            'opensign_doc_id' => $docId,
            'signed_url'      => $signedUrl,
        ];
    } catch (Throwable $e) {
        error_log('[opensign_poll] failed to flip bos ' . $bos['id'] . ': ' . $e->getMessage());
    }
}

echo json_encode([
    'polled'  => count($pending),
    'signed'  => count($updates),
    'updates' => $updates,
]);

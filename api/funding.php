<?php
// Funding pipeline — post-close stage tracker for leads that have been
// marked Closed. Derives stages from data we already track:
//
//   Stage 1  closed              → lead_states.lead_temperature = 'closed'
//   Stage 2  bos_signed          → bill_of_sale.signed_at IS NOT NULL
//   Stage 3  funded              → bill_of_sale.funded_at IS NOT NULL
//   Stage 4  transport_scheduled → lead_transport row with transport_date set
//   Stage 5  delivered           → lead_transport.status = 'delivered'
//
// Frontend renders the stages as a 5-step progress bar; this endpoint
// just emits the raw flags so the UI doesn't have to know the order.
//
// PUT /api/funding marks the "funded" stage complete (timestamp + amount
// + notes). All other stages flip automatically when their source data
// changes — no need to maintain a parallel state machine.

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/pipeline.php';
initSession();

$user = requireAuth();
$db   = getDBConnection();
$method = $_SERVER['REQUEST_METHOD'];

// -----------------------------------------------------------------------------
// GET — list of closed leads with derived stage progression
// -----------------------------------------------------------------------------
if ($method === 'GET') {
    $stmt = $db->query(
        "SELECT r.id AS lead_id,
                r.norm_vin,
                r.norm_make, r.norm_model, r.norm_year,
                JSON_UNQUOTE(JSON_EXTRACT(r.normalized_payload_json, '\$.full_name')) AS lead_full_name,
                JSON_UNQUOTE(JSON_EXTRACT(r.normalized_payload_json, '\$.first_name')) AS lead_first_name,
                JSON_UNQUOTE(JSON_EXTRACT(r.normalized_payload_json, '\$.last_name'))  AS lead_last_name,

                s.status, s.lead_temperature, s.price_offered, s.assigned_user_id,
                u_assignee.name AS assigned_user_name,

                b.id              AS bos_id,
                b.buyer_name,
                b.payment_amount,
                b.signed_at       AS bos_signed_at,
                b.funded_at,
                b.funded_amount,
                b.funded_by,
                b.funding_notes,
                u_funded.name     AS funded_by_name,

                t.id              AS transport_id,
                t.transport_date,
                t.status          AS transport_status,
                t.assigned_transporter_id,
                tr.name           AS transporter_name

           FROM imported_leads_raw r
           JOIN lead_states s           ON s.imported_lead_id = r.id
           LEFT JOIN bill_of_sale  b    ON b.imported_lead_id = r.id
           LEFT JOIN lead_transport t   ON t.imported_lead_id = r.id
           LEFT JOIN transporters tr    ON tr.id = t.assigned_transporter_id
           LEFT JOIN users u_assignee   ON u_assignee.id = s.assigned_user_id
           LEFT JOIN users u_funded     ON u_funded.id   = b.funded_by
          WHERE s.lead_temperature = 'closed'
          ORDER BY COALESCE(b.funded_at, b.signed_at, s.updated_at) DESC"
    );
    $rows = $stmt->fetchAll();

    $out = [];
    foreach ($rows as $r) {
        $name = trim((string) ($r['lead_full_name'] ?: trim(($r['lead_first_name'] ?? '') . ' ' . ($r['lead_last_name'] ?? ''))));

        // Determine current stage (latest completed).
        $stages = [
            'closed'              => true,
            'bos_signed'          => !empty($r['bos_signed_at']),
            'funded'              => !empty($r['funded_at']),
            'transport_scheduled' => !empty($r['transport_date']),
            'delivered'           => $r['transport_status'] === 'delivered',
        ];
        $current = 'closed';
        foreach (['bos_signed','funded','transport_scheduled','delivered'] as $s) {
            if ($stages[$s]) $current = $s;
        }

        $out[] = [
            'lead_id'           => (int) $r['lead_id'],
            'lead_name'         => $name !== '' ? $name : null,
            'vin'               => $r['norm_vin'],
            'vehicle'           => trim(implode(' ', array_filter([$r['norm_year'], $r['norm_make'], $r['norm_model']]))) ?: null,
            'assigned_user_id'  => $r['assigned_user_id'] !== null ? (int) $r['assigned_user_id'] : null,
            'assigned_user_name'=> $r['assigned_user_name'],

            'price_offered'     => $r['price_offered'] !== null ? (float) $r['price_offered'] : null,

            'bos_id'            => $r['bos_id'] !== null ? (int) $r['bos_id'] : null,
            'buyer_name'        => $r['buyer_name'],
            'payment_amount'    => $r['payment_amount'] !== null ? (float) $r['payment_amount'] : null,
            'bos_signed_at'     => $r['bos_signed_at'],

            'funded_at'         => $r['funded_at'],
            'funded_amount'     => $r['funded_amount'] !== null ? (float) $r['funded_amount'] : null,
            'funded_by_name'    => $r['funded_by_name'],
            'funding_notes'     => $r['funding_notes'],

            'transport_id'      => $r['transport_id'] !== null ? (int) $r['transport_id'] : null,
            'transport_date'    => $r['transport_date'],
            'transport_status'  => $r['transport_status'],
            'transporter_name'  => $r['transporter_name'],

            'stages'            => $stages,
            'current_stage'     => $current,
        ];
    }

    // Summary counts for the KPI strip.
    $counts = [
        'closed' => 0, 'bos_signed' => 0, 'funded' => 0, 'transport_scheduled' => 0, 'delivered' => 0,
    ];
    foreach ($out as $row) {
        $counts[$row['current_stage']] += 1;
    }

    echo json_encode(['rows' => $out, 'counts' => $counts]);
    exit();
}

// -----------------------------------------------------------------------------
// PUT — mark a closed lead as funded (or revert)
// -----------------------------------------------------------------------------
if ($method === 'PUT') {
    $input = json_decode(file_get_contents('php://input'), true) ?? [];
    $leadId = (int) ($input['lead_id'] ?? 0);
    if ($leadId <= 0) pipelineFail(400, 'lead_id is required', 'missing_lead_id');

    // The lead must have a BoS row already — funding follows signed BoS.
    $bos = $db->prepare('SELECT id, signed_at, funded_at FROM bill_of_sale WHERE imported_lead_id = :lid');
    $bos->execute([':lid' => $leadId]);
    $bosRow = $bos->fetch();
    if (!$bosRow) pipelineFail(400, 'No Bill of Sale on file. Fill out and save the BoS before marking funded.', 'no_bos');

    $clear = !empty($input['clear']);
    if ($clear) {
        $upd = $db->prepare(
            'UPDATE bill_of_sale
                SET funded_at = NULL, funded_amount = NULL, funded_by = NULL, funding_notes = NULL
              WHERE imported_lead_id = :lid'
        );
        $upd->execute([':lid' => $leadId]);
        logLeadActivity($db, $leadId, $user['id'], 'lead_funded_cleared', null, null);
        echo json_encode(['success' => true, 'cleared' => true]);
        exit();
    }

    $amount = isset($input['funded_amount']) && $input['funded_amount'] !== '' ? (float) $input['funded_amount'] : null;
    $notes  = isset($input['funding_notes'])  ? trim((string) $input['funding_notes'])  : null;

    $upd = $db->prepare(
        'UPDATE bill_of_sale
            SET funded_at     = COALESCE(funded_at, NOW()),
                funded_amount = :amt,
                funded_by     = COALESCE(funded_by, :uid),
                funding_notes = :notes
          WHERE imported_lead_id = :lid'
    );
    $upd->execute([
        ':amt'   => $amount,
        ':uid'   => $user['id'],
        ':notes' => $notes !== '' ? $notes : null,
        ':lid'   => $leadId,
    ]);

    if (empty($bosRow['funded_at'])) {
        logLeadActivity($db, $leadId, $user['id'], 'lead_funded', null, ['amount' => $amount]);
    }

    // Return the updated row for inline UI refresh.
    $sel = $db->prepare(
        'SELECT id, funded_at, funded_amount, funded_by, funding_notes
           FROM bill_of_sale WHERE imported_lead_id = :lid'
    );
    $sel->execute([':lid' => $leadId]);
    echo json_encode(['success' => true, 'bos' => $sel->fetch()]);
    exit();
}

pipelineFail(405, 'Method not allowed', 'method_not_allowed');

<?php

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/pipeline.php';
initSession();

$user = requireAuth();
$db   = getDBConnection();
$method = $_SERVER['REQUEST_METHOD'];

function fetchBoS(PDO $db, int $leadId): ?array
{
    $stmt = $db->prepare('SELECT * FROM bill_of_sale WHERE imported_lead_id = :lid');
    $stmt->execute([':lid' => $leadId]);
    $row = $stmt->fetch();
    if (!$row) return null;
    $row['id']                      = (int) $row['id'];
    $row['imported_lead_id']        = (int) $row['imported_lead_id'];
    $row['payment_amount']          = $row['payment_amount']  !== null ? (float) $row['payment_amount']  : null;
    $row['trade_amount']            = $row['trade_amount']    !== null ? (float) $row['trade_amount']    : null;
    $row['gift_value']              = $row['gift_value']      !== null ? (float) $row['gift_value']      : null;
    $row['odometer_accurate']       = (bool) $row['odometer_accurate'];
    $row['odometer_exceeds_limits'] = (bool) $row['odometer_exceeds_limits'];
    $row['odometer_not_actual']     = (bool) $row['odometer_not_actual'];
    return $row;
}

function defaultsFromLead(PDO $db, int $leadId): array
{
    $stmt = $db->prepare('SELECT normalized_payload_json, raw_payload_json FROM imported_leads_raw WHERE id = :id');
    $stmt->execute([':id' => $leadId]);
    $row = $stmt->fetch();
    if (!$row) pipelineFail(404, 'Lead not found', 'lead_not_found');
    $np  = json_decode($row['normalized_payload_json'] ?? 'null', true) ?: [];
    $raw = json_decode($row['raw_payload_json']        ?? 'null', true) ?: [];

    $name = trim(($np['full_name'] ?? '') ?: trim(($np['first_name'] ?? '') . ' ' . ($np['last_name'] ?? '')));
    $addr = trim(($np['full_address'] ?? '') ?: trim(implode(', ', array_filter([
        $np['city']  ?? null,
        $np['state'] ?? null,
        $np['zip_code'] ?? null,
    ]))));

    // Pull common Carfax/TLO columns from the raw row when normalized fields don't carry them.
    $bodyType = $raw['BodyClass'] ?? $raw['Body Type'] ?? $raw['Body'] ?? null;
    $color    = $raw['Color']     ?? $raw['ExteriorColor'] ?? null;

    $stmt = $db->prepare('SELECT company_name, company_address, default_state, default_county FROM company_settings WHERE id = 1');
    $stmt->execute();
    $cs = $stmt->fetch() ?: [];

    return [
        'sale_county'       => $cs['default_county'] ?? null,
        'sale_state'        => $cs['default_state']  ?? null,
        'sale_date'         => date('Y-m-d'),
        'buyer_name'        => $name ?: null,
        'buyer_address'     => $addr ?: null,
        'seller_name'       => $cs['company_name']    ?? null,
        'seller_address'    => $cs['company_address'] ?? null,
        'vehicle_make'      => $np['make']    ?? null,
        'vehicle_model'     => $np['model']   ?? null,
        'vehicle_body_type' => $bodyType,
        'vehicle_year'      => $np['year']    ?? null,
        'vehicle_color'     => $color,
        'vehicle_odometer'  => $np['mileage'] ?? null,
        'vehicle_vin'       => $np['vin']     ?? null,
        'payment_type'      => 'cash',
        'payment_amount'    => null,
        'trade_amount'      => null,
        'trade_make'        => null,
        'trade_model'       => null,
        'trade_body_type'   => null,
        'trade_year'        => null,
        'trade_color'       => null,
        'trade_odometer'    => null,
        'gift_value'        => null,
        'other_terms'       => null,
        'taxes_paid_by'     => 'buyer',
        'odometer_accurate'       => true,
        'odometer_exceeds_limits' => false,
        'odometer_not_actual'     => false,
    ];
}

function renderBillOfSalePdf(array $d): string
{
    require_once __DIR__ . '/vendor/autoload.php';

    $mpdf = new \Mpdf\Mpdf([
        'mode'        => 'utf-8',
        'format'      => 'Letter',
        'margin_left'   => 18,
        'margin_right'  => 18,
        'margin_top'    => 16,
        'margin_bottom' => 16,
    ]);

    $esc = fn($v) => htmlspecialchars((string) ($v ?? ''), ENT_QUOTES | ENT_HTML5, 'UTF-8');
    $blank = fn($v, $minWidth = '180px') => $v
        ? '<span class="filled">' . $esc($v) . '</span>'
        : '<span class="blank" style="min-width:' . $minWidth . '"></span>';
    $check = fn($on) => $on ? '<span class="cb on">&#10004;</span>' : '<span class="cb"></span>';

    $saleDate = $d['sale_date'] ? date('F j, Y', strtotime($d['sale_date'])) : null;
    $saleYear = $d['sale_date'] ? date('Y',       strtotime($d['sale_date'])) : null;

    $css = '
      body { font-family: DejaVuSans, sans-serif; font-size: 11pt; color: #111; line-height: 1.5; }
      h1   { text-align: center; font-size: 16pt; margin: 0 0 18px 0; letter-spacing: 0.5px; }
      h2   { font-size: 12pt; margin: 18px 0 8px 0; }
      .section { margin: 14px 0; }
      .num     { font-weight: bold; }
      p { margin: 6px 0; }
      .blank {
        display: inline-block;
        border-bottom: 1px solid #111;
        min-width: 180px;
        padding: 0 4px;
      }
      .filled { border-bottom: 1px solid #111; padding: 0 4px; font-weight: 600; }
      .grid-row { margin: 4px 0; }
      .col { display: inline-block; min-width: 33%; }
      .cb  { display: inline-block; width: 12px; height: 12px; border: 1px solid #111; text-align: center; line-height: 12px; font-size: 10pt; margin-right: 6px; }
      .cb.on { background: #fff; }
      .indent { margin-left: 24px; }
      .clause { text-align: justify; }
      .sig-block { margin: 10px 0; }
      .sig-line  { border-bottom: 1px solid #111; display: inline-block; min-width: 240px; margin-left: 6px; }
      .warning   { font-weight: bold; }
      .page-break { page-break-before: always; }
    ';

    // Page 1 — PARTIES, VEHICLE DESCRIPTION, EXCHANGE, TAXES
    $html  = '<style>' . $css . '</style>';
    $html .= '<h1>MOTOR VEHICLE BILL OF SALE</h1>';

    $html .= '<div class="section"><p><span class="num">1. THE PARTIES.</span> '
           . 'This transaction is made in the County of ' . $blank($d['sale_county'])
           . ', State of ' . $blank($d['sale_state'], '120px')
           . ', on ' . $blank($saleDate, '180px')
           . ', 20' . $blank($saleYear ? substr($saleYear, 2) : null, '40px')
           . ' by and between:</p>';

    $html .= '<p class="indent"><u>Buyer:</u> ' . $blank($d['buyer_name'])
           . ' with a mailing address of ' . $blank($d['buyer_address'], '300px')
           . ' (&ldquo;Buyer&rdquo;), and agrees to purchase the Vehicle from:</p>';

    $html .= '<p class="indent"><u>Seller:</u> ' . $blank($d['seller_name'])
           . ' with a mailing address of ' . $blank($d['seller_address'], '300px')
           . ' (&ldquo;Seller&rdquo;), and agrees to sell the Vehicle to the Buyer under the following terms:</p>';
    $html .= '</div>';

    $html .= '<div class="section">';
    $html .= '<p><span class="num">2. VEHICLE DESCRIPTION.</span></p>';
    $html .= '<p class="indent"><u>Make:</u> ' . $blank($d['vehicle_make'], '120px')
           . ' &nbsp; <u>Model:</u> ' . $blank($d['vehicle_model'], '120px')
           . ' &nbsp; <u>Body Type:</u> ' . $blank($d['vehicle_body_type'], '120px') . '</p>';
    $html .= '<p class="indent"><u>Year:</u> ' . $blank($d['vehicle_year'], '80px')
           . ' &nbsp; <u>Color:</u> ' . $blank($d['vehicle_color'], '100px')
           . ' &nbsp; <u>Odometer:</u> ' . $blank($d['vehicle_odometer'], '120px') . ' Miles</p>';
    $html .= '<p class="indent"><u>Vehicle Identification Number (VIN):</u> ' . $blank($d['vehicle_vin'], '260px') . '</p>';
    $html .= '<p class="indent">Hereinafter known as the &ldquo;Vehicle.&rdquo;</p>';
    $html .= '</div>';

    $html .= '<div class="section">';
    $html .= '<p><span class="num">3. THE EXCHANGE.</span> The Seller agrees to transfer ownership and possession of the Vehicle for: (check one)</p>';

    $html .= '<p class="indent">' . $check($d['payment_type'] === 'cash')
           . ' <b>Cash Payment.</b> The Buyer agrees to pay $'
           . $blank($d['payment_type'] === 'cash' && $d['payment_amount'] !== null ? number_format($d['payment_amount'], 2) : null, '120px')
           . ' to the Seller.</p>';

    $html .= '<p class="indent">' . $check($d['payment_type'] === 'trade')
           . ' <b>Trade.</b> The Buyer agrees to pay $'
           . $blank($d['payment_type'] === 'trade' && $d['trade_amount'] !== null ? number_format($d['trade_amount'], 2) : null, '120px')
           . ' and trade the following:</p>';

    if ($d['payment_type'] === 'trade') {
        $html .= '<p class="indent"><u>Make:</u> ' . $blank($d['trade_make'], '120px')
               . ' &nbsp; <u>Model:</u> ' . $blank($d['trade_model'], '120px')
               . ' &nbsp; <u>Body Type:</u> ' . $blank($d['trade_body_type'], '120px') . '</p>';
        $html .= '<p class="indent"><u>Year:</u> ' . $blank($d['trade_year'], '80px')
               . ' &nbsp; <u>Color:</u> ' . $blank($d['trade_color'], '100px')
               . ' &nbsp; <u>Odometer:</u> ' . $blank($d['trade_odometer'], '120px') . ' Miles</p>';
    } else {
        $html .= '<p class="indent"><u>Make:</u> ' . $blank(null, '120px')
               . ' &nbsp; <u>Model:</u> ' . $blank(null, '120px')
               . ' &nbsp; <u>Body Type:</u> ' . $blank(null, '120px') . '</p>';
        $html .= '<p class="indent"><u>Year:</u> ' . $blank(null, '80px')
               . ' &nbsp; <u>Color:</u> ' . $blank(null, '100px')
               . ' &nbsp; <u>Odometer:</u> ' . $blank(null, '120px') . ' Miles</p>';
    }

    $html .= '<p class="indent">' . $check($d['payment_type'] === 'gift')
           . ' <b>As a Gift.</b> The Seller is giving the vehicle as a gift to the Buyer. The value of the vehicle is $'
           . $blank($d['payment_type'] === 'gift' && $d['gift_value'] !== null ? number_format($d['gift_value'], 2) : null, '120px') . '.</p>';

    $html .= '<p class="indent">' . $check($d['payment_type'] === 'other')
           . ' <b>Other.</b> ' . $blank($d['payment_type'] === 'other' ? $d['other_terms'] : null, '320px') . '.</p>';

    $html .= '<p class="indent">Hereinafter known as the &ldquo;Exchange.&rdquo;</p>';
    $html .= '</div>';

    $html .= '<div class="section">';
    $html .= '<p><span class="num">4. TAXES.</span> All municipal, county, and state taxes in relation to the sale of the Vehicle, including sales taxes, are paid by the: (check one)</p>';
    $html .= '<p class="indent">' . $check($d['taxes_paid_by'] === 'buyer')  . ' <b>Buyer</b> and not included in the exchange.</p>';
    $html .= '<p class="indent">' . $check($d['taxes_paid_by'] === 'seller') . ' <b>Seller</b> and included as part of the exchange.</p>';
    $html .= '</div>';

    // Page 2 — CONDITIONS, AUTHORIZATION, ODOMETER DISCLOSURE
    $html .= '<div class="page-break"></div>';

    $html .= '<div class="section"><p><span class="num">5. BUYER AND SELLER CONDITIONS.</span></p>';
    $html .= '<p class="clause">The undersigned Seller affirms that the above information about the Vehicle is accurate to the best of their knowledge. The undersigned Buyer accepts receipt of this document and understands that the above vehicle is sold on an &ldquo;as is, where is&rdquo; condition with no guarantees or warranties, either expressed or implied.</p></div>';

    $html .= '<div class="section"><p><span class="num">6. AUTHORIZATION.</span></p>';
    $html .= '<div class="sig-block"><b>Buyer Signature:</b><span class="sig-line"></span></div>';
    $html .= '<p>Date: ' . $blank($saleDate, '160px') . '<br>Print Name: ' . $blank($d['buyer_name'], '240px') . '</p>';
    $html .= '<div class="sig-block"><b>Seller Signature:</b><span class="sig-line"></span></div>';
    $html .= '<p>Date: ' . $blank($saleDate, '160px') . '<br>Print Name: ' . $blank($d['seller_name'], '240px') . '</p>';
    $html .= '</div>';

    $html .= '<h1 style="margin-top:24px">ODOMETER DISCLOSURE STATEMENT</h1>';
    $html .= '<p class="clause">FEDERAL and STATE LAW requires that you state the mileage in connection with the transfer of ownership. Failure to complete or providing a false statement may result in fines and/or imprisonment.</p>';
    $html .= '<p>I/We, ' . $blank($d['seller_name'], '220px')
           . ', the Seller, certify to the best of my/our knowledge that the odometer reading of '
           . $blank($d['vehicle_odometer'], '120px') . ' Miles.</p>';
    $html .= '<p>The actual mileage of the vehicle is accurate, unless one (1) of the following statements is checked (&#10004;):</p>';
    $html .= '<p class="indent">' . $check($d['odometer_exceeds_limits']) . ' I hereby certify that the odometer reading reflects the amount of mileage in excess of its mechanical limits.</p>';
    $html .= '<p class="indent">' . $check($d['odometer_not_actual']) . ' I hereby certify that the odometer reading is <b>not</b> the actual mileage. <span class="warning">WARNING &mdash; ODOMETER DISCREPANCY</span></p>';
    $html .= '<div class="sig-block" style="margin-top:18px"><b>Buyer Signature:</b><span class="sig-line"></span></div>';
    $html .= '<p>Date: ' . $blank($saleDate, '160px') . '<br>Print Name: ' . $blank($d['buyer_name'], '240px') . '</p>';

    $mpdf->WriteHTML($html);
    return $mpdf->Output('', 'S');
}

// List mode — all bills of sale across leads, joined with enough lead
// context for the Bill of Sale tab to render a useful table.
//
//   GET /api/bill_of_sale?list=1
//
// Returns: [{ id, imported_lead_id, lead_name, vehicle_vin, vehicle_make,
//             vehicle_model, vehicle_year, buyer_name, payment_type,
//             payment_amount, has_signature, status, updated_at }, ...]
if ($method === 'GET' && isset($_GET['list'])) {
    $stmt = $db->query(
        "SELECT b.id, b.imported_lead_id,
                b.vehicle_vin, b.vehicle_make, b.vehicle_model, b.vehicle_year,
                b.buyer_name, b.payment_type, b.payment_amount,
                b.signed_at, b.signature_request_id, b.signature_status,
                b.created_at, b.updated_at,
                JSON_UNQUOTE(JSON_EXTRACT(r.normalized_payload_json, '$.full_name'))   AS lead_full_name,
                JSON_UNQUOTE(JSON_EXTRACT(r.normalized_payload_json, '$.first_name'))  AS lead_first_name,
                JSON_UNQUOTE(JSON_EXTRACT(r.normalized_payload_json, '$.last_name'))   AS lead_last_name,
                u.name AS created_by_name
           FROM bill_of_sale b
           JOIN imported_leads_raw r ON r.id = b.imported_lead_id
           LEFT JOIN users u ON u.id = b.created_by
          ORDER BY b.updated_at DESC, b.id DESC"
    );
    $rows = $stmt->fetchAll();
    foreach ($rows as &$r) {
        $r['id']               = (int) $r['id'];
        $r['imported_lead_id'] = (int) $r['imported_lead_id'];
        $r['payment_amount']   = $r['payment_amount'] !== null ? (float) $r['payment_amount'] : null;
        $r['vehicle_year']     = $r['vehicle_year']   !== null ? (int) $r['vehicle_year']   : null;
        $lead = trim((string) ($r['lead_full_name'] ?: trim(($r['lead_first_name'] ?? '') . ' ' . ($r['lead_last_name'] ?? ''))));
        $r['lead_name'] = $lead !== '' ? $lead : null;
        unset($r['lead_full_name'], $r['lead_first_name'], $r['lead_last_name']);

        // Derive a display status. Real signature flow lands in v2.
        if (!empty($r['signed_at'])) {
            $r['status'] = 'signed';
        } elseif (!empty($r['signature_request_id'])) {
            $r['status'] = 'awaiting_signature';
        } elseif (!empty($r['buyer_name']) && $r['payment_amount']) {
            $r['status'] = 'ready_to_send';
        } else {
            $r['status'] = 'draft';
        }
    }
    unset($r);
    echo json_encode($rows);
    exit();
}

if ($method === 'GET') {
    $leadId = (int) ($_GET['lead_id'] ?? 0);
    if ($leadId <= 0) pipelineFail(400, 'lead_id is required', 'missing_lead_id');
    loadLeadOrFail($db, $leadId);

    $format = $_GET['format'] ?? 'json';
    $row = fetchBoS($db, $leadId) ?: defaultsFromLead($db, $leadId);

    if ($format === 'pdf') {
        try {
            $pdf = renderBillOfSalePdf($row);
        } catch (Throwable $e) {
            pipelineFail(500, 'PDF generation failed: ' . $e->getMessage(), 'pdf_error');
        }
        $existing = fetchBoS($db, $leadId);
        if ($existing) {
            logLeadActivity($db, $leadId, $user['id'], 'bill_of_sale_generated', null, ['vin' => $row['vehicle_vin']]);
        }
        $filename = 'BoS-' . ($row['vehicle_vin'] ?: ('lead-' . $leadId)) . '-' . date('Ymd') . '.pdf';
        if (PHP_SAPI !== 'cli') {
            // Reset the JSON content-type header set by config.php.
            header_remove('Content-Type');
            header('Content-Type: application/pdf');
            header('Content-Disposition: attachment; filename="' . $filename . '"');
            header('Content-Length: ' . strlen($pdf));
        }
        echo $pdf;
        exit();
    }
    echo json_encode($row);
    exit();
}

if ($method === 'PUT') {
    $input = json_decode(file_get_contents('php://input'), true) ?? [];
    $leadId = (int) ($input['lead_id'] ?? 0);
    if ($leadId <= 0) pipelineFail(400, 'lead_id is required', 'missing_lead_id');
    loadLeadOrFail($db, $leadId);

    if (!empty($input['payment_type']) && !in_array($input['payment_type'], BOS_PAYMENT_TYPES, true)) {
        pipelineFail(400, 'Invalid payment_type', 'invalid_payment_type');
    }
    if (!empty($input['taxes_paid_by']) && !in_array($input['taxes_paid_by'], BOS_TAXES_PAID_BY, true)) {
        pipelineFail(400, 'Invalid taxes_paid_by', 'invalid_taxes_paid_by');
    }

    $columns = [
        'sale_county','sale_state','sale_date',
        'buyer_name','buyer_address','seller_name','seller_address',
        'vehicle_make','vehicle_model','vehicle_body_type','vehicle_year','vehicle_color','vehicle_odometer','vehicle_vin',
        'payment_type','payment_amount','trade_amount',
        'trade_make','trade_model','trade_body_type','trade_year','trade_color','trade_odometer',
        'gift_value','other_terms','taxes_paid_by',
        'odometer_accurate','odometer_exceeds_limits','odometer_not_actual',
    ];

    $cols = ['imported_lead_id', 'created_by'];
    $vals = [':lid', ':uid'];
    $sets = [];
    $params = [':lid' => $leadId, ':uid' => $user['id']];
    foreach ($columns as $k) {
        if (!array_key_exists($k, $input)) continue;
        $v = $input[$k];
        if (in_array($k, ['odometer_accurate','odometer_exceeds_limits','odometer_not_actual'], true)) {
            $v = $v ? 1 : 0;
        } elseif (in_array($k, ['payment_amount','trade_amount','gift_value'], true)) {
            $v = ($v === '' || $v === null) ? null : (float) $v;
        } else {
            $v = ($v === '' || $v === null) ? null : (is_string($v) ? trim($v) : $v);
        }
        $cols[] = $k;
        $vals[] = ":$k";
        $sets[] = "$k = VALUES($k)";
        $params[":$k"] = $v;
    }

    if (count($cols) <= 2) {
        echo json_encode(['success' => true, 'unchanged' => true]);
        exit();
    }

    $sql = 'INSERT INTO bill_of_sale (' . implode(',', $cols) . ') VALUES (' . implode(',', $vals) . ') '
         . 'ON DUPLICATE KEY UPDATE ' . implode(', ', $sets);
    try {
        $db->prepare($sql)->execute($params);
        logLeadActivity($db, $leadId, $user['id'], 'bill_of_sale_updated', null, ['payment_type' => $input['payment_type'] ?? null]);
    } catch (Throwable $e) {
        pipelineFail(500, 'Bill of Sale save failed: ' . $e->getMessage(), 'db_error');
    }
    echo json_encode(['success' => true, 'bill_of_sale' => fetchBoS($db, $leadId)]);
    exit();
}

pipelineFail(405, 'Method not allowed', 'method_not_allowed');

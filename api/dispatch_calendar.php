<?php

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/pipeline.php';
initSession();

$user = requireAuth();
$db   = getDBConnection();

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    pipelineFail(405, 'Method not allowed', 'method_not_allowed');
}

$start = $_GET['start'] ?? null;
$end   = $_GET['end']   ?? null;
$statusFilter      = $_GET['status']         ?? null;
$transporterFilter = $_GET['transporter_id'] ?? null;

$where  = ['lt.transport_date IS NOT NULL'];
$params = [];
if ($start) {
    $where[] = 'lt.transport_date >= :start';
    $params[':start'] = $start;
}
if ($end) {
    $where[] = 'lt.transport_date <= :end';
    $params[':end'] = $end;
}
if ($statusFilter && in_array($statusFilter, TRANSPORT_STATUSES, true)) {
    $where[] = 'lt.status = :status';
    $params[':status'] = $statusFilter;
}
if ($transporterFilter !== null && $transporterFilter !== '') {
    $where[] = 'lt.assigned_transporter_id = :tid';
    $params[':tid'] = (int) $transporterFilter;
}

$sql = "
  SELECT
    lt.id,
    lt.imported_lead_id,
    lt.transport_date,
    lt.transport_time,
    lt.time_window,
    lt.pickup_location,
    lt.delivery_location,
    lt.vehicle_info,
    lt.status,
    lt.assigned_transporter_id,
    lt.notes,
    t.name  AS transporter_name,
    t.phone AS transporter_phone,
    t.email AS transporter_email,
    r.normalized_payload_json,
    r.batch_id,
    s.status   AS lead_status,
    s.priority AS lead_priority
  FROM lead_transport lt
  INNER JOIN imported_leads_raw r ON r.id = lt.imported_lead_id
  LEFT JOIN lead_states s        ON s.imported_lead_id = lt.imported_lead_id
  LEFT JOIN transporters t       ON t.id = lt.assigned_transporter_id
  WHERE " . implode(' AND ', $where) . "
  ORDER BY lt.transport_date ASC, lt.transport_time ASC
  LIMIT 500
";

$stmt = $db->prepare($sql);
$stmt->execute($params);
$rows = $stmt->fetchAll();

$events = array_map(function ($r) {
    $np  = json_decode($r['normalized_payload_json'] ?? 'null', true) ?: [];
    $name = trim(($np['full_name'] ?? '') ?: trim(($np['first_name'] ?? '') . ' ' . ($np['last_name'] ?? '')));
    $vin  = $np['vin']  ?? null;
    $year = $np['year'] ?? null;
    $make = $np['make'] ?? null;
    $model = $np['model'] ?? null;
    $vehicle = $r['vehicle_info'] ?: trim(implode(' ', array_filter([$year, $make, $model])));

    $startIso = $r['transport_date'];
    if ($r['transport_time']) $startIso .= 'T' . $r['transport_time'];
    return [
        'id'                      => (int) $r['id'],
        'lead_id'                 => (int) $r['imported_lead_id'],
        'title'                   => ($name ?: 'Lead #' . $r['imported_lead_id']) . ' — ' . ($vehicle ?: 'Vehicle'),
        'start'                   => $startIso,
        'all_day'                 => $r['transport_time'] === null,
        'status'                  => $r['status'],
        'time_window'             => $r['time_window'],
        'pickup_location'         => $r['pickup_location'],
        'delivery_location'       => $r['delivery_location'],
        'vehicle_info'            => $vehicle,
        'vehicle_vin'             => $vin,
        'lead_name'               => $name ?: null,
        'assigned_transporter_id' => $r['assigned_transporter_id'] !== null ? (int) $r['assigned_transporter_id'] : null,
        'transporter_name'        => $r['transporter_name'],
        'transporter_phone'       => $r['transporter_phone'],
        'transporter_email'       => $r['transporter_email'],
        'notes'                   => $r['notes'],
        'lead_status'             => $r['lead_status'],
        'lead_priority'           => $r['lead_priority'],
    ];
}, $rows);

// Summary counts so the dashboard can show "5 scheduled, 2 notified, 1 delivered" at a glance.
$summary = ['total' => count($events)];
foreach (TRANSPORT_STATUSES as $st) $summary[$st] = 0;
foreach ($events as $e) {
    if (isset($summary[$e['status']])) $summary[$e['status']]++;
}

if (($_GET['format'] ?? null) === 'csv') {
    if (function_exists('header_remove')) header_remove('Content-Type');
    $filename = 'dispatch_' . date('Ymd_His') . '.csv';
    header('Content-Type: text/csv; charset=UTF-8');
    header('Content-Disposition: attachment; filename="' . $filename . '"');
    $out = fopen('php://output', 'w');
    fwrite($out, "\xEF\xBB\xBF"); // UTF-8 BOM for Excel
    fputcsv($out, [
        'transport_id', 'lead_id', 'lead_name', 'date', 'time', 'time_window',
        'status', 'pickup', 'delivery', 'vehicle', 'vin',
        'transporter', 'transporter_phone', 'transporter_email',
        'lead_status', 'lead_priority', 'notes',
    ]);
    foreach ($events as $e) {
        fputcsv($out, [
            $e['id'], $e['lead_id'], $e['lead_name'] ?? '',
            substr($e['start'], 0, 10),
            $e['all_day'] ? '' : substr($e['start'], 11),
            $e['time_window'] ?? '',
            $e['status'],
            $e['pickup_location']   ?? '',
            $e['delivery_location'] ?? '',
            $e['vehicle_info']      ?? '',
            $e['vehicle_vin']       ?? '',
            $e['transporter_name']  ?? '',
            $e['transporter_phone'] ?? '',
            $e['transporter_email'] ?? '',
            $e['lead_status']       ?? '',
            $e['lead_priority']     ?? '',
            $e['notes']             ?? '',
        ]);
    }
    fclose($out);
    exit();
}

echo json_encode(['events' => $events, 'summary' => $summary]);

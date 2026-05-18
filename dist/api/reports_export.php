<?php

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/pipeline.php';
require_once __DIR__ . '/reports_lib.php';
initSession();

$user = requireAuth();
$db   = getDBConnection();

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    pipelineFail(405, 'Method not allowed', 'method_not_allowed');
}

$format = $_GET['format'] ?? 'csv';
$type   = $_GET['type']   ?? 'all';
$isAdmin = ($user['role'] ?? null) === 'admin';
$unscoped = $isAdmin || ($user['role'] ?? null) === 'marketer';

$bundle = [];
if ($type === 'leads' || $type === 'all') {
    $bundle['leads'] = leadsReport($db, (int) $user['id'], $unscoped);
}
if ($type === 'duplicates' || $type === 'all') {
    $bundle['duplicates'] = duplicatesReport($db, (int) $user['id']);
}
if ($type === 'dispatch' || $type === 'all') {
    $bundle['dispatch'] = dispatchReport($db);
}
if (($type === 'marketing' || $type === 'all') && $unscoped) {
    $bundle['marketing'] = marketingReport($db);
}

if ($format === 'pdf') {
    require_once __DIR__ . '/vendor/autoload.php';
    $mpdf = new \Mpdf\Mpdf([
        'mode'        => 'utf-8',
        'format'      => 'Letter',
        'margin_left'   => 14,
        'margin_right'  => 14,
        'margin_top'    => 14,
        'margin_bottom' => 14,
    ]);

    $esc = fn($v) => htmlspecialchars((string) ($v ?? ''), ENT_QUOTES | ENT_HTML5, 'UTF-8');
    $h = '<style>
        body { font-family: DejaVuSans, sans-serif; font-size: 10pt; color: #111; }
        h1 { font-size: 16pt; margin: 0 0 4px 0; }
        h2 { font-size: 12pt; margin: 16px 0 6px 0; color: #1f2937; border-bottom: 1px solid #d1d5db; padding-bottom: 2px; }
        .meta { color: #6b7280; font-size: 9pt; margin-bottom: 14px; }
        table { width: 100%; border-collapse: collapse; margin: 6px 0; }
        th, td { text-align: left; padding: 4px 8px; border-bottom: 1px solid #e5e7eb; font-size: 9.5pt; }
        th { background: #f9fafb; font-weight: 600; color: #374151; }
        .kpi { display: inline-block; margin-right: 16px; padding: 6px 10px; background: #f3f4f6; border-radius: 4px; }
        .kpi b { font-size: 12pt; display: block; }
        .kpi span { font-size: 8.5pt; color: #6b7280; }
    </style>';
    $h .= '<h1>CRM Report</h1>';
    $h .= '<p class="meta">Generated ' . date('F j, Y, g:i a') . ' by ' . $esc($user['role']) . '</p>';

    $renderKpiRow = function (array $items) use ($esc) {
        $s = '<div style="margin: 6px 0 12px 0">';
        foreach ($items as [$label, $value]) {
            $s .= '<span class="kpi"><b>' . $esc($value) . '</b><span>' . $esc($label) . '</span></span>';
        }
        return $s . '</div>';
    };
    $renderRowsTable = function (array $rows, string $keyHeader, string $countHeader = 'Count') use ($esc) {
        $s = '<table><thead><tr><th>' . $esc($keyHeader) . '</th><th style="text-align:right">' . $esc($countHeader) . '</th></tr></thead><tbody>';
        foreach ($rows as $r) {
            $s .= '<tr><td>' . $esc($r['label'] ?? $r['key'] ?? '') . '</td><td style="text-align:right">' . $esc($r['count'] ?? 0) . '</td></tr>';
        }
        return $s . '</tbody></table>';
    };

    if (!empty($bundle['leads'])) {
        $l = $bundle['leads'];
        $h .= '<h2>Leads</h2>';
        $h .= $renderKpiRow([
            ['Total leads',     number_format($l['total'])],
            ['Unassigned',      number_format($l['unassigned'])],
            ['Imported today',  number_format($l['imported_today'])],
            ['Imported (7d)',   number_format($l['imported_this_week'])],
            ['Open tasks',      number_format($l['open_tasks'])],
            ['Tasks overdue',   number_format($l['tasks_overdue'])],
        ]);
        $h .= '<h3 style="font-size:10pt;margin-top:10px">By status</h3>';
        $h .= $renderRowsTable($l['by_status']      ?? [], 'Status');
        $h .= '<h3 style="font-size:10pt;margin-top:10px">By priority</h3>';
        $h .= $renderRowsTable($l['by_priority']    ?? [], 'Priority');
        $h .= '<h3 style="font-size:10pt;margin-top:10px">By temperature</h3>';
        $h .= $renderRowsTable($l['by_temperature'] ?? [], 'Temperature');
    }

    if (!empty($bundle['dispatch'])) {
        $d = $bundle['dispatch'];
        $h .= '<h2>Dispatch</h2>';
        $h .= $renderKpiRow([
            ['Total transports',  number_format($d['total'])],
            ['Scheduled today',   number_format($d['scheduled_today'])],
            ['Scheduled (7d)',    number_format($d['scheduled_7d'])],
            ['Delivered (30d)',   number_format($d['delivered_30d'])],
            ['Unassigned',        number_format($d['unassigned_active'])],
            ['Overdue',           number_format($d['overdue'])],
            ['Notifications 7d',  number_format($d['notifications_7d'])],
        ]);
        $h .= '<h3 style="font-size:10pt;margin-top:10px">By status</h3>';
        $h .= $renderRowsTable($d['by_status'] ?? [], 'Status');
        if (!empty($d['by_transporter'])) {
            $h .= '<h3 style="font-size:10pt;margin-top:10px">By transporter</h3>';
            $h .= '<table><thead><tr><th>Transporter</th><th style="text-align:right">Active</th><th style="text-align:right">Delivered</th><th style="text-align:right">Total</th></tr></thead><tbody>';
            foreach ($d['by_transporter'] as $r) {
                $h .= '<tr><td>' . $esc($r['name']) . '</td>'
                    . '<td style="text-align:right">' . $esc($r['active']) . '</td>'
                    . '<td style="text-align:right">' . $esc($r['delivered']) . '</td>'
                    . '<td style="text-align:right">' . $esc($r['total']) . '</td></tr>';
            }
            $h .= '</tbody></table>';
        }
    }

    if (!empty($bundle['duplicates'])) {
        $dup = $bundle['duplicates'];
        $h .= '<h2>Duplicates</h2>';
        $h .= $renderKpiRow([
            ['Groups',          number_format($dup['total'])],
            ['Created today',   number_format($dup['created_today'])],
            ['Created (7d)',    number_format($dup['created_this_week'])],
        ]);
        $h .= $renderRowsTable($dup['by_review_status'] ?? [], 'Review status');
    }

    if (!empty($bundle['marketing'])) {
        $m = $bundle['marketing'];
        $h .= '<h2>Marketing</h2>';
        $h .= $renderKpiRow([
            ['Active campaigns', number_format($m['active_campaigns'])],
            ['Sent (7d)',        number_format($m['sent_7d'])],
            ['Sent (30d)',       number_format($m['sent_30d'])],
            ['Open rate (30d)',  $m['open_rate_30d'] . '%'],
            ['Click rate (30d)', $m['click_rate_30d'] . '%'],
        ]);
    }

    $pdf = $mpdf->Output('', 'S');
    if (function_exists('header_remove')) header_remove('Content-Type');
    header('Content-Type: application/pdf');
    header('Content-Disposition: attachment; filename="crm-report-' . date('Ymd') . '.pdf"');
    header('Content-Length: ' . strlen($pdf));
    echo $pdf;
    exit();
}

// CSV — long-format: section, metric, value
if (function_exists('header_remove')) header_remove('Content-Type');
$filename = 'crm-report-' . $type . '-' . date('Ymd_His') . '.csv';
header('Content-Type: text/csv; charset=UTF-8');
header('Content-Disposition: attachment; filename="' . $filename . '"');
$out = fopen('php://output', 'w');
fwrite($out, "\xEF\xBB\xBF");
fputcsv($out, ['section', 'metric', 'value']);

$writeScalar = function ($section, $rows) use ($out) {
    foreach ($rows as $k => $v) {
        if (is_array($v)) continue; // handled separately below
        fputcsv($out, [$section, $k, is_bool($v) ? ($v ? '1' : '0') : (string) $v]);
    }
};
$writeRows = function ($section, $rows, $keyField = 'key') use ($out) {
    foreach ($rows as $r) {
        fputcsv($out, [$section, $r[$keyField] ?? '', $r['count'] ?? '']);
    }
};

if (!empty($bundle['leads'])) {
    $l = $bundle['leads'];
    $writeScalar('leads', $l);
    $writeRows('leads.by_status',      $l['by_status']      ?? []);
    $writeRows('leads.by_priority',    $l['by_priority']    ?? []);
    $writeRows('leads.by_temperature', $l['by_temperature'] ?? []);
    $writeRows('leads.by_source_stage',$l['by_source_stage']?? []);
    foreach ($l['by_batch'] ?? [] as $r) {
        fputcsv($out, ['leads.by_batch', $r['batch_name'] ?? '', $r['count'] ?? '']);
    }
}
if (!empty($bundle['dispatch'])) {
    $d = $bundle['dispatch'];
    $writeScalar('dispatch', $d);
    $writeRows('dispatch.by_status', $d['by_status'] ?? []);
    foreach ($d['by_transporter'] ?? [] as $r) {
        fputcsv($out, ['dispatch.by_transporter.active',    $r['name'], $r['active']]);
        fputcsv($out, ['dispatch.by_transporter.delivered', $r['name'], $r['delivered']]);
        fputcsv($out, ['dispatch.by_transporter.total',     $r['name'], $r['total']]);
    }
}
if (!empty($bundle['duplicates'])) {
    $dup = $bundle['duplicates'];
    $writeScalar('duplicates', $dup);
    $writeRows('duplicates.by_review_status', $dup['by_review_status'] ?? []);
    $writeRows('duplicates.by_match_type',    $dup['by_match_type']    ?? []);
}
if (!empty($bundle['marketing'])) {
    $writeScalar('marketing', $bundle['marketing']);
}

fclose($out);
exit();

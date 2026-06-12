<?php
// One-off script: renders a representative Bill of Sale PDF, writes
// it to /tmp/bos-sample.pdf, and prints the path so the caller can
// parse it with pdftotext -bbox-layout to find the exact Y position
// of each "Signature" line. Used to calibrate OpenSign placeholder
// coords after a layout change.
require_once '/var/www/crm/api/bos_helpers.php';

$pdf = renderBillOfSalePdf([
    'sale_county'       => 'Tarrant',
    'sale_state'        => 'TX',
    'sale_date'         => '2026-06-15',
    'seller_name'       => 'Jane Doe',
    'seller_address'    => '123 Test St, Fort Worth, TX 76110',
    'buyer_name'        => 'Mitchell Briggs',
    'buyer_address'     => 'Vin Vault LLC, Fort Worth, TX',
    'vehicle_make'      => 'Mazda',
    'vehicle_model'     => 'Miata',
    'vehicle_body_type' => 'Convertible',
    'vehicle_year'      => '1995',
    'vehicle_color'     => 'Red',
    'vehicle_odometer'  => '45000',
    'vehicle_vin'       => 'TEST12345678VIN',
    'payment_type'      => 'cash',
    'payment_amount'    => 15000,
    'trade_amount'      => null,
    'trade_make'        => null,
    'trade_model'       => null,
    'trade_body_type'   => null,
    'trade_year'        => null,
    'trade_color'       => null,
    'trade_odometer'    => null,
    'gift_value'        => null,
    'other_terms'       => null,
    'additional_terms'  => null,  // exercise the default-boilerplate path
    'taxes_paid_by'     => 'buyer',
    'odometer_accurate'       => true,
    'odometer_exceeds_limits' => false,
    'odometer_not_actual'     => false,
]);
file_put_contents('/tmp/bos-sample.pdf', $pdf);
echo 'wrote /tmp/bos-sample.pdf (' . strlen($pdf) . ' bytes)' . PHP_EOL;

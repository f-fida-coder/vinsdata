<?php
// Shared JV-agreement helpers.
//
// Two functions live here:
//   - fetchJvData(PDO, int) → joined investor + lead + investor_leads row
//                             with all the fields needed to render the JV PDF
//   - renderJvAgreementPdf(array) → bytes of a Joint Venture Agreement
//                                   PDF rendered from that row
//
// Mirrors the bos_helpers.php pattern (mPDF + DancingScript for the
// pre-signed VinVault signature). Pure functions — no headers, no
// exits, no session deps. Safe to require from any handler.

require_once __DIR__ . '/pipeline.php';

if (!function_exists('fetchJvData')) {
function fetchJvData(PDO $db, int $investorLeadId): array
{
    $stmt = $db->prepare(
        "SELECT il.*,
                inv.name        AS investor_name,
                inv.email       AS investor_email,
                inv.phone       AS investor_phone,
                inv.entity_name AS investor_entity,
                inv.address     AS investor_address,
                r.normalized_payload_json
           FROM investor_leads il
           JOIN investors inv        ON inv.id = il.investor_id
           JOIN imported_leads_raw r ON r.id   = il.imported_lead_id
          WHERE il.id = :id"
    );
    $stmt->execute([':id' => $investorLeadId]);
    $row = $stmt->fetch();
    if (!$row) pipelineFail(404, 'Investor linkage not found', 'not_found');

    $np = json_decode($row['normalized_payload_json'] ?? 'null', true) ?: [];

    // Lookup the operator's saved price_offered (if any) so the
    // "target purchase price" line reflects what the desk plans to
    // pay rather than just whatever the import asked for. Falls back
    // to price_wanted (lead's ask) if the operator hasn't entered a
    // counter yet — better than leaving the field blank on the PDF.
    $ovStmt = $db->prepare('SELECT price_offered, price_wanted FROM lead_states WHERE imported_lead_id = :id');
    $ovStmt->execute([':id' => (int) $row['imported_lead_id']]);
    $override = $ovStmt->fetch() ?: [];

    // Company / VinVault defaults for the operator side of the agreement.
    $csStmt = $db->prepare('SELECT company_name, company_address FROM company_settings WHERE id = 1');
    $csStmt->execute();
    $cs = $csStmt->fetch() ?: [];

    $investorAmount = $row['investment_amount'] !== null ? (float) $row['investment_amount'] : 0.0;
    // share_pct on investor_leads is the INVESTOR's share. Vin Vault
    // gets the remainder of the 100% pool.
    $investorShare  = $row['share_pct'] !== null ? (float) $row['share_pct'] : 0.0;
    $vinvaultShare  = max(0.0, 100.0 - $investorShare);

    $targetPrice = null;
    if (isset($override['price_offered']) && $override['price_offered'] !== null && $override['price_offered'] !== '') {
        $targetPrice = (float) $override['price_offered'];
    } elseif (isset($override['price_wanted']) && $override['price_wanted'] !== null && $override['price_wanted'] !== '') {
        $targetPrice = (float) $override['price_wanted'];
    }

    return [
        'effective_date'        => date('F j, Y'),
        // Vin Vault side
        'operator_name'         => $cs['company_name']    ?: 'Vin Vault LLC',
        'operator_address'      => $cs['company_address'] ?: null,
        'operator_signer_name'  => 'Mitchell Briggs',
        'operator_signer_title' => 'Owner',
        // Investor side
        'investor_id'           => (int) $row['investor_id'],
        'investor_name'         => $row['investor_name']    ?? null,
        'investor_email'        => $row['investor_email']   ?? null,
        'investor_entity'       => $row['investor_entity']  ?? null,
        'investor_address'      => $row['investor_address'] ?? null,
        // Vehicle
        'vehicle_year'          => $np['year']  ?? null,
        'vehicle_make'          => $np['make']  ?? null,
        'vehicle_model'         => $np['model'] ?? null,
        'vehicle_vin'           => $np['vin']   ?? null,
        'target_purchase_price' => $targetPrice,
        // Terms
        'capital_contribution'  => $investorAmount,
        'investor_share_pct'    => $investorShare,
        'vinvault_share_pct'    => $vinvaultShare,
        'hold_period_days'      => 90,
        'notes'                 => $row['notes'] ?? null,
        // For PDF filename / OpenSign reference
        'investor_lead_id'      => (int) $row['id'],
        'imported_lead_id'      => (int) $row['imported_lead_id'],
    ];
}
}

if (!function_exists('renderJvAgreementPdf')) {
function renderJvAgreementPdf(array $d): string
{
    require_once __DIR__ . '/vendor/autoload.php';

    // Same Dancing Script font registration as the BoS — Mitchell
    // Briggs' pre-signed name renders in real cursive on the Vin
    // Vault side of the signature block.
    $defaultConfig     = (new \Mpdf\Config\ConfigVariables())->getDefaults();
    $defaultFontConfig = (new \Mpdf\Config\FontVariables())->getDefaults();

    $mpdf = new \Mpdf\Mpdf([
        'mode'          => 'utf-8',
        'format'        => 'Letter',
        'margin_left'   => 22,
        'margin_right'  => 22,
        'margin_top'    => 18,
        'margin_bottom' => 18,
        'fontDir'       => array_merge($defaultConfig['fontDir'], [__DIR__ . '/fonts']),
        'fontdata'      => $defaultFontConfig['fontdata'] + [
            'dancingscript' => ['R' => 'DancingScript-Regular.ttf'],
        ],
    ]);

    $esc   = fn($v) => htmlspecialchars((string) ($v ?? ''), ENT_QUOTES | ENT_HTML5, 'UTF-8');
    $money = fn($n) => $n !== null
        ? '$' . number_format((float) $n, 2)
        : '$_____________';
    $or    = fn($v, $fallback = '_____________') => ($v !== null && $v !== '') ? $esc($v) : $fallback;

    $vehicleDesc = trim(implode(' ', array_filter([
        $d['vehicle_year']  ?? null,
        $d['vehicle_make']  ?? null,
        $d['vehicle_model'] ?? null,
    ]))) ?: '_______________';

    $investorLabel = trim(implode(' ', array_filter([
        $d['investor_name'] ?? null,
        $d['investor_entity'] ? '(' . $d['investor_entity'] . ')' : null,
    ]))) ?: '_______________';

    $css = '
      body { font-family: DejaVuSans, sans-serif; font-size: 11pt; color: #111; line-height: 1.55; }
      h1   { text-align: center; font-size: 16pt; margin: 0 0 4px 0; letter-spacing: 0.5px; }
      .subtitle { text-align: center; font-size: 11pt; color: #444; margin: 0 0 18px 0; font-style: italic; }
      h2   { font-size: 12pt; margin: 14px 0 6px 0; color: #1a1a4a; }
      p    { margin: 6px 0; text-align: justify; }
      .lede { margin: 10px 0 4px 0; }
      .indent { margin-left: 18px; }
      .kv   { margin: 3px 0; }
      .kv b { display: inline-block; min-width: 170px; }
      ul   { margin: 4px 0 8px 22px; padding: 0; }
      li   { margin: 3px 0; text-align: justify; }
      .sig-block { margin-top: 28px; }
      .sig-row   { display: block; margin: 12px 0; }
      .sig-line  { border-bottom: 1px solid #111; display: inline-block; min-width: 260px; padding: 0 6px 2px; vertical-align: bottom; }
      .sig-text  {
        font-family: dancingscript;
        font-size: 22pt;
        color: #1a1a4a;
        display: inline-block;
        min-width: 260px;
        padding: 0 6px 2px;
        vertical-align: bottom;
        line-height: 1;
      }
      .small { font-size: 10pt; color: #555; }
      .page-break { page-break-before: always; }
    ';

    $html  = '<style>' . $css . '</style>';
    $html .= '<h1>JOINT VENTURE AGREEMENT</h1>';
    $html .= '<p class="subtitle">Single Vehicle Investment &mdash; Vin Vault LLC</p>';

    $html .= '<p class="lede">This Joint Venture Agreement (the &ldquo;Agreement&rdquo;) is entered into and made effective as of '
           . '<b>' . $or($d['effective_date']) . '</b>, by and between:</p>';
    $html .= '<p class="indent"><b>' . $esc($d['operator_name']) . '</b> (&ldquo;Operator&rdquo;), and</p>';
    $html .= '<p class="indent"><b>' . $esc($investorLabel) . '</b> (&ldquo;Investor&rdquo;).</p>';
    $html .= '<p>Operator and Investor are each referred to herein as a &ldquo;Party&rdquo; and collectively as the &ldquo;Parties.&rdquo;</p>';

    // 1. Purpose
    $html .= '<h2>1. Purpose</h2>';
    $html .= '<p>The Parties are entering into this Agreement for the limited and exclusive purpose of jointly acquiring, reconditioning (as needed), marketing, and reselling a single motor vehicle (the &ldquo;Vehicle&rdquo;) identified in Section 2, and sharing in the net profit (or loss) generated from the resale of that Vehicle on the terms set forth herein.</p>';

    // 2. Vehicle Information
    $html .= '<h2>2. Vehicle Information</h2>';
    $html .= '<p class="kv"><b>Year / Make / Model:</b> ' . $or($vehicleDesc) . '</p>';
    $html .= '<p class="kv"><b>Vehicle Identification Number (VIN):</b> ' . $or($d['vehicle_vin']) . '</p>';
    $html .= '<p class="kv"><b>Target Purchase Price:</b> ' . $money($d['target_purchase_price']) . '</p>';

    // 3. Capital Contribution
    $html .= '<h2>3. Capital Contribution</h2>';
    $html .= '<p>The Investor shall contribute a total of <b>' . $money($d['capital_contribution']) . '</b> (the &ldquo;Capital Contribution&rdquo;) to fund all or part of the acquisition of the Vehicle. The Capital Contribution shall be wired or otherwise delivered to the Operator prior to closing on the Vehicle. The Capital Contribution is not a loan, does not bear interest, and does not entitle the Investor to any ownership in the Operator entity.</p>';

    // 4. Title and Ownership
    $html .= '<h2>4. Title and Ownership</h2>';
    $html .= '<p>Legal title to the Vehicle shall be held in the name of the Operator (or its designated affiliate). The Operator shall hold title as the operating party for the benefit of the joint venture solely for the purposes of this Agreement, including registration, insurance, listing, transport, and resale. The Investor acknowledges that holding title in the Operator&rsquo;s name is administrative and shall not by itself entitle the Operator to any portion of the Investor&rsquo;s economic interest defined in Section 8.</p>';

    // 5. Management
    $html .= '<h2>5. Management</h2>';
    $html .= '<p>The Operator shall have sole and exclusive day-to-day control over all aspects of the joint venture, including but not limited to: negotiating and closing the acquisition; arranging transport and storage; reconditioning, detailing, and any mechanical or cosmetic work; marketing and listing the Vehicle; communicating with prospective buyers; setting the listing and final sale price; and closing the resale transaction. The Operator shall act in good faith and use commercially reasonable efforts to maximize the net profit of the joint venture.</p>';

    // 6. Estimated Economics
    $html .= '<h2>6. Estimated Economics</h2>';
    $html .= '<p>The Parties acknowledge that the figures below are good-faith estimates only and do not constitute a guarantee of profit, sale price, or sale timeline. Actual amounts will be determined at the time of resale.</p>';
    $html .= '<ul>';
    $html .= '<li><b>Target Purchase Price:</b> ' . $money($d['target_purchase_price']) . '</li>';
    $html .= '<li><b>Investor Capital Contribution:</b> ' . $money($d['capital_contribution']) . '</li>';
    $html .= '<li><b>Profit Split:</b> ' . number_format((float) $d['investor_share_pct'], 2) . '% to Investor / '
           . number_format((float) $d['vinvault_share_pct'], 2) . '% to Operator</li>';
    $html .= '<li><b>Estimated Hold Period:</b> ' . (int) $d['hold_period_days'] . ' days from acquisition to resale</li>';
    $html .= '</ul>';

    // 7. Net Profit Calculation
    $html .= '<h2>7. Net Profit Calculation</h2>';
    $html .= '<p>&ldquo;Net Profit&rdquo; means the gross resale proceeds actually received by the Operator from the sale of the Vehicle, less: (a) the acquisition cost of the Vehicle; (b) reasonable and documented out-of-pocket costs incurred by the Operator on behalf of the joint venture, including (without limitation) transport, storage, reconditioning, detailing, mechanical or cosmetic repairs, marketing and listing fees, transaction fees, taxes and registration costs directly attributable to the Vehicle. Operator overhead, salaries, and general business expenses are not deducted from Net Profit.</p>';

    $html .= '<div class="page-break"></div>';

    // 8. Distribution Waterfall
    $html .= '<h2>8. Distribution Waterfall</h2>';
    $html .= '<p>Following the resale of the Vehicle, proceeds shall be distributed in the following order of priority:</p>';
    $html .= '<ol>';
    $html .= '<li>First, to the Investor, return of one hundred percent (100%) of the Capital Contribution actually contributed under Section 3, before any profit distribution is made.</li>';
    $html .= '<li>Second, after return of the Capital Contribution, the remaining Net Profit (as calculated under Section 7) shall be split <b>' . number_format((float) $d['investor_share_pct'], 2) . '% to the Investor</b> and <b>' . number_format((float) $d['vinvault_share_pct'], 2) . '% to the Operator</b>.</li>';
    $html .= '<li>If the resale results in a net loss after return of the Capital Contribution is not possible in full, the shortfall shall be borne by the Investor up to the amount of the Capital Contribution and by the Operator for any portion above the Capital Contribution that is attributable to costs the Operator advanced.</li>';
    $html .= '</ol>';
    $html .= '<p>Distributions shall be paid to the Investor by wire, ACH, or check at the Operator&rsquo;s reasonable discretion, within fifteen (15) business days of the Operator&rsquo;s receipt of cleared resale funds.</p>';

    // 9. Hold Period
    $html .= '<h2>9. Hold Period</h2>';
    $html .= '<p>The Parties anticipate that the Vehicle will be resold within approximately <b>' . (int) $d['hold_period_days'] . ' days</b> of acquisition. If the Vehicle has not been resold by the end of this period, the Operator shall continue commercially reasonable resale efforts. The Investor acknowledges that the actual hold period may be shorter or substantially longer depending on market conditions, buyer availability, and Vehicle-specific factors, and that the Operator&rsquo;s estimate is not a guarantee.</p>';

    // 10. Risk Disclosure
    $html .= '<h2>10. Risk Disclosure</h2>';
    $html .= '<p>The Investor acknowledges and accepts that this is a speculative investment in a single used motor vehicle. Risks include but are not limited to: market price volatility; latent mechanical, cosmetic, or title defects discovered post-acquisition; longer-than-expected time to resale; damage, theft, or total loss; and the possibility that the Vehicle resells at or below the acquisition and reconditioning cost, resulting in partial or total loss of the Capital Contribution. The Operator makes no guarantee of return of capital and no guarantee of profit.</p>';

    // 11. Limitation of Liability
    $html .= '<h2>11. Limitation of Liability</h2>';
    $html .= '<p>Except in the case of fraud, willful misconduct, or gross negligence, neither Party shall be liable to the other for indirect, special, incidental, consequential, or punitive damages arising out of or relating to this Agreement. The Operator&rsquo;s aggregate liability under this Agreement shall not exceed the amount of the Capital Contribution actually received from the Investor for the Vehicle covered by this Agreement.</p>';

    // 12. Governing Law
    $html .= '<h2>12. Governing Law</h2>';
    $html .= '<p>This Agreement shall be governed by and construed in accordance with the laws of the State of Texas, without regard to its conflict-of-laws principles. The Parties agree that any dispute arising out of or relating to this Agreement shall be resolved exclusively in the state or federal courts located in Texas, and each Party consents to the personal jurisdiction and venue of those courts.</p>';

    // Entire Agreement
    $html .= '<h2>Entire Agreement</h2>';
    $html .= '<p>This Agreement constitutes the entire understanding of the Parties with respect to its subject matter and supersedes all prior negotiations, representations, or agreements, whether oral or written. This Agreement may be amended only by a written instrument signed by both Parties. This Agreement may be executed in counterparts, each of which shall be deemed an original, and which together shall constitute one and the same instrument. Electronic signatures shall have the same force and effect as original signatures.</p>';

    // Signature blocks
    // Vin Vault side is pre-signed with Mitchell Briggs in DancingScript.
    // Investor side has blank signature + date for OpenSign to fill in.
    $opSig = '<span class="sig-text">' . $esc($d['operator_signer_name']) . '</span>';

    $html .= '<div class="sig-block">';
    $html .= '<p><b>IN WITNESS WHEREOF</b>, the Parties have executed this Agreement as of the Effective Date set forth above.</p>';

    $html .= '<div style="margin-top:18px;"><b>OPERATOR &mdash; ' . $esc($d['operator_name']) . '</b></div>';
    $html .= '<div class="sig-row">Signature: ' . $opSig . '</div>';
    $html .= '<p class="kv"><b>Name:</b> ' . $esc($d['operator_signer_name']) . '</p>';
    $html .= '<p class="kv"><b>Title:</b> ' . $esc($d['operator_signer_title']) . '</p>';
    $html .= '<p class="kv"><b>Date:</b> ' . $esc($d['effective_date']) . '</p>';

    $html .= '<div style="margin-top:24px;"><b>INVESTOR &mdash; ' . $esc($investorLabel) . '</b></div>';
    $html .= '<div class="sig-row">Signature: <span class="sig-line"></span></div>';
    $html .= '<p class="kv"><b>Name:</b> ' . $esc($d['investor_name']) . '</p>';
    if (!empty($d['investor_entity'])) {
        $html .= '<p class="kv"><b>Entity:</b> ' . $esc($d['investor_entity']) . '</p>';
    }
    $html .= '<p class="kv"><b>Date:</b> <span class="sig-line" style="min-width:160px"></span></p>';
    $html .= '</div>';

    $mpdf->WriteHTML($html);
    return $mpdf->Output('', 'S');
}
}

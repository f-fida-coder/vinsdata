<?php
// Public, no-auth endpoint. Linked from the unsubscribe footer of every
// outbound email. The token is an HMAC-signed "<campaign_id>:<recipient_id>"
// blob, so a user can opt out by following the link but can't opt out someone
// else.

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/pipeline.php';
// Note: NO initSession / requireAuth — this endpoint must work from an email link.

$db = getDBConnection();

if ($_SERVER['REQUEST_METHOD'] !== 'GET' && $_SERVER['REQUEST_METHOD'] !== 'POST') {
    http_response_code(405);
    echo 'Method not allowed';
    exit();
}

$token = (string) ($_GET['t'] ?? $_POST['t'] ?? '');
if ($token === '') {
    http_response_code(400);
    renderPage('Invalid link', 'This unsubscribe link is missing its token.');
    exit();
}

$parsed = parseUnsubscribeToken($token);
if ($parsed === null) {
    http_response_code(400);
    renderPage('Invalid link', "This unsubscribe link couldn't be verified. It may have been copied incorrectly.");
    exit();
}
[$campaignId, $recipientId] = $parsed;

$stmt = $db->prepare(
    "SELECT r.*, c.channel, c.name AS campaign_name
       FROM marketing_campaign_recipients r
       JOIN marketing_campaigns c ON c.id = r.campaign_id
      WHERE r.id = :rid AND r.campaign_id = :cid"
);
$stmt->execute([':rid' => $recipientId, ':cid' => $campaignId]);
$recipient = $stmt->fetch();
if (!$recipient) {
    http_response_code(404);
    renderPage('Not found', 'This unsubscribe link does not match any recipient.');
    exit();
}

$identifierType = $recipient['channel'] === 'email' ? 'email' : 'phone';
$identifier     = normalizeContactIdentifier($identifierType, (string) $recipient['resolved_to']);

try {
    $db->beginTransaction();
    $db->prepare(
        'INSERT IGNORE INTO marketing_suppressions (identifier_type, identifier, reason, source_campaign_id, source_lead_id)
         VALUES (:t, :i, "unsubscribe", :c, :l)'
    )->execute([
        ':t' => $identifierType,
        ':i' => $identifier,
        ':c' => $campaignId,
        ':l' => (int) $recipient['imported_lead_id'],
    ]);

    // Mark this recipient as opted_out if not already sent (keep sent history intact).
    $db->prepare(
        "UPDATE marketing_campaign_recipients
            SET send_status = CASE
                  WHEN send_status IN ('sent','bounced','replied') THEN send_status
                  ELSE 'opted_out'
                END
          WHERE id = :id"
    )->execute([':id' => $recipientId]);

    // Activity + audit.
    logLeadActivity(
        $db, (int) $recipient['imported_lead_id'], 0, 'opted_out', null,
        ['campaign_id' => $campaignId, 'campaign_name' => $recipient['campaign_name'], 'reason' => 'unsubscribe']
    );
    $db->commit();
} catch (Throwable $e) {
    $db->rollBack();
    http_response_code(500);
    renderPage('Something went wrong', "We couldn't record your opt-out. Please reply to the original message and we'll remove you manually.");
    exit();
}

renderPage(
    "You're unsubscribed",
    "We've removed " . htmlspecialchars($recipient['resolved_to']) . " from our marketing list. You won't hear from us again."
);

function renderPage(string $title, string $message): void
{
    header('Content-Type: text/html; charset=UTF-8');
    $t = htmlspecialchars($title);
    $m = $message; // already sanitized
    echo <<<HTML
<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>$t</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body { font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; background:#f8f9fc; color:#1f2937; margin:0; padding:48px 16px; }
  .card { max-width: 440px; margin: 40px auto; background:#fff; border:1px solid #e5e7eb; border-radius:16px; padding:32px; box-shadow: 0 1px 3px rgba(0,0,0,0.04); text-align:center; }
  h1 { font-size: 20px; margin: 0 0 12px; color:#111827; }
  p { color:#4b5563; line-height:1.5; margin: 0; }
</style>
</head><body>
  <div class="card">
    <h1>$t</h1>
    <p>$m</p>
  </div>
</body></html>
HTML;
}

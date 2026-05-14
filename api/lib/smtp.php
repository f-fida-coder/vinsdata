<?php
// Minimal SMTP client. Just enough to send a single message through
// Gmail's submission server (or any other RFC 5321/5322 SMTP relay
// that supports STARTTLS + AUTH LOGIN). No Composer required.
//
// Usage:
//   sendSmtpMessage([
//     'host' => 'smtp.gmail.com', 'port' => 587,
//     'username' => 'crm@vinvault.us', 'password' => 'xxxx-xxxx-xxxx-xxxx',
//     'from_email' => 'crm@vinvault.us', 'from_name' => 'Vin Vault',
//     'to' => 'lead@example.com',
//     'subject' => 'Quick question about your truck',
//     'body_text' => 'Hi there...',
//   ]);
// Returns ['ok' => bool, 'message_id' => string|null, 'error' => string|null].
//
// Why hand-rolled instead of PHPMailer: shared Hostinger PHP doesn't have
// Composer wired up, the project ships zero PHP deps today, and we only
// need plain-text email + a single recipient. ~120 lines is cheaper than
// the dependency footprint.

class SmtpException extends RuntimeException {}

function sendSmtpMessage(array $opts): array
{
    $host = $opts['host']     ?? 'smtp.gmail.com';
    $port = (int) ($opts['port'] ?? 587);
    $user = $opts['username'] ?? '';
    $pass = $opts['password'] ?? '';
    $fromEmail = $opts['from_email'] ?? $user;
    $fromName  = $opts['from_name']  ?? '';
    $to        = $opts['to']         ?? '';
    $subject   = $opts['subject']    ?? '(no subject)';
    $bodyText  = $opts['body_text']  ?? '';
    $bodyHtml  = $opts['body_html']  ?? null;
    $timeout   = (int) ($opts['timeout'] ?? 20);

    if ($host === '' || $user === '' || $pass === '' || $to === '' || $bodyText === '') {
        return ['ok' => false, 'error' => 'smtp_missing_required_fields'];
    }

    // 1. Connect plaintext (Gmail submission opens plaintext, then upgrades
    //    via STARTTLS — this is the standard MSA flow on port 587).
    $errno  = 0;
    $errstr = '';
    $sock = @stream_socket_client("tcp://$host:$port", $errno, $errstr, $timeout);
    if (!$sock) {
        return ['ok' => false, 'error' => "smtp_connect_failed: $errstr ($errno)"];
    }
    stream_set_timeout($sock, $timeout);

    try {
        smtpExpect($sock, 220);
        smtpCmd($sock, 'EHLO ' . smtpHelo(), 250);
        smtpCmd($sock, 'STARTTLS', 220);

        // 2. Upgrade to TLS in place. Gmail requires TLS 1.2+; modern OpenSSL
        //    negotiates that automatically.
        if (!stream_socket_enable_crypto(
            $sock,
            true,
            STREAM_CRYPTO_METHOD_TLS_CLIENT
                | STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT
                | STREAM_CRYPTO_METHOD_TLSv1_3_CLIENT
        )) {
            return ['ok' => false, 'error' => 'smtp_tls_handshake_failed'];
        }

        // 3. After STARTTLS we MUST re-EHLO; the server forgets prior state.
        smtpCmd($sock, 'EHLO ' . smtpHelo(), 250);

        // 4. AUTH LOGIN — the simplest auth mechanism Gmail supports.
        smtpCmd($sock, 'AUTH LOGIN', 334);
        smtpCmd($sock, base64_encode($user), 334);
        smtpCmd($sock, base64_encode($pass), 235);

        // 5. Envelope.
        smtpCmd($sock, 'MAIL FROM:<' . $fromEmail . '>', 250);
        smtpCmd($sock, 'RCPT TO:<' . $to . '>', [250, 251]);

        // 6. Headers + body.
        smtpCmd($sock, 'DATA', 354);

        $messageId = sprintf(
            '<%s.%s@%s>',
            bin2hex(random_bytes(8)),
            time(),
            preg_replace('/[^a-zA-Z0-9.\-]/', '', explode('@', $fromEmail)[1] ?? 'localhost')
        );

        $fromHeader = $fromName !== ''
            ? smtpEncodeHeader($fromName) . ' <' . $fromEmail . '>'
            : $fromEmail;

        $headers = [
            'From: ' . $fromHeader,
            'To: ' . $to,
            'Subject: ' . smtpEncodeHeader($subject),
            'Date: ' . gmdate('r'),
            'Message-ID: ' . $messageId,
            'MIME-Version: 1.0',
        ];

        if ($bodyHtml === null) {
            $headers[] = 'Content-Type: text/plain; charset=UTF-8';
            $headers[] = 'Content-Transfer-Encoding: 8bit';
            $body = smtpDotStuff($bodyText);
        } else {
            // multipart/alternative — text fallback first, then HTML.
            $boundary = 'b_' . bin2hex(random_bytes(8));
            $headers[] = 'Content-Type: multipart/alternative; boundary="' . $boundary . '"';
            $body = "--$boundary\r\n"
                  . "Content-Type: text/plain; charset=UTF-8\r\n"
                  . "Content-Transfer-Encoding: 8bit\r\n\r\n"
                  . smtpDotStuff($bodyText) . "\r\n"
                  . "--$boundary\r\n"
                  . "Content-Type: text/html; charset=UTF-8\r\n"
                  . "Content-Transfer-Encoding: 8bit\r\n\r\n"
                  . smtpDotStuff($bodyHtml) . "\r\n"
                  . "--$boundary--\r\n";
        }

        $payload = implode("\r\n", $headers) . "\r\n\r\n" . $body . "\r\n.\r\n";
        smtpWrite($sock, $payload);
        smtpExpect($sock, 250);

        smtpCmd($sock, 'QUIT', [221, 250]);
        return ['ok' => true, 'message_id' => $messageId];
    } catch (SmtpException $e) {
        return ['ok' => false, 'error' => $e->getMessage()];
    } finally {
        @fclose($sock);
    }
}

function smtpHelo(): string
{
    $host = $_SERVER['SERVER_NAME'] ?? gethostname() ?: 'localhost';
    return preg_match('/^[A-Za-z0-9.\-]+$/', $host) ? $host : 'localhost';
}

function smtpEncodeHeader(string $value): string
{
    // RFC 2047 if not pure ASCII.
    return preg_match('/[\x80-\xff]/', $value)
        ? '=?UTF-8?B?' . base64_encode($value) . '?='
        : $value;
}

function smtpDotStuff(string $body): string
{
    // RFC 5321 §4.5.2: lines starting with "." in the body must be doubled.
    $body = str_replace("\r\n", "\n", str_replace("\r", "\n", $body));
    $body = str_replace("\n", "\r\n", $body);
    return preg_replace('/^\./m', '..', $body);
}

function smtpWrite($sock, string $data): void
{
    if (fwrite($sock, $data) === false) {
        throw new SmtpException('smtp_write_failed');
    }
}

function smtpReadResponse($sock): array
{
    $lines = [];
    while (!feof($sock)) {
        $line = fgets($sock, 1024);
        if ($line === false) {
            $info = stream_get_meta_data($sock);
            $why = !empty($info['timed_out']) ? 'timeout' : 'eof';
            throw new SmtpException("smtp_read_failed_$why");
        }
        $lines[] = rtrim($line, "\r\n");
        // Continuation lines have a "-" after the code; final line uses " ".
        if (strlen($line) >= 4 && $line[3] === ' ') break;
    }
    if (empty($lines)) {
        throw new SmtpException('smtp_empty_response');
    }
    $code = (int) substr($lines[0], 0, 3);
    return ['code' => $code, 'lines' => $lines];
}

function smtpExpect($sock, $expected): array
{
    $resp = smtpReadResponse($sock);
    $allowed = is_array($expected) ? $expected : [$expected];
    if (!in_array($resp['code'], $allowed, true)) {
        throw new SmtpException('smtp_unexpected_response: ' . implode(' | ', $resp['lines']));
    }
    return $resp;
}

function smtpCmd($sock, string $cmd, $expected): array
{
    smtpWrite($sock, $cmd . "\r\n");
    return smtpExpect($sock, $expected);
}

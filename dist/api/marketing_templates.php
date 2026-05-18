<?php

require_once __DIR__ . '/config.php';
require_once __DIR__ . '/pipeline.php';
initSession();

$user = requireAuth();
$db   = getDBConnection();

/** Extract {{variable}} tokens from a body string. */
function extractTemplateVariables(string $body): array
{
    preg_match_all('/\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}/i', $body, $m);
    return array_values(array_unique(array_map('strtolower', $m[1] ?? [])));
}

function formatTemplate(array $row): array
{
    return [
        'id'          => (int) $row['id'],
        'name'        => $row['name'],
        'channel'     => $row['channel'],
        'subject'     => $row['subject'],
        'body'        => $row['body'],
        'variables'   => json_decode($row['variables_json'] ?? 'null', true) ?? [],
        'is_active'   => (int) $row['is_active'] === 1,
        'created_by'  => $row['created_by'] !== null ? (int) $row['created_by'] : null,
        'created_at'  => $row['created_at'],
        'updated_at'  => $row['updated_at'],
    ];
}

function loadTemplateOrFail(PDO $db, int $id): array
{
    $stmt = $db->prepare('SELECT * FROM marketing_templates WHERE id = :id');
    $stmt->execute([':id' => $id]);
    $row = $stmt->fetch();
    if (!$row) pipelineFail(404, 'Template not found', 'template_not_found');
    return $row;
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    if (isset($_GET['id'])) {
        echo json_encode(formatTemplate(loadTemplateOrFail($db, (int) $_GET['id'])));
        exit();
    }
    $sql = 'SELECT * FROM marketing_templates WHERE 1=1';
    $params = [];
    if (!empty($_GET['channel'])) {
        assertMarketingChannel($_GET['channel']);
        $sql .= ' AND channel = :ch';
        $params[':ch'] = $_GET['channel'];
    }
    if (isset($_GET['active'])) {
        $sql .= ' AND is_active = :act';
        $params[':act'] = $_GET['active'] === '0' ? 0 : 1;
    }
    $sql .= ' ORDER BY channel, name';
    $stmt = $db->prepare($sql);
    $stmt->execute($params);
    echo json_encode(array_map('formatTemplate', $stmt->fetchAll()));
    exit();
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    assertAdminOrMarketer($user);
    $input = json_decode(file_get_contents('php://input'), true) ?? [];

    $name    = trim((string) ($input['name']    ?? ''));
    $channel = (string)       ($input['channel'] ?? '');
    $subject = isset($input['subject']) ? trim((string) $input['subject']) : null;
    $body    = (string)       ($input['body']    ?? '');

    if ($name === '')              pipelineFail(400, 'name is required',    'missing_fields');
    if (mb_strlen($name) > 128)    pipelineFail(400, 'name too long',       'name_too_long');
    assertMarketingChannel($channel);
    if ($body === '')              pipelineFail(400, 'body is required',    'missing_fields');
    if ($channel === 'email' && (!$subject || $subject === '')) {
        pipelineFail(400, 'subject is required for email templates', 'missing_fields');
    }
    if ($subject !== null && mb_strlen($subject) > 255) {
        pipelineFail(400, 'subject too long', 'subject_too_long');
    }

    $vars = extractTemplateVariables($body . ' ' . ($subject ?? ''));
    try {
        $stmt = $db->prepare(
            'INSERT INTO marketing_templates (name, channel, subject, body, variables_json, is_active, created_by)
             VALUES (:name, :ch, :sub, :body, :vars, 1, :by)'
        );
        $stmt->execute([
            ':name' => $name,
            ':ch'   => $channel,
            ':sub'  => $subject,
            ':body' => $body,
            ':vars' => json_encode($vars),
            ':by'   => $user['id'],
        ]);
    } catch (PDOException $e) {
        if ($e->getCode() === '23000') {
            pipelineFail(409, "A $channel template named '$name' already exists", 'template_name_conflict');
        }
        throw $e;
    }
    $id = (int) $db->lastInsertId();
    echo json_encode(formatTemplate(loadTemplateOrFail($db, $id)));
    exit();
}

if ($_SERVER['REQUEST_METHOD'] === 'PATCH' || $_SERVER['REQUEST_METHOD'] === 'PUT') {
    assertAdminOrMarketer($user);
    $input = json_decode(file_get_contents('php://input'), true) ?? [];
    $id = (int) ($input['id'] ?? 0);
    if ($id <= 0) pipelineFail(400, 'id is required', 'missing_fields');

    $row = loadTemplateOrFail($db, $id);

    $fields = [];
    $params = [':id' => $id];

    if (array_key_exists('name', $input)) {
        $name = trim((string) $input['name']);
        if ($name === '')            pipelineFail(400, 'name cannot be empty', 'missing_fields');
        if (mb_strlen($name) > 128)  pipelineFail(400, 'name too long',       'name_too_long');
        $fields[] = 'name = :name'; $params[':name'] = $name;
    }
    if (array_key_exists('subject', $input)) {
        $subject = $input['subject'] === null ? null : trim((string) $input['subject']);
        if ($subject !== null && mb_strlen($subject) > 255) {
            pipelineFail(400, 'subject too long', 'subject_too_long');
        }
        $fields[] = 'subject = :sub'; $params[':sub'] = $subject;
    }
    if (array_key_exists('body', $input)) {
        $body = (string) $input['body'];
        if ($body === '') pipelineFail(400, 'body cannot be empty', 'missing_fields');
        $fields[] = 'body = :body';         $params[':body'] = $body;
        $fields[] = 'variables_json = :vars';
        $params[':vars'] = json_encode(extractTemplateVariables($body . ' ' . ($input['subject'] ?? $row['subject'] ?? '')));
    }
    if (array_key_exists('is_active', $input)) {
        $fields[] = 'is_active = :act'; $params[':act'] = $input['is_active'] ? 1 : 0;
    }
    if (empty($fields)) pipelineFail(400, 'No changes provided', 'no_changes');

    try {
        $stmt = $db->prepare('UPDATE marketing_templates SET ' . implode(', ', $fields) . ' WHERE id = :id');
        $stmt->execute($params);
    } catch (PDOException $e) {
        if ($e->getCode() === '23000') pipelineFail(409, 'Template name already exists', 'template_name_conflict');
        throw $e;
    }
    echo json_encode(formatTemplate(loadTemplateOrFail($db, $id)));
    exit();
}

if ($_SERVER['REQUEST_METHOD'] === 'DELETE') {
    assertAdminOrMarketer($user);
    $input = json_decode(file_get_contents('php://input'), true) ?? [];
    $id = (int) ($input['id'] ?? $_GET['id'] ?? 0);
    if ($id <= 0) pipelineFail(400, 'id is required', 'missing_fields');
    loadTemplateOrFail($db, $id);
    $stmt = $db->prepare('DELETE FROM marketing_templates WHERE id = :id');
    $stmt->execute([':id' => $id]);
    echo json_encode(['success' => true, 'id' => $id]);
    exit();
}

pipelineFail(405, 'Method not allowed', 'method_not_allowed');

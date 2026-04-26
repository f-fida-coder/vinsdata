<?php
// SLA / stale-lead helpers — rule evaluation and alert resolution.
//
// Evaluation: for every active sla_rule, find leads matching the predicate
// (temperature filter, status filter) that have no `lead_activities` row in
// the configured window. Insert a row into `sla_alerts` for each match
// (skipping leads that already have an unresolved alert for the same rule).
//
// Resolution: any time an activity is logged for a lead, all open alerts
// for that lead get resolved_at set.
//
// Idempotent. Safe to re-run.

require_once __DIR__ . '/pipeline.php';

const SLA_NOTIFY_ROLES = ['admin', 'marketer', 'carfax', 'filter', 'tlo'];

function loadActiveSlaRules(PDO $db): array
{
    $stmt = $db->query(
        'SELECT id, name, if_temperature_in, if_status_in, if_no_activity_for_days,
                notify_assignee, notify_role
           FROM sla_rules
          WHERE active = 1
          ORDER BY id'
    );
    $rules = [];
    foreach ($stmt->fetchAll() as $r) {
        $rules[] = [
            'id'                  => (int) $r['id'],
            'name'                => $r['name'],
            'temperatures'        => json_decode((string) ($r['if_temperature_in'] ?? 'null'), true),
            'statuses'            => json_decode((string) ($r['if_status_in']      ?? 'null'), true),
            'days'                => (int) $r['if_no_activity_for_days'],
            'notify_assignee'     => (int) $r['notify_assignee'] === 1,
            'notify_role'         => $r['notify_role'],
        ];
    }
    return $rules;
}

/**
 * Evaluate all active SLA rules. Returns a summary:
 *   ['rules_evaluated' => N, 'alerts_fired' => M, 'matches' => [...]]
 *
 * Each match is the new alert row (id, rule_id, imported_lead_id) for any
 * downstream notification dispatcher to act on.
 */
function evaluateSlaRules(PDO $db): array
{
    $rules = loadActiveSlaRules($db);
    $fired = 0;
    $matches = [];

    foreach ($rules as $rule) {
        $where = ['lead.import_status = \'imported\''];
        $params = [':days' => $rule['days']];

        if (is_array($rule['temperatures']) && count($rule['temperatures']) > 0) {
            // JSON_CONTAINS handles each member; OR them.
            $or = [];
            foreach ($rule['temperatures'] as $i => $t) {
                $key = ":temp$i";
                $or[] = "s.lead_temperature = $key";
                $params[$key] = $t;
            }
            $where[] = '(' . implode(' OR ', $or) . ')';
        }

        if (is_array($rule['statuses']) && count($rule['statuses']) > 0) {
            $or = [];
            foreach ($rule['statuses'] as $i => $st) {
                $key = ":st$i";
                $or[] = "s.status = $key";
                $params[$key] = $st;
            }
            $where[] = '(' . implode(' OR ', $or) . ')';
        }

        // No activity in last N days.
        $where[] = 'NOT EXISTS (
            SELECT 1 FROM lead_activities a
             WHERE a.imported_lead_id = lead.id
               AND a.created_at >= DATE_SUB(NOW(), INTERVAL :days DAY)
        )';

        // Skip leads that already have an open alert for this rule.
        $where[] = 'NOT EXISTS (
            SELECT 1 FROM sla_alerts open_a
             WHERE open_a.rule_id = :rule_id
               AND open_a.imported_lead_id = lead.id
               AND open_a.resolved_at IS NULL
        )';
        $params[':rule_id'] = $rule['id'];

        $sql = 'SELECT lead.id AS lead_id
                  FROM imported_leads_raw lead
                  JOIN lead_states s ON s.imported_lead_id = lead.id
                 WHERE ' . implode(' AND ', $where);

        $stmt = $db->prepare($sql);
        $stmt->execute($params);

        $insert = $db->prepare(
            'INSERT INTO sla_alerts (rule_id, imported_lead_id) VALUES (:rule, :lead)'
        );
        foreach ($stmt->fetchAll() as $row) {
            $insert->execute([':rule' => $rule['id'], ':lead' => $row['lead_id']]);
            $matches[] = [
                'alert_id' => (int) $db->lastInsertId(),
                'rule_id'  => $rule['id'],
                'lead_id'  => (int) $row['lead_id'],
            ];
            $fired++;
        }
    }

    return [
        'rules_evaluated' => count($rules),
        'alerts_fired'    => $fired,
        'matches'         => $matches,
    ];
}

/**
 * Mark every open SLA alert for a given lead as resolved. Called after any
 * activity is logged on the lead so subsequent evaluations re-fire only if
 * the lead goes stale again.
 */
function resolveSlaAlertsForLead(PDO $db, int $importedLeadId, string $reason = 'activity'): int
{
    $stmt = $db->prepare(
        'UPDATE sla_alerts
            SET resolved_at = NOW(),
                resolved_reason = :reason
          WHERE imported_lead_id = :lead
            AND resolved_at IS NULL'
    );
    $stmt->execute([':lead' => $importedLeadId, ':reason' => $reason]);
    return $stmt->rowCount();
}

/**
 * Quick count of unresolved alerts for the dashboard badge.
 * Optionally scoped to a single user (their assigned leads only).
 */
function countOpenSlaAlerts(PDO $db, ?int $assignedUserId = null): int
{
    if ($assignedUserId === null) {
        $stmt = $db->query(
            'SELECT COUNT(*) FROM sla_alerts a WHERE a.resolved_at IS NULL'
        );
        return (int) $stmt->fetchColumn();
    }
    $stmt = $db->prepare(
        'SELECT COUNT(*)
           FROM sla_alerts a
           JOIN lead_states s ON s.imported_lead_id = a.imported_lead_id
          WHERE a.resolved_at IS NULL
            AND s.assigned_user_id = :u'
    );
    $stmt->execute([':u' => $assignedUserId]);
    return (int) $stmt->fetchColumn();
}

#!/usr/bin/env python3
"""
Backfill the canonical vehicles_v2 table from existing v1 data.

Reads:  imported_leads_raw + lead_states
Writes: vehicles_v2 (one row per unique VIN), vehicle_imports (provenance)

Usage:
    python scripts/backfill_vehicles_v2.py                # dry-run, prints report
    python scripts/backfill_vehicles_v2.py --commit       # actually inserts

Dry-run never touches the DB. It runs the full grouping logic and
prints exactly what would be inserted plus a collision/quality report.
Re-running --commit is safe: it INSERT IGNOREs on the unique VIN, so
already-backfilled rows stay put.

Connection details come from api/config.local.php (parsed crudely with
regex). Use --host/--user/--password/--db to override.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

import pymysql
from pymysql.constants import CLIENT


# ----- Field-promotion mapping --------------------------------------------------

# Each tuple: (vehicles_v2 column, source - either 'norm:<col>' on
# imported_leads_raw, 'payload:<key>' from JSON, or 'state:<col>' on
# lead_states). Order = priority within a row; first non-empty wins.
PROMOTION_RULES: dict[str, list[str]] = {
    'year':                ['norm:norm_year',  'payload:year'],
    'make':                ['norm:norm_make',  'payload:make'],
    'model':               ['norm:norm_model', 'payload:model'],
    'trim':                ['payload:trim'],
    'mileage':             ['payload:mileage', 'payload:LastReportedMiles'],
    'vehicle_condition':   ['payload:condition'],

    'owner_first_name':    ['payload:first_name'],
    'owner_last_name':     ['payload:last_name'],
    'owner_full_address':  ['payload:full_address'],
    'owner_city':          ['payload:city'],
    'owner_state':         ['norm:norm_state', 'payload:state'],
    'owner_zip':           ['payload:zip_code'],
    'owner_phone':         ['norm:norm_phone_primary', 'payload:phone_primary'],
    'owner_email':         ['norm:norm_email_primary', 'payload:email_primary'],

    'data_stage':          ['imports:source_stage'],   # carfax/filter/tlo from the batch row
    'lead_temperature':    ['state:lead_temperature'],
    'priority':            ['state:priority'],
    'lead_status':         ['state:status'],
    'assigned_user_id':    ['state:assigned_user_id'],
    'asking_price':        ['state:price_wanted'],
    'offer_price':         ['state:price_offered'],
}


def read_creds_from_config() -> dict[str, str]:
    cfg = Path(__file__).resolve().parent.parent / 'api' / 'config.local.php'
    if not cfg.exists():
        sys.exit(f'Could not find {cfg}. Pass --host/--user/--password/--db instead.')
    text = cfg.read_text(encoding='utf-8')
    out = {}
    for key, define in [('host', 'DB_HOST'), ('db', 'DB_NAME'), ('user', 'DB_USER'), ('password', 'DB_PASS')]:
        m = re.search(rf"define\(\s*'{define}'\s*,\s*'([^']*)'\s*\)", text)
        if not m:
            sys.exit(f'Could not parse {define} from {cfg}')
        out[key] = m.group(1)
    return out


def fetch_v1_rows(conn: pymysql.connections.Connection) -> list[dict[str, Any]]:
    """One row per (imported_lead, optional lead_state, batch.source_stage)."""
    sql = '''
        SELECT  r.id            AS lead_id,
                r.norm_vin,
                r.norm_make, r.norm_model, r.norm_year, r.norm_state,
                r.norm_phone_primary, r.norm_email_primary,
                r.normalized_payload_json,
                r.import_status,
                r.created_at    AS imported_at,
                b.source_stage,
                b.batch_name,
                b.id            AS batch_id,
                s.status        AS lead_status,
                s.priority,
                s.lead_temperature,
                s.assigned_user_id,
                s.price_wanted,
                s.price_offered
        FROM    imported_leads_raw r
        JOIN    lead_import_batches b ON b.id = r.batch_id
        LEFT JOIN lead_states     s ON s.imported_lead_id = r.id
        WHERE   r.import_status = 'imported'
          AND   r.norm_vin IS NOT NULL
          AND   r.norm_vin <> ''
    '''
    with conn.cursor(pymysql.cursors.DictCursor) as cur:
        cur.execute(sql)
        return cur.fetchall()


def completeness_score(row: dict[str, Any]) -> int:
    """How 'rich' is this row? Used to pick a winner per VIN on collision."""
    payload = json.loads(row.get('normalized_payload_json') or '{}') if row.get('normalized_payload_json') else {}
    score = 0
    for key in ('norm_phone_primary', 'norm_email_primary', 'norm_make', 'norm_model', 'norm_year', 'norm_state'):
        if row.get(key):
            score += 1
    for key in ('first_name', 'last_name', 'full_address', 'city', 'zip_code', 'mileage', 'phone_secondary'):
        if payload.get(key):
            score += 1
    # Carfax/TLO stages typically carry richer data than 'generated'.
    score += {'tlo': 4, 'filter': 3, 'carfax': 2, 'generated': 1}.get(row.get('source_stage') or '', 0)
    # Assigned/priced leads have human-curated state — prefer them.
    if row.get('assigned_user_id'): score += 2
    if row.get('price_wanted') is not None or row.get('price_offered') is not None: score += 1
    return score


def resolve_value(rule: str, row: dict[str, Any], payload: dict[str, Any]) -> Any:
    if rule.startswith('norm:'):
        return row.get(rule[len('norm:'):])
    if rule.startswith('payload:'):
        return payload.get(rule[len('payload:'):])
    if rule.startswith('state:'):
        return row.get(rule[len('state:'):])
    if rule.startswith('imports:'):
        return row.get(rule[len('imports:'):])
    return None


def build_vehicle_record(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Pick the winning row, then layer in non-empty fallbacks from siblings."""
    rows_sorted = sorted(rows, key=completeness_score, reverse=True)
    winner = rows_sorted[0]
    winner_payload = json.loads(winner.get('normalized_payload_json') or '{}') if winner.get('normalized_payload_json') else {}

    record: dict[str, Any] = {'vin': winner['norm_vin']}
    for col, ladder in PROMOTION_RULES.items():
        for rule in ladder:
            v = resolve_value(rule, winner, winner_payload)
            if v not in (None, '', 0) or (col == 'assigned_user_id' and v is not None):
                record[col] = v
                break
        if col not in record:
            # Try sibling rows.
            for sib in rows_sorted[1:]:
                sib_payload = json.loads(sib.get('normalized_payload_json') or '{}') if sib.get('normalized_payload_json') else {}
                for rule in ladder:
                    v = resolve_value(rule, sib, sib_payload)
                    if v not in (None, ''):
                        record[col] = v
                        break
                if col in record:
                    break
        record.setdefault(col, None)

    # Map normalization for known oddballs:
    if record.get('data_stage') not in (None, 'generated', 'carfax', 'filter', 'tlo'):
        record['data_stage'] = 'generated'
    if not record.get('data_stage'):
        record['data_stage'] = 'generated'

    record['source']         = winner.get('source_stage')
    record['date_imported']  = winner.get('imported_at')
    record['list_name']      = winner.get('batch_name')

    return record


def insert_vehicle(conn, record: dict[str, Any]) -> int | None:
    cols = [k for k, v in record.items() if v is not None]
    placeholders = ', '.join(['%s'] * len(cols))
    sql = (
        'INSERT IGNORE INTO vehicles_v2 ('
        + ', '.join(cols)
        + ') VALUES (' + placeholders + ')'
    )
    with conn.cursor() as cur:
        cur.execute(sql, [record[c] for c in cols])
        if cur.rowcount == 0:
            return None  # already there
        return cur.lastrowid


def insert_provenance(conn, vehicle_id: int, lead_ids: list[int], rows_by_lead: dict[int, dict[str, Any]]):
    rows = [
        (vehicle_id, lead_id, rows_by_lead[lead_id].get('batch_id'))
        for lead_id in lead_ids
    ]
    with conn.cursor() as cur:
        cur.executemany(
            'INSERT IGNORE INTO vehicle_imports (vehicle_id, imported_lead_id, batch_id) VALUES (%s, %s, %s)',
            rows,
        )


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--commit', action='store_true', help='Actually write to the DB. Default is dry-run.')
    p.add_argument('--host'); p.add_argument('--user'); p.add_argument('--password'); p.add_argument('--db')
    args = p.parse_args()

    creds = read_creds_from_config()
    for k in ('host', 'user', 'password', 'db'):
        if getattr(args, k):
            creds[k] = getattr(args, k)

    conn = pymysql.connect(
        host=creds['host'], user=creds['user'], password=creds['password'],
        database=creds['db'], client_flag=CLIENT.MULTI_STATEMENTS, charset='utf8mb4', autocommit=False,
    )

    print(f'Connected to {creds["host"]}/{creds["db"]}.')
    rows = fetch_v1_rows(conn)
    print(f'Loaded {len(rows)} v1 lead rows with non-empty VINs.')

    # Group by VIN.
    by_vin: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for r in rows:
        by_vin[r['norm_vin']].append(r)

    print(f'Unique VINs: {len(by_vin)}')

    collisions = sum(1 for v in by_vin.values() if len(v) > 1)
    print(f'VINs with >1 source row (collisions resolved by completeness score): {collisions}')

    stage_dist = Counter(r.get('source_stage') for r in rows)
    print(f'Source-stage distribution: {dict(stage_dist)}')

    rows_by_lead = {r['lead_id']: r for r in rows}

    if not args.commit:
        # Just preview the first three records as a sanity check.
        print('\nSample of records that WOULD be inserted into vehicles_v2:')
        for vin, group in list(by_vin.items())[:3]:
            rec = build_vehicle_record(group)
            print(f'  VIN {vin}:')
            for k in ('year', 'make', 'model', 'owner_first_name', 'owner_last_name',
                      'owner_phone', 'owner_email', 'data_stage', 'lead_temperature'):
                v = rec.get(k)
                if v is not None:
                    print(f'    {k}: {v}')
            print(f'    (will link {len(group)} provenance rows)')
        print(f'\nDry run complete — no changes made. Pass --commit to actually insert.')
        return

    # Real run.
    inserted = 0
    skipped  = 0
    linked   = 0
    for vin, group in by_vin.items():
        rec = build_vehicle_record(group)
        vid = insert_vehicle(conn, rec)
        if vid is None:
            # Already exists. Look it up so we still write provenance.
            with conn.cursor() as cur:
                cur.execute('SELECT id FROM vehicles_v2 WHERE vin = %s', (vin,))
                got = cur.fetchone()
                if not got:
                    skipped += 1
                    continue
                vid = got[0]
        else:
            inserted += 1
        insert_provenance(conn, vid, [r['lead_id'] for r in group], rows_by_lead)
        linked += len(group)

        if (inserted + skipped) % 1000 == 0:
            conn.commit()
            print(f'  ...processed {inserted + skipped} VINs')

    conn.commit()
    conn.close()
    print(f'\nDone. Inserted {inserted} new vehicles_v2 rows, linked {linked} provenance rows.')
    print('You can re-run with --commit safely; INSERT IGNORE makes it idempotent.')


if __name__ == '__main__':
    main()

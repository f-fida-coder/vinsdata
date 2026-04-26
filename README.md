# Vin Vault — Internal CRM

A two-section internal CRM for off-market vehicle sourcing. Used by a small team to ingest VIN lists, enrich them, find owners, run outreach, and close acquisitions for resale.

**Live:** [crm.vinvault.us](https://crm.vinvault.us)
**Brand site:** [vinvault.us](https://vinvault.us)
**Audit + roadmap:** see [`AUDIT.md`](./AUDIT.md) and [`ROADMAP.md`](./ROADMAP.md).
**Data model v2 design:** [`docs/data-model-v2.md`](./docs/data-model-v2.md).

---

## What it does

Two conceptually separate sections share one database, one auth, one design system:

- **`/intake`** — data pipeline. Raw VIN lists come in; each VIN moves through four enrichment stages (Generated → Carfax → Filter → TLO). Operators upload Carfax / TLO export files; the app matches rows back to VINs. The Filter stage runs admin-defined predicate rules and surfaces flagged leads to a manual review queue.
- **`/pipeline`** — lead tracking. Once enriched, leads carry a temperature (No Answer → Cold → Warm → Hot → Closed) independent of their data stage. Operators run outreach (email + SMS — phase 4), log contacts, set tasks, and close deals.

The same VIN record participates in both sections. See `docs/data-model-v2.md` for the canonical Vehicle-by-VIN model.

---

## Stack

| Layer | Tech |
| --- | --- |
| Frontend | React 19 + React Router 7 + Vite 8 + Tailwind 3 |
| Backend | PHP 8.3+ (flat endpoint files under `api/`) |
| DB | MySQL 8 (Hostinger shared) |
| Auth | PHP sessions + CSRF token (X-CSRF-Token header) |
| Hosting | Hostinger shared hosting; LiteSpeed + `.htaccess` rewrites |
| Build | `vite build` + `scripts/copy-api-to-dist.mjs` produces a self-contained `dist/` |
| Fonts | Manrope (UI) + Geist Mono (mono) — loaded from Google Fonts |

---

## Run locally

### Prerequisites

- Node 20+ (verified on 24)
- PHP 8.3+ (`winget install PHP.PHP.8.3` on Windows)
- Network access to the Hostinger MySQL host (or any MySQL server you point at)

### One-time setup

```bash
npm install
```

Make sure `api/config.local.php` exists with valid DB credentials. The repo currently commits this file (see the `.gitignore` note); if you ever rotate the password, update it both in the DB and in this file. Template lives at `api/config.local.php.example`.

PHP needs a couple of extensions enabled. The `.claude/php.ini` we ship is what the dev script uses on Windows. On macOS / Linux, edit your existing php.ini to enable: `pdo_mysql`, `mbstring`, `fileinfo`, `openssl`, `curl`.

### Dev loop

```bash
npm run dev
```

Concurrently runs Vite on `http://localhost:5173` and PHP's built-in server on `http://localhost:8001`. Vite proxies `/api/*` to the PHP server with `.php` automatically appended (so `/api/leads` hits `api/leads.php`).

The dev backend talks to the **production database**. Be careful — changing a lead's status on localhost mutates the live record.

### Running migrations

Migration files live in `api/migrations/`. They are idempotent (each one wraps its DDL in an `information_schema` check). Apply them in numerical order against the target database.

Easiest path on Hostinger: phpMyAdmin → SQL tab → paste the file → run.

To run from a local Python script (when MySQL is reachable from your machine):

```python
import pymysql
from pymysql.constants import CLIENT
from pathlib import Path

conn = pymysql.connect(
    host='srv2052.hstgr.io',
    user='u487877829_vinsdata',
    password='...',
    database='u487877829_vins_data',
    client_flag=CLIENT.MULTI_STATEMENTS,
    charset='utf8mb4',
    autocommit=True,
)
sql = Path('api/migrations/0XX_xxx.sql').read_text(encoding='utf-8')
with conn.cursor() as cur:
    cur.execute(sql)
    while cur.nextset(): pass
```

### Linting

```bash
npm run lint
```

Test runner not yet wired up; see `ROADMAP.md` Phase 1 for the planned Vitest + PHPUnit scaffolding.

---

## Deploy to Hostinger

```bash
npm run build
```

Produces a self-contained `dist/` folder containing:

```
dist/
├── .htaccess          (security headers, CSP, SPA-fallback rewrites)
├── index.html
├── favicon.svg, icons.svg
├── assets/            (built JS + CSS bundles)
└── api/
    ├── config.php, config.local.php (yes — see .gitignore note)
    ├── *.php          (every endpoint)
    └── migrations/    (every SQL migration, for reference)
```

### Steps

1. Run any pending migrations against the target DB (see "Running migrations" above).
2. Upload the contents of `dist/` to the document root for the subdomain (in this case `crm.vinvault.us`'s docroot in Hostinger). Overwrite existing files.
3. Verify `https://crm.vinvault.us/api/me` returns 401 with the `vv_session` cookie + an `X-CSRF-Token` response header. That's the unauthenticated-but-working state.
4. Log in: `admin@vin.com` / `admin123`.

### Disaster recovery

The pre-Phase-1 backup lives as a tag on origin: `pre-phase1-rewrite-backup`. To roll back to that snapshot:

```bash
git checkout pre-phase1-rewrite-backup
npm run build
# Re-deploy the resulting dist/
```

---

## Data model overview

(Full design in [`docs/data-model-v2.md`](./docs/data-model-v2.md). Quick reference here.)

### v1 (current production)

- `users` — accounts. Roles: admin / carfax / filter / tlo / marketer. Admin = full rights; everything else = operator (can move/upload/append, can't delete entities).
- `vehicles` — file batch label (NOT a per-VIN record yet).
- `files` + `file_artifacts` + `file_stage_history` — the data-stage pipeline.
- `lead_import_batches` + `imported_leads_raw` — CSV imports normalize into one row per imported lead, with VIN, owner contact, and an arbitrary JSON payload.
- `lead_states` — 1:1 with `imported_leads_raw`. Holds the CRM hot fields: status, priority, lead_temperature, prices, assigned user.
- `lead_notes`, `lead_tasks`, `lead_contact_logs`, `lead_activities` — per-lead UX surfaces + an append-only timeline.
- `lead_duplicate_*` — dedupe scanner output + manual review.
- `filter_rules` + `filter_rule_results` — VIN Filter rule engine (Phase 3).
- `sla_rules` + `sla_alerts` — stale-lead alerts (Phase 3).
- `marketing_*` — campaigns, templates, recipients, suppressions, webhook events.
- `rate_limit_events` — sliding-window rate counter for expensive endpoints.

### v2 (shadow tables — non-destructive)

Migration 014 added three tables that are not yet wired into any code path:

- `vehicles_v2` — one row per VIN, unique constraint on VIN, all CRM fields inlined.
- `vehicle_imports` — provenance: which import batches contributed to a vehicle's row.
- `vehicle_field_changes` — append-only merge log per field mutation.

The cutover plan + reasoning: `docs/data-model-v2.md`.

---

## Two independent status axes per record

Worth reading carefully — the spec is precise here.

**Data stage** (4-step linear, file-pipeline-driven):
```
VIN Generated  →  VIN Carfax  →  VIN Filter  →  VIN TLO
```

**Lead temperature** (5-step, outreach-driven):
```
No Answer  →  Cold  →  Warm  →  Hot  →  Closed
```

A VIN can be at data-stage `tlo` (fully enriched, contactable) and at any lead-temperature. Both axes live on the same record.

---

## Required environment

`api/config.local.php` must exist on every environment with the following constants defined:

```php
<?php
define('DB_HOST', '...');
define('DB_NAME', '...');
define('DB_USER', '...');
define('DB_PASS', '...');

// Optional — enables cron access to the SLA evaluator
// define('SLA_CRON_TOKEN', 'some-long-random-string');
```

If the file is missing or any constant is undefined, `api/config.php` returns 500 with a structured JSON message saying which constant is missing.

Frontend env vars are limited:
- `BACKEND_PORT` (default 8001) — port for the PHP dev server.
- `VITE_API_TARGET` (default `http://localhost:${BACKEND_PORT}`) — where Vite proxies `/api/*`.

---

## Project layout

```
.
├── api/                    PHP backend
│   ├── config.php          loads config.local.php; security headers; CSRF
│   ├── pipeline.php        shared helpers (auth, role gates, rate limits)
│   ├── *.php               endpoint files (one per route)
│   └── migrations/         numbered SQL migrations
├── docs/                   design docs (data-model-v2, audit, roadmap)
├── public/                 static assets (favicon, brand SVGs)
├── scripts/
│   └── copy-api-to-dist.mjs  bundles api + .htaccess into dist/ on build
├── src/
│   ├── App.jsx             routes + sidebar
│   ├── api.js              axios + CSRF interceptor
│   ├── components/         shared UI (drawers, modals, brand mark)
│   ├── context/            AuthContext
│   ├── design/tokens.css   CSS variables (palette, radii, shadows, fonts)
│   ├── lib/                non-UI helpers (status palettes, formatters)
│   └── pages/              top-level routes
├── AUDIT.md
├── README.md               (this file)
└── ROADMAP.md
```

---

## Branches & contributing

Solo workflow; commits go straight to `main`. Each commit follows the convention `phase-N: <imperative summary>` with a body explaining the **why**. PRs aren't required but feel free to use them on substantive changes.

Backups via the safety tag on origin (`pre-phase1-rewrite-backup`) plus Hostinger's automated DB snapshots.

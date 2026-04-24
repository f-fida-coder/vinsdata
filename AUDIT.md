# Vin Vault CRM — Phase 0 Audit

**Author:** Claude (senior eng / product pair)
**Date:** 2026-04-24
**Scope:** Codebase inspection + data-model mapping for `f-fida-coder/vinsdata`. Live site `crm.vinvault.us` could not be exercised programmatically (React SPA, login-gated; WebFetch only sees the bundle shell). Everything below is grounded in source + DB migrations.

---

## 0. Executive summary — read this first

The prompt described Vin Vault as a "scrappy working prototype" on "Vite + vanilla JS + Tailwind (frontend only)" with Google Sheets as the data layer. **That is not what's in the repo.** What's actually there is a meaningfully-developed full-stack CRM:

- **Real stack:** React 19 + React Router 7 + Vite + Tailwind (frontend) → **PHP 7.4+ backend** (40 `.php` endpoints) → **MySQL on Hostinger** (28 tables via 11 migrations).
- **Already built:** file-stage pipeline with role-gated transitions, lead import with CSV column mapping + normalization, duplicate detection across VIN/phone/email/address, CRM layer with states/notes/labels/activities, lead tasks + notifications, merge-prep workflow, saved views, marketing campaigns with templates / send / webhook / suppression / unsubscribe.
- **Not what it looks like on the surface:** despite matching the target shape in broad strokes, the core record model is **wrong for the product you described**. The current "Vehicle" table is a generic `{id, name}` label — essentially a *batch container*. VINs live as normalized columns inside `imported_leads_raw` rows without a unique constraint. The system prevents duplicate VINs *detectively* (via a dedupe scan) rather than *preventively* (via a schema constraint). At 5k VINs/week that's a drift problem, not a theoretical one.

**Bottom line:** this is a refactor + hardening job, not a greenfield build. The roadmap reflects that — no "Phase 1: foundation" from-scratch; instead, Phase 1 is harden-what-exists.

**Phase 0 is complete. Do not ask me to write production code until you've read this doc and `ROADMAP.md` and approved the direction.**

---

## 1. Stack & repo shape

| Layer | Reality | Prompt said |
| --- | --- | --- |
| Frontend | React 19 + React Router 7 + Vite 8 + Tailwind 3 | "Vite + vanilla JS + Tailwind" |
| Backend | PHP 7.4+ with hand-rolled endpoint files (`api/*.php`) | "frontend only" |
| DB | MySQL (Hostinger shared, `srv2052.hstgr.io`) | "Google Sheets + Drive" |
| Auth | PHP sessions, `withCredentials: true` on axios | "need real login" |
| Hosting | Hostinger shared hosting, `.htaccess` rewrites for SPA + API routing | unspecified |
| Build | `vite build` → `dist/` + `scripts/copy-api-to-dist.mjs` folds `api/*.php` into `dist/api/` | N/A |
| Testing | **None.** No `__tests__`, no `vitest`, no `jest`, no PHPUnit. | implied need |
| TypeScript | No. Plain `.jsx`. | unspecified |
| Environment config | `VITE_API_TARGET`, `BACKEND_PORT` in dev proxy. **DB creds hardcoded in `api/config.php`.** | N/A |

**Dev loop:** `npm run dev` runs `vite` + `php -S localhost:8001 -t api` under `concurrently`. Vite proxies `/api/x` → `/x.php` on the PHP dev server. In production the proxy becomes an `.htaccess` rewrite rule that appends `.php`.

**The "CRM for VinVault" / "vin-vault" / Google Apps Script assets under `Desktop/Projects/` are separate legacy artefacts,** not part of this repo. The `.gs` file logs leads into a Google Sheet with columns `DATE, VIN, MAKE, MODEL, YEAR, LASTREPORTMILES, FULL ADDRESS, FIRST NAME, LAST NAME, PHONE, EMAIL, PRICE WANTED, PRICE OFFERED, AGENT, NOTES`. Useful as the **column schema** the migration tool has to read.

---

## 2. Frontend map

### Routes (`src/App.jsx`)

| Path | Component | Notes |
| --- | --- | --- |
| `/login` | `LoginPage` | email/password form, POST `/api/auth` |
| `/` | `DashboardPage` | summary cards |
| `/vehicles` | `VehiclesPage` | "files"-level view, not VIN-level |
| `/leads` | `LeadsPage` | main CRM explorer, opens `LeadDetailDrawer` |
| `/tasks` | `TasksPage` | task queue w/ due-date filters |
| `/duplicates` | `DuplicatesPage` | VIN/phone/email dedupe review |
| `/merge-prep` | `MergePrepPage` | merge decision workflow |
| `/marketing` | `MarketingCampaignsPage` | campaign list (admin/marketer) |
| `/marketing/new` | `MarketingComposerPage` | template + segment picker |
| `/marketing/:id` | `MarketingDetailPage` | send status |
| `/users` | `UsersPage` | admin-only user CRUD |
| `/logs` | `LogsPage` | append-only activity view |

### Components

`LeadDetailDrawer`, `FileDetailDrawer`, `DuplicateGroupDrawer`, `MergePrepDrawer` (side-panel record views), `LeadBulkActions`, `NotificationBell` (polling /api/notifications), `SavedViewsMenu`, `SummaryCards`, `ImportFinalFileModal`.

### State + auth

- Global: `src/context/AuthContext.jsx` only. Everything else is page-local `useState`.
- `main.jsx` wraps `<App>` in `<AuthProvider>`.
- Axios client (`src/api.js`) uses base URL `/api` and `withCredentials: true` so the session cookie is sent.
- No client-side token. No refresh logic. If the session dies the user gets 401 and bounces to `/login`.

### Styling

Tailwind 3.4. Sidebar uses `from-gray-900 to-gray-800` gradient, main area `#f8f9fc`. No design tokens file; colors/spacing sprinkled inline per component. **This is the main UX-polish surface** — every pass of "make it feel like Linear" is going to touch these components.

---

## 3. Backend map

All endpoints are flat PHP files under `api/`. Common pattern: `require 'config.php'`, call `initSession()`, `requireAuth()`, switch on `$_SERVER['REQUEST_METHOD']`, return JSON. Prepared statements are used consistently (good).

### Endpoint groups

**Auth** — `auth.php` (login), `logout.php`, `me.php`.

**File pipeline (intake)** — `files.php` (CRUD, 11 KB), `upload.php` (artifact upload + stage guard, 6 KB), `advance.php` (promote to next stage, 3 KB), `file_history.php` (timeline).

**Lead import** — `lead_imports.php` (8 KB batch import), `import_eligibility.php`, `mapping_templates.php` (CSV column maps), `duplicate_scan.php` (6 KB; VIN/phone/email/address matching), `lead_filter_options.php` (distinct-value lists for filter UI).

**CRM core** — `leads.php` (20 KB — main read endpoint), `lead_state.php` (8 KB — status/temperature/price/assignee writes), `lead_notes.php`, `lead_activities.php` (append-only audit feed), `lead_labels.php`, `lead_tasks.php` (19 KB — full task lifecycle), `lead_contact_logs.php`, `lead_bulk_actions.php` (16 KB — multi-record state changes), `lead_merge_prep.php` (24 KB — merge decision builder).

**Marketing** — `marketing_templates.php`, `marketing_campaigns.php` (24 KB), `marketing_send.php` (9 KB — dispatch loop), `marketing_webhook.php` (12 KB — inbound provider callbacks), `marketing_suppressions.php`, `marketing_unsubscribe.php`.

**Platform** — `users.php`, `vehicles.php` (43 lines, thin), `logs.php`, `notifications.php`, `saved_views.php`, `pipeline.php` (23 KB — shared helpers: `requireAuth`, stage gates, tier logic, `storeUploadedFile`).

**DB migrations** — `api/migrations/` holds 11 ordered files that add tables incrementally. `DEPLOY.md` shows only the first 4 tables (the seed), the remaining 24 come from migrations. The `DEPLOY.md` seed is **stale** — running it alone gives you a non-working app.

### Session mechanism

`config.php:initSession()` configures the cookie: `secure` (if HTTPS), `httponly`, `SameSite=Lax`. User id + name + role live in `$_SESSION`. `requireAuth()` in `pipeline.php` checks and returns the user array or emits `HTTP 401`. No JWT, no refresh, no bearer tokens. CSRF relies on SameSite alone.

---

## 4. Actual database schema (reconstructed)

DEPLOY.md's SQL block is the first migration only. The real schema after all 11 migrations:

**Auth & platform:** `users` (role enum: admin / carfax / filter / tlo).

**File pipeline (intake):**
- `vehicles` — `{id, name}`. **This is a batch-label table, not a VIN record.**
- `files` — belongs to a vehicle, has `current_stage` (generated | carfax | filter | tlo), `status` (active | completed | blocked | invalid), `latest_artifact_id`, `assigned_to`. One row per "work item at a stage."
- `file_artifacts` — uploaded documents per file-stage.
- `file_stage_history` — append-only stage-transition log (action_type: create, upload, advance, complete, block, invalidate, reactivate).

**Lead import:**
- `column_mapping_templates` — named CSV-column → field mappings, scoped by source_stage.
- `lead_import_batches` — import runs (file_id, artifact_id, counts, mapping_json).
- `imported_leads_raw` — **the de facto "lead" table.** One row per imported CSV row. Holds `raw_payload_json` + `normalized_payload_json` + stored generated columns `norm_vin`, `norm_phone_primary`, `norm_email_primary`, `norm_state`, `norm_make`, `norm_model`, `norm_year`.

**CRM actions layer:**
- `lead_states` — **this is the "hot" row per lead.** 1:1 with `imported_leads_raw` via `imported_lead_id`. Holds `status` (enum w/ 13 values including `deal_closed`, `do_not_call`, `marketing`, `nurture`), `priority` (low | medium | high | hot), `lead_temperature` (cold | warm | hot | closed), `price_wanted`, `price_offered`, `assigned_user_id`.
- `lead_notes`, `lead_labels`, `lead_label_links`.
- `lead_activities` — append-only audit log with 24+ activity types (`status_changed`, `priority_changed`, `temperature_changed`, `price_wanted_changed`, `task_created`, `contact_logged`, `campaign_sent`, `campaign_opened`, `campaign_clicked`, `campaign_replied`, `opted_out`, etc.) with `old_value_json` / `new_value_json`.

**Dedupe:**
- `lead_duplicate_groups` — match_type (vin | phone | email | address_last_name | name_phone), match_key, confidence, review_status.
- `lead_duplicate_group_members`.
- `lead_duplicate_reviews` — append-only decision journal.

**Tasks & contact:**
- `lead_tasks` — task_type (callback | follow_up | review | verify_contact | custom), due_at, status, assignees.
- `lead_contact_logs` — channel (phone | email | sms | whatsapp | other), outcome (attempted | connected | no_answer | voicemail | wrong_number | follow_up_needed | completed | other).
- `notifications` — task_overdue / due_today / due_soon / assigned / reopened.
- `saved_views` — per-user filter presets.
- `lead_merge_prep_groups`, `lead_merge_prep_choices`.

**Marketing:**
- `marketing_templates` (channel: email | sms | whatsapp), `marketing_campaigns` (draft → queued → sending → sent), `marketing_campaign_recipients` (per-lead render + send status), `marketing_suppressions` (unsubscribe / bounce / complaint / manual_dnc / legal).

---

## 5. Mapping current state to the target model

Your spec says: **one Vehicle record per VIN, keyed by VIN, with two independent status axes (data-stage × lead-temperature), plus activity log, deals, gated transitions, SLA alerts.** Here's what's there versus what's not.

| Target requirement | Status | Where it lives / what's missing |
| --- | --- | --- |
| VIN-primary Vehicle record | ❌ **Wrong shape** | VIN is a `norm_vin` generated column inside `imported_leads_raw`. No unique constraint. "Vehicle" in current schema is a batch label. This is the single biggest structural delta. |
| VIN dedupe on re-import | ⚠️ Detective, not preventive | `duplicate_scan.php` runs post-import and creates `lead_duplicate_groups` for human review. Does not block insertion. Merge workflow exists (`lead_merge_prep_*`) but is operator-driven. |
| Year / Make / Model / Trim | ⚠️ Partial | `norm_make`, `norm_model`, `norm_year` are generated columns; Trim isn't. All live inside a JSON payload, not a first-class Vehicle column set. |
| Mileage / Condition | ⚠️ In JSON payload | Not promoted to a typed column. Lives in `normalized_payload_json`. |
| Owner Name / Age / Address / Phone / Email | ⚠️ In JSON payload | `norm_phone_primary`, `norm_email_primary`, `norm_state` are the only promoted fields. Age, full address components, name are in JSON. |
| Asking / offer / acquisition / resale prices | ⚠️ Partial | `lead_states.price_wanted` + `price_offered` exist. Acquisition price + resale fields **do not exist**. |
| Data stage: VIN Generated → Carfax → Filter → TLO | ✅ Exact match | `files.current_stage` enum, role-gated transitions in `pipeline.php`. |
| Uploading Carfax / TLO export files to progress records | ✅ | `upload.php` + `advance.php`. |
| VIN Filter: auto rules configurable in UI + manual review queue | ❌ Not built | No rules table, no admin UI, no auto-filter engine. `DuplicatesPage` is the closest analog but it's for dedupe, not filter rules. |
| Lead temperature: No Answer → Cold → Warm → Hot → Closed | ⚠️ Missing "No Answer" | `lead_temperature` enum is `cold | warm | hot | closed`. "No Answer" is currently represented by a `lead_contact_logs.outcome = 'no_answer'` event + `lead_states.status = 'no_answer'`. Needs a temperature enum extension and UI unification. |
| Activity log (comms, stage changes, notes) | ✅ | `lead_activities` covers it — comms via `campaign_*` and `contact_logged` types; stage via `status_changed` / `temperature_changed`; notes via `note_added/edited/deleted`. `file_stage_history` handles data-stage events separately. |
| Deal = child record of Vehicle, resale tracking | ❌ Not built | Closest today: `lead_states.status = 'deal_closed'`. No deal table, no acquisition_date, no title-doc field, no resale (listed_price / buyer / sale_date / margin). You confirmed "vehicle purchase = deal closed" — we still need a Deal row to hold the purchase + resale fields. |
| Gated status transitions | ⚠️ Partial | Data-stage has `STAGE_ROLES` + `assertRoleForStage()` — good. Lead-stage transitions are mostly unguarded (`lead_state.php` writes freely). No "can't move to Offer without contact info" / "can't mark Closed-Won without price + title" checks. |
| SLA / stale-lead alerts | ❌ Not built | `notifications` table + `lead_tasks.due_at` exist for task-level alerts. No table/engine for "leads with no activity in N days," no daily digest, no admin-configurable SLA threshold. |
| Email send + log + reply-capture | ⚠️ Structure exists, provider may be stubbed | `marketing_send.php` and `marketing_webhook.php` exist with recipient/suppression tables. **Provider integration (Resend / Postmark / SendGrid) and inbound reply-capture are not verified in this audit.** Likely stubbed or config-driven. Per-lead one-off email (not campaign) is not wired. |
| SMS send + inbound webhook | ⚠️ Enum-only | `channel = 'sms'` exists in templates/campaigns and contact_logs. No Twilio code, no inbound SMS webhook endpoint visible. |
| One-time Sheets / Drive import tool | ❌ Not built | CSV import pipeline is robust; adding a Google-Sheets-specific importer is a thin adapter on top. |
| Admin vs. user role separation (users = move + upload + add; no delete/edit existing) | ⚠️ Partial | `users.role` enum is `admin | carfax | filter | tlo`. Stage-scoped roles, not admin/user split. Your role model (admin = full, user = append-only + move) needs either new roles or row-level checks. |
| Saved views per operator | ✅ | `saved_views` table + `SavedViewsMenu.jsx`. |
| Keyboard shortcuts | ❌ Not built | No hotkey handling seen. |

### The "same VIN, two status axes" question

Your spec treats data-stage and lead-temperature as orthogonal dimensions on one record. Current code scatters them across **two tables** (`files` for data-stage, `lead_states` for temperature) joined through a chain (`files` ↔ `vehicles` is loose; `lead_states` ↔ `imported_leads_raw`; `imported_leads_raw` ↔ `lead_import_batches` ↔ `files` through batch provenance). That works today because operators navigate via separate `/vehicles` (file-level) and `/leads` (lead-level) UIs — which matches the `/intake` vs `/pipeline` split you described. But if you want a single "Vehicle record opens a drawer showing both axes," the join needs hardening (a stable `imported_lead_id ↔ file_id` relation is what `lead_import_batches.file_id` gives you, but it's indirect).

**Recommendation:** keep the two-table split but make VIN the shared key across both, and introduce a canonical `vehicles_v2` (or rename-and-rewrite `vehicles`) that is one row per VIN with the promoted columns. Details in the roadmap.

---

## 6. Top 5 risks (ranked)

### 🔴 1. Production DB credentials hardcoded in `api/config.php` and committed to git

```
DB_HOST = 'srv2052.hstgr.io'
DB_NAME = 'u487877829_vins_data'
DB_USER = 'u487877829_vinsdata'
DB_PASS = 'Vins.ok12'
```

The repo is at `github.com/f-fida-coder/vinsdata`. If that repo is public *or ever was public*, the creds are already leaked. Even if private, every contributor's laptop + every CI log is a surface. Anyone with this can connect from any IP Hostinger permits, read every lead + owner PII, drop tables.

**Immediate actions (not hypothetical):**
- Rotate the DB password in Hostinger *today*.
- Restrict remote MySQL access to Hostinger's app IPs only (hPanel → Remote MySQL).
- Move creds to environment variables read via `getenv()` in `config.php`.
- Add `api/config.local.php` to `.gitignore`; check git history with `git log -p -- api/config.php` to confirm how long they've been exposed.

### 🔴 2. VIN uniqueness is not enforced at the schema level

Per your spec: **"Dedupe is hard — never allow two active records with the same VIN. Re-imports must merge/update, not duplicate."** The current system satisfies this softly (via `duplicate_scan.php` after the fact) but not hard-ly. With 20k VINs today + 5k/week growth and repeat imports from overlapping source lists, detective dedupe plus optional human review is going to leak duplicates at some rate. Worse, because the dedupe table uses `match_key` on normalized VIN, an import error that normalizes two spellings differently will produce two active leads with the same VIN that pass the scan.

**Fix direction:** promote VIN to a unique indexed column on a canonical vehicle row and make import upsert-on-VIN. Covered in Phase 2 of the roadmap.

### 🟠 3. Marketing bulk send has no rate limit, no queue, and no provider sanity checks

`marketing_send.php` is a POST endpoint that iterates recipients and dispatches. At 20k+ leads a misfire — wrong segment, wrong template, testing on prod — has two consequences:

- Sender reputation damage (one bad blast can cold-shoulder the sending domain for weeks).
- Potential provider-side throttle / suspension.

There is no async job table, no per-minute dispatch cap, no "confirm send" UX gate visible. Also: no visible integration with a specific email provider yet — so either it's using `mail()` (very bad for deliverability) or it's stubbed.

**Fix direction:** Phase 4 roadmap — introduce Resend (recommended) + an async `marketing_jobs` table + cron-driven dispatcher with per-minute throttle + double-confirm send UI.

### 🟠 4. Legacy owner-PII CSVs sitting in git history

Amended after git inspection: the runtime upload directory is actually well-protected — `api/uploads/.htaccess` contains `Deny from all` (Apache refuses all requests; stronger than disabling PHP) and `.gitignore` correctly excludes `api/uploads/` going forward. That risk was over-stated in the initial audit.

The real issue here is historical: the **first commit (`271cc2f`, 2026-04-09) checked in two real upload artefacts** before `api/uploads/` was added to `.gitignore`:

- `api/uploads/69d77d2166bf84.27040615_b3aa5422f3afc939.csv` — 501 rows
- `api/uploads/69d77d4a61f5e4.72959037_84bac6bfe767d5f3.xlsx` — 15 KB binary

If those files contain real owner contact data (likely, given the product), they are **still recoverable from git history** even though they've been removed from the index. Private repo limits blast radius to repo collaborators + GitHub's internal systems, but the PII is present and does not go away until history is rewritten.

**Fix options (needs your call):**
- **Nuclear / clean:** rewrite git history with `git filter-repo --path api/uploads/ --invert-paths`, force-push. Destroys any open clones/forks; breaks SHAs. Only viable on a private repo with small contributor list.
- **Accept + document:** leave history, record a data-exposure note in an internal log, rotate any PII you can (phones, emails are what they are — rotation is not a thing), and rely on repo access control.

### 🟠 4b. (Original, revised) Production DB credentials were committed in plaintext for ~6 days

Confirmed via `git log -p -- api/config.php`:
- Commits `271cc2f` / `d867ff2` / `6736d80` (2026-04-09) held dev creds only (`localhost / root / 1245!`).
- Commit `2f42f40` (2026-04-18) — "Use remote MySQL host for both environments in config.php" — is where real Hostinger prod creds (`srv2052.hstgr.io`, `u487877829_vinsdata`, `Vins.ok12`) landed.
- That means **prod creds have been in private-repo git history for ~6 days at the time of this audit** (2026-04-24).

Private repo keeps this from being a worldwide leak. It is still mandatory to rotate the DB password (you must do this in Hostinger hPanel — I can't do it for you), move creds to environment variables read in `config.php`, and re-examine whether full history rewrite is warranted (same trade-off as 4 above).

### 🟡 5. No test suite, no CI, no backup policy documented

- Business logic that *must* be correct — VIN dedupe, stage transitions, gated-transition rules, filter auto-rules, bulk actions, merge-prep commit, campaign recipient expansion — has zero automated coverage.
- No GitHub Actions / CI file; regressions ship on vibes.
- No documented Hostinger MySQL backup cadence or restore drill.

At 20k rows today this is annoying; at 250k+ rows in a year it's the kind of thing that takes the business down for a week.

**Fix direction:** Phase 1 introduces Vitest for frontend lib + PHPUnit (or a lightweight alternative) for API business-logic tests, a GitHub Actions workflow running lint + tests on push, and documented + scheduled DB snapshots.

---

## 7. Stack recommendations (keep or change?)

You asked for one paragraph per decision with the trade-off. Here they are.

### Framework: keep React + Vite + PHP. Do not port to Next.js / Remix / Astro.

The "prototype" has real product surface — 40+ endpoints, 28 tables, 12 pages, substantial business logic (bulk actions, merge prep, marketing send). Porting that to Next.js means reimplementing the PHP layer in Node (Route handlers / tRPC / similar), rewriting every query, re-testing every flow, and redoing deploy. At ASAP tempo this is a 2–3 month diversion before you regain feature velocity. In return you get: SSR you don't need (internal tool, 3 users), better tooling, a larger hiring pool, and a less-quirky ops story. The real pain point the prompt hints at — "inconsistent, rough UI" — is a component/design-system problem, not a framework problem. Tailwind + shadcn-style primitives fix that inside the existing React app without touching PHP. **Recommendation: keep the stack; invest the saved time in Phases 2–5.** Fallback, if later you hire a Node-only team: a greenfield port after v1 stabilizes.

### Database: keep MySQL on Hostinger for v1, but plan a Postgres path.

MySQL 5.7+/8.0 on Hostinger shared is fine for 20k→500k rows. The schema uses generated columns, JSON functions, and enums — all supported. What you lose vs. Postgres: richer JSON operators, stronger constraint system, partial indexes, `pg_stat_statements`, easier LISTEN/NOTIFY for realtime. What you gain by staying: zero migration risk, no hosting change, existing code works. **Recommendation: stay on Hostinger MySQL through v1. If you outgrow shared hosting (cron limits, connection limits, backup granularity), move to a managed MySQL (PlanetScale / Aiven) or do a Postgres migration then — both are done with a `mysqldump → pgloader` pipeline in a weekend for this size.** For now: rotate creds, tighten access, verify Hostinger's backup schedule, document restore steps.

### Auth: keep PHP sessions. Skip Auth0 / Clerk / Supabase Auth.

For 2–3 internal users with no customer login, bolting on a third-party auth provider buys nothing you need (social login, MFA UX, org management) and costs complexity + per-user fees + an external dependency. PHP sessions with `HttpOnly + Secure + SameSite=Lax` cookies are enough once we add a CSRF header token and enforce HTTPS. **Recommendation: keep sessions; add CSRF tokens in Phase 1; add MFA in Phase 1 or 2 (TOTP via an open library — cheap) if admin accounts touch acquisition money.** Future-you should revisit if you onboard >10 people or hand out access to external partners.

### Email provider: Resend.

Three real options. **Resend** — best DX, simple API, React Email templates, generous free tier, <1h to integrate, reply-capture via inbound webhooks. **Postmark** — higher reputation/deliverability, stricter template rules, pricier, better for transactional-only. **SendGrid** — most features, worst DX, questionable current reputation post-Twilio ownership churn. For mixed campaign + one-off + reply-capture use case with ASAP timeline, Resend wins. **Recommendation: Resend. Own the domain `vinvault.us` SPF / DKIM / DMARC records (you confirmed DNS control). Use a subdomain like `reply.vinvault.us` for inbound routing with MX pointed at Resend's inbound.**

### SMS provider: Twilio.

No real competition at this scale. Twilio Programmable Messaging + one dedicated 10DLC number + webhook on inbound. Bandwidth.com is cheaper per message but a bigger lift to set up; Telnyx is similar. Twilio's campaign/brand registration (10DLC) takes 1–2 weeks of paperwork for US A2P messaging — **start this on day 1 of Phase 4**, because you can't send compliantly without it. **Recommendation: Twilio; begin 10DLC brand/campaign registration immediately in Phase 4 so it's approved by the time code's ready.**

---

## 8. Known unknowns (things I couldn't verify from code alone)

1. **Live site behavior.** Live login is behind auth; I can't exercise flows remotely. Recommended: screen-share 15 minutes so I can see which UIs feel complete vs. half-wired, where the rough edges actually are, and what your team's daily path is.
2. **Does `marketing_send.php` actually send email today?** The table and dispatch loop are there but I didn't deeply read the send function to confirm which transport it calls (mail() / SMTP / Resend API / stub). First task in Phase 4 is to read + verify + replace.
3. **Is the Hostinger database already populated with production data?** You said "we already have the setup for database." If there are real records already, Phase 2 (data-model alignment) has to be a backfill migration, not a clean re-create. Confirm before we design the canonical-vehicle migration.
4. **How many CSV source formats are in active use?** `column_mapping_templates` suggests the team already encountered schema drift across source lists. The number of active templates tells us how many mappings the migration tool has to preserve.
5. **Git history of `api/config.php`.** Need to run `git log -p -- api/config.php` once I have repo push access to know the leak window.
6. **Whether `github.com/f-fida-coder/vinsdata` is public or private.** This flips the credential-rotation urgency from "soon" to "right now."
7. **What the legacy Google Sheets actually contain vs. the `.gs` schema.** The `.gs` script is clean; real sheets often have drift (missing columns, inconsistent phone formatting, multiple sheets). One-time import tool needs a dry-run mode.

---

## 9. What I need from you before Phase 1 starts

Please answer the numbered items in section 8, plus:

- **A. Is the GitHub repo public or private?** (drives credential-rotation urgency)
- **B. Is there already live data in the Hostinger DB I should not wipe?** (drives Phase 2 migration shape)
- **C. Branch strategy.** OK for me to work on `audit/phase-0` branch and PR into `master`? Or push straight to `master` for solo cadence?
- **D. Do you have Hostinger cron enabled on your plan?** (needed for SLA alerts, marketing queue, Sheets migration, backup verifier — most of Phase 1+)
- **E. Is Hostinger's MySQL reachable from outside Hostinger, or locked to the app's own host?** (affects whether I can run migrations from my machine vs. only via a deployed endpoint)
- **F. Do you want MFA on admin accounts in v1, or defer to v2?**
- **G. Any compliance constraints I should know about?** (GDPR / CCPA — even US-only ops have California exposure; your leads have PII)

Answer in plain English. "I don't know" is a fine answer — I'll flag what to do next.

Once answered, I'll write `ROADMAP.md` implementation notes per phase and **stop for your go/no-go on each phase before writing code**.

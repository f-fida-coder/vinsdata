# Vin Vault CRM — Phased Roadmap to v1

Read `AUDIT.md` first. This document is the implementation plan.

## How to read this

- **T-shirt sizes:** S (≤ 3 focused working days), M (1–2 weeks), L (3–4 weeks). Assumes one engineer working head-down. Calendar time is usually longer because of back-and-forth and review gates.
- **Checkpoint gate** at the end of every phase. I stop. You review. You say "go" before the next phase starts. No auto-rollover.
- **Branch strategy:** each phase ships on a dedicated branch `phase-N-<slug>`. Small commits, clear messages, PR into `master` at phase end (or push direct — your call on branch protection).
- The phases below are **re-scoped from the prompt's suggested order** because ~60% of the skeleton already exists (see `AUDIT.md` §5). There is no "Phase 1 — build empty logged-in app"; that's already there. Phase 1 is harden-what-exists.

---

## Phase 1 — Hardening & foundation fixes · **M**

**Goal:** take the existing codebase from "demo-able" to "I would put real money + real PII on this."

**Tracks:**

1. **Secrets + DB hygiene** (S within the phase)
   - Rotate Hostinger DB password. Lock remote MySQL to app IPs.
   - Move credentials to environment variables read in `api/config.php`. Add `api/config.local.php` to `.gitignore`.
   - Audit `git log` for secret leak window; document what was exposed and when.
   - Document Hostinger's MySQL backup cadence; if automated backups aren't on, turn them on. Write a 1-page `docs/restore.md` with a rehearsed restore procedure.

2. **App security baseline**
   - CSRF header token (`X-CSRF-Token`) issued on login, validated on all non-GET endpoints.
   - HSTS + Content-Security-Policy headers in `.htaccess` + `config.php`.
   - `api/uploads/.htaccess` disables PHP execution. Verify upload MIME-sniff, not just extension.
   - Rate limit on `/api/duplicate_scan` and `/api/marketing_send` via DB-backed token bucket.
   - Input-length checks on free-text fields.
   - Optional: MFA (TOTP) on admin accounts via `otphp` library. Defer to Phase 2 if time-pressured — flag clearly.

3. **Role refactor**
   - Your model: admin = full; user = can move + upload + append; cannot delete or edit existing.
   - Current enum is stage-scoped (`carfax / filter / tlo`). Keep those as optional *skill* labels, but introduce top-level `account_type` enum (`admin | operator`). Tighten endpoints to check both.

4. **Test + CI skeleton**
   - Vitest for `src/lib/*` (dedupe helpers, normalization).
   - A lightweight PHP test runner — PHPUnit if Hostinger allows Composer, else a tiny home-rolled runner — for business logic in `pipeline.php`, `lead_state.php`, `duplicate_scan.php`, `lead_imports.php`.
   - GitHub Actions workflow: `lint + test` on push.
   - Seed script: `scripts/seed.mjs` populates ~20 fake vehicles + owners + a couple active deals so the app is demo-able from a fresh DB.

5. **Docs**
   - **Replace the Vite-boilerplate `README.md`** with one that describes: what Vin Vault is, how to run locally (frontend + PHP + DB seed), env vars, deploy steps, data-model overview (link to `AUDIT.md`).
   - `.env.example` listing every required var.
   - Short `docs/architecture.md` diagram explaining the `/intake` vs `/pipeline` split and which tables belong to which.

**Deliverable:** clean, rotated, documented, tested baseline. App is unchanged from the user's perspective. Security posture moves from red to yellow-green.

**Checkpoint:** you can `git pull master && npm install && npm run dev` on a clean machine using only the README. Tests pass. Secrets aren't in git. You approve the Phase 2 migration plan before I touch data shape.

---

## Phase 2 — Data-model alignment (canonical Vehicle-by-VIN) · **L**

**Goal:** make VIN a first-class unique record, as the product spec requires.

**The problem today:** `vehicles` is a batch label. VIN lives as `norm_vin` inside `imported_leads_raw` rows with no unique constraint. Five thousand VINs a week will make dedupe-after-the-fact bite.

**Tracks:**

1. **Design + approval gate (inside the phase)**
   - Write `docs/data-model-v2.md` proposing the canonical shape. Probable shape:
     ```
     vehicles_v2 (one row per VIN)
       ├─ vin (unique, indexed)
       ├─ year / make / model / trim / mileage / condition
       ├─ owner_name / owner_age / owner_address / owner_phone / owner_email
       ├─ asking_price / offer_price / acquisition_price (phase 5)
       ├─ data_stage enum (generated | carfax | filter | tlo)
       ├─ lead_temperature enum (no_answer | cold | warm | hot | closed)
       ├─ source / date_imported / list_name
       ├─ dead_reason / dead_at
       ├─ timestamps
     ```
   - The join story: `lead_states` collapses into `vehicles_v2`; `imported_leads_raw` becomes a provenance log (unchanged, keeps JSON blobs for history); `files` + `file_artifacts` + `file_stage_history` stay as the **pipeline batch** layer and now link to VINs through a `vehicle_file_link` table.
   - **Stop and get written approval on the shape before writing the migration.**

2. **Migration**
   - Backward-compatible migration `012_canonical_vehicles.sql`: create `vehicles_v2`, backfill from `imported_leads_raw` + `lead_states` with dedupe rules (pick the row with the most complete owner info on VIN collision; log chosen-vs-dropped in `vehicles_v2_merge_log`).
   - Dry-run mode: report how many collisions happen, how many rows end up in the new table, what's lost. **You see this report before the real migration runs.**
   - Cutover script with a rollback point.

3. **API refactor**
   - Introduce `/api/vehicles_v2` endpoints (list, get, upsert). Old endpoints stay alive for one phase to let the frontend migrate without a big-bang.
   - CSV import becomes upsert-on-VIN. Merge log shows what changed on re-import (per the spec's "inspectable merge behavior" requirement).
   - Keep `duplicate_scan` but demote it to a sanity-check job, not the primary dedupe path.

4. **Frontend swap**
   - `LeadsPage` and `VehiclesPage` consolidate around the canonical record.
   - Record-detail drawer shows both data-stage and temperature.
   - `/intake` vs `/pipeline` routes stabilize (may rename existing routes).

**Deliverable:** VIN is unique. Re-imports merge predictably. Operators see one row per VIN.

**Checkpoint:** load a test CSV with known duplicates, confirm merge behavior, re-import the same CSV, confirm no new rows. Old endpoints still work (deprecation warning in logs). You approve the Phase 3 sequencing.

---

## Phase 3 — Lead pipeline completions · **M**

**Goal:** finish the lead-tracking side. Close the gaps identified in audit §5.

**Tracks:**

1. **Temperature extension**
   - Add `no_answer` to the `lead_temperature` enum so the state machine matches the spec exactly (`no_answer → cold → warm → hot → closed`).
   - Migration from current rows: any lead with ≥1 `lead_contact_logs.outcome='no_answer'` and no other activity becomes `no_answer`.

2. **Gated lead-stage transitions**
   - Rule engine in `api/pipeline.php`:
     - Can't advance to `warm` / `hot` without owner contact info present on `vehicles_v2`.
     - Can't advance to `closed` without a Deal record (see Phase 5).
     - Can't skip data-stage steps (already enforced; extend the same helper).
   - Transition errors return structured JSON with the failing rule, not a 500.
   - Unit test per rule.

3. **VIN Filter rule engine + admin UI**
   - New `filter_rules` table: `id, name, predicate_json, action (reject | flag_for_review), active, created_by, created_at`.
   - `predicate_json` is a small AST (field, op, value) — no arbitrary code.
   - Runs automatically when a VIN reaches data-stage `carfax` (right before `filter`). Predicate matches → action applied.
   - Manual review queue for `flag_for_review` verdicts, auto-accept for clean passes.
   - Admin-only UI under `/admin/filter-rules` with a visual rule builder.
   - Migration: seed with a handful of sensible defaults (drop salvage, drop out-of-region, etc.) as examples for the team to edit.

4. **SLA / stale-lead engine**
   - `sla_rules` table: `id, name, if_temperature_in, if_no_activity_for_days, then_notify (role or user_id), active`.
   - Daily cron (via Hostinger cron or a polled endpoint) evaluates rules, writes to `notifications`, and optionally emails a digest.
   - Dashboard badge shows stale-lead count per operator.

5. **Activity log UX**
   - `LogsPage` already exists; tighten it into the per-vehicle timeline the spec describes.
   - Filter by activity type; clickable deep-links to tasks / contact logs.

**Deliverable:** the lead-management side matches the spec. Operators can't break the state machine. Stale leads surface themselves.

**Checkpoint:** run through the 20-seed-records walkthrough with me — move a lead cold → warm → hot → closed while trying to violate rules. Every block is expected and shows the right message.

---

## Phase 4 — Outreach (email + SMS) · **L**

**Goal:** real communications, real logging, real compliance posture.

**Tracks:**

1. **Kick-off (day 1, outside the critical path)**
   - Start Twilio 10DLC brand + campaign registration. Submit paperwork. Approval takes 1–2 weeks and blocks compliant US A2P messaging. *This is the first task of Phase 4.* Nothing else here is blocked by it, but every delay day adds directly to the end date.
   - Set up Resend account, add `vinvault.us` sending domain, configure SPF/DKIM/DMARC. Set up a `reply.vinvault.us` subdomain with Resend inbound MX.

2. **Email integration**
   - Replace whatever `marketing_send.php` currently does with a Resend adapter.
   - Introduce a `outbound_jobs` table (campaign_recipient_id, provider, status, last_error, attempts, run_at). Cron dispatcher processes pending jobs with a per-minute cap.
   - Per-lead one-off email send (not just campaigns) — reuse the outbound-jobs path. Surface in the lead detail drawer.
   - Inbound reply capture: Resend webhook → `marketing_webhook.php` extended → thread onto the right `vehicles_v2` record via a reply-to address encoding `{vehicle_id}@reply.vinvault.us`.
   - Unsubscribe flow already exists; verify end-to-end.

3. **SMS integration**
   - Twilio adapter behind the same `outbound_jobs` table.
   - Inbound webhook endpoint `api/sms_webhook.php`: Twilio → verify signature → match sender to a vehicle's owner_phone → log as `lead_contact_logs` inbound SMS + emit activity.
   - STOP/HELP keyword handling + automatic suppression.

4. **Double-confirm send UX**
   - Any campaign targeting >50 recipients requires a confirmation modal showing the final count, template preview, and suppression exclusions. Prevents "oops."

5. **Tighten integration with gated transitions**
   - Sending the first email / SMS to a lead at temperature `no_answer` auto-bumps to `cold` with an activity entry.
   - Inbound reply auto-bumps `cold → warm` (configurable off per-user).

**Deliverable:** send, receive, log, suppress — working, rate-limited, observable.

**Checkpoint:** send 5 test emails + 5 test SMS to your own addresses. Reply to each. Confirm every event lands on the vehicle timeline with correct direction, channel, and content.

---

## Phase 5 — Deals + resale tracking · **M**

**Goal:** once a lead warms and closes, the system tracks the purchase and the resale.

**Tracks:**

1. **Deal model**
   - `deals` table: `id, vehicle_id (FK vehicles_v2), status (negotiating | won | lost), acquisition_price, title_doc_artifact_id, pickup_date, seller_signature_artifact_id, lost_reason, created_by, created_at, closed_at`.
   - `deal_resales` table: `id, deal_id, listed_price, list_channel, buyer_name, sale_date, sale_price, margin (generated column), notes`.
   - Deal is created when `lead_temperature = warm` and owner contact exists. Deal is closed-won when `lead_temperature = closed` *and* acquisition_price + title_doc both present. Closed-won triggers a resale row (draft).

2. **UX**
   - Record detail drawer gets a Deal tab showing: current negotiating state, captured docs, and if closed-won, the resale card.
   - Admin-only view `/deals/closed` for reporting on margin / throughput.

3. **Gate enforcement**
   - Phase 3's rule engine gains deal-aware rules: can't mark lead `closed` without a deal in `won` status. Lost deals flip the lead to `dead` with a reason.

**Deliverable:** end-to-end a lead becomes a sold car with numbers tracked.

**Checkpoint:** walk one seed record through the full funnel: intake → carfax → filter → tlo → cold → warm → (Deal created) → hot → closed-won → resale listed → sold. All activity logged, margin visible.

---

## Phase 6 — Migration, UX polish, & production hardening · **L**

**Goal:** move legacy data in. Make the UI feel like Linear. Ship.

**Tracks:**

1. **One-time Google Workspace import tool**
   - Script `scripts/migrate-from-sheets.mjs` using the Google Sheets API with a service-account JSON key.
   - Reads the legacy "Leads" sheet columns (matches the `.gs` schema in `Desktop/Projects/CRM for VinVault/VinVault_CRM.gs`).
   - Dry-run mode outputs a `migration-report.csv`: what will be inserted, what will merge into an existing VIN, what will be skipped (missing VIN etc.).
   - Preserves provenance: legacy rows get `source = 'google_sheets_migration_2026'` with row number + import timestamp.
   - Drive files: download each referenced file, upload to `api/uploads/`, link as `file_artifacts` on the matching vehicle.
   - **Runs once per environment.** Not a sync. A `migration_completed` flag prevents re-runs.

2. **UX pass**
   - Design-token pass: define typography scale, spacing, color palette, radius, shadows in a `src/design/tokens.css`. Apply across components.
   - Tighten data-density: reduce row padding on tables, use small inline status pills, adopt monospaced digits for IDs and numbers.
   - Keyboard shortcuts: `⌘K` global search, `n` new record, `/` focus filter, `e` edit, `j/k` row navigation, `s` change stage.
   - Sharpen the sidebar: quieter palette, clearer active-state, keyboard-accessible.
   - Mobile pass: tables collapse to card view under `md`; drawers go full-screen; ensure login works on mobile. Mobile stays secondary per spec.
   - Accessibility quick pass: focus outlines, ARIA on drawers, color-contrast check.

3. **Production hardening**
   - Full security re-review on Phase 1 fixes (someone other than me should read the diffs).
   - Error monitoring (Sentry for frontend; a simple PHP error logger for backend).
   - Backup verification: restore a backup to a scratch DB as a drill.
   - Performance check: index review on top-10 slowest queries in the pipeline. Add covering indexes where needed.

**Deliverable:** v1 is live with real data, feels polished, backed up, monitored.

**Checkpoint:** you use it for two days. Open issues go into a Phase 7 polish bucket.

---

## Cross-cutting conventions

- **Testing:** every new business rule gets a unit test. UI tests optional. Dedupe, gated transitions, filter engine, SLA engine, upsert-on-VIN all get tests.
- **Migrations:** one `.sql` per migration, numbered. Reversible where feasible (down migration file alongside).
- **Feature flags:** any risky change (rule-engine behavior, outbound sending) gates behind a config flag so we can dark-launch.
- **Observability:** every endpoint that mutates state writes to `lead_activities` or `file_stage_history`. No silent changes.
- **Commit hygiene:** one logical change per commit, imperative mood, reference the phase (`phase-1: rotate db creds`).

---

## Things explicitly NOT in v1 (defer to v2+)

- Carfax / TLO / any external enrichment API — manual upload path stays.
- Public inbound lead form.
- Dealer / external user logins.
- Automated scraping.
- Realtime collaboration (WebSockets, presence).
- Mobile-native app.
- Full-text search over notes (use simple LIKE / MATCH until it hurts).
- Reporting dashboards beyond what's already built (`reports.php`).

---

## Open items to resolve before Phase 1 starts

See `AUDIT.md` §9. Specifically: GitHub repo public-or-private, live DB populated or not, branch strategy, Hostinger cron availability, MFA preference, compliance posture. Plus the phone-home screen-share so I can see the live app in use.

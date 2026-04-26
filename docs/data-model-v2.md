# Data model v2 — canonical Vehicle-by-VIN

**Status:** design + shadow tables (migration 014). Cutover gated on your approval.

## What's wrong with v1

The product spec is unambiguous: **"one VIN = one Vehicle record. Dedupe is hard — never allow two active records with the same VIN. Re-imports must merge/update, not duplicate."**

The current schema doesn't model that. VINs live as a normalized column on `imported_leads_raw` rows. If the same VIN appears in two different CSV imports, you get two `imported_leads_raw` rows with the same `norm_vin`. Each row gets its own `lead_states` (1:1) — so the same vehicle now has two CRM-state rows that are out of sync. `duplicate_scan.php` papers over this *after the fact* by grouping the rows for human review, but it doesn't enforce uniqueness. At 5k VINs/week with overlapping source lists, this drifts.

The `vehicles` table that exists today is a generic `{id, name}` label — a batch container, not a vehicle record. It has no VIN, no year/make/model, no owner fields. The path from a row in `imported_leads_raw` to "the vehicle this row is about" goes through the `lead_import_batches.file_id → files → vehicles` chain, where `vehicles` is just a folder name.

## v2 model

Three new tables. All `_v2`-suffixed so v1 stays untouched until cutover.

### `vehicles_v2` — one row per VIN

```
id                      BIGINT PK
vin                     VARCHAR(17)  UNIQUE NOT NULL
year                    SMALLINT
make                    VARCHAR(80)
model                   VARCHAR(80)
trim                    VARCHAR(80)
mileage                 INT
condition               VARCHAR(80)

owner_first_name        VARCHAR(80)
owner_last_name         VARCHAR(80)
owner_full_address      VARCHAR(255)
owner_city              VARCHAR(80)
owner_state             CHAR(2)
owner_zip               VARCHAR(15)
owner_phone             VARCHAR(40)
owner_email             VARCHAR(255)
owner_age               SMALLINT

asking_price            DECIMAL(12,2)
offer_price             DECIMAL(12,2)
acquisition_price       DECIMAL(12,2)

data_stage              ENUM('generated','carfax','filter','tlo')
lead_temperature        ENUM('no_answer','cold','warm','hot','closed')
priority                ENUM('low','medium','high','hot')
status                  ENUM(...the existing lead_states.status enum...)
assigned_user_id        INT REFERENCES users(id)

source                  VARCHAR(255)         -- where the VIN came from
date_imported           TIMESTAMP
list_name               VARCHAR(255)

dead_reason             VARCHAR(255)
dead_at                 TIMESTAMP

notes                   TEXT
created_at              TIMESTAMP
updated_at              TIMESTAMP

UNIQUE KEY              (vin)
INDEX                   (data_stage), (lead_temperature), (owner_state),
                        (make, model), (year), (assigned_user_id)
```

VIN is unique. Re-imports become an UPSERT: find by VIN, update fields, log the diff. No more silent duplicates.

The CRM fields (`status`, `priority`, `lead_temperature`, prices, `assigned_user_id`) all collapse onto this row. `lead_states` becomes redundant — its data lives directly on the vehicle.

The `data_stage` is also on the vehicle, replacing the per-file batch concept. A vehicle moves from `generated → carfax → filter → tlo` over its lifetime; uploads (Carfax exports, TLO exports) are events that mutate the vehicle row, not promotions of a batch.

### `vehicle_imports` — provenance

```
id                  BIGINT PK
vehicle_id          BIGINT REFERENCES vehicles_v2(id) ON DELETE CASCADE
imported_lead_id    BIGINT REFERENCES imported_leads_raw(id) ON DELETE CASCADE
batch_id            BIGINT REFERENCES lead_import_batches(id) ON DELETE SET NULL
created_at          TIMESTAMP
UNIQUE KEY          (vehicle_id, imported_lead_id)
INDEX               (imported_lead_id)
```

One row per `(vehicle, source-import)` pair. Tells you which import batches contributed data to this vehicle's row over time. Multiple imports of the same VIN produce multiple `vehicle_imports` rows but only one `vehicles_v2` row.

### `vehicle_field_changes` — merge log

```
id                  BIGINT PK
vehicle_id          BIGINT REFERENCES vehicles_v2(id) ON DELETE CASCADE
imported_lead_id    BIGINT REFERENCES imported_leads_raw(id) ON DELETE SET NULL
field_name          VARCHAR(80)
old_value           TEXT
new_value           TEXT
source              VARCHAR(255)
created_at          TIMESTAMP
INDEX               (vehicle_id, created_at)
```

Spec calls out: *"Merge behavior should be inspectable (show what changed)."* This table is that audit trail. When an upsert mutates an existing vehicle, every changed field gets a row. Drawer renders this as a "Merge log" tab.

## Migration plan (3 phases)

### Phase A — `014_canonical_vehicles.sql` (this commit, non-destructive)

Creates the three tables. **No data movement, no code paths use them yet.** Existing app behavior is unchanged. You can deploy this migration today with zero risk.

### Phase B — backfill (separate migration, separate approval)

`015_backfill_vehicles_v2.sql` walks `imported_leads_raw` joined to `lead_states` and builds one `vehicles_v2` row per unique `norm_vin`. Collision rule: the row with the most-complete owner fields wins; loser rows still get a `vehicle_imports` link. Dry-run mode produces a CSV report of:
- Total VINs found
- Collisions (count and example pairs)
- Rows missing a VIN entirely (will be skipped)
- Rows with malformed VINs (logged for cleanup)

You see the report before the real backfill runs.

### Phase C — cutover

New API endpoints (`/api/vehicles_v2`) read/write the canonical rows. Frontend swaps over page-by-page. Old endpoints stay alive for one phase as a deprecation surface, emitting a warning in logs. Once nothing reads the old shape, we drop the v1 read paths.

## Trade-offs you should know about

**Why not just add `UNIQUE` to `imported_leads_raw.norm_vin`?**
Two reasons. (1) The same VIN legitimately appears in multiple import batches over time (re-imports are normal). Uniqueness on the raw row blocks re-imports. (2) Even if we forced uniqueness there, `imported_leads_raw` mixes "the import event" (when, by whom, source list) with "the vehicle" (year, make, owner). Splitting them is the right normalization regardless of dedupe.

**Why not migrate in place?**
Could be done — add columns to `vehicles`, change semantics. But `vehicles` is referenced by `files.vehicle_id` and that referential meaning ("this file batch belongs to vehicle X") doesn't survive the change to "Vehicle = VIN." A new table avoids breaking those FK chains and lets us deprecate cleanly.

**Why are CRM fields on the Vehicle, not on a child `lead_states`?**
The product owns one CRM lifecycle per VIN. The current 1:1 split (`imported_leads_raw` ↔ `lead_states`) is the same row in two tables, costing us a JOIN every read. Inlining them is simpler and matches how operators think ("this vehicle is hot") instead of how the schema thinks ("this lead-state attached to this imported lead is hot").

## Open questions for you

1. **Year/Make/Model bound to the VIN itself, not the import?** If a Carfax import contradicts a TLO import on year, which wins? My instinct: most-recent-import wins; conflict gets logged in `vehicle_field_changes` so you can review. OK?
2. **Owner age — do we get this from TLO, or rarely?** If rarely, OK to keep nullable; otherwise we should validate it.
3. **What's the `status` enum supposed to be on the canonical vehicle?** Right now `lead_states.status` has 13 values mixing CRM lifecycle (new, contacted, callback) with disposition (do_not_call, disqualified, marketing). Worth splitting into two fields? Or keep monolithic?

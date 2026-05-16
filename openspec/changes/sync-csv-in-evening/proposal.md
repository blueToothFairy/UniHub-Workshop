## Why

UniHub validates workshop registrations against student records that exist only in a legacy university system with no API and no realtime feed, so the platform needs a one-way batch sync pipeline that ingests the legacy CSV export reliably enough to gate same-day registration without ever blocking live traffic.

## What Changes

- Introduce the `student-csv-import` capability: a scheduled, one-way CSV ingestion pipeline that parses, validates, deduplicates, and upserts student master data into the internal database.
- Run the pipeline on TWO daily windows — a nightly baseline import and an additional evening freshness pass — both driven by environment-configurable cron expressions that share a single import service code path.
- Detect whether a candidate CSV file is fresh enough to import by checking presence, non-empty size, sha256 content hash against successful-run history, and mtime against the latest successful run, so the same physical file is never effectively imported twice.
- Tolerate malformed input through per-row validation with reasons, and abort the whole run when the error rate exceeds a configurable threshold so a partly-corrupt dataset never replaces good data.
- Persist a durable import-run audit record for every attempt distinguishing `processed`, `skipped_missing`, `skipped_stale`, `failed_validation`, and `failed_runtime` outcomes with row counters, source metadata, and a human-readable reason.
- Keep registration and authentication serving the last successful dataset whenever a run is skipped, aborts, or fails at runtime — the new pipeline is non-blocking by construction.
- Archive successfully-processed source files into a `processed/` subdirectory stamped with run window and timestamp so reprocessing of the same physical file becomes impossible.

## Capabilities

### New Capabilities
- `student-csv-import`: One-way scheduled ingestion of student master data from the legacy CSV export, including dual-window scheduling (nightly + evening), file-freshness gating, per-row validation, threshold-based abort, idempotent reprocessing, and durable run-outcome observability.

### Modified Capabilities
- None.

## Impact

- Affected backend areas: `backend/src/modules/csv-import/` (service, cron, repository, types), application startup in `backend/src/app.ts` to register cron jobs, environment configuration via `backend/.env.example`, and durable storage via `backend/migrations/20260515_create_csv_import_runs.sql`.
- Affected operational systems: the shared CSV drop directory (`CSV_DROP_DIR`, default `data/csv/`), the PostgreSQL `users` upsert path for `role = 'student'` rows, and operator-facing structured logs/alert events.
- No breaking changes to student, organizer, or check-in staff APIs are intended — registration continues to read student records from the internal `users` table (rows with `role = 'student'`) and is unaware of which import run last populated them.
- Success targets: a valid 15,000-row file SHALL be ingested in under 10 minutes per run; registration P99 latency SHALL NOT degrade by more than 50 ms during an active import; an unavailable evening file SHALL produce a logged skip rather than any user-visible failure.
- No new monthly infrastructure cost: the pipeline runs in-process alongside the existing backend with a stdlib-only polling timer — no queue, no worker dyno, no managed file storage, no new external dependency.

## Out of Scope

- Replacing the legacy CSV feed with a direct API integration (the legacy system has no API).
- Converting CSV ingest into BullMQ jobs, an event-driven workflow, or a mobile-triggered sync.
- Building an organizer UI for manual upload, manual retry, or historical run browsing in this change.
- Persisting per-row failure detail (line numbers, reasons) durably for operator inspection — only aggregate counts and a top-level reason are stored.
- Soft-deactivating students who disappear from a later CSV export (a separate dataset-lifecycle decision).
- Changing mobile check-in, workshop roster sync, registration payment, or QR attendance flows.

## Context

UniHub's student eligibility check during workshop registration depends entirely on student master data that originates in the university's legacy Student Management System. That system has no API, no webhook, and no realtime export — its sole integration channel is a CSV file produced overnight and dropped into a shared directory the UniHub backend can read. Without a robust batch import pipeline, the registration module has nothing to validate against, so this capability sits on the critical path for the entire workshop registration flow.

The project's original blueprint assumed a single nightly import at 02:05 AM local time, but operational reality also demands a second freshness window: same-day student admissions and enrolment corrections made at the registrar's office in the morning would not appear in UniHub until the next night if there were only one schedule. At the same time, the integration must remain strictly one-way, must tolerate corrupt or truncated CSV output, must never block registration during a run, and must remain idempotent so operations staff can replay the job without fear of double-applying a dataset.

Stakeholders are: organizers who depend on fresh student rosters before evening workshops; check-in staff and registration code paths that must always see *some* valid dataset; operators who need clear outcome signals when a scheduled run produces no useful work; and the registrar (upstream) whose CSV format and emission cadence are outside UniHub's control.

## Goals / Non-Goals

**Goals:**
- Provide an end-to-end batch import pipeline (parse → validate → dedupe → upsert → archive → record) that runs entirely from a scheduled cron context with no human or mobile triggering.
- Support two daily run windows (nightly baseline + evening freshness pass) via the same service code path, switched by a `runWindow` parameter only.
- Detect three "no useful work to do" conditions before any write: missing file, empty file, and stale file (already-processed content hash or older mtime than the latest successful run).
- Tolerate corrupt source files by counting bad rows separately and aborting the whole run when the error rate exceeds a configurable threshold.
- Preserve the last successful student dataset whenever any run is skipped, aborted, or crashes mid-execution.
- Produce a durable run-outcome record with enough metadata that an operator reading logs days later can diagnose what happened without re-running the job.

**Non-Goals:**
- Replacing the legacy CSV feed with an API-based integration (the upstream system has no API).
- Partial commits: never apply *some* rows from a CSV whose error rate exceeded the threshold.
- Soft-deactivation of students missing from a newer CSV (a separate dataset-lifecycle question).
- Per-row failure detail persistence beyond aggregate counts and a top-level reason.
- A frontend admin page for manual CSV upload, retry, or run history in this change.
- Converting this into BullMQ work or extracting it to a separate worker process — current volume (~15k rows × 2/day) does not justify the operational overhead.

## Decisions

### Decision 1: Two scheduled windows share one service, switched by a `runWindow` parameter

The same `CsvImportService.runImport(runWindow)` method handles both `nightly` and `evening` cron firings. The cron registration layer is the only place that knows which window is firing; the import logic itself is window-agnostic except that the recorded outcome row carries the window label.

This avoids two code paths drifting apart and keeps validation, dedupe, and upsert semantics identical between runs. The window label exists for observability and for future per-window policy (e.g. different error thresholds), not for branching logic today.

Alternatives considered:
- Two separate importers per window. Rejected: duplicated parsing/upsert would diverge in maintenance.
- A single importer that polls hourly and decides internally. Rejected: increases I/O churn and obscures schedule from operators; explicit cron expressions are auditable.

### Decision 2: File-freshness is determined by sha256 + mtime + run history, not filename

A candidate CSV is considered fresh enough to import only when ALL of:
1. The file exists at `CSV_DROP_DIR/CSV_IMPORT_FILENAME`.
2. Its size is greater than zero.
3. Its sha256 content hash does not match any previously-successful run's `source_sha256`.
4. Its mtime is strictly newer than the most recent successful run's `source_modified_at`.

Each gate has a distinct skip outcome (`skipped_missing`, `failed_validation` for empty, `skipped_stale` for both duplicate-hash and older-mtime). The durable `csv_import_runs` table is the single source of truth for "have we processed this before?".

This avoids the major failure mode of a second daily schedule: re-importing yesterday's file at 18:05 and giving a false impression of freshness.

Alternatives considered:
- Filename-based freshness (e.g. `students-2026-05-15.csv`). Rejected: the brief does not guarantee a stable naming convention from the upstream producer.
- mtime alone. Rejected: a `touch` or filesystem-level operation could spuriously refresh mtime without changing content; sha256 catches this.
- Hash alone. Rejected: mtime catches the case where the producer intentionally re-emits semantically-identical content (e.g. timestamp-only differences) that we still consider a refresh.

### Decision 3: Pipeline shape is fixed; per-row threshold-abort prevents partial corruption

Every run follows the same shape:

```
locate file → compute metadata (size, mtime, sha256)
  → freshness gates (missing? empty? duplicate hash? stale mtime?)
  → stream-parse rows (line-buffered, BOM-stripped, quoted-field aware)
  → per-row validate (student_id /^SV\d{6}$/, email, full_name)
  → in-memory dedupe by student_id (last-wins)
  → if error_rate > CSV_ERROR_THRESHOLD → abort, no writes
  → repository.applyStudentRows(rows) → archive source → completeRun(processed)
```

Above the threshold (default 10%), the run aborts atomically and the previous dataset stays active. Below the threshold, all *valid* rows are upserted; invalid rows are counted but not surfaced individually (a follow-up change can persist per-row detail if operators need it).

This matches the constraint "must tolerate corrupt CSV" without committing partially-broken state — corruption either falls within tolerated noise (commit valid rows) or trips the threshold (commit nothing).

Alternatives considered:
- Per-row commit-or-skip with no threshold. Rejected: a fully corrupt file would silently leave the dataset in an inconsistent state.
- Two-phase staging table (load → validate → swap). Rejected for this iteration: ~15k rows fits comfortably in memory, and the upsert + archive pair gives the atomicity actually needed.

### Decision 4: Run failures are non-blocking; last successful dataset remains authoritative

Any run that ends with `skipped_missing`, `skipped_stale`, `failed_validation`, or `failed_runtime` leaves the existing `users` student rows untouched. Registration and authentication continue serving the last successful dataset with zero downtime. Operators see the failure via structured logs and the `csv_import_runs` audit row; students see nothing.

This is the safest stance for a one-way auxiliary feed. Treating CSV freshness as a hard dependency for registration would turn an upstream hiccup into a UniHub-visible outage.

Alternatives considered:
- Fail-closed: block registration until a fresh import succeeds. Rejected: turns an auxiliary sync into a user-facing SLA dependency on a system we don't control.
- Partial apply on runtime failure. Rejected: leaves the dataset in an unknown state and defeats idempotency.

### Decision 5: Durable observability via `csv_import_runs`, not console logs alone

Every run — successful, skipped, or failed — writes a row to `csv_import_runs` capturing run window, start/finish timestamps, source file metadata (path, filename, size, mtime, sha256), row counters, outcome category, and a human-readable reason for non-success cases. The same payload is also emitted as structured JSON to stdout for log aggregation, plus a `warn`-level alert event for failures.

This data contract is small (one row per run) but sufficient to power a future admin UI without rework. It also makes acceptance testing possible: a smoke test can read back the run record instead of grepping logs.

Alternatives considered:
- Console logs only. Rejected: scheduled jobs need durable evidence for debugging and reporting.
- Build an admin UI immediately. Rejected: out of scope for this change; the durable record is the prerequisite for that future work.

### Decision 6: In-process polling-timer "cron", not `node-cron` or a separate worker

The scheduler is a `setInterval` that ticks every 30 seconds, parses the configured `m h * * *` schedule, and invokes `service.runImport(window)` once per matching minute-slot per window (deduped by `<date>-<hour>-<minute>` slot key). It runs inside the main API process.

This stays inside Node's stdlib (no `node-cron`), keeps deployment simple (no separate worker dyno), and exploits the streaming parse + chunked writes to remain non-blocking for HTTP traffic. The 30-second tick interval is well under the minute granularity of the schedule, and the slot-key dedupe prevents double-firing on slow ticks.

Alternatives considered:
- `node-cron` library. Rejected: a small new dependency for behaviour expressible in ~30 lines.
- Extract to a dedicated worker process. Rejected for this iteration: ~15k rows × twice a day is well within the API process's headroom, and a separate worker would need its own deploy/health/monitoring footprint with no offsetting benefit at current scale.

## Risks / Trade-offs

- [The legacy system may not produce a distinct evening file, so the evening run will commonly find only the nightly file already processed] → Distinct `skipped_stale` and `skipped_missing` outcomes give operators a clear signal that "no fresh work" is the healthy state, not a bug.
- [In-process cron will fire once per API replica if the backend ever scales horizontally] → The deployment topology is single-VPS today; if this changes, a leader-election gate (Redis `SET NX` with TTL keyed on `<window>-<date>`) is the smallest follow-up.
- [The 30-second polling timer drifts under heavy event-loop load] → The minute-slot dedupe makes drift safe: missing the exact minute by a few seconds still lands within the slot; the run fires on the next tick that matches.
- [Per-row failure detail is not persisted, so an operator cannot tell *which* rows failed without re-running with debug logging] → Acceptable initial trade-off; counters plus threshold-abort cover the dangerous cases. A follow-up change can add `csv_import_run_errors` if operators need it.
- [In-memory dedupe by `student_id` requires the whole file to fit in memory] → For ~15k rows × ~150 bytes the heap footprint is roughly 2 MB. Even at 10× growth this remains trivial.
- [The same physical file is archived under the first successful run's timestamp; replaying after archive requires manual restore] → Acceptable: archive happens only after a successful run; failed/skipped runs leave the file in place for retry.
- [sha256 of large files is CPU-bound and blocks the event loop briefly] → For 15k-row files (~3 MB) this is single-digit milliseconds; for larger files we can switch to streaming hash with explicit `setImmediate` yields.

## Migration Plan

1. Apply migration `20260515_create_csv_import_runs.sql` via the direct (port 5432) Postgres connection.
2. Deploy backend with `CSV_IMPORT_ENABLED=false` initially to land code without firing any job.
3. Verify the migration shape and that `loadCsvImportJobDefinitions` returns an empty array when disabled.
4. Set `CSV_IMPORT_ENABLED=true`, `CSV_IMPORT_NIGHTLY_CRON`, and `CSV_IMPORT_EVENING_CRON` per environment; redeploy.
5. Run smoke tests for: fresh-file processed path, stale-file skip, missing-file skip, validation-abort path, and same-file rerun idempotency.
6. Watch one full nightly + evening cycle in production logs and verify the resulting `csv_import_runs` rows.

**Rollback strategy:**
- Set `CSV_IMPORT_ENABLED=false` and redeploy; no schedules will register.
- The `csv_import_runs` table is additive and can stay in place for diagnostic value even if the feature is disabled.
- The migration is non-destructive to existing tables (the `users` table is untouched by this migration aside from an additive `uq_users_student_id` unique index where `student_id IS NOT NULL`).

## Open Questions

- Does the legacy producer write its evening update under the same filename (`students.csv`) or to a date-stamped variant? Current code assumes a single fixed filename via `CSV_IMPORT_FILENAME`.
- Should `skipped_stale` for "already-processed hash" and `skipped_stale` for "older mtime" be merged into one outcome (current behaviour) or split into `skipped_duplicate` and `skipped_stale` for clearer operator signal?
- Should evening run failures trigger an immediate operator notification (email via Resend, or in-app alert) or is the current structured-`warn` log sufficient until a dashboard exists?
- What is the canonical "evening" time — currently a default of `5 18 * * *` (18:05 local) with env override; do organizers need this configurable per workshop day?

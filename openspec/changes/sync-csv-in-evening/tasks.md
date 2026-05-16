## 1. Data Model and Run Persistence

- [x] 1.1 Add database migration `20260515_create_csv_import_runs.sql` for CSV import run history including run window, source file identity (path, filename, size, mtime, sha256), outcome category, row counters, timestamps, and reason — supports `student-csv-import` "Every import run is durably recorded" requirement and `design.md` Decision 2 and Decision 5.
- [x] 1.2 Define TypeScript types/interfaces for `CsvImportRunWindow`, `CsvImportRunOutcome`, `CsvImportSourceMetadata`, `CsvImportCounters`, `CsvImportExecutionResult`, and the narrow `CsvImportRepositoryContract` consumed by the service — supports `student-csv-import` durable-record requirement and the SOLID Interface Segregation guideline (types before service).
- [x] 1.3 Implement repository helpers in `csv-import.repository.ts` for `createRun`, `completeRun`, `getLatestSuccessfulRun`, `getSuccessfulRunBySourceHash`, and `applyStudentRows` — supports `student-csv-import` "Successfully-processed source files are archived", "Import upserts student records non-destructively per run", and idempotency requirements.
- [x] 1.4 Manual smoke test: run the migration against a local Postgres instance and exercise each repository method, verifying the `csv_import_runs` table accepts and returns the expected row shape.

## 2. Import Service Pipeline

- [x] 2.1 Implement `CsvImportService.runImport(runWindow)` in `csv-import.service.ts` with constructor-injected repository, clock, and logger so it can be unit-tested without module-level singletons — supports `design.md` Decision 1 (single service for both windows) and the Dependency Inversion guideline.
- [x] 2.2 Implement file freshness gates (missing file → `skipped_missing`, empty file → `failed_validation`, duplicate sha256 → `skipped_stale`, older mtime → `skipped_stale`) before any parse work begins — supports `student-csv-import` "System only imports source files that are fresh enough" requirement and `design.md` Decision 2.
- [x] 2.3 Implement streaming CSV parser with BOM stripping, quoted-field handling, and blank-line skipping; per-row validation of `student_id`, `email`, and `full_name`; and in-memory dedupe by `student_id` (last-wins) — supports `student-csv-import` "System parses and validates each CSV row" and "System deduplicates rows that share a student_id" requirements.
- [x] 2.4 Implement threshold-based abort: when `errorRows / totalRows > CSV_ERROR_THRESHOLD`, record `failed_validation` and exit without calling `applyStudentRows` — supports `student-csv-import` "System tolerates corrupt files via a threshold-based abort" requirement and `design.md` Decision 3.
- [x] 2.5 Wire successful path to `applyStudentRows` → archive source file under `processed/` → `completeRun(processed)`; wire runtime catch-all to `completeRun(failed_runtime)` with the error message — supports `student-csv-import` "Successfully-processed source files are archived", "Import failures leave the last successful dataset active", and idempotency requirements.
- [x] 2.6 Manual smoke test: exercise fresh-file, missing-file, empty-file, stale-by-hash, stale-by-mtime, validation-abort, runtime-error, and same-file-rerun paths against the service layer using a temporary drop directory.

## 3. Scheduling and Configuration

- [x] 3.1 Add environment configuration in `backend/.env.example` for `CSV_IMPORT_ENABLED`, `CSV_IMPORT_NIGHTLY_CRON`, `CSV_IMPORT_EVENING_CRON`, `CSV_IMPORT_TIMEZONE`, `CSV_DROP_DIR`, `CSV_IMPORT_FILENAME`, and `CSV_ERROR_THRESHOLD` — supports `design.md` Decision 1, Decision 6, and Open Questions.
- [x] 3.2 Implement `loadCsvImportJobDefinitions(env)` that returns an empty array when imports are disabled and otherwise yields both `nightly` and `evening` schedule definitions — supports `student-csv-import` nightly and evening schedule requirements and the disabled-globally scenario.
- [x] 3.3 Implement `registerCsvImportJobs(service, options)` as a 30-second polling timer with minute-slot dedupe per `runWindow`, calling `service.runImport(runWindow)` only when the parsed `m h * * *` schedule matches the current timezone-local minute — supports `design.md` Decision 6 (in-process cron) without violating SRP (parsing remains in service, scheduling remains in cron file).
- [x] 3.4 Register the cron jobs from `backend/src/app.ts` startup path so both nightly and evening schedules fire in production — supports `student-csv-import` nightly and evening schedule firing scenarios.
- [x] 3.5 Manual smoke test: confirm `loadCsvImportJobDefinitions` produces both schedules when enabled, neither when disabled, and that the cron module invokes the shared service with the correct `runWindow` argument when its tick matches.

## 4. Observability and Operator Signals

- [x] 4.1 Persist success, skip, and failure summaries via `repository.completeRun` for every terminal outcome, including top-level reason fields and source-metadata snapshot — supports `student-csv-import` "Every import run is durably recorded" requirement.
- [x] 4.2 Emit structured JSON logs (`student_csv_import_run`) from the service for every completed run and an additional `student_csv_import_alert` warn-level event for failure outcomes — supports `student-csv-import` "Run outcomes are emitted as structured logs and alert events" requirement and `design.md` Decision 5.
- [x] 4.3 Document the new environment variables, expected run outcomes, and operator fallback behaviour in `README.md` and/or `backend/.env.example` so operators can interpret logs and adjust thresholds without reading code.
- [x] 4.4 Manual smoke test: verify logs and persisted run records clearly differentiate `processed`, `skipped_missing`, `skipped_stale`, `failed_validation`, and `failed_runtime`, including that failure outcomes produce both the run log and the alert event.

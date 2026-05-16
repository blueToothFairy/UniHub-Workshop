## ADDED Requirements

### Requirement: System ingests student master data from a one-way CSV feed
The system SHALL maintain its authoritative student records by importing CSV exports produced by the legacy Student Management System. UniHub MUST NOT call legacy APIs and MUST NOT push data back to the legacy system. Student records are persisted as rows in the internal `users` table with `role = 'student'`.

#### Scenario: Registration reads only the internal student records
- **WHEN** a student attempts to register for a workshop
- **THEN** the registration service SHALL validate the student against the internal `users` table (rows with `role = 'student'`) populated by the CSV import pipeline
- **THEN** the registration service SHALL NOT contact the legacy system or read its filesystem directly

#### Scenario: Import pipeline writes only to internal storage
- **WHEN** a CSV import run completes
- **THEN** the system SHALL mutate only internal database tables (`users`, `csv_import_runs`) and the local filesystem under the configured drop directory
- **THEN** the system SHALL NOT write to or call any legacy endpoint

### Requirement: System runs scheduled CSV imports on a nightly baseline window
The system SHALL execute a CSV import on a configurable nightly cron schedule (`CSV_IMPORT_NIGHTLY_CRON`, default `5 2 * * *`) without any human or mobile-triggered action.

#### Scenario: Nightly schedule fires
- **WHEN** the configured nightly cron expression matches the current local time in the configured timezone
- **THEN** the backend SHALL invoke the CSV import service with `runWindow = "nightly"`
- **THEN** the run SHALL be recorded in `csv_import_runs` with `run_window = "nightly"`

### Requirement: System runs a second CSV import on an evening freshness window
The system SHALL execute an additional CSV import on a configurable evening cron schedule (`CSV_IMPORT_EVENING_CRON`, default `5 18 * * *`) so that same-day student updates from the registrar become visible before evening workshops.

#### Scenario: Evening schedule fires
- **WHEN** the configured evening cron expression matches the current local time
- **THEN** the backend SHALL invoke the same CSV import service with `runWindow = "evening"`
- **THEN** the evening run SHALL use the identical parse, validation, dedupe, and upsert pipeline as the nightly run

#### Scenario: Scheduled imports can be globally disabled
- **WHEN** the environment variable `CSV_IMPORT_ENABLED` is not the string `"true"`
- **THEN** the system SHALL register neither the nightly nor the evening cron job at startup
- **THEN** the system SHALL log a single startup message indicating that scheduled CSV imports are disabled

### Requirement: System only imports source files that are fresh enough
The system SHALL determine whether a candidate CSV file is fresh enough to import by verifying ALL of: the file exists, its size is greater than zero, its sha256 content hash does not match any previously-successful run, and its mtime is strictly newer than the most recent successful run's `source_modified_at`.

#### Scenario: Fresh candidate file is present
- **WHEN** a scheduled run finds a CSV file with non-zero size, a sha256 not present in `csv_import_runs.source_sha256` for any successful run, and an mtime newer than the latest successful run's `source_modified_at`
- **THEN** the system SHALL proceed to parse and validate the file
- **THEN** the system SHALL persist the source metadata (path, filename, size, mtime, sha256) on the run record

#### Scenario: Candidate file is missing
- **WHEN** no file exists at the configured CSV drop path at run time
- **THEN** the system SHALL not mutate any student records
- **THEN** the system SHALL record the run outcome as `skipped_missing` with a reason naming the inspected path

#### Scenario: Candidate file is empty
- **WHEN** the candidate file exists but has zero bytes
- **THEN** the system SHALL not mutate any student records
- **THEN** the system SHALL record the run outcome as `failed_validation` with the reason `"CSV file is empty"`

#### Scenario: Candidate file content has already been processed
- **WHEN** the candidate file's sha256 matches the `source_sha256` of any previously-successful run
- **THEN** the system SHALL not mutate any student records
- **THEN** the system SHALL record the run outcome as `skipped_stale` and reference the run id that originally processed the same content

#### Scenario: Candidate file is older than the latest successful run
- **WHEN** the candidate file's mtime is less than or equal to the latest successful run's `source_modified_at`
- **THEN** the system SHALL not mutate any student records
- **THEN** the system SHALL record the run outcome as `skipped_stale` with both timestamps captured in the reason

### Requirement: System parses and validates each CSV row
The system SHALL stream-parse the CSV file line by line — stripping BOM, honouring quoted fields, and skipping blank lines — and validate every data row's `student_id`, `email`, and `full_name` before considering the row for upsert.

#### Scenario: Row passes validation
- **WHEN** a row's `student_id` matches `/^SV\d{6}$/`, its email is syntactically valid, and its `full_name` is non-empty and no longer than 255 characters
- **THEN** the system SHALL include the row in the candidate set for upsert

#### Scenario: Row fails validation
- **WHEN** a row fails any field-level check (bad `student_id` format, malformed email, missing or oversized `full_name`)
- **THEN** the system SHALL count the row as an error with a short reason string
- **THEN** the system SHALL continue parsing the remaining rows in the same run

### Requirement: System tolerates corrupt files via a threshold-based abort
The system SHALL abort a run without applying any student writes when the per-row validation error rate exceeds a configurable threshold (`CSV_ERROR_THRESHOLD`, default `0.10`).

#### Scenario: Error rate exceeds threshold
- **WHEN** the count of invalid rows divided by total parsed rows is strictly greater than `CSV_ERROR_THRESHOLD`
- **THEN** the system SHALL NOT invoke the student upsert path
- **THEN** the system SHALL record the run outcome as `failed_validation` with a reason quoting the observed and configured rates

#### Scenario: Error rate is within threshold
- **WHEN** the error rate is less than or equal to `CSV_ERROR_THRESHOLD`
- **THEN** the system SHALL upsert the deduplicated valid rows
- **THEN** the system SHALL record both valid and error counts on the run record

### Requirement: System deduplicates rows that share a student_id within one file
The system SHALL deduplicate rows during parse so that a single `student_id` produces at most one upsert per run, with the last occurrence in file order winning.

#### Scenario: Duplicate student_id appears twice in one file
- **WHEN** two rows in the same CSV file share the same `student_id` and both pass validation
- **THEN** the system SHALL retain only the second occurrence as the row to upsert
- **THEN** both rows SHALL count toward `total_rows` while `valid_rows` SHALL reflect the deduplicated set actually presented to the upsert path

### Requirement: Import is idempotent across repeated runs of the same source file
The system MUST guarantee that re-running an import against an already-processed source file does not produce a second effective dataset replacement. Idempotency is enforced by source-file freshness comparison plus the existing row upsert semantics.

#### Scenario: Same file is processed twice in the same day
- **WHEN** the evening run encounters the same physical file (identical sha256) that the nightly run already processed successfully
- **THEN** the system SHALL record the outcome as `skipped_stale` without re-parsing or re-upserting

#### Scenario: A newer file genuinely arrives between runs
- **WHEN** a file with a different sha256 and a newer mtime than the latest successful run becomes available
- **THEN** the system SHALL process the new file and replace the dataset through the normal pipeline

### Requirement: Import upserts student records non-destructively per run
The system SHALL upsert validated rows into the `users` table (role `student`) such that previously-imported students remain present until explicitly replaced by a successful run. The upsert SHALL be idempotent at the row level and SHALL match existing students by `student_id` OR case-insensitive `email`.

#### Scenario: New student in the file
- **WHEN** a validated row contains a `student_id` and email that do not match any existing `users` row with `role = 'student'`
- **THEN** the system SHALL insert a new row into `users` with `role = 'student'`, a generated UUID id, the provided `student_id`, `email`, and `full_name`
- **THEN** the system SHALL set `password_hash` to a bcrypt hash of the `student_id` and set `force_change_password = true` so the student must set a new password on first login
- **THEN** the system SHALL count the row toward `inserted_rows`

#### Scenario: Existing student appears with updated attributes
- **WHEN** a validated row's `student_id` already exists in `users` (role `student`) OR its email matches an existing student row case-insensitively
- **THEN** the system SHALL update that user's `student_id`, `email`, and `full_name` in place and refresh `updated_at`
- **THEN** the system SHALL count the row toward `updated_rows`

### Requirement: Import does not interrupt live system traffic
The system SHALL execute imports in the background of the main backend process using streaming parse and database writes that do not block HTTP request handling for more than tens of milliseconds at a time.

#### Scenario: Import runs concurrently with registration traffic
- **WHEN** a CSV import is in progress and a registration request arrives at the API
- **THEN** the registration request SHALL be handled against the current (last-successful) student dataset
- **THEN** the registration request SHALL NOT wait for the import to finish before completing

#### Scenario: Eventual consistency across the registration boundary
- **WHEN** a fresh import has just been recorded as `processed`
- **THEN** subsequent registration requests SHALL observe the new dataset on their next read against `users` (role `student`)
- **THEN** the system SHALL NOT provide any synchronous "sync now" mechanism — freshness is bounded by the cron schedule only

### Requirement: Import failures leave the last successful dataset active
The system SHALL preserve the most recently successfully-imported student dataset whenever any run is skipped, fails validation, or fails at runtime.

#### Scenario: Validation-threshold abort
- **WHEN** a run aborts because its per-row error rate exceeded `CSV_ERROR_THRESHOLD`
- **THEN** the `users` student rows SHALL remain unchanged
- **THEN** registration and authentication SHALL continue to validate students against the previously-imported dataset

#### Scenario: Runtime failure mid-import
- **WHEN** an unhandled exception is thrown after the run has started (for example a database error during upsert)
- **THEN** the system SHALL record the run outcome as `failed_runtime` with the error message captured as the reason
- **THEN** previously-active student data SHALL remain available to downstream readers without manual intervention

### Requirement: Successfully-processed source files are archived
The system SHALL move the source CSV file into a `processed/` subdirectory of the drop directory after a successful run, stamped with run window and timestamp, so the same physical file cannot be re-read by a later run.

#### Scenario: Successful run archives the source file
- **WHEN** an import run completes with outcome `processed`
- **THEN** the system SHALL rename the source file to `{drop_dir}/processed/{iso_stamp}-{run_window}-{filename}`
- **THEN** subsequent scheduled runs SHALL find no candidate file at the original drop path until a new export arrives

#### Scenario: Skipped or failed run leaves the source file in place
- **WHEN** an import run completes with any outcome other than `processed`
- **THEN** the system SHALL NOT move or rename the source file
- **THEN** the file SHALL remain available at its original drop path for diagnostic inspection and retry

### Requirement: Every import run is durably recorded
The system SHALL persist a `csv_import_runs` row for every import attempt, capturing run window, start timestamp, finish timestamp, source file metadata (path, filename, size, mtime, sha256), row counters (total, valid, error, inserted, updated), outcome category, and a human-readable reason for non-success cases.

#### Scenario: Successful run is recorded
- **WHEN** an import completes successfully
- **THEN** a row SHALL be written to `csv_import_runs` with `outcome = "processed"`, all source metadata fields populated, and non-zero counters reflecting the work done

#### Scenario: Skipped or failed run is recorded
- **WHEN** an import is skipped or fails at any stage (missing, empty, stale, threshold-abort, runtime error)
- **THEN** a row SHALL be written to `csv_import_runs` with the matching outcome category and a non-empty `reason` field
- **THEN** counters not applicable to the outcome SHALL be stored as zero

### Requirement: Run outcomes are emitted as structured logs and alert events
The system SHALL emit a structured JSON log line for every completed run and an additional warn-level alert event for failure outcomes, both keyed by run window and outcome category, so log aggregators can route on shape rather than parsing free text.

#### Scenario: Successful run is logged
- **WHEN** a run completes with `outcome = "processed"`
- **THEN** the system SHALL emit `console.info` with a JSON payload of type `student_csv_import_run` including run id, run window, outcome, source filename, source modified-at, and row counters

#### Scenario: Failed run emits an alert event
- **WHEN** a run completes with outcome `failed_validation` or `failed_runtime`
- **THEN** the system SHALL emit `console.error` with the run payload
- **THEN** the system SHALL emit `console.warn` with a JSON payload of type `student_csv_import_alert` carrying severity, run window, outcome, and reason

#### Scenario: Skipped run is logged without alert
- **WHEN** a run completes with outcome `skipped_missing` or `skipped_stale`
- **THEN** the system SHALL emit `console.warn` with the run payload so the run is visible in logs
- **THEN** the system SHALL NOT emit a `student_csv_import_alert` event for the skip

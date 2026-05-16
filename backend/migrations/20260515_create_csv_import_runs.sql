CREATE UNIQUE INDEX IF NOT EXISTS uq_users_student_id
ON users(student_id)
WHERE student_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS csv_import_runs (
  id UUID PRIMARY KEY,
  run_window TEXT NOT NULL CHECK (run_window IN ('nightly', 'evening')),
  outcome TEXT NOT NULL CHECK (
    outcome IN (
      'running',
      'processed',
      'skipped_missing',
      'skipped_stale',
      'failed_validation',
      'failed_runtime'
    )
  ),
  source_path TEXT,
  source_filename TEXT,
  source_size_bytes BIGINT,
  source_modified_at TIMESTAMPTZ,
  source_sha256 TEXT,
  total_rows INTEGER,
  valid_rows INTEGER,
  error_rows INTEGER,
  inserted_rows INTEGER,
  updated_rows INTEGER,
  reason TEXT,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_csv_import_runs_window_started_at
ON csv_import_runs(run_window, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_csv_import_runs_outcome_started_at
ON csv_import_runs(outcome, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_csv_import_runs_success_modified_at
ON csv_import_runs(source_modified_at DESC)
WHERE outcome = 'processed';

CREATE UNIQUE INDEX IF NOT EXISTS uq_csv_import_runs_source_sha256
ON csv_import_runs(source_sha256)
WHERE source_sha256 IS NOT NULL AND outcome = 'processed';

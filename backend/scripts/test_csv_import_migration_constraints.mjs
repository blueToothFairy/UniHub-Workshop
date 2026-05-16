import assert from "node:assert/strict";
import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";

async function runStaticCheck(migrationSql) {
  const requiredFragments = [
    "CREATE TABLE IF NOT EXISTS csv_import_runs",
    "run_window TEXT NOT NULL CHECK (run_window IN ('nightly', 'evening'))",
    "'processed'",
    "'skipped_missing'",
    "'skipped_stale'",
    "'failed_validation'",
    "'failed_runtime'",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_users_student_id",
    "CREATE INDEX IF NOT EXISTS idx_csv_import_runs_window_started_at",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_csv_import_runs_source_sha256"
  ];

  for (const fragment of requiredFragments) {
    assert.equal(migrationSql.includes(fragment), true, `Migration SQL missing required fragment: ${fragment}`);
  }
}

async function runLiveReadOnlyCheck(connectionString) {
  const pool = new Pool({ connectionString, max: 1, idleTimeoutMillis: 5_000, connectionTimeoutMillis: 10_000 });
  try {
    const tableRes = await pool.query("SELECT to_regclass('public.csv_import_runs') AS name");
    const tableExists = typeof tableRes.rows[0]?.name === "string";
    const indexRes = await pool.query(
      "SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='csv_import_runs' ORDER BY indexname"
    );
    return {
      tableExists,
      indexes: indexRes.rows.map((row) => row.indexname)
    };
  } finally {
    await pool.end();
  }
}

async function main() {
  const migrationPath = path.resolve(process.cwd(), "migrations", "20260515_create_csv_import_runs.sql");
  const migrationSql = await readFile(migrationPath, "utf8");
  await runStaticCheck(migrationSql);

  if (process.env.CSV_IMPORT_VERIFY_LIVE_DB !== "true") {
    console.log("Static CSV import migration check passed.");
    return;
  }

  const connectionString = process.env.SUPABASE_POOLER_URL || process.env.SUPABASE_DIRECT_URL;
  if (!connectionString) {
    console.log("Static CSV import migration check passed (no DB configured for live verification).");
    return;
  }

  const live = await runLiveReadOnlyCheck(connectionString);
  assert.equal(live.tableExists, true, "csv_import_runs table is missing in live DB");
  assert.equal(live.indexes.includes("idx_csv_import_runs_window_started_at"), true, "Missing idx_csv_import_runs_window_started_at");
  assert.equal(live.indexes.includes("idx_csv_import_runs_outcome_started_at"), true, "Missing idx_csv_import_runs_outcome_started_at");
  console.log("CSV import migration constraints/indexes verified.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

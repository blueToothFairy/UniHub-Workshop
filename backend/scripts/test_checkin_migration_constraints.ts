import assert from "node:assert/strict";
import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";

type LiveCheckResult = {
  tableExists: boolean;
  constraints: string[];
  indexes: string[];
};

async function runStaticCheck(migrationSql: string): Promise<void> {
  const requiredFragments: string[] = [
    "CREATE TABLE IF NOT EXISTS workshop_checkins",
    "CONSTRAINT uq_workshop_checkins_registration UNIQUE (registration_id)",
    "CONSTRAINT chk_workshop_checkins_device_pair CHECK",
    "CREATE UNIQUE INDEX IF NOT EXISTS uq_workshop_checkins_staff_device_scan",
    "CREATE INDEX IF NOT EXISTS idx_workshop_checkins_workshop_id",
    "CREATE INDEX IF NOT EXISTS idx_workshop_checkins_checked_in_by"
  ];

  for (const fragment of requiredFragments) {
    assert.equal(
      migrationSql.includes(fragment),
      true,
      `Migration SQL missing required fragment: ${fragment}`
    );
  }
}

async function runLiveReadOnlyCheck(connectionString: string): Promise<LiveCheckResult> {
  const pool = new Pool({ connectionString, max: 1, idleTimeoutMillis: 5_000, connectionTimeoutMillis: 10_000 });
  try {
    const tableRes = await pool.query<{ name: string | null }>("SELECT to_regclass('public.workshop_checkins') AS name");
    const tableExists = typeof tableRes.rows[0]?.name === "string";

    const constraintRes = await pool.query<{ conname: string }>(
      "SELECT conname FROM pg_constraint WHERE conrelid = 'public.workshop_checkins'::regclass ORDER BY conname"
    );
    const constraints = constraintRes.rows.map((r) => r.conname);

    const indexRes = await pool.query<{ indexname: string }>(
      "SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='workshop_checkins' ORDER BY indexname"
    );
    const indexes = indexRes.rows.map((r) => r.indexname);

    return { tableExists, constraints, indexes };
  } finally {
    await pool.end();
  }
}

async function main() {
  const migrationPath = path.resolve(process.cwd(), "migrations", "20260510_create_workshop_checkins.sql");
  const migrationSql = await readFile(migrationPath, "utf8");

  await runStaticCheck(migrationSql);

  const connectionString = process.env.SUPABASE_POOLER_URL || process.env.SUPABASE_DIRECT_URL;
  if (!connectionString) {
    console.log("Static migration check passed (no DB configured for live verification).");
    return;
  }

  const live = await runLiveReadOnlyCheck(connectionString);
  assert.equal(live.tableExists, true, "workshop_checkins table is missing in live DB");

  assert.equal(
    live.constraints.includes("uq_workshop_checkins_registration"),
    true,
    "Missing unique constraint uq_workshop_checkins_registration"
  );
  assert.equal(
    live.constraints.includes("chk_workshop_checkins_device_pair"),
    true,
    "Missing check constraint chk_workshop_checkins_device_pair"
  );

  const requiredIndexes = [
    "uq_workshop_checkins_staff_device_scan",
    "idx_workshop_checkins_workshop_id",
    "idx_workshop_checkins_checked_in_by"
  ];
  for (const index of requiredIndexes) {
    assert.equal(live.indexes.includes(index), true, `Missing index ${index}`);
  }

  console.log("Checkin migration constraints/indexes verified.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

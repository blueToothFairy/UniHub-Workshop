/**
 * Manual demo for evening (and optional nightly) CSV import.
 *
 * Prerequisites:
 *   1. npm run build
 *   2. Migration applied: npm run migrate:run  (or run 20260515_create_csv_import_runs.sql)
 *   3. SUPABASE_POOLER_URL set in backend/.env
 *
 * Quick start:
 *   npm run demo:csv-import:evening:prepare   # copy demo CSV into CSV_DROP_DIR
 *   npm run demo:csv-import:evening           # run one evening import immediately
 *
 * Flags:
 *   --prepare          Copy data/csv/demo/students.csv → drop dir (overwrites target)
 *   --simulate-cron    Fire the in-process scheduler once at the current local minute
 *   --window evening   Run window for direct import (default: evening)
 */
import { copyFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "..");

dotenv.config({ path: path.join(backendRoot, ".env") });

const args = new Set(process.argv.slice(2));
const runWindow = process.argv.includes("--window")
  ? process.argv[process.argv.indexOf("--window") + 1]
  : "evening";

function resolveDropPath() {
  const dropDir = process.env.CSV_DROP_DIR ?? path.join(backendRoot, "data", "csv");
  const filename = process.env.CSV_IMPORT_FILENAME ?? "students.csv";
  return {
    dropDir: path.isAbsolute(dropDir) ? dropDir : path.resolve(backendRoot, dropDir),
    filename,
    targetPath: path.join(
      path.isAbsolute(dropDir) ? dropDir : path.resolve(backendRoot, dropDir),
      process.env.CSV_IMPORT_FILENAME ?? "students.csv"
    )
  };
}

async function prepareDemoCsv() {
  const demoSource = path.join(backendRoot, "data", "csv", "demo", "students.csv");
  const { dropDir, targetPath } = resolveDropPath();
  await mkdir(dropDir, { recursive: true });
  await mkdir(path.join(dropDir, "processed"), { recursive: true });
  await copyFile(demoSource, targetPath);
  const fileStat = await stat(targetPath);
  console.log(`Prepared demo CSV:\n  from: ${demoSource}\n  to:   ${targetPath}\n  size: ${fileStat.size} bytes`);
}

async function printRecentRuns(database) {
  const result = await database.query(
    `SELECT id, run_window, outcome, reason, inserted_rows, updated_rows, started_at, finished_at
     FROM csv_import_runs
     ORDER BY started_at DESC
     LIMIT 5`
  );
  console.log("\nRecent csv_import_runs:");
  console.table(
    result.rows.map((row) => ({
      id: row.id.slice(0, 8),
      run_window: row.run_window,
      outcome: row.outcome,
      inserted: row.inserted_rows,
      updated: row.updated_rows,
      reason: row.reason ? String(row.reason).slice(0, 60) : null,
      started_at: row.started_at
    }))
  );
}

async function runDirectImport() {
  if (!process.env.SUPABASE_POOLER_URL) {
    throw new Error("SUPABASE_POOLER_URL is required in backend/.env");
  }
  if (!["evening", "nightly"].includes(runWindow)) {
    throw new Error(`Invalid --window "${runWindow}". Use "evening" or "nightly".`);
  }

  const { CsvImportRepository } = await import("../dist/modules/csv-import/csv-import.repository.js");
  const { CsvImportService } = await import("../dist/modules/csv-import/csv-import.service.js");
  const { PgDatabase } = await import("../dist/shared/infra/pgDatabase.js");

  const database = new PgDatabase();
  const service = new CsvImportService({ repository: new CsvImportRepository(database) });
  const { targetPath } = resolveDropPath();

  console.log(`Running CSV import (runWindow=${runWindow}) for:\n  ${targetPath}`);
  const result = await service.runImport(runWindow);
  console.log("\nImport result:");
  console.log(JSON.stringify(result, null, 2));
  await printRecentRuns(database);
}

async function simulateCronTick() {
  if (!process.env.SUPABASE_POOLER_URL) {
    throw new Error("SUPABASE_POOLER_URL is required in backend/.env");
  }

  const { CsvImportRepository } = await import("../dist/modules/csv-import/csv-import.repository.js");
  const { CsvImportService } = await import("../dist/modules/csv-import/csv-import.service.js");
  const { PgDatabase } = await import("../dist/shared/infra/pgDatabase.js");
  const { registerCsvImportJobs } = await import("../dist/modules/csv-import/csv-import.cron.js");

  const database = new PgDatabase();
  const service = new CsvImportService({ repository: new CsvImportRepository(database) });
  const now = new Date();
  const minute = now.getMinutes();
  const hour = now.getHours();
  const cron = `${minute} ${hour} * * *`;
  const timezone = process.env.CSV_IMPORT_TIMEZONE ?? "Asia/Ho_Chi_Minh";

  const env = {
    ...process.env,
    CSV_IMPORT_ENABLED: "true",
    CSV_IMPORT_EVENING_CRON: cron,
    CSV_IMPORT_NIGHTLY_CRON: "59 23 * * *",
    CSV_IMPORT_TIMEZONE: timezone
  };

  let tickCount = 0;
  const registration = registerCsvImportJobs(service, {
    env,
    now: () => now,
    scheduler: (handler) => {
      tickCount += 1;
      void handler();
      return { stop: () => undefined };
    },
    logger: console
  });

  registration.stop();
  console.log(`Simulated cron tick at ${hour}:${String(minute).padStart(2, "0")} (${timezone}), handlers=${tickCount}`);
  await printRecentRuns(database);
}

async function main() {
  if (args.has("--prepare")) {
    await prepareDemoCsv();
    if (!args.has("--simulate-cron") && args.size === 1) {
      return;
    }
  }

  if (args.has("--simulate-cron")) {
    if (!args.has("--prepare")) {
      console.log("Tip: run with --prepare first if students.csv is missing in the drop directory.");
    }
    await simulateCronTick();
    return;
  }

  await runDirectImport();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

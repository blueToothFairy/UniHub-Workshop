import { readFile } from "node:fs/promises";
import path from "node:path";
import { dbPool } from "../src/shared/infra/db.js";

async function main() {
  try {
    const migrationPath = path.resolve(process.cwd(), "migrations", "20260502_add_workshop_summary_fields.sql");
    const sql = await readFile(migrationPath, "utf8");

    console.log(`Applying migration: ${migrationPath}`);
    await dbPool.query(sql);
    console.log("Migration applied successfully.");

    const checkSql = `SELECT column_name FROM information_schema.columns WHERE table_name='workshops' AND column_name IN ('pdf_url','ai_summary','summary_status','summary_generated_at','summary_error_code') ORDER BY column_name;`;
    const res = await dbPool.query(checkSql);
    const present = res.rows.map((r: any) => r.column_name);
    console.log("Present columns:", present);

    const missing = ["pdf_url", "ai_summary", "summary_status", "summary_generated_at", "summary_error_code"].filter((c) => !present.includes(c));
    if (missing.length === 0) {
      console.log("All expected columns are present.");
      process.exit(0);
    }
    console.warn("Missing columns:", missing);
    process.exit(2);
  } catch (err: any) {
    console.error("Migration check failed:", err.message ?? err);
    process.exit(1);
  }
}

main();

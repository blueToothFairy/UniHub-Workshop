import { randomUUID } from "node:crypto";
import bcrypt from "bcrypt";
import { dbPool } from "../../shared/infra/db.js";
import type { IDatabase } from "../../shared/interfaces/IDatabase.js";
import type {
  CsvImportCounters,
  CsvImportRepositoryContract,
  CsvImportRunOutcome,
  CsvImportRunRecord,
  CsvImportSourceMetadata,
  CsvImportStudentRow,
  CsvImportRunWindow
} from "./csv-import.types.js";

function parseBcryptRounds(): number {
  const parsed = Number(process.env.CSV_IMPORT_BCRYPT_ROUNDS ?? 8);
  return Number.isFinite(parsed) && parsed >= 4 && parsed <= 15 ? parsed : 8;
}

export class CsvImportRepository implements CsvImportRepositoryContract {
  public constructor(private readonly database: IDatabase) {}

  public async createRun(input: {
    runWindow: CsvImportRunWindow;
    startedAt: string;
  }): Promise<CsvImportRunRecord> {
    const result = await this.database.query<CsvImportRunRecord>(
      `INSERT INTO csv_import_runs (
         id, run_window, outcome, started_at, created_at, updated_at
       ) VALUES ($1, $2, 'running', $3, $3, $3)
       RETURNING *`,
      [randomUUID(), input.runWindow, input.startedAt]
    );
    return result.rows[0];
  }

  public async completeRun(input: {
    runId: string;
    outcome: CsvImportRunOutcome;
    finishedAt: string;
    source?: CsvImportSourceMetadata | null;
    counters?: Partial<CsvImportCounters>;
    reason?: string | null;
  }): Promise<CsvImportRunRecord> {
    const result = await this.database.query<CsvImportRunRecord>(
      `UPDATE csv_import_runs
       SET outcome = $2,
           source_path = $3,
           source_filename = $4,
           source_size_bytes = $5,
           source_modified_at = $6,
           source_sha256 = $7,
           total_rows = $8,
           valid_rows = $9,
           error_rows = $10,
           inserted_rows = $11,
           updated_rows = $12,
           reason = $13,
           finished_at = $14,
           updated_at = $14
       WHERE id = $1
       RETURNING *`,
      [
        input.runId,
        input.outcome,
        input.source?.path ?? null,
        input.source?.filename ?? null,
        input.source?.sizeBytes ?? null,
        input.source?.modifiedAt ?? null,
        input.source?.sha256 ?? null,
        input.counters?.totalRows ?? null,
        input.counters?.validRows ?? null,
        input.counters?.errorRows ?? null,
        input.counters?.insertedRows ?? null,
        input.counters?.updatedRows ?? null,
        input.reason ?? null,
        input.finishedAt
      ]
    );
    return result.rows[0];
  }

  public async getLatestSuccessfulRun(): Promise<CsvImportRunRecord | null> {
    const result = await this.database.query<CsvImportRunRecord>(
      `SELECT *
       FROM csv_import_runs
       WHERE outcome = 'processed'
       ORDER BY source_modified_at DESC NULLS LAST, finished_at DESC NULLS LAST
       LIMIT 1`
    );
    return result.rows[0] ?? null;
  }

  public async getSuccessfulRunBySourceHash(sourceHash: string): Promise<CsvImportRunRecord | null> {
    const result = await this.database.query<CsvImportRunRecord>(
      `SELECT *
       FROM csv_import_runs
       WHERE outcome = 'processed' AND source_sha256 = $1
       LIMIT 1`,
      [sourceHash]
    );
    return result.rows[0] ?? null;
  }

  public async applyStudentRows(
    rows: CsvImportStudentRow[],
    importedAt: string
  ): Promise<{ insertedRows: number; updatedRows: number }> {
    if (rows.length === 0) {
      return { insertedRows: 0, updatedRows: 0 };
    }

    const bcryptRounds = parseBcryptRounds();
    const passwordHashes = await Promise.all(rows.map((row) => bcrypt.hash(row.studentId, bcryptRounds)));

    const client = await dbPool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `CREATE TEMP TABLE tmp_csv_students (
           student_id TEXT NOT NULL,
           email TEXT NOT NULL,
           full_name TEXT NOT NULL,
           password_hash TEXT NOT NULL
         ) ON COMMIT DROP`
      );

      const chunkSize = 500;
      for (let index = 0; index < rows.length; index += chunkSize) {
        const chunk = rows.slice(index, index + chunkSize);
        const valuesClause = chunk
          .map((_row, chunkIndex) => {
            const base = chunkIndex * 4;
            return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`;
          })
          .join(", ");
        const params = chunk.flatMap((row, chunkIndex) => [
          row.studentId,
          row.email,
          row.fullName,
          passwordHashes[index + chunkIndex]
        ]);
        await client.query(
          `INSERT INTO tmp_csv_students (student_id, email, full_name, password_hash)
           VALUES ${valuesClause}`,
          params
        );
      }

      // Match existing students by student_id first, then by email (covers self-registered rows with student_id NULL).
      const updateResult = await client.query(
        `WITH matched AS (
           SELECT DISTINCT ON (u.id)
             u.id AS user_id,
             t.student_id,
             t.email,
             t.full_name
           FROM users u
           JOIN tmp_csv_students t
             ON u.role = 'student'
            AND (
              u.student_id = t.student_id
              OR LOWER(u.email) = LOWER(t.email)
            )
           ORDER BY u.id, t.student_id
         )
         UPDATE users u
         SET student_id = matched.student_id,
             email = matched.email,
             full_name = matched.full_name,
             updated_at = $1::timestamptz
         FROM matched
         WHERE u.id = matched.user_id`,
        [importedAt]
      );

      // Insert rows with no matching student account yet (new email + new student_id in users).
      const insertResult = await client.query(
        `INSERT INTO users (
           id, email, full_name, role, student_id, password_hash,
           force_change_password, created_at, updated_at
         )
         SELECT
           gen_random_uuid(),
           t.email,
           t.full_name,
           'student',
           t.student_id,
           t.password_hash,
           true,
           $1::timestamptz,
           $1::timestamptz
         FROM tmp_csv_students t
         WHERE NOT EXISTS (
           SELECT 1
           FROM users u
           WHERE u.role = 'student'
             AND (
               u.student_id = t.student_id
               OR LOWER(u.email) = LOWER(t.email)
             )
         )`,
        [importedAt]
      );

      await client.query("COMMIT");
      return {
        insertedRows: insertResult.rowCount ?? 0,
        updatedRows: updateResult.rowCount ?? 0
      };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

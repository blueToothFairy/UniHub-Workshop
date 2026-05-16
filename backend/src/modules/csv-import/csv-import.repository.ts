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

    const client = await dbPool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `CREATE TEMP TABLE tmp_csv_students (
           student_id TEXT NOT NULL,
           email TEXT NOT NULL,
           full_name TEXT NOT NULL
         ) ON COMMIT DROP`
      );

      const chunkSize = 500;
      for (let index = 0; index < rows.length; index += chunkSize) {
        const chunk = rows.slice(index, index + chunkSize);
        const valuesClause = chunk
          .map((_row, chunkIndex) => {
            const base = chunkIndex * 3;
            return `($${base + 1}, $${base + 2}, $${base + 3})`;
          })
          .join(", ");
        const params = chunk.flatMap((row) => [row.studentId, row.email, row.fullName]);
        await client.query(
          `INSERT INTO tmp_csv_students (student_id, email, full_name)
           VALUES ${valuesClause}`,
          params
        );
      }

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
             updated_at = $1
         FROM matched
         WHERE u.id = matched.user_id`,
        [importedAt]
      );

      const bcryptRounds = parseBcryptRounds();
      const existingResult = await client.query<{
        student_id: string;
      }>(
        `SELECT t.student_id
         FROM tmp_csv_students t
         JOIN users u
           ON u.role = 'student'
          AND (
            u.student_id = t.student_id
            OR LOWER(u.email) = LOWER(t.email)
          )`
      );
      const existingStudentIds = new Set(existingResult.rows.map((row) => row.student_id));
      const newRows = rows.filter((row) => !existingStudentIds.has(row.studentId));

      if (newRows.length > 0) {
        const hashedPasswords = await Promise.all(
          newRows.map((row) => bcrypt.hash(row.studentId, bcryptRounds))
        );

        for (let index = 0; index < newRows.length; index += chunkSize) {
          const chunk = newRows.slice(index, index + chunkSize);
          const valuesClause = chunk
            .map((_row, chunkIndex) => {
              const base = chunkIndex * 8;
              return `($${base + 1}, $${base + 2}, $${base + 3}, 'student', $${base + 4}, $${base + 5}, true, $${base + 6}, $${base + 7})`;
            })
            .join(", ");
          const params = chunk.flatMap((row, chunkIndex) => [
            randomUUID(),
            row.email,
            row.fullName,
            row.studentId,
            hashedPasswords[index + chunkIndex],
            importedAt,
            importedAt
          ]);
          await client.query(
            `INSERT INTO users (
               id, email, full_name, role, student_id, password_hash,
               force_change_password, created_at, updated_at
             )
             VALUES ${valuesClause}`,
            params
          );
        }
      }

      await client.query("COMMIT");
      return {
        insertedRows: newRows.length,
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

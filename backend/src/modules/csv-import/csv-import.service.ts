import { createHash } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import type {
  CsvImportCounters,
  CsvImportExecutionResult,
  CsvImportParsedResult,
  CsvImportRepositoryContract,
  CsvImportRunOutcome,
  CsvImportSourceMetadata,
  CsvImportStudentRow,
  CsvImportRunWindow
} from "./csv-import.types.js";

interface CsvImportServiceOptions {
  repository: CsvImportRepositoryContract;
  now?: () => Date;
  logger?: Pick<Console, "info" | "warn" | "error">;
}

function parseThreshold(): number {
  const parsed = Number(process.env.CSV_ERROR_THRESHOLD ?? 0.1);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    return 0.1;
  }
  return parsed;
}

function getDropDirectory(): string {
  return process.env.CSV_DROP_DIR ?? path.resolve(process.cwd(), "data", "csv");
}

function getImportFilename(): string {
  return process.env.CSV_IMPORT_FILENAME ?? "students.csv";
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === "\"") {
      if (inQuotes && line[index + 1] === "\"") {
        current += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }
    current += char;
  }

  values.push(current);
  return values;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Legacy registrar IDs (SV001234) and UniHub test/export IDs (STU1000). */
const STUDENT_ID_PATTERN = /^(SV\d{4,12}|STU\d{3,15})$/i;

function normalizeStudentId(studentId: string): string {
  return studentId.trim().toUpperCase();
}

function validateStudentRow(row: Record<string, string>): { valid: true; value: CsvImportStudentRow } | { valid: false; reason: string } {
  const studentId = normalizeStudentId(row.student_id ?? "");
  const email = normalizeEmail(row.email ?? "");
  const fullName = row.full_name?.trim() ?? "";

  if (!STUDENT_ID_PATTERN.test(studentId)) {
    return { valid: false, reason: "Invalid student_id format (expected SV######## or STU###...)" };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { valid: false, reason: "Invalid email" };
  }
  if (fullName.length === 0) {
    return { valid: false, reason: "full_name is required" };
  }
  if (fullName.length > 255) {
    return { valid: false, reason: "full_name too long" };
  }

  return {
    valid: true,
    value: {
      studentId,
      email,
      fullName
    }
  };
}

export class CsvImportService {
  private readonly repository: CsvImportRepositoryContract;

  private readonly now: () => Date;

  private readonly logger: Pick<Console, "info" | "warn" | "error">;

  public constructor(options: CsvImportServiceOptions) {
    this.repository = options.repository;
    this.now = options.now ?? (() => new Date());
    this.logger = options.logger ?? console;
  }

  public async runImport(runWindow: CsvImportRunWindow): Promise<CsvImportExecutionResult> {
    const startedAt = this.now().toISOString();
    const run = await this.repository.createRun({ runWindow, startedAt });
    const csvPath = path.join(getDropDirectory(), getImportFilename());

    try {
      let source: CsvImportSourceMetadata | null = null;
      try {
        source = await this.computeSourceMetadata(csvPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          const completed = await this.repository.completeRun({
            runId: run.id,
            outcome: "skipped_missing",
            finishedAt: this.now().toISOString(),
            reason: `CSV file not found at ${csvPath}`,
            counters: this.emptyCounters()
          });
          this.logRun(completed);
          return this.toExecutionResult(completed);
        }
        throw error;
      }

      if (source.sizeBytes <= 0) {
        const completed = await this.repository.completeRun({
          runId: run.id,
          outcome: "failed_validation",
          finishedAt: this.now().toISOString(),
          reason: "CSV file is empty",
          source,
          counters: this.emptyCounters()
        });
        this.logRun(completed);
        return this.toExecutionResult(completed);
      }

      const duplicateRun = await this.repository.getSuccessfulRunBySourceHash(source.sha256);
      if (duplicateRun) {
        const completed = await this.repository.completeRun({
          runId: run.id,
          outcome: "skipped_stale",
          finishedAt: this.now().toISOString(),
          source,
          reason: `Source file hash already processed by run ${duplicateRun.id}`,
          counters: this.emptyCounters()
        });
        this.logRun(completed);
        return this.toExecutionResult(completed);
      }

      const latestSuccessfulRun = await this.repository.getLatestSuccessfulRun();
      if (
        latestSuccessfulRun?.source_modified_at &&
        latestSuccessfulRun.source_modified_at.getTime() >= new Date(source.modifiedAt).getTime()
      ) {
        const completed = await this.repository.completeRun({
          runId: run.id,
          outcome: "skipped_stale",
          finishedAt: this.now().toISOString(),
          source,
          reason: `Source file modified at ${source.modifiedAt} is not newer than latest successful import`,
          counters: this.emptyCounters()
        });
        this.logRun(completed);
        return this.toExecutionResult(completed);
      }

      const parsed = await this.parseCsvFile(csvPath);
      const totalCandidateRows = parsed.totalRows;
      const validRowCount = parsed.validRows.length;
      const dedupedRows = this.dedupeRows(parsed.validRows);
      const errorCount = parsed.errorRows.length;
      const errorRate = totalCandidateRows === 0 ? 1 : errorCount / totalCandidateRows;

      if (errorRate > parseThreshold()) {
        const completed = await this.repository.completeRun({
          runId: run.id,
          outcome: "failed_validation",
          finishedAt: this.now().toISOString(),
          source,
          reason: `Validation error rate ${(errorRate * 100).toFixed(1)}% exceeds threshold ${(parseThreshold() * 100).toFixed(1)}%`,
          counters: {
            totalRows: totalCandidateRows,
            validRows: validRowCount,
            errorRows: errorCount,
            insertedRows: 0,
            updatedRows: 0
          }
        });
        this.logRun(completed);
        return this.toExecutionResult(completed);
      }

      const writeResult = await this.repository.applyStudentRows(dedupedRows, this.now().toISOString());
      await this.archiveSourceFile(csvPath, runWindow);

      const completed = await this.repository.completeRun({
        runId: run.id,
        outcome: "processed",
        finishedAt: this.now().toISOString(),
        source,
        reason: null,
        counters: {
          totalRows: totalCandidateRows,
          validRows: validRowCount,
          errorRows: errorCount,
          insertedRows: writeResult.insertedRows,
          updatedRows: writeResult.updatedRows
        }
      });
      this.logRun(completed);
      return this.toExecutionResult(completed);
    } catch (error) {
      const completed = await this.repository.completeRun({
        runId: run.id,
        outcome: "failed_runtime",
        finishedAt: this.now().toISOString(),
        reason: error instanceof Error ? error.message : "Unknown CSV import runtime failure",
        counters: this.emptyCounters()
      });
      this.logRun(completed);
      return this.toExecutionResult(completed);
    }
  }

  private async computeSourceMetadata(filePath: string): Promise<CsvImportSourceMetadata> {
    const stat = await fs.stat(filePath);
    const hash = createHash("sha256");
    await new Promise<void>((resolve, reject) => {
      const stream = createReadStream(filePath);
      stream.on("data", (chunk: string | Buffer) => {
        hash.update(chunk);
      });
      stream.on("end", () => resolve());
      stream.on("error", reject);
    });

    return {
      path: filePath,
      filename: path.basename(filePath),
      sizeBytes: stat.size,
      modifiedAt: stat.mtime.toISOString(),
      sha256: hash.digest("hex")
    };
  }

  private async parseCsvFile(filePath: string): Promise<CsvImportParsedResult> {
    const stream = createReadStream(filePath, { encoding: "utf8" });
    const reader = readline.createInterface({ input: stream, crlfDelay: Infinity });
    const rows = new Map<string, CsvImportStudentRow>();
    const errorRows: Array<{ rowNumber: number; reason: string }> = [];
    let headers: string[] | null = null;
    let totalRows = 0;

    for await (const rawLine of reader) {
      const line = rawLine.replace(/^\uFEFF/, "").trim();
      if (line.length === 0) {
        continue;
      }
      if (!headers) {
        headers = parseCsvLine(line).map((value) => value.trim());
        continue;
      }

      totalRows += 1;
      const columns = parseCsvLine(line);
      const row = headers.reduce<Record<string, string>>((acc, header, index) => {
        acc[header] = (columns[index] ?? "").trim();
        return acc;
      }, {});
      const validation = validateStudentRow(row);
      if (!validation.valid) {
        errorRows.push({ rowNumber: totalRows + 1, reason: validation.reason });
        continue;
      }
      rows.set(validation.value.studentId, validation.value);
    }

    return {
      totalRows,
      validRows: [...rows.values()],
      errorRows
    };
  }

  private dedupeRows(rows: CsvImportStudentRow[]): CsvImportStudentRow[] {
    const deduped = new Map<string, CsvImportStudentRow>();
    for (const row of rows) {
      deduped.set(row.studentId, row);
    }
    return [...deduped.values()];
  }

  private async archiveSourceFile(filePath: string, runWindow: CsvImportRunWindow): Promise<void> {
    const archiveDirectory = path.join(getDropDirectory(), "processed");
    await fs.mkdir(archiveDirectory, { recursive: true });
    const stamp = this.now().toISOString().replaceAll(":", "-");
    const archivePath = path.join(archiveDirectory, `${stamp}-${runWindow}-${getImportFilename()}`);
    await fs.rename(filePath, archivePath);
  }

  private emptyCounters(): CsvImportCounters {
    return {
      totalRows: 0,
      validRows: 0,
      errorRows: 0,
      insertedRows: 0,
      updatedRows: 0
    };
  }

  private toExecutionResult(record: {
    id: string;
    run_window: CsvImportRunWindow;
    outcome: CsvImportRunOutcome;
    reason: string | null;
    total_rows: number | null;
    valid_rows: number | null;
    error_rows: number | null;
    inserted_rows: number | null;
    updated_rows: number | null;
    source_path: string | null;
    source_filename: string | null;
    source_size_bytes: string | number | null;
    source_modified_at: Date | null;
    source_sha256: string | null;
  }): CsvImportExecutionResult {
    return {
      runId: record.id,
      runWindow: record.run_window,
      outcome: record.outcome,
      reason: record.reason,
      counters: {
        totalRows: record.total_rows ?? 0,
        validRows: record.valid_rows ?? 0,
        errorRows: record.error_rows ?? 0,
        insertedRows: record.inserted_rows ?? 0,
        updatedRows: record.updated_rows ?? 0
      },
      source: record.source_path && record.source_filename && record.source_modified_at && record.source_sha256
        ? {
            path: record.source_path,
            filename: record.source_filename,
            sizeBytes: Number(record.source_size_bytes ?? 0),
            modifiedAt: record.source_modified_at.toISOString(),
            sha256: record.source_sha256
          }
        : null
    };
  }

  private logRun(record: {
    id: string;
    run_window: CsvImportRunWindow;
    outcome: CsvImportRunOutcome;
    reason: string | null;
    total_rows: number | null;
    valid_rows: number | null;
    error_rows: number | null;
    inserted_rows: number | null;
    updated_rows: number | null;
    source_filename: string | null;
    source_modified_at: Date | null;
  }): void {
    const payload = {
      type: "student_csv_import_run",
      runId: record.id,
      runWindow: record.run_window,
      outcome: record.outcome,
      reason: record.reason,
      sourceFilename: record.source_filename,
      sourceModifiedAt: record.source_modified_at?.toISOString() ?? null,
      totalRows: record.total_rows,
      validRows: record.valid_rows,
      errorRows: record.error_rows,
      insertedRows: record.inserted_rows,
      updatedRows: record.updated_rows
    };

    if (record.outcome === "processed") {
      this.logger.info(JSON.stringify(payload));
      return;
    }

    if (record.outcome === "failed_runtime" || record.outcome === "failed_validation") {
      this.logger.error(JSON.stringify(payload));
      this.logger.warn(JSON.stringify({
        type: "student_csv_import_alert",
        severity: "warning",
        runWindow: record.run_window,
        outcome: record.outcome,
        reason: record.reason
      }));
      return;
    }

    this.logger.warn(JSON.stringify(payload));
  }
}

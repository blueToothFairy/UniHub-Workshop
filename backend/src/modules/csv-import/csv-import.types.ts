import type { QueryResultRow } from "pg";

export type CsvImportRunWindow = "nightly" | "evening";

export type CsvImportRunOutcome =
  | "running"
  | "processed"
  | "skipped_missing"
  | "skipped_stale"
  | "failed_validation"
  | "failed_runtime";

export interface CsvImportSourceMetadata {
  path: string;
  filename: string;
  sizeBytes: number;
  modifiedAt: string;
  sha256: string;
}

export interface CsvImportCounters {
  totalRows: number;
  validRows: number;
  errorRows: number;
  insertedRows: number;
  updatedRows: number;
}

export interface CsvImportRunRecord extends QueryResultRow {
  id: string;
  run_window: CsvImportRunWindow;
  outcome: CsvImportRunOutcome;
  source_path: string | null;
  source_filename: string | null;
  source_size_bytes: string | null;
  source_modified_at: Date | null;
  source_sha256: string | null;
  total_rows: number | null;
  valid_rows: number | null;
  error_rows: number | null;
  inserted_rows: number | null;
  updated_rows: number | null;
  reason: string | null;
  started_at: Date;
  finished_at: Date | null;
}

export interface CsvImportStudentRow {
  studentId: string;
  email: string;
  fullName: string;
}

export interface CsvImportParsedResult {
  totalRows: number;
  validRows: CsvImportStudentRow[];
  errorRows: Array<{ rowNumber: number; reason: string }>;
}

export interface CsvImportExecutionResult {
  runId: string;
  runWindow: CsvImportRunWindow;
  outcome: CsvImportRunOutcome;
  reason: string | null;
  counters: CsvImportCounters;
  source: CsvImportSourceMetadata | null;
}

export interface CsvImportRepositoryContract {
  createRun(input: {
    runWindow: CsvImportRunWindow;
    startedAt: string;
  }): Promise<CsvImportRunRecord>;
  completeRun(input: {
    runId: string;
    outcome: CsvImportRunOutcome;
    finishedAt: string;
    source?: CsvImportSourceMetadata | null;
    counters?: Partial<CsvImportCounters>;
    reason?: string | null;
  }): Promise<CsvImportRunRecord>;
  getLatestSuccessfulRun(): Promise<CsvImportRunRecord | null>;
  getSuccessfulRunBySourceHash(sourceHash: string): Promise<CsvImportRunRecord | null>;
  applyStudentRows(rows: CsvImportStudentRow[], importedAt: string): Promise<{ insertedRows: number; updatedRows: number }>;
}

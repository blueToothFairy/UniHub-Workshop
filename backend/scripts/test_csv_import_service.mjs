import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CsvImportService } from "../dist/modules/csv-import/csv-import.service.js";

class CsvImportRepositoryStub {
  runs = [];
  students = new Map();
  shouldThrowOnApply = false;

  async createRun(input) {
    const timestamp = new Date(input.startedAt);
    const record = {
      id: `run-${this.runs.length + 1}`,
      run_window: input.runWindow,
      outcome: "running",
      source_path: null,
      source_filename: null,
      source_size_bytes: null,
      source_modified_at: null,
      source_sha256: null,
      total_rows: null,
      valid_rows: null,
      error_rows: null,
      inserted_rows: null,
      updated_rows: null,
      reason: null,
      started_at: timestamp,
      finished_at: null,
      created_at: timestamp,
      updated_at: timestamp
    };
    this.runs.push(record);
    return record;
  }

  async completeRun(input) {
    const record = this.runs.find((item) => item.id === input.runId);
    assert.ok(record, `Run ${input.runId} was not created`);
    record.outcome = input.outcome;
    record.finished_at = new Date(input.finishedAt);
    record.updated_at = new Date(input.finishedAt);
    record.reason = input.reason ?? null;
    record.source_path = input.source?.path ?? null;
    record.source_filename = input.source?.filename ?? null;
    record.source_size_bytes = input.source ? String(input.source.sizeBytes) : null;
    record.source_modified_at = input.source ? new Date(input.source.modifiedAt) : null;
    record.source_sha256 = input.source?.sha256 ?? null;
    record.total_rows = input.counters?.totalRows ?? 0;
    record.valid_rows = input.counters?.validRows ?? 0;
    record.error_rows = input.counters?.errorRows ?? 0;
    record.inserted_rows = input.counters?.insertedRows ?? 0;
    record.updated_rows = input.counters?.updatedRows ?? 0;
    return record;
  }

  async getLatestSuccessfulRun() {
    return this.runs
      .filter((run) => run.outcome === "processed")
      .sort((left, right) => {
        const leftTime = left.source_modified_at?.getTime() ?? 0;
        const rightTime = right.source_modified_at?.getTime() ?? 0;
        return rightTime - leftTime;
      })[0] ?? null;
  }

  async getSuccessfulRunBySourceHash(sourceHash) {
    return this.runs.find((run) => run.outcome === "processed" && run.source_sha256 === sourceHash) ?? null;
  }

  async applyStudentRows(rows) {
    if (this.shouldThrowOnApply) {
      throw new Error("database unavailable");
    }
    let insertedRows = 0;
    let updatedRows = 0;
    for (const row of rows) {
      if (this.students.has(row.studentId)) {
        updatedRows += 1;
      } else {
        insertedRows += 1;
      }
      this.students.set(row.studentId, row);
    }
    return { insertedRows, updatedRows };
  }
}

async function writeCsv(filePath, contents) {
  await writeFile(filePath, contents, "utf8");
}

async function main() {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "unihub-csv-import-"));
  const csvDir = path.join(tempRoot, "csv");
  await mkdir(path.join(csvDir, "processed"), { recursive: true });

  process.env.CSV_DROP_DIR = csvDir;
  process.env.CSV_IMPORT_FILENAME = "students.csv";
  process.env.CSV_ERROR_THRESHOLD = "0.5";

  const repository = new CsvImportRepositoryStub();
  const service = new CsvImportService({ repository });
  const sourceFile = path.join(csvDir, "students.csv");

  await writeCsv(
    sourceFile,
    [
      "student_id,email,full_name",
      "SV000001,one@student.edu.vn,Student One",
      "STU1002,two@student.edu.vn,Student Two"
    ].join("\n")
  );

  const first = await service.runImport("evening");
  assert.equal(first.outcome, "processed");
  assert.equal(first.counters.insertedRows, 2);
  assert.equal(repository.students.size, 2);
  assert.equal(repository.students.has("STU1002"), true);

  const archivedFiles = await readdir(path.join(csvDir, "processed"));
  assert.equal(archivedFiles.length > 0, true);

  await writeCsv(
    sourceFile,
    [
      "student_id,email,full_name",
      "SV000001,one@student.edu.vn,Student One",
      "STU1002,two@student.edu.vn,Student Two"
    ].join("\n")
  );
  const duplicate = await service.runImport("evening");
  assert.equal(duplicate.outcome, "skipped_stale");

  await rm(sourceFile);
  const missing = await service.runImport("nightly");
  assert.equal(missing.outcome, "skipped_missing");

  await writeCsv(
    sourceFile,
    [
      "student_id,email,full_name",
      "bad-id,broken,Student Broken",
      "SV000003,three@student.edu.vn,Student Three"
    ].join("\n")
  );
  process.env.CSV_ERROR_THRESHOLD = "0.2";
  const validation = await service.runImport("evening");
  assert.equal(validation.outcome, "failed_validation");

  await writeCsv(
    sourceFile,
    [
      "student_id,email,full_name",
      "SV000004,four@student.edu.vn,Student Four"
    ].join("\n")
  );
  repository.shouldThrowOnApply = true;
  const runtime = await service.runImport("evening");
  assert.equal(runtime.outcome, "failed_runtime");

  console.log("CSV import service scenarios verified.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

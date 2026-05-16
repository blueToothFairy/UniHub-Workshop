import assert from "node:assert/strict";
import { CsvImportService } from "../dist/modules/csv-import/csv-import.service.js";
import { loadCsvImportJobDefinitions, registerCsvImportJobs } from "../dist/modules/csv-import/csv-import.cron.js";

class NoopRepository {
  async createRun() {
    throw new Error("not used");
  }

  async completeRun() {
    throw new Error("not used");
  }

  async getLatestSuccessfulRun() {
    return null;
  }

  async getSuccessfulRunBySourceHash() {
    return null;
  }

  async applyStudentRows() {
    return { insertedRows: 0, updatedRows: 0 };
  }
}

async function main() {
  const env = {
    CSV_IMPORT_ENABLED: "true",
    CSV_IMPORT_TIMEZONE: "Asia/Ho_Chi_Minh",
    CSV_IMPORT_NIGHTLY_CRON: "5 2 * * *",
    CSV_IMPORT_EVENING_CRON: "5 18 * * *"
  };

  const definitions = loadCsvImportJobDefinitions(env);
  assert.equal(definitions.length, 2);
  assert.equal(definitions[0].runWindow, "nightly");
  assert.equal(definitions[1].runWindow, "evening");

  let scheduledHandlers = 0;
  const service = new CsvImportService({ repository: new NoopRepository() });
  const jobs = registerCsvImportJobs(service, {
    env,
    scheduler: () => {
      scheduledHandlers += 1;
      return { stop: () => undefined };
    },
    logger: {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined
    }
  });

  assert.equal(jobs.jobs.length, 2);
  assert.equal(scheduledHandlers, 2);
  console.log("CSV import cron registration verified.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

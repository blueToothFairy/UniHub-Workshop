import assert from "node:assert/strict";
import type { QueryResult, QueryResultRow } from "pg";
import { AdminService } from "../src/modules/admin/admin.service.js";
import type { IDatabase } from "../src/shared/interfaces/IDatabase.js";
import { QueueStub } from "../src/shared/infra/queue.js";

class AdminDatabaseStub implements IDatabase {
  public async query<T extends QueryResultRow>(text: string): Promise<QueryResult<T>> {
    if (text.includes("FROM workshops")) {
      return {
        rows: [{
          total_workshops: "3",
          total_registrations: "12",
          paid_workshops: "1",
          free_workshops: "2",
          cancelled_workshops: "0"
        } as T],
        rowCount: 1
      } as QueryResult<T>;
    }

    if (text.includes("FROM workshop_checkins")) {
      return {
        rows: [{ total: "9" } as T],
        rowCount: 1
      } as QueryResult<T>;
    }

    throw new Error(`Unhandled query in admin stub: ${text}`);
  }
}

async function main() {
  const adminService = new AdminService(new QueueStub(), new AdminDatabaseStub(), {
    uploadWorkshopPdf: async () => ({ status: "processing", workshop_id: "ignored" }),
    overrideWorkshopSummary: async () => undefined
  } as any);

  const stats = await adminService.getDashboardStats();
  assert.equal(stats.totalWorkshops, 3);
  assert.equal(stats.totalRegistrations, 12);
  assert.equal(stats.checkins, 9);
  console.log("Admin dashboard checkin stats test passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

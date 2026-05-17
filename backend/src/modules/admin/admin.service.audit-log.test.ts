import assert from "node:assert/strict";
import test from "node:test";
import type { QueryResult, QueryResultRow } from "pg";
import { decodeAuditLogCursor } from "./admin-audit-log-cursor.js";
import { AdminService } from "./admin.service.js";
import type { IDatabase } from "../../shared/interfaces/IDatabase.js";
import { AppError } from "../../shared/errors/AppError.js";
import { QueueStub } from "../../shared/infra/queue.js";

interface AuditLogListRow {
  id: string;
  actor_user_id: string;
  action: "workshop.create" | "workshop.update" | "workshop.cancel";
  target_type: "workshop";
  target_id: string;
  created_at: Date;
}

const SAMPLE_ROWS: AuditLogListRow[] = [
  {
    id: "log-3",
    actor_user_id: "organizer-1",
    action: "workshop.cancel",
    target_type: "workshop",
    target_id: "workshop-3",
    created_at: new Date("2026-05-16T12:00:00.000Z")
  },
  {
    id: "log-2",
    actor_user_id: "organizer-1",
    action: "workshop.update",
    target_type: "workshop",
    target_id: "workshop-2",
    created_at: new Date("2026-05-16T11:00:00.000Z")
  },
  {
    id: "log-1",
    actor_user_id: "organizer-1",
    action: "workshop.create",
    target_type: "workshop",
    target_id: "workshop-1",
    created_at: new Date("2026-05-16T10:00:00.000Z")
  }
];

class AuditLogDatabaseStub implements IDatabase {
  public async query<T extends QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<T>> {
    if (!text.includes("FROM audit_logs")) {
      throw new Error(`Unhandled query: ${text}`);
    }

    const limit = Number(values?.at(-1) ?? 25);
    const rows = values && values.length >= 3
      ? SAMPLE_ROWS.filter((row) => {
          const cursor = { createdAt: String(values[0]), id: String(values[1]) };
          return row.created_at.toISOString() < cursor.createdAt
            || (row.created_at.toISOString() === cursor.createdAt && row.id < cursor.id);
        })
      : [...SAMPLE_ROWS];

    return {
      rows: rows.slice(0, limit) as T[],
      rowCount: Math.min(limit, rows.length)
    } as QueryResult<T>;
  }
}

const aiStub = {
  uploadWorkshopPdf: async () => ({ status: "processing" as const, workshop_id: "ignored" }),
  overrideWorkshopSummary: async () => undefined
};

test("listAuditLogs returns first page with next cursor when more rows exist", async () => {
  const service = new AdminService(new QueueStub(), new AuditLogDatabaseStub(), aiStub as never);
  const page = await service.listAuditLogs({ limit: 2 });

  assert.equal(page.items.length, 2);
  assert.equal(page.items[0]?.id, "log-3");
  assert.equal(page.items[1]?.id, "log-2");
  assert.ok(page.next_cursor);
  assert.doesNotMatch(JSON.stringify(page.items), /beforeState|afterState/);
});

test("listAuditLogs returns next page using cursor and null cursor at end", async () => {
  const service = new AdminService(new QueueStub(), new AuditLogDatabaseStub(), aiStub as never);
  const first = await service.listAuditLogs({ limit: 2 });
  const second = await service.listAuditLogs({ limit: 2, cursor: first.next_cursor! });

  assert.equal(second.items.length, 1);
  assert.equal(second.items[0]?.id, "log-1");
  assert.equal(second.next_cursor, null);
});

test("listAuditLogs rejects invalid limit", async () => {
  const service = new AdminService(new QueueStub(), new AuditLogDatabaseStub(), aiStub as never);
  await assert.rejects(
    () => service.listAuditLogs({ limit: 0 }),
    (error: unknown) => error instanceof AppError && error.code === "INVALID_AUDIT_LOG_QUERY"
  );
});

test("listAuditLogs rejects invalid cursor", async () => {
  const service = new AdminService(new QueueStub(), new AuditLogDatabaseStub(), aiStub as never);
  await assert.rejects(
    () => service.listAuditLogs({ cursor: "bad-cursor" }),
    (error: unknown) => error instanceof AppError && error.code === "INVALID_AUDIT_LOG_CURSOR"
  );
});

test("decodeAuditLogCursor matches last item from first page", async () => {
  const service = new AdminService(new QueueStub(), new AuditLogDatabaseStub(), aiStub as never);
  const first = await service.listAuditLogs({ limit: 2 });
  const last = first.items.at(-1)!;
  assert.deepEqual(decodeAuditLogCursor(first.next_cursor!), { createdAt: last.createdAt, id: last.id });
});

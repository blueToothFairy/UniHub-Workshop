import assert from "node:assert/strict";
import type { QueryResult, QueryResultRow } from "pg";
import { CheckinService } from "../src/modules/checkin/checkin.service.js";
import type { IDatabase } from "../src/shared/interfaces/IDatabase.js";

interface RosterRegistrationRecord {
  id: string;
  user_id: string;
  workshop_id: string;
  status: "pending_payment" | "confirmed" | "cancelled" | "expired";
  cancelled_at: Date | null;
  updated_at: Date;
  created_at: Date;
}

interface UserRecord {
  id: string;
  full_name: string;
  student_id: string | null;
}

class CheckinReadDatabaseStub implements IDatabase {
  public readonly registrations: RosterRegistrationRecord[] = [];
  public readonly users = new Map<string, UserRecord>();

  public async query<T extends QueryResultRow>(text: string, params: unknown[] = []): Promise<QueryResult<T>> {
    if (text.includes("FROM registrations r") && text.includes("JOIN users u ON u.id = r.user_id") && text.includes("r.workshop_id=$1")) {
      const workshopId = String(params[0]);
      const after = typeof params[1] === "string" ? new Date(String(params[1])) : null;
      const rows = this.registrations
        .filter((registration) =>
          registration.workshop_id === workshopId &&
          ["confirmed", "cancelled", "expired"].includes(registration.status) &&
          (!after || registration.updated_at > after)
        )
        .sort((a, b) => a.updated_at.getTime() - b.updated_at.getTime() || a.created_at.getTime() - b.created_at.getTime())
        .map((registration) => {
          const user = this.users.get(registration.user_id);
          return {
            registration_id: registration.id,
            student_user_id: registration.user_id,
            student_name: user?.full_name ?? null,
            student_id: user?.student_id ?? null,
            registration_status: registration.status
          } as T;
        });
      return { rows, rowCount: rows.length } as QueryResult<T>;
    }

    if (text.includes("FROM registrations r") && text.includes("r.status='cancelled'") && text.includes("r.cancelled_at AS cancelled_at")) {
      const after = typeof params[0] === "string" ? new Date(String(params[0])) : null;
      const rows = this.registrations
        .filter((registration) =>
          registration.status === "cancelled" &&
          registration.cancelled_at &&
          (!after || registration.cancelled_at > after)
        )
        .sort((a, b) => {
          const left = a.cancelled_at?.getTime() ?? 0;
          const right = b.cancelled_at?.getTime() ?? 0;
          return left - right || a.id.localeCompare(b.id);
        })
        .map((registration) => ({
          registration_id: registration.id,
          cancelled_at: registration.cancelled_at!
        } as T));
      return { rows, rowCount: rows.length } as QueryResult<T>;
    }

    throw new Error(`Unhandled query in stub: ${text}`);
  }
}

async function main() {
  const database = new CheckinReadDatabaseStub();
  const service = new CheckinService(database);
  const baseTime = new Date("2026-05-15T10:00:00.000Z");

  database.users.set("student-1", { id: "student-1", full_name: "Alice Nguyen", student_id: "S001" });
  database.users.set("student-2", { id: "student-2", full_name: "Bao Tran", student_id: "S002" });
  database.users.set("student-3", { id: "student-3", full_name: "Chi Le", student_id: null });

  database.registrations.push(
    {
      id: "reg-confirmed",
      user_id: "student-1",
      workshop_id: "workshop-1",
      status: "confirmed",
      cancelled_at: null,
      updated_at: new Date("2026-05-15T10:05:00.000Z"),
      created_at: baseTime
    },
    {
      id: "reg-cancelled",
      user_id: "student-2",
      workshop_id: "workshop-1",
      status: "cancelled",
      cancelled_at: new Date("2026-05-15T10:10:00.000Z"),
      updated_at: new Date("2026-05-15T10:10:00.000Z"),
      created_at: new Date("2026-05-15T10:01:00.000Z")
    },
    {
      id: "reg-expired",
      user_id: "student-3",
      workshop_id: "workshop-1",
      status: "expired",
      cancelled_at: null,
      updated_at: new Date("2026-05-15T10:15:00.000Z"),
      created_at: new Date("2026-05-15T10:02:00.000Z")
    },
    {
      id: "reg-other-workshop",
      user_id: "student-1",
      workshop_id: "workshop-2",
      status: "confirmed",
      cancelled_at: null,
      updated_at: new Date("2026-05-15T10:20:00.000Z"),
      created_at: new Date("2026-05-15T10:03:00.000Z")
    }
  );

  const roster = await service.getRoster("workshop-1");
  assert.equal(roster.workshop_id, "workshop-1");
  assert.equal(roster.roster.length, 3);
  assert.deepEqual(
    roster.roster.map((entry) => ({
      registration_id: entry.registration_id,
      student_name: entry.student_name,
      registration_status: entry.registration_status
    })),
    [
      { registration_id: "reg-confirmed", student_name: "Alice Nguyen", registration_status: "confirmed" },
      { registration_id: "reg-cancelled", student_name: "Bao Tran", registration_status: "cancelled" },
      { registration_id: "reg-expired", student_name: "Chi Le", registration_status: "expired" }
    ]
  );

  const incrementalRoster = await service.getRoster("workshop-1", "2026-05-15T10:06:00.000Z");
  assert.equal(incrementalRoster.roster.length, 2);
  assert.equal(incrementalRoster.roster[0].registration_id, "reg-cancelled");

  const cancelled = await service.getCancelledSince("2026-05-15T10:08:00.000Z");
  assert.equal(cancelled.cancelled.length, 1);
  assert.equal(cancelled.cancelled[0].registration_id, "reg-cancelled");
  assert.equal(cancelled.cancelled[0].cancelled_at, "2026-05-15T10:10:00.000Z");

  let invalidAfterCode = "";
  try {
    await service.getCancelledSince("not-a-date");
  } catch (error) {
    invalidAfterCode = (error as { code?: string }).code ?? "";
  }
  assert.equal(invalidAfterCode, "INVALID_QUERY");

  console.log("Checkin read tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

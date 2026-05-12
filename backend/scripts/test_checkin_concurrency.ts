import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import type { QueryResult, QueryResultRow } from "pg";
import { CheckinService } from "../src/modules/checkin/checkin.service.js";
import type { IDatabase } from "../src/shared/interfaces/IDatabase.js";

process.env.JWT_SECRET = process.env.JWT_SECRET ?? "development-secret";

class ConcurrencyDatabaseStub implements IDatabase {
  private readonly registration = {
    registration_id: "reg-concurrent",
    registration_user_id: "student-concurrent",
    registration_workshop_id: "workshop-concurrent",
    registration_status: "confirmed",
    workshop_status: "published",
    checked_in_at: null as Date | null
  };

  private persisted: Date | null = null;

  public async query<T extends QueryResultRow>(text: string, params: unknown[] = []): Promise<QueryResult<T>> {
    if (text.includes("LEFT JOIN workshop_checkins")) {
      return {
        rows: [{
          ...this.registration,
          checked_in_at: this.persisted
        } as T],
        rowCount: 1
      } as QueryResult<T>;
    }

    if (text.includes("INSERT INTO workshop_checkins")) {
      if (this.persisted) {
        return { rows: [], rowCount: 0 } as QueryResult<T>;
      }
      this.persisted = new Date();
      return { rows: [{ checked_in_at: this.persisted } as T], rowCount: 1 } as QueryResult<T>;
    }

    if (text.includes("WHERE registration_id=$1")) {
      return {
        rows: this.persisted ? [{ registration_id: String(params[0]), workshop_id: "workshop-concurrent", checked_in_at: this.persisted } as T] : [],
        rowCount: this.persisted ? 1 : 0
      } as QueryResult<T>;
    }

    if (text.includes("WHERE checked_in_by=$1 AND device_id=$2 AND device_scan_id=$3")) {
      return { rows: [], rowCount: 0 } as QueryResult<T>;
    }

    throw new Error(`Unhandled query in concurrency stub: ${text}`);
  }
}

function makeToken(): string {
  return jwt.sign(
    {
      type: "workshop_checkin",
      registration_id: "reg-concurrent",
      workshop_id: "workshop-concurrent",
      user_id: "student-concurrent",
      exp: Math.floor(Date.now() / 1000) + 3600
    },
    process.env.JWT_SECRET!
  );
}

async function main() {
  const database = new ConcurrencyDatabaseStub();
  const service = new CheckinService(database);
  const qrToken = makeToken();

  const results = await Promise.all([
    service.scan({ actorUserId: "staff-1", qrToken }),
    service.scan({ actorUserId: "staff-1", qrToken }),
    service.scan({ actorUserId: "staff-1", qrToken }),
    service.scan({ actorUserId: "staff-1", qrToken })
  ]);

  const checkedIn = results.filter((result) => result.result === "checked_in").length;
  const alreadyCheckedIn = results.filter((result) => result.result === "already_checked_in").length;
  assert.equal(checkedIn, 1);
  assert.equal(alreadyCheckedIn, 3);
  console.log("Checkin concurrency test passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

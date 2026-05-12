import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import type { QueryResult, QueryResultRow } from "pg";
import { CheckinService } from "../src/modules/checkin/checkin.service.js";
import type { IDatabase } from "../src/shared/interfaces/IDatabase.js";

process.env.JWT_SECRET = process.env.JWT_SECRET ?? "development-secret";

type RegistrationStatus = "pending_payment" | "confirmed" | "cancelled" | "expired";
type WorkshopStatus = "draft" | "published" | "cancelled";

interface RegistrationRecord {
  id: string;
  user_id: string;
  workshop_id: string;
  status: RegistrationStatus;
}

interface WorkshopRecord {
  id: string;
  status: WorkshopStatus;
}

interface CheckinRecord {
  registration_id: string;
  workshop_id: string;
  user_id: string;
  checked_in_by: string;
  device_id: string | null;
  device_scan_id: string | null;
  checked_in_at: Date;
}

class CheckinDatabaseStub implements IDatabase {
  public readonly registrations = new Map<string, RegistrationRecord>();
  public readonly workshops = new Map<string, WorkshopRecord>();
  public readonly checkins = new Map<string, CheckinRecord>();

  public async query<T extends QueryResultRow>(text: string, params: unknown[] = []): Promise<QueryResult<T>> {
    if (text.includes("FROM registrations r") && text.includes("LEFT JOIN workshop_checkins")) {
      const registration = this.registrations.get(String(params[0]));
      if (!registration) {
        return { rows: [], rowCount: 0 } as QueryResult<T>;
      }
      const workshop = this.workshops.get(registration.workshop_id)!;
      const checkin = this.checkins.get(registration.id) ?? null;
      return {
        rows: [{
          registration_id: registration.id,
          registration_user_id: registration.user_id,
          registration_workshop_id: registration.workshop_id,
          registration_status: registration.status,
          workshop_status: workshop.status,
          checked_in_at: checkin?.checked_in_at ?? null
        } as T],
        rowCount: 1
      } as QueryResult<T>;
    }

    if (text.includes("WHERE checked_in_by=$1 AND device_id=$2 AND device_scan_id=$3")) {
      const row = [...this.checkins.values()].find((checkin) =>
        checkin.checked_in_by === params[0] &&
        checkin.device_id === params[1] &&
        checkin.device_scan_id === params[2]
      );
      return { rows: row ? [{ registration_id: row.registration_id, workshop_id: row.workshop_id, checked_in_at: row.checked_in_at } as T] : [], rowCount: row ? 1 : 0 } as QueryResult<T>;
    }

    if (text.includes("FROM workshop_checkins") && text.includes("WHERE registration_id=$1")) {
      const row = this.checkins.get(String(params[0]));
      return { rows: row ? [{ registration_id: row.registration_id, workshop_id: row.workshop_id, checked_in_at: row.checked_in_at } as T] : [], rowCount: row ? 1 : 0 } as QueryResult<T>;
    }

    if (text.includes("INSERT INTO workshop_checkins")) {
      const registrationId = String(params[1]);
      if (this.checkins.has(registrationId)) {
        return { rows: [], rowCount: 0 } as QueryResult<T>;
      }
      const checkedInAt = new Date();
      this.checkins.set(registrationId, {
        registration_id: registrationId,
        workshop_id: String(params[2]),
        user_id: String(params[3]),
        checked_in_by: String(params[4]),
        device_id: params[6] ? String(params[6]) : null,
        device_scan_id: params[7] ? String(params[7]) : null,
        checked_in_at: checkedInAt
      });
      return { rows: [{ checked_in_at: checkedInAt } as T], rowCount: 1 } as QueryResult<T>;
    }

    if (text.includes("SELECT COUNT(*)::text AS total FROM workshop_checkins")) {
      return { rows: [{ total: String(this.checkins.size) } as T], rowCount: 1 } as QueryResult<T>;
    }

    throw new Error(`Unhandled query in stub: ${text}`);
  }
}

function makeQrToken(input: { registrationId: string; workshopId: string; userId: string }): string {
  return jwt.sign(
    {
      type: "workshop_checkin",
      registration_id: input.registrationId,
      workshop_id: input.workshopId,
      user_id: input.userId,
      exp: Math.floor(Date.now() / 1000) + 3600
    },
    process.env.JWT_SECRET!
  );
}

async function main() {
  const database = new CheckinDatabaseStub();
  const service = new CheckinService(database);
  const registrationId = "reg-1";
  const workshopId = "workshop-1";
  const userId = "student-1";
  const actorUserId = "staff-1";

  database.registrations.set(registrationId, { id: registrationId, user_id: userId, workshop_id: workshopId, status: "confirmed" });
  database.workshops.set(workshopId, { id: workshopId, status: "published" });

  const qrToken = makeQrToken({ registrationId, workshopId, userId });
  const first = await service.scan({ actorUserId, qrToken });
  assert.equal(first.result, "checked_in");
  assert.equal(first.registration_id, registrationId);

  const duplicate = await service.scan({ actorUserId, qrToken });
  assert.equal(duplicate.result, "already_checked_in");
  assert.equal(database.checkins.size, 1);

  let invalidQrCode = "";
  try {
    await service.scan({ actorUserId, qrToken: "invalid-token" });
  } catch (error) {
    invalidQrCode = (error as { code?: string }).code ?? "";
  }
  assert.equal(invalidQrCode, "INVALID_QR_TOKEN");

  const syncRegistrationId = "reg-2";
  const syncWorkshopId = "workshop-2";
  const syncUserId = "student-2";
  database.registrations.set(syncRegistrationId, { id: syncRegistrationId, user_id: syncUserId, workshop_id: syncWorkshopId, status: "confirmed" });
  database.workshops.set(syncWorkshopId, { id: syncWorkshopId, status: "published" });

  const syncToken = makeQrToken({ registrationId: syncRegistrationId, workshopId: syncWorkshopId, userId: syncUserId });
  const syncResponse = await service.sync({
    actorUserId,
    items: [
      {
        device_id: "device-a",
        device_scan_id: "scan-1",
        qr_token: syncToken,
        scanned_at_device: new Date().toISOString()
      },
      {
        device_id: "device-a",
        device_scan_id: "scan-invalid",
        qr_token: "broken",
        scanned_at_device: new Date().toISOString()
      }
    ]
  });

  assert.equal(syncResponse.results[0].result, "checked_in");
  assert.equal(syncResponse.results[1].result, "invalid_qr");

  const replay = await service.sync({
    actorUserId,
    items: [
      {
        device_id: "device-a",
        device_scan_id: "scan-1",
        qr_token: syncToken,
        scanned_at_device: new Date().toISOString()
      }
    ]
  });
  assert.equal(replay.results[0].result, "checked_in");

  console.log("Checkin service tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

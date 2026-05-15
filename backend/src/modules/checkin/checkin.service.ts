import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { AppError } from "../../shared/errors/AppError.js";
import type { IDatabase } from "../../shared/interfaces/IDatabase.js";
import type {
  CheckinQrPayload,
  CheckinScanResponse,
  CheckinSource,
  CheckinSyncItemRequest,
  CheckinSyncItemResponse,
  CheckinSyncResponse
} from "./checkin.types.js";

interface CheckinCandidateRow {
  registration_id: string;
  registration_user_id: string;
  student_name: string | null;
  student_id: string | null;
  registration_workshop_id: string;
  registration_status: "pending_payment" | "confirmed" | "cancelled" | "expired";
  workshop_status: "draft" | "published" | "cancelled";
  checked_in_at: Date | null;
}

interface CheckinReplayRow {
  registration_id: string;
  workshop_id: string;
  checked_in_at: Date;
  student_name: string | null;
  student_id: string | null;
}

interface InsertCheckinRow {
  checked_in_at: Date;
}

export class CheckinService {
  private static readonly MAX_SYNC_BATCH = 100;

  public constructor(private readonly database: IDatabase) {}

  public async scan(input: {
    actorUserId: string;
    qrToken: string;
    workshopId?: string;
  }): Promise<CheckinScanResponse> {
    const payload = this.verifyQrToken(input.qrToken);
    const candidate = await this.getCandidate(payload.registration_id);
    this.assertCandidate(candidate, payload, input.workshopId);

    if (candidate.checked_in_at) {
      return this.toScanResponse(
        "already_checked_in",
        candidate.registration_id,
        candidate.registration_workshop_id,
        candidate.student_name,
        candidate.student_id,
        candidate.checked_in_at
      );
    }

    const inserted = await this.insertCheckin({
      registrationId: candidate.registration_id,
      workshopId: candidate.registration_workshop_id,
      userId: candidate.registration_user_id,
      checkedInBy: input.actorUserId,
      source: "online_scan"
    });

    if (inserted) {
      return this.toScanResponse(
        "checked_in",
        candidate.registration_id,
        candidate.registration_workshop_id,
        candidate.student_name,
        candidate.student_id,
        inserted.checked_in_at
      );
    }

    const existing = await this.getPersistedCheckin(candidate.registration_id);
    if (!existing) {
      throw new AppError(500, "CHECKIN_WRITE_FAILED", "Attendance record could not be persisted");
    }
    return this.toScanResponse(
      "already_checked_in",
      existing.registration_id,
      existing.workshop_id,
      existing.student_name,
      existing.student_id,
      existing.checked_in_at
    );
  }

  public async sync(input: {
    actorUserId: string;
    items: CheckinSyncItemRequest[];
  }): Promise<CheckinSyncResponse> {
    if (input.items.length === 0 || input.items.length > CheckinService.MAX_SYNC_BATCH) {
      throw new AppError(400, "INVALID_SYNC_PAYLOAD", "items must contain between 1 and 100 records");
    }

    const results: CheckinSyncItemResponse[] = [];
    for (const item of input.items) {
      results.push(await this.processSyncItem(input.actorUserId, item));
    }
    return { results };
  }

  public async getTotalCheckins(): Promise<number> {
    const result = await this.database.query<{ total: string }>("SELECT COUNT(*)::text AS total FROM workshop_checkins");
    return Number(result.rows[0]?.total ?? 0);
  }

  private async processSyncItem(actorUserId: string, item: CheckinSyncItemRequest): Promise<CheckinSyncItemResponse> {
    if (!item?.device_id || !item?.device_scan_id || !item?.qr_token || !item?.scanned_at_device) {
      throw new AppError(400, "INVALID_SYNC_PAYLOAD", "Each sync item requires device_id, device_scan_id, qr_token, and scanned_at_device");
    }

    const replay = await this.getReplayByDevice(actorUserId, item.device_id, item.device_scan_id);
    if (replay) {
      return {
        device_scan_id: item.device_scan_id,
        result: "checked_in",
        registration_id: replay.registration_id,
        checked_in_at: replay.checked_in_at.toISOString(),
        student_name: replay.student_name,
        student_id: replay.student_id,
        error_code: null
      };
    }

    let payload: CheckinQrPayload;
    try {
      payload = this.verifyQrToken(item.qr_token);
    } catch {
      return this.toSyncError(item.device_scan_id, "invalid_qr", "INVALID_QR_TOKEN");
    }

    try {
      const candidate = await this.getCandidate(payload.registration_id);
      const mismatch = this.getMismatchCode(candidate, payload, item.workshop_id);
      if (mismatch) {
        return this.toSyncError(item.device_scan_id, mismatch.result, mismatch.errorCode);
      }
      if (candidate.workshop_status === "cancelled") {
        return this.toSyncError(item.device_scan_id, "workshop_cancelled", "WORKSHOP_CANCELLED");
      }
      if (candidate.registration_status !== "confirmed") {
        return this.toSyncError(item.device_scan_id, "registration_not_confirmed", "REGISTRATION_NOT_CONFIRMED");
      }
      if (candidate.checked_in_at) {
        return {
          device_scan_id: item.device_scan_id,
          result: "already_checked_in",
          registration_id: candidate.registration_id,
          checked_in_at: candidate.checked_in_at.toISOString(),
          student_name: candidate.student_name,
          student_id: candidate.student_id,
          error_code: null
        };
      }

      const inserted = await this.insertCheckin({
        registrationId: candidate.registration_id,
        workshopId: candidate.registration_workshop_id,
        userId: candidate.registration_user_id,
        checkedInBy: actorUserId,
        source: "offline_sync",
        deviceId: item.device_id,
        deviceScanId: item.device_scan_id,
        scannedAtDevice: item.scanned_at_device
      });

      if (inserted) {
        return {
          device_scan_id: item.device_scan_id,
          result: "checked_in",
          registration_id: candidate.registration_id,
          checked_in_at: inserted.checked_in_at.toISOString(),
          student_name: candidate.student_name,
          student_id: candidate.student_id,
          error_code: null
        };
      }

      const existing = await this.getPersistedCheckin(candidate.registration_id);
      if (!existing) {
        return this.toSyncError(item.device_scan_id, "already_checked_in", "CHECKIN_ALREADY_EXISTS");
      }

      return {
        device_scan_id: item.device_scan_id,
        result: "already_checked_in",
        registration_id: existing.registration_id,
        checked_in_at: existing.checked_in_at.toISOString(),
        student_name: existing.student_name,
        student_id: existing.student_id,
        error_code: null
      };
    } catch (error) {
      if (error instanceof AppError && error.code === "INVALID_QR_TOKEN") {
        return this.toSyncError(item.device_scan_id, "invalid_qr", "INVALID_QR_TOKEN");
      }
      throw error;
    }
  }

  private async getCandidate(registrationId: string): Promise<CheckinCandidateRow> {
    const result = await this.database.query<CheckinCandidateRow>(
      `SELECT
         r.id AS registration_id,
         r.user_id AS registration_user_id,
         u.full_name AS student_name,
         u.student_id AS student_id,
         r.workshop_id AS registration_workshop_id,
         r.status AS registration_status,
         w.status AS workshop_status,
         wc.checked_in_at AS checked_in_at
       FROM registrations r
       JOIN users u ON u.id = r.user_id
       JOIN workshops w ON w.id = r.workshop_id
       LEFT JOIN workshop_checkins wc ON wc.registration_id = r.id
       WHERE r.id=$1
       LIMIT 1`,
      [registrationId]
    );
    const row = result.rows[0];
    if (!row) {
      throw new AppError(400, "INVALID_QR_TOKEN", "QR token does not reference a valid registration");
    }
    return row;
  }

  private assertCandidate(candidate: CheckinCandidateRow, payload: CheckinQrPayload, requestedWorkshopId?: string): void {
    const mismatch = this.getMismatchCode(candidate, payload, requestedWorkshopId);
    if (mismatch) {
      throw new AppError(mismatch.errorCode === "INVALID_QR_TOKEN" ? 400 : 409, mismatch.errorCode, mismatch.message);
    }
    if (candidate.workshop_status === "cancelled") {
      throw new AppError(409, "WORKSHOP_CANCELLED", "Workshop is cancelled");
    }
    if (candidate.registration_status !== "confirmed") {
      throw new AppError(409, "REGISTRATION_NOT_CONFIRMED", "Registration is not eligible for check-in");
    }
  }

  private getMismatchCode(
    candidate: CheckinCandidateRow,
    payload: CheckinQrPayload,
    requestedWorkshopId?: string
  ): { result: "workshop_mismatch" | "invalid_qr"; errorCode: string; message: string } | null {
    if (
      candidate.registration_id !== payload.registration_id ||
      candidate.registration_user_id !== payload.user_id ||
      candidate.registration_workshop_id !== payload.workshop_id
    ) {
      return { result: "invalid_qr", errorCode: "INVALID_QR_TOKEN", message: "QR token claims do not match the registration record" };
    }
    if (requestedWorkshopId && requestedWorkshopId !== payload.workshop_id) {
      return { result: "workshop_mismatch", errorCode: "WORKSHOP_MISMATCH", message: "Requested workshop does not match QR token workshop" };
    }
    return null;
  }

  private async getReplayByDevice(actorUserId: string, deviceId: string, deviceScanId: string): Promise<CheckinReplayRow | null> {
    const result = await this.database.query<CheckinReplayRow>(
      `SELECT
         wc.registration_id,
         wc.workshop_id,
         wc.checked_in_at,
         u.full_name AS student_name,
         u.student_id AS student_id
       FROM workshop_checkins wc
       JOIN registrations r ON r.id = wc.registration_id
       JOIN users u ON u.id = r.user_id
       WHERE wc.checked_in_by=$1 AND wc.device_id=$2 AND wc.device_scan_id=$3
       LIMIT 1`,
      [actorUserId, deviceId, deviceScanId]
    );
    return result.rows[0] ?? null;
  }

  private async getPersistedCheckin(registrationId: string): Promise<CheckinReplayRow | null> {
    const result = await this.database.query<CheckinReplayRow>(
      `SELECT
         wc.registration_id,
         wc.workshop_id,
         wc.checked_in_at,
         u.full_name AS student_name,
         u.student_id AS student_id
       FROM workshop_checkins wc
       JOIN registrations r ON r.id = wc.registration_id
       JOIN users u ON u.id = r.user_id
       WHERE wc.registration_id=$1
       LIMIT 1`,
      [registrationId]
    );
    return result.rows[0] ?? null;
  }

  private async insertCheckin(input: {
    registrationId: string;
    workshopId: string;
    userId: string;
    checkedInBy: string;
    source: CheckinSource;
    deviceId?: string;
    deviceScanId?: string;
    scannedAtDevice?: string;
  }): Promise<InsertCheckinRow | null> {
    const result = await this.database.query<InsertCheckinRow>(
      `INSERT INTO workshop_checkins (
         id, registration_id, workshop_id, user_id, checked_in_by, source,
         device_id, device_scan_id, scanned_at_device, checked_in_at, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW(),NOW())
       ON CONFLICT DO NOTHING
       RETURNING checked_in_at`,
      [
        randomUUID(),
        input.registrationId,
        input.workshopId,
        input.userId,
        input.checkedInBy,
        input.source,
        input.deviceId ?? null,
        input.deviceScanId ?? null,
        input.scannedAtDevice ?? null
      ]
    );
    return result.rows[0] ?? null;
  }

  private verifyQrToken(token: string): CheckinQrPayload {
    const secret = process.env.JWT_SECRET ?? "development-secret";
    try {
      const payload = jwt.verify(token, secret) as CheckinQrPayload;
      if (
        payload.type !== "workshop_checkin" ||
        typeof payload.registration_id !== "string" ||
        typeof payload.workshop_id !== "string" ||
        typeof payload.user_id !== "string"
      ) {
        throw new AppError(400, "INVALID_QR_TOKEN", "QR token does not contain required claims");
      }
      return payload;
    } catch {
      throw new AppError(400, "INVALID_QR_TOKEN", "QR token is invalid or expired");
    }
  }

  private toScanResponse(
    result: "checked_in" | "already_checked_in",
    registrationId: string,
    workshopId: string,
    studentName: string | null,
    studentId: string | null,
    checkedInAt: Date
  ): CheckinScanResponse {
    return {
      result,
      registration_id: registrationId,
      workshop_id: workshopId,
      student_name: studentName,
      student_id: studentId,
      checked_in_at: checkedInAt.toISOString()
    };
  }

  private toSyncError(deviceScanId: string, result: CheckinSyncItemResponse["result"], errorCode: string): CheckinSyncItemResponse {
    return {
      device_scan_id: deviceScanId,
      result,
      registration_id: null,
      checked_in_at: null,
      student_name: null,
      student_id: null,
      error_code: errorCode
    };
  }
}

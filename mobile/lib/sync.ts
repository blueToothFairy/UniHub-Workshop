import { checkinApi, type MobileCheckinSyncItemRequest, type MobileCheckinSyncItemResponse } from "./api";
import {
  appendSyncLog,
  listPendingCheckins,
  markCheckinsSynced,
  markPendingCheckinsRetained,
  type StoredCheckinRecord
} from "./db";

export interface SyncPendingCheckinsResult {
  processed: number;
  cleared: number;
  retained: number;
  clearedIds: string[];
  retainedItems: Array<{ device_scan_id: string; result: MobileCheckinSyncItemResponse["result"]; error_code: string | null }>;
}

function toSyncRequestItem(record: StoredCheckinRecord): MobileCheckinSyncItemRequest {
  return {
    device_id: record.device_id,
    device_scan_id: record.device_scan_id,
    qr_token: record.qr_token,
    workshop_id: record.workshop_id ?? undefined,
    scanned_at_device: record.scanned_at_device
  };
}

function isSyncedResult(result: MobileCheckinSyncItemResponse["result"]): boolean {
  return result === "checked_in";
}

function isConflictResult(result: MobileCheckinSyncItemResponse["result"]): boolean {
  return result === "already_checked_in";
}

let syncPendingCheckinsInFlight: Promise<SyncPendingCheckinsResult> | null = null;

export async function syncPendingCheckins(token: string, chunkSize = 25): Promise<SyncPendingCheckinsResult> {
  return syncPendingCheckinsWithStaffCode(token, null, chunkSize);
}

export async function syncPendingCheckinsWithStaffCode(
  token: string,
  staffCode: string | null,
  chunkSize = 25
): Promise<SyncPendingCheckinsResult> {
  if (syncPendingCheckinsInFlight) {
    return syncPendingCheckinsInFlight;
  }

  syncPendingCheckinsInFlight = (async () => {
    const pending = await listPendingCheckins(chunkSize);
    if (pending.length === 0) {
      return { processed: 0, cleared: 0, retained: 0, clearedIds: [], retainedItems: [] };
    }

    try {
      const response = await checkinApi.syncCheckins(token, pending.map(toSyncRequestItem));
      const synced = response.results.filter((result) => isSyncedResult(result.result));
      const conflicts = response.results.filter((result) => isConflictResult(result.result));
      const retained = response.results.filter((result) => !isSyncedResult(result.result) && !isConflictResult(result.result));

      await markCheckinsSynced(
        [...synced, ...conflicts].map((item) => ({ device_scan_id: item.device_scan_id, result: item }))
      );
      await markPendingCheckinsRetained(
        retained.map((item) => ({ device_scan_id: item.device_scan_id, result: item, error_code: item.error_code }))
      );
      await appendSyncLog({
        synced_at: new Date().toISOString(),
        staff_code: staffCode,
        records_sent: pending.length,
        records_ok: synced.length,
        records_conflict: conflicts.length,
        error: null
      });

      return {
        processed: response.results.length,
        cleared: synced.length + conflicts.length,
        retained: retained.length,
        clearedIds: [...synced, ...conflicts].map((item) => item.device_scan_id),
        retainedItems: retained.map((item) => ({
          device_scan_id: item.device_scan_id,
          result: item.result,
          error_code: item.error_code
        }))
      };
    } catch (error) {
      await appendSyncLog({
        synced_at: new Date().toISOString(),
        staff_code: staffCode,
        records_sent: pending.length,
        records_ok: 0,
        records_conflict: 0,
        error: error instanceof Error ? error.message : "Unknown sync failure"
      });
      throw error;
    }
  })();

  try {
    return await syncPendingCheckinsInFlight;
  } finally {
    syncPendingCheckinsInFlight = null;
  }
}

import * as SQLite from "expo-sqlite";

export type StoredCheckinStatus = "pending_sync" | "synced" | "conflict";

export interface StoredCheckinRecord {
  id: string;
  device_scan_id: string;
  qr_token: string;
  registration_id: string | null;
  workshop_id: string | null;
  student_name: string | null;
  checked_in_at: string;
  scanned_at_device: string;
  status: StoredCheckinStatus;
  device_id: string;
  sync_result: string | null;
  retry_count: number;
  last_error_code: string | null;
  created_at: string;
  updated_at: string;
}

export interface PendingCheckinSummary {
  total: number;
  retained: number;
  items: StoredCheckinRecord[];
}

interface SyncLogEntry {
  id: string;
  synced_at: string;
  records_sent: number;
  records_ok: number;
  records_conflict: number;
  error: string | null;
}

const DATABASE_NAME = "checkin-queue.db";
const INIT_SQL = `
  CREATE TABLE IF NOT EXISTS checkins (
    id TEXT PRIMARY KEY,
    device_scan_id TEXT NOT NULL UNIQUE,
    qr_token TEXT NOT NULL,
    registration_id TEXT,
    workshop_id TEXT,
    student_name TEXT,
    checked_in_at TEXT NOT NULL,
    scanned_at_device TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending_sync',
    device_id TEXT NOT NULL,
    sync_result TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0,
    last_error_code TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_checkins_status
  ON checkins(status);

  CREATE INDEX IF NOT EXISTS idx_checkins_registration_id
  ON checkins(registration_id);

  CREATE TABLE IF NOT EXISTS cancelled_registrations (
    registration_id TEXT PRIMARY KEY,
    cancelled_at TEXT NOT NULL,
    synced_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sync_log (
    id TEXT PRIMARY KEY,
    synced_at TEXT NOT NULL,
    records_sent INTEGER,
    records_ok INTEGER,
    records_conflict INTEGER,
    error TEXT
  );

  CREATE TABLE IF NOT EXISTS pending_checkins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL,
    device_scan_id TEXT NOT NULL UNIQUE,
    qr_token TEXT NOT NULL,
    workshop_id TEXT,
    scanned_at_device TEXT NOT NULL,
    retry_count INTEGER NOT NULL DEFAULT 0,
    last_error_code TEXT,
    created_at TEXT NOT NULL
  );

  INSERT OR IGNORE INTO checkins (
    id,
    device_scan_id,
    qr_token,
    registration_id,
    workshop_id,
    student_name,
    checked_in_at,
    scanned_at_device,
    status,
    device_id,
    sync_result,
    retry_count,
    last_error_code,
    created_at,
    updated_at
  )
  SELECT
    'legacy-' || device_scan_id,
    device_scan_id,
    qr_token,
    NULL,
    workshop_id,
    NULL,
    scanned_at_device,
    scanned_at_device,
    'pending_sync',
    device_id,
    NULL,
    retry_count,
    last_error_code,
    created_at,
    created_at
  FROM pending_checkins;
`;

let databasePromise: Promise<SQLite.SQLiteDatabase> | null = null;

function createLocalId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function serializeSyncResult(result: unknown): string {
  return JSON.stringify(result);
}

async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (!databasePromise) {
    databasePromise = (async () => {
      const database = await SQLite.openDatabaseAsync(DATABASE_NAME);
      await database.execAsync(INIT_SQL);
      return database;
    })();
  }
  return databasePromise;
}

export async function enqueuePendingCheckin(
  record: Omit<StoredCheckinRecord, "retry_count" | "last_error_code" | "sync_result" | "created_at" | "updated_at" | "status">
): Promise<void> {
  const database = await getDatabase();
  const now = new Date().toISOString();
  await database.runAsync(
    `INSERT OR IGNORE INTO checkins (
      id, device_scan_id, qr_token, registration_id, workshop_id, student_name, checked_in_at,
      scanned_at_device, status, device_id, sync_result, retry_count, last_error_code, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending_sync', ?, NULL, 0, NULL, ?, ?)`,
    record.id,
    record.device_scan_id,
    record.qr_token,
    record.registration_id,
    record.workshop_id,
    record.student_name,
    record.checked_in_at,
    record.scanned_at_device,
    record.device_id,
    now,
    now
  );
}

export async function listPendingCheckins(limit = 25): Promise<StoredCheckinRecord[]> {
  const database = await getDatabase();
  return database.getAllAsync<StoredCheckinRecord>(
    `SELECT id, device_scan_id, qr_token, registration_id, workshop_id, student_name, checked_in_at,
            scanned_at_device, status, device_id, sync_result, retry_count, last_error_code, created_at, updated_at
     FROM checkins
     WHERE status = 'pending_sync'
     ORDER BY checked_in_at ASC
     LIMIT ?`,
    limit
  );
}

async function listVisibleQueuedCheckins(limit = 10): Promise<StoredCheckinRecord[]> {
  const database = await getDatabase();
  return database.getAllAsync<StoredCheckinRecord>(
    `SELECT id, device_scan_id, qr_token, registration_id, workshop_id, student_name, checked_in_at,
            scanned_at_device, status, device_id, sync_result, retry_count, last_error_code, created_at, updated_at
     FROM checkins
     WHERE status IN ('pending_sync', 'conflict')
     ORDER BY
       CASE status WHEN 'pending_sync' THEN 0 ELSE 1 END,
       checked_in_at ASC
     LIMIT ?`,
    limit
  );
}

export async function getPendingCheckinSummary(limit = 10): Promise<PendingCheckinSummary> {
  const database = await getDatabase();
  const counts = await database.getFirstAsync<{ total: number | string; retained: number | string }>(
    `SELECT
       SUM(CASE WHEN status = 'pending_sync' THEN 1 ELSE 0 END) AS total,
       SUM(CASE WHEN status = 'conflict' THEN 1 ELSE 0 END) AS retained
     FROM checkins`
  );

  return {
    total: Number(counts?.total ?? 0),
    retained: Number(counts?.retained ?? 0),
    items: await listVisibleQueuedCheckins(limit)
  };
}

export async function markCheckinsSynced(items: Array<{ device_scan_id: string; result: unknown }>): Promise<void> {
  if (items.length === 0) {
    return;
  }

  const database = await getDatabase();
  const updatedAt = new Date().toISOString();
  for (const item of items) {
    await database.runAsync(
      `UPDATE checkins
       SET status = 'synced',
           sync_result = ?,
           retry_count = retry_count + 1,
           last_error_code = NULL,
           updated_at = ?
       WHERE device_scan_id = ?`,
      serializeSyncResult(item.result),
      updatedAt,
      item.device_scan_id
    );
  }
}

export async function markCheckinsConflict(items: Array<{ device_scan_id: string; result: unknown; error_code: string | null }>): Promise<void> {
  if (items.length === 0) {
    return;
  }

  const database = await getDatabase();
  const updatedAt = new Date().toISOString();
  for (const item of items) {
    await database.runAsync(
      `UPDATE checkins
       SET status = 'conflict',
           sync_result = ?,
           retry_count = retry_count + 1,
           last_error_code = ?,
           updated_at = ?
       WHERE device_scan_id = ?`,
      serializeSyncResult(item.result),
      item.error_code,
      updatedAt,
      item.device_scan_id
    );
  }
}

export async function markPendingCheckinsRetained(items: Array<{ device_scan_id: string; result: unknown; error_code: string | null }>): Promise<void> {
  if (items.length === 0) {
    return;
  }

  const database = await getDatabase();
  const updatedAt = new Date().toISOString();
  for (const item of items) {
    await database.runAsync(
      `UPDATE checkins
       SET status = 'pending_sync',
           sync_result = ?,
           retry_count = retry_count + 1,
           last_error_code = ?,
           updated_at = ?
       WHERE device_scan_id = ?`,
      serializeSyncResult(item.result),
      item.error_code,
      updatedAt,
      item.device_scan_id
    );
  }
}

export async function appendSyncLog(entry: Omit<SyncLogEntry, "id"> & { id?: string }): Promise<void> {
  const database = await getDatabase();
  await database.runAsync(
    `INSERT INTO sync_log (
      id, synced_at, records_sent, records_ok, records_conflict, error
    ) VALUES (?, ?, ?, ?, ?, ?)`,
    entry.id ?? createLocalId("sync"),
    entry.synced_at,
    entry.records_sent,
    entry.records_ok,
    entry.records_conflict,
    entry.error
  );
}

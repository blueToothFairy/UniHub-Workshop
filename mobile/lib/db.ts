import * as SQLite from "expo-sqlite";

export type StoredCheckinStatus = "pending_sync" | "synced" | "conflict";

export interface CachedWorkshopRecord {
  workshop_id: string;
  title: string;
  starts_at: string | null;
  ends_at: string | null;
  location: string | null;
  status: string | null;
  synced_at: string;
}

export interface CachedRosterEntry {
  workshop_id: string;
  registration_id: string;
  student_user_id: string;
  student_name: string;
  student_id: string | null;
  registration_status: string;
  synced_at: string;
}

export interface CancelledRegistrationRecord {
  registration_id: string;
  cancelled_at: string;
  synced_at: string;
}

export interface StoredCheckinRecord {
  id: string;
  device_scan_id: string;
  qr_token: string;
  registration_id: string | null;
  workshop_id: string | null;
  student_name: string | null;
  student_id: string | null;
  staff_code: string | null;
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
  staff_code: string | null;
  records_sent: number;
  records_ok: number;
  records_conflict: number;
  error: string | null;
}

export interface StoredSyncLogEntry {
  id: string;
  synced_at: string;
  staff_code: string | null;
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
    student_id TEXT,
    staff_code TEXT,
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
    staff_code TEXT,
    records_sent INTEGER,
    records_ok INTEGER,
    records_conflict INTEGER,
    error TEXT
  );

  CREATE TABLE IF NOT EXISTS workshops_cache (
    workshop_id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    starts_at TEXT,
    ends_at TEXT,
    location TEXT,
    status TEXT,
    synced_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS workshop_roster_cache (
    workshop_id TEXT NOT NULL,
    registration_id TEXT NOT NULL,
    student_user_id TEXT NOT NULL,
    student_name TEXT NOT NULL,
    student_id TEXT,
    registration_status TEXT NOT NULL,
    synced_at TEXT NOT NULL,
    PRIMARY KEY (workshop_id, registration_id)
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
    student_id,
    staff_code,
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
    NULL,
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
      await ensureSchema(database);
      return database;
    })();
  }
  return databasePromise;
}

async function hasColumn(database: SQLite.SQLiteDatabase, table: string, column: string): Promise<boolean> {
  const rows = await database.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
  return rows.some((row) => row.name === column);
}

async function ensureSchema(database: SQLite.SQLiteDatabase): Promise<void> {
  // These are best-effort migrations for existing installs.
  if (!(await hasColumn(database, "checkins", "student_id"))) {
    await database.execAsync("ALTER TABLE checkins ADD COLUMN student_id TEXT;");
  }
  if (!(await hasColumn(database, "checkins", "staff_code"))) {
    await database.execAsync("ALTER TABLE checkins ADD COLUMN staff_code TEXT;");
  }
  if (!(await hasColumn(database, "sync_log", "staff_code"))) {
    await database.execAsync("ALTER TABLE sync_log ADD COLUMN staff_code TEXT;");
  }

  await database.execAsync(`
    CREATE TABLE IF NOT EXISTS workshops_cache (
      workshop_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      starts_at TEXT,
      ends_at TEXT,
      location TEXT,
      status TEXT,
      synced_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workshop_roster_cache (
      workshop_id TEXT NOT NULL,
      registration_id TEXT NOT NULL,
      student_user_id TEXT NOT NULL,
      student_name TEXT NOT NULL,
      student_id TEXT,
      registration_status TEXT NOT NULL,
      synced_at TEXT NOT NULL,
      PRIMARY KEY (workshop_id, registration_id)
    );
  `);
}

export async function enqueuePendingCheckin(
  record: Omit<StoredCheckinRecord, "retry_count" | "last_error_code" | "sync_result" | "created_at" | "updated_at" | "status">
): Promise<void> {
  const database = await getDatabase();
  const now = new Date().toISOString();
  await database.runAsync(
    `INSERT OR IGNORE INTO checkins (
      id, device_scan_id, qr_token, registration_id, workshop_id, student_name, student_id, staff_code, checked_in_at,
      scanned_at_device, status, device_id, sync_result, retry_count, last_error_code, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_sync', ?, NULL, 0, NULL, ?, ?)`,
    record.id,
    record.device_scan_id,
    record.qr_token,
    record.registration_id,
    record.workshop_id,
    record.student_name,
    record.student_id,
    record.staff_code,
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
    `SELECT id, device_scan_id, qr_token, registration_id, workshop_id, student_name, student_id, staff_code, checked_in_at,
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
    `SELECT id, device_scan_id, qr_token, registration_id, workshop_id, student_name, student_id, staff_code, checked_in_at,
            scanned_at_device, status, device_id, sync_result, retry_count, last_error_code, created_at, updated_at
     FROM checkins
     WHERE status = 'pending_sync'
     ORDER BY checked_in_at ASC
     LIMIT ?`,
    limit
  );
}

export async function getPendingCheckinSummary(limit = 10): Promise<PendingCheckinSummary> {
  const database = await getDatabase();
  const counts = await database.getFirstAsync<{ total: number | string; retained: number | string }>(
    `SELECT
       SUM(CASE WHEN status = 'pending_sync' THEN 1 ELSE 0 END) AS total,
       SUM(CASE WHEN status = 'pending_sync' AND last_error_code IS NOT NULL THEN 1 ELSE 0 END) AS retained
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
    const payload = typeof item.result === "object" && item.result !== null ? (item.result as Record<string, unknown>) : null;
    const studentName = typeof payload?.student_name === "string" ? payload.student_name : null;
    const studentId = typeof payload?.student_id === "string" ? payload.student_id : null;
    const registrationId = typeof payload?.registration_id === "string" ? payload.registration_id : null;
    const workshopId = typeof payload?.workshop_id === "string" ? payload.workshop_id : null;
    await database.runAsync(
      `UPDATE checkins
       SET status = 'synced',
           sync_result = ?,
           student_name = COALESCE(?, student_name),
           student_id = COALESCE(?, student_id),
           registration_id = COALESCE(?, registration_id),
           workshop_id = COALESCE(?, workshop_id),
           retry_count = retry_count + 1,
           last_error_code = NULL,
           updated_at = ?
       WHERE device_scan_id = ?`,
      serializeSyncResult(item.result),
      studentName,
      studentId,
      registrationId,
      workshopId,
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
    const payload = typeof item.result === "object" && item.result !== null ? (item.result as Record<string, unknown>) : null;
    const studentName = typeof payload?.student_name === "string" ? payload.student_name : null;
    const studentId = typeof payload?.student_id === "string" ? payload.student_id : null;
    const registrationId = typeof payload?.registration_id === "string" ? payload.registration_id : null;
    const workshopId = typeof payload?.workshop_id === "string" ? payload.workshop_id : null;
    await database.runAsync(
      `UPDATE checkins
       SET status = 'conflict',
           sync_result = ?,
           student_name = COALESCE(?, student_name),
           student_id = COALESCE(?, student_id),
           registration_id = COALESCE(?, registration_id),
           workshop_id = COALESCE(?, workshop_id),
           retry_count = retry_count + 1,
           last_error_code = ?,
           updated_at = ?
       WHERE device_scan_id = ?`,
      serializeSyncResult(item.result),
      studentName,
      studentId,
      registrationId,
      workshopId,
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
    const payload = typeof item.result === "object" && item.result !== null ? (item.result as Record<string, unknown>) : null;
    const studentName = typeof payload?.student_name === "string" ? payload.student_name : null;
    const studentId = typeof payload?.student_id === "string" ? payload.student_id : null;
    const registrationId = typeof payload?.registration_id === "string" ? payload.registration_id : null;
    const workshopId = typeof payload?.workshop_id === "string" ? payload.workshop_id : null;
    await database.runAsync(
      `UPDATE checkins
       SET status = 'pending_sync',
           sync_result = ?,
           student_name = COALESCE(?, student_name),
           student_id = COALESCE(?, student_id),
           registration_id = COALESCE(?, registration_id),
           workshop_id = COALESCE(?, workshop_id),
           retry_count = retry_count + 1,
           last_error_code = ?,
           updated_at = ?
       WHERE device_scan_id = ?`,
      serializeSyncResult(item.result),
      studentName,
      studentId,
      registrationId,
      workshopId,
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
      id, synced_at, staff_code, records_sent, records_ok, records_conflict, error
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    entry.id ?? createLocalId("sync"),
    entry.synced_at,
    entry.staff_code ?? null,
    entry.records_sent,
    entry.records_ok,
    entry.records_conflict,
    entry.error
  );
}

export async function listSyncLog(limit = 30): Promise<StoredSyncLogEntry[]> {
  const database = await getDatabase();
  return database.getAllAsync<StoredSyncLogEntry>(
    `SELECT id, synced_at, staff_code, records_sent, records_ok, records_conflict, error
     FROM sync_log
     ORDER BY synced_at DESC
     LIMIT ?`,
    limit
  );
}

export async function listCheckinLog(limit = 60): Promise<StoredCheckinRecord[]> {
  const database = await getDatabase();
  return database.getAllAsync<StoredCheckinRecord>(
    `SELECT id, device_scan_id, qr_token, registration_id, workshop_id, student_name, student_id, staff_code, checked_in_at,
            scanned_at_device, status, device_id, sync_result, retry_count, last_error_code, created_at, updated_at
     FROM checkins
     ORDER BY checked_in_at DESC
     LIMIT ?`,
    limit
  );
}

export async function findLatestCheckinByRegistrationId(registrationId: string): Promise<StoredCheckinRecord | null> {
  const database = await getDatabase();
  const row = await database.getFirstAsync<StoredCheckinRecord>(
    `SELECT id, device_scan_id, qr_token, registration_id, workshop_id, student_name, student_id, staff_code, checked_in_at,
            scanned_at_device, status, device_id, sync_result, retry_count, last_error_code, created_at, updated_at
     FROM checkins
     WHERE registration_id = ?
     ORDER BY checked_in_at DESC
     LIMIT 1`,
    registrationId
  );
  return row ?? null;
}

export async function isRegistrationCancelled(registrationId: string): Promise<boolean> {
  const database = await getDatabase();
  const row = await database.getFirstAsync<{ registration_id: string }>(
    `SELECT registration_id
     FROM cancelled_registrations
     WHERE registration_id = ?
     LIMIT 1`,
    registrationId
  );
  return typeof row?.registration_id === "string";
}

export async function upsertCancelledRegistrations(
  items: Array<{ registration_id: string; cancelled_at: string }>,
  syncedAt: string
): Promise<void> {
  if (items.length === 0) {
    return;
  }
  const database = await getDatabase();
  for (const item of items) {
    await database.runAsync(
      `INSERT INTO cancelled_registrations (registration_id, cancelled_at, synced_at)
       VALUES (?, ?, ?)
       ON CONFLICT(registration_id) DO UPDATE SET
         cancelled_at=excluded.cancelled_at,
         synced_at=excluded.synced_at`,
      item.registration_id,
      item.cancelled_at,
      syncedAt
    );
  }
}

export async function upsertWorkshopsCache(workshops: Omit<CachedWorkshopRecord, "synced_at">[], syncedAt: string): Promise<void> {
  const database = await getDatabase();
  await database.execAsync("BEGIN");
  try {
    for (const workshop of workshops) {
      await database.runAsync(
        `INSERT INTO workshops_cache (workshop_id, title, starts_at, ends_at, location, status, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(workshop_id) DO UPDATE SET
           title=excluded.title,
           starts_at=excluded.starts_at,
           ends_at=excluded.ends_at,
           location=excluded.location,
           status=excluded.status,
           synced_at=excluded.synced_at`,
        workshop.workshop_id,
        workshop.title,
        workshop.starts_at,
        workshop.ends_at,
        workshop.location,
        workshop.status,
        syncedAt
      );
    }
    await database.execAsync("COMMIT");
  } catch (error) {
    await database.execAsync("ROLLBACK");
    throw error;
  }
}

export async function listWorkshopsCache(limit = 200): Promise<CachedWorkshopRecord[]> {
  const database = await getDatabase();
  return database.getAllAsync<CachedWorkshopRecord>(
    `SELECT workshop_id, title, starts_at, ends_at, location, status, synced_at
     FROM workshops_cache
     ORDER BY starts_at ASC
     LIMIT ?`,
    limit
  );
}

export async function getCachedWorkshop(workshopId: string): Promise<CachedWorkshopRecord | null> {
  const database = await getDatabase();
  const row = await database.getFirstAsync<CachedWorkshopRecord>(
    `SELECT workshop_id, title, starts_at, ends_at, location, status, synced_at
     FROM workshops_cache
     WHERE workshop_id = ?
     LIMIT 1`,
    workshopId
  );
  return row ?? null;
}

export async function upsertWorkshopRosterCache(
  workshopId: string,
  roster: Array<Omit<CachedRosterEntry, "workshop_id" | "synced_at">>,
  syncedAt: string
): Promise<void> {
  const database = await getDatabase();
  await database.execAsync("BEGIN");
  try {
    for (const entry of roster) {
      await database.runAsync(
        `INSERT INTO workshop_roster_cache (
          workshop_id, registration_id, student_user_id, student_name, student_id, registration_status, synced_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(workshop_id, registration_id) DO UPDATE SET
          student_user_id=excluded.student_user_id,
          student_name=excluded.student_name,
          student_id=excluded.student_id,
          registration_status=excluded.registration_status,
          synced_at=excluded.synced_at`,
        workshopId,
        entry.registration_id,
        entry.student_user_id,
        entry.student_name,
        entry.student_id,
        entry.registration_status,
        syncedAt
      );
    }
    await backfillCheckinStudentNamesFromRoster(database);
    await database.execAsync("COMMIT");
  } catch (error) {
    await database.execAsync("ROLLBACK");
    throw error;
  }
}

export async function backfillCheckinStudentNamesFromRoster(
  database?: SQLite.SQLiteDatabase,
): Promise<void> {
  const db = database ?? (await getDatabase());
  const updatedAt = new Date().toISOString();
  await db.runAsync(
    `UPDATE checkins
     SET student_name = (
           SELECT r.student_name
           FROM workshop_roster_cache r
           WHERE r.workshop_id = checkins.workshop_id
             AND r.registration_id = checkins.registration_id
           LIMIT 1
         ),
         student_id = COALESCE(
           (
             SELECT r.student_id
             FROM workshop_roster_cache r
             WHERE r.workshop_id = checkins.workshop_id
               AND r.registration_id = checkins.registration_id
             LIMIT 1
           ),
           student_id
         ),
         updated_at = ?
     WHERE student_name IS NULL
       AND workshop_id IS NOT NULL
       AND registration_id IS NOT NULL
       AND EXISTS (
         SELECT 1
         FROM workshop_roster_cache r
         WHERE r.workshop_id = checkins.workshop_id
           AND r.registration_id = checkins.registration_id
       )`,
    updatedAt,
  );
}

export async function getRosterEntry(workshopId: string, registrationId: string): Promise<CachedRosterEntry | null> {
  const database = await getDatabase();
  const row = await database.getFirstAsync<CachedRosterEntry>(
    `SELECT workshop_id, registration_id, student_user_id, student_name, student_id, registration_status, synced_at
     FROM workshop_roster_cache
     WHERE workshop_id = ? AND registration_id = ?
     LIMIT 1`,
    workshopId,
    registrationId
  );
  return row ?? null;
}

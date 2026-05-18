import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";
import { Redis } from "ioredis";

const { Client } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DEMO_ROOT = path.resolve(__dirname, "..");
export const RUNTIME_DIR = path.resolve(DEMO_ROOT, ".runtime");
export const CONTEXT_PATH = path.resolve(RUNTIME_DIR, "context.json");
export const BACKEND_ROOT = path.resolve(DEMO_ROOT, "..", "..");

dotenv.config({ path: path.resolve(BACKEND_ROOT, ".env") });

export const DEMO_CONFIG = {
  apiBase: process.env.DEMO_API_BASE_URL ?? process.env.TEST_API_BASE_URL ?? "http://127.0.0.1:3000",
  adminEmail: process.env.DEMO_ADMIN_EMAIL ?? process.env.TEST_ADMIN_EMAIL ?? "dungd@example.com",
  adminPassword: process.env.DEMO_ADMIN_PASSWORD ?? process.env.TEST_ADMIN_PASSWORD ?? "Password123!",
  studentPassword: process.env.DEMO_STUDENT_PASSWORD ?? process.env.TEST_STUDENT_PASSWORD ?? "Password123!",
  requestTimeoutMs: Number(process.env.DEMO_REQUEST_TIMEOUT_MS ?? 20_000),
  studentCount: Number(process.env.DEMO_STUDENT_COUNT ?? 50),
  cbStudentCount: Number(process.env.DEMO_CB_STUDENT_COUNT ?? process.env.DEMO_STUDENT_COUNT ?? 50),
  pgUrl: process.env.SUPABASE_POOLER_URL ?? "",
  redisUrl: process.env.REDIS_URL ?? "",
  breakerKeyPrefix: process.env.DEMO_BREAKER_KEY_PREFIX ?? "payment:circuit-breaker:momo"
};

function nowTag() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function appendLine(filePath, line) {
  fs.appendFileSync(filePath, `${line}\n`, "utf8");
}

export function createPartLogger(partDir, prefix = "result") {
  ensureDir(partDir);
  const filePath = path.resolve(partDir, `${prefix}-${nowTag()}.txt`);
  const log = (line) => {
    const rendered = `[${new Date().toISOString()}] ${line}`;
    console.log(rendered);
    appendLine(filePath, rendered);
  };
  const section = (title) => {
    log("");
    log(`========== ${title} ==========`);
  };
  return { filePath, log, section };
}

export function initRuntime() {
  ensureDir(RUNTIME_DIR);
}

export function saveContext(context) {
  initRuntime();
  fs.writeFileSync(CONTEXT_PATH, JSON.stringify(context, null, 2), "utf8");
}

export function loadContext() {
  if (!fs.existsSync(CONTEXT_PATH)) {
    throw new Error(`Missing context file: ${CONTEXT_PATH}. Run 00_setup first.`);
  }
  return JSON.parse(fs.readFileSync(CONTEXT_PATH, "utf8"));
}

export function mergeContext(patch) {
  const current = loadContext();
  const next = deepMerge(current, patch);
  saveContext(next);
  return next;
}

function deepMerge(base, patch) {
  if (Array.isArray(base) || Array.isArray(patch) || typeof base !== "object" || typeof patch !== "object" || !base || !patch) {
    return patch;
  }
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (k in out) {
      out[k] = deepMerge(out[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

export async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function api(pathname, init = {}, timeoutMs = DEMO_CONFIG.requestTimeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${DEMO_CONFIG.apiBase}${pathname}`, { ...init, signal: controller.signal });
    const body = await response.json().catch(() => ({}));
    return { status: response.status, body, headers: response.headers };
  } finally {
    clearTimeout(timeout);
  }
}

export async function waitForHealth(maxWaitMs = 30_000) {
  const started = Date.now();
  while (Date.now() - started < maxWaitMs) {
    try {
      const rs = await api("/health");
      if (rs.status === 200) {
        return;
      }
    } catch {
      // keep waiting
    }
    await sleep(500);
  }
  throw new Error(`Backend health check failed within ${maxWaitMs}ms at ${DEMO_CONFIG.apiBase}`);
}

export async function login(email, password) {
  const rs = await api("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  return rs;
}

export async function registerStudent(email, fullName, password) {
  const rs = await api("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, full_name: fullName, password })
  });
  return rs;
}

export async function ensureStudentToken(studentLabel, email, password) {
  const fullName = `Demo ${studentLabel}`;
  const registerRs = await registerStudent(email, fullName, password);
  if (registerRs.status === 201) {
    return registerRs.body.access_token;
  }
  if (registerRs.status === 409 && registerRs.body?.error?.code === "EMAIL_ALREADY_EXISTS") {
    const loginRs = await login(email, password);
    if (loginRs.status !== 200) {
      throw new Error(`Login failed for existing user ${email}: ${JSON.stringify(loginRs.body)}`);
    }
    return loginRs.body.access_token;
  }
  throw new Error(`Register failed for ${email}: status=${registerRs.status}, body=${JSON.stringify(registerRs.body)}`);
}

export async function createWorkshop(adminToken, payload) {
  const rs = await api("/admin/workshops", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  return rs;
}

export async function getWorkshopAdmin(adminToken, workshopId) {
  return api(`/admin/workshops/${workshopId}`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
}

export async function getWorkshopPublic(workshopId) {
  return api(`/workshops/${workshopId}`, { cache: "no-store" });
}

export async function requestAdmission(studentToken, workshopId) {
  return api(`/workshops/${workshopId}/admission`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${studentToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({})
  });
}

export async function getRegistrationGate(studentToken, workshopId) {
  return api(`/workshops/${workshopId}/registration-gate`, {
    headers: { Authorization: `Bearer ${studentToken}` }
  });
}

export async function createRegistration(studentToken, workshopId, idempotencyKey, admissionToken) {
  const headers = {
    Authorization: `Bearer ${studentToken}`,
    "Content-Type": "application/json",
    "Idempotency-Key": idempotencyKey
  };
  if (admissionToken) {
    headers["Admission-Token"] = admissionToken;
  }

  return api("/registrations", {
    method: "POST",
    headers,
    body: JSON.stringify({ workshop_id: workshopId })
  });
}

export async function acquireAdmissionToken({
  studentToken,
  workshopId,
  logger,
  maxAttempts = 25
}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const rs = await requestAdmission(studentToken, workshopId);
    const status = rs.body?.data?.status;

    if (rs.status === 200 && status === "admitted" && typeof rs.body?.data?.admission_token === "string") {
      return rs.body.data.admission_token;
    }
    if (rs.status === 200 && status === "full") {
      throw new Error("Workshop is full while waiting for admission token");
    }

    const retryAfter = Number(
      rs.body?.retry_after
        ?? rs.body?.data?.retry_after
        ?? 1
    );
    const safeRetryAfterMs = Math.max(1, Number.isFinite(retryAfter) ? retryAfter : 1) * 1000;
    logger?.log(`Admission attempt ${attempt} not admitted yet (status=${rs.status}, gate=${status ?? "n/a"}). Retry in ${safeRetryAfterMs}ms`);
    await sleep(safeRetryAfterMs);
  }

  throw new Error(`Failed to acquire admission token after ${maxAttempts} attempts`);
}

export async function queryOne(sql, params = []) {
  if (!DEMO_CONFIG.pgUrl) {
    throw new Error("SUPABASE_POOLER_URL is missing");
  }
  const client = new Client({ connectionString: DEMO_CONFIG.pgUrl });
  await client.connect();
  try {
    const rs = await client.query(sql, params);
    return rs.rows[0] ?? null;
  } finally {
    await client.end();
  }
}

export async function queryRows(sql, params = []) {
  if (!DEMO_CONFIG.pgUrl) {
    throw new Error("SUPABASE_POOLER_URL is missing");
  }
  const client = new Client({ connectionString: DEMO_CONFIG.pgUrl });
  await client.connect();
  try {
    const rs = await client.query(sql, params);
    return rs.rows;
  } finally {
    await client.end();
  }
}

export async function getWorkshopCounters(workshopId) {
  const row = await queryOne(
    `SELECT id, capacity, reserved_count, confirmed_count
     FROM workshops
     WHERE id=$1
     LIMIT 1`,
    [workshopId]
  );
  if (!row) {
    throw new Error(`Workshop not found in DB: ${workshopId}`);
  }
  return row;
}

export async function getRegistrationStatusCounts(workshopId) {
  return queryRows(
    `SELECT status, COUNT(*)::int AS count
     FROM registrations
     WHERE workshop_id=$1
     GROUP BY status
     ORDER BY status`,
    [workshopId]
  );
}

export async function countPaymentsByIdempotencyKey(key) {
  const row = await queryOne(
    "SELECT COUNT(*)::int AS count FROM payments WHERE idempotency_key=$1",
    [key]
  );
  return Number(row?.count ?? 0);
}

export async function getCircuitSnapshotFromRedis() {
  if (!DEMO_CONFIG.redisUrl) {
    return null;
  }

  const redis = new Redis(DEMO_CONFIG.redisUrl, { maxRetriesPerRequest: null });
  try {
    const stateKey = `${DEMO_CONFIG.breakerKeyPrefix}:state`;
    const failureKey = `${DEMO_CONFIG.breakerKeyPrefix}:failures`;
    const [stateRaw, openedAtRaw, openUntilRaw, probeRaw, failureRaw] = await Promise.all([
      redis.hget(stateKey, "state"),
      redis.hget(stateKey, "opened_at_ms"),
      redis.hget(stateKey, "open_until_ms"),
      redis.hget(stateKey, "probe_in_flight"),
      redis.get(failureKey)
    ]);

    return {
      state: stateRaw ?? "CLOSED",
      openedAtMs: openedAtRaw ? Number(openedAtRaw) : null,
      openUntilMs: openUntilRaw ? Number(openUntilRaw) : null,
      probeInFlight: probeRaw ? Number(probeRaw) : 0,
      failureCount: failureRaw ? Number(failureRaw) : 0
    };
  } finally {
    redis.disconnect();
  }
}

export function getPeakConfigSnapshot() {
  return {
    PEAK_CONTROL_ENABLED: process.env.PEAK_CONTROL_ENABLED ?? "(missing)",
    PEAK_CONTROL_WINDOW_START_UTC: process.env.PEAK_CONTROL_WINDOW_START_UTC ?? "(missing)",
    PEAK_CONTROL_WINDOW_END_UTC: process.env.PEAK_CONTROL_WINDOW_END_UTC ?? "(missing)",
    PEAK_CONTROL_USER_POLL_MIN_INTERVAL_SECONDS: process.env.PEAK_CONTROL_USER_POLL_MIN_INTERVAL_SECONDS ?? "(missing)",
    PEAK_CONTROL_USER_WRITE_MIN_INTERVAL_SECONDS: process.env.PEAK_CONTROL_USER_WRITE_MIN_INTERVAL_SECONDS ?? "(missing)",
    PEAK_CONTROL_GLOBAL_WRITE_LIMIT_PER_SECOND: process.env.PEAK_CONTROL_GLOBAL_WRITE_LIMIT_PER_SECOND ?? "(missing)",
    PEAK_CONTROL_QUEUE_BUFFER_SEATS: process.env.PEAK_CONTROL_QUEUE_BUFFER_SEATS ?? "(missing)",
    PEAK_CONTROL_QUEUE_RETRY_AFTER_SECONDS: process.env.PEAK_CONTROL_QUEUE_RETRY_AFTER_SECONDS ?? "(missing)"
  };
}

export function getBreakerConfigSnapshot() {
  return {
    PAYMENT_CIRCUIT_FAILURE_THRESHOLD: process.env.PAYMENT_CIRCUIT_FAILURE_THRESHOLD ?? "(missing)",
    PAYMENT_CIRCUIT_FAILURE_WINDOW_SECONDS: process.env.PAYMENT_CIRCUIT_FAILURE_WINDOW_SECONDS ?? "(missing)",
    PAYMENT_CIRCUIT_OPEN_DURATION_SECONDS: process.env.PAYMENT_CIRCUIT_OPEN_DURATION_SECONDS ?? "(missing)",
    PAYMENT_CIRCUIT_HALF_OPEN_PROBE_LIMIT: process.env.PAYMENT_CIRCUIT_HALF_OPEN_PROBE_LIMIT ?? "(missing)",
    PAYMENT_GATEWAY_MODE: process.env.PAYMENT_GATEWAY_MODE ?? "(missing)",
    MOMO_ENDPOINT: process.env.MOMO_ENDPOINT ?? "(missing)",
    MOMO_CREATE_ORDER_TIMEOUT_MS: process.env.MOMO_CREATE_ORDER_TIMEOUT_MS ?? "(missing)"
  };
}

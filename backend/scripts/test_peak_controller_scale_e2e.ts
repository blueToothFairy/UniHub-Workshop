import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, "..");
dotenv.config({ path: path.resolve(backendRoot, ".env") });

const API_BASE = process.env.TEST_API_BASE_URL ?? "http://127.0.0.1:3100";
const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL ?? "dungd@example.com";
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD ?? "Password123!";
const STUDENT_PASSWORD = process.env.TEST_STUDENT_PASSWORD ?? "Password123!";
const REQUEST_TIMEOUT_MS = Number(process.env.TEST_PEAK_REQUEST_TIMEOUT_MS ?? 20000);

const WORKSHOP_COUNT = Number(process.env.TEST_PEAK_WORKSHOP_COUNT ?? 5);
const WORKSHOP_CAPACITY = Number(process.env.TEST_PEAK_WORKSHOP_CAPACITY ?? 50);
const STUDENT_COUNT = Number(process.env.TEST_PEAK_STUDENT_COUNT ?? 12000);
const MIN_WORKSHOPS_PER_STUDENT = Number(process.env.TEST_PEAK_MIN_WORKSHOPS_PER_STUDENT ?? 1);
const MAX_WORKSHOPS_PER_STUDENT = Number(process.env.TEST_PEAK_MAX_WORKSHOPS_PER_STUDENT ?? 5);
const CREATE_STUDENT_CONCURRENCY = Number(process.env.TEST_PEAK_CREATE_STUDENT_CONCURRENCY ?? 30);
const FLOW_CONCURRENCY = Number(process.env.TEST_PEAK_FLOW_CONCURRENCY ?? 120);
const RANDOM_SEED = Number(process.env.TEST_PEAK_RANDOM_SEED ?? Date.now());

interface ApiResult {
  status: number;
  body: any;
}

interface Student {
  email: string;
  token: string;
  workshopIds: string[];
}

interface Counters {
  admissionAdmitted: number;
  admissionWaiting: number;
  admissionFull: number;
  admissionRateLimited: number;
  admissionOtherErrors: number;
  registrationSuccess: number;
  registrationFull: number;
  registrationBusy: number;
  registrationRateLimited: number;
  registrationTokenRequired: number;
  registrationTokenInvalid: number;
  registrationOtherErrors: number;
}

function makeCounters(): Counters {
  return {
    admissionAdmitted: 0,
    admissionWaiting: 0,
    admissionFull: 0,
    admissionRateLimited: 0,
    admissionOtherErrors: 0,
    registrationSuccess: 0,
    registrationFull: 0,
    registrationBusy: 0,
    registrationRateLimited: 0,
    registrationTokenRequired: 0,
    registrationTokenInvalid: 0,
    registrationOtherErrors: 0
  };
}

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function randomInt(rand: () => number, min: number, max: number): number {
  return Math.floor(rand() * (max - min + 1)) + min;
}

function pickUnique<T>(items: T[], count: number, rand: () => number): T[] {
  const indices = items.map((_, idx) => idx);
  for (let i = indices.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = indices[i];
    indices[i] = indices[j];
    indices[j] = tmp;
  }
  return indices.slice(0, count).map((idx) => items[idx]);
}

async function api(pathname: string, init: RequestInit = {}): Promise<ApiResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${API_BASE}${pathname}`, { ...init, signal: controller.signal });
    const body = await response.json().catch(() => ({}));
    return { status: response.status, body };
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForHealth(timeoutMs = 30_000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const health = await api("/health");
      if (health.status === 200) {
        return;
      }
    } catch {
      // backend may still be starting
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Backend did not become healthy within ${timeoutMs}ms at ${API_BASE}`);
}

async function login(email: string, password: string): Promise<{ accessToken: string; role: string }> {
  const result = await api("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  assert.equal(result.status, 200, `Login failed for ${email}: ${JSON.stringify(result.body)}`);
  return { accessToken: result.body.access_token as string, role: result.body.user?.role as string };
}

async function registerStudent(email: string, fullName: string, password: string): Promise<string> {
  const result = await api("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, full_name: fullName, password })
  });
  assert.equal(result.status, 201, `Register failed for ${email}: ${JSON.stringify(result.body)}`);
  return result.body.access_token as string;
}

async function createWorkshop(adminToken: string, index: number, seed: number): Promise<string> {
  const now = Date.now();
  const offsetDays = 5 + index;
  const startsAt = new Date(now + (offsetDays * 24 * 60 * 60 * 1000)).toISOString();
  const endsAt = new Date(now + (offsetDays * 24 * 60 * 60 * 1000) + (2 * 60 * 60 * 1000)).toISOString();

  const payload = {
    title: `Peak Scale ${seed}-${index}`,
    description: "Peak controller scale e2e workshop",
    speakerName: `Peak Scale Speaker ${seed}-${index}`,
    room: `PEAK-SCALE-${seed}-${index}`,
    startsAt,
    endsAt,
    capacity: WORKSHOP_CAPACITY,
    priceVnd: 0,
    status: "published"
  };
  const result = await api("/admin/workshops", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  assert.equal(result.status, 201, `Create workshop ${index} failed: ${JSON.stringify(result.body)}`);
  return result.body.data.id as string;
}

async function requestAdmission(studentToken: string, workshopId: string): Promise<ApiResult> {
  return api(`/workshops/${workshopId}/admission`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${studentToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({})
  });
}

async function createRegistration(studentToken: string, workshopId: string, idempotencyKey: string, admissionToken: string): Promise<ApiResult> {
  return api("/registrations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${studentToken}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
      "Admission-Token": admissionToken
    },
    body: JSON.stringify({ workshop_id: workshopId })
  });
}

async function getWorkshopDetail(adminToken: string, workshopId: string): Promise<any> {
  const result = await api(`/admin/workshops/${workshopId}`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert.equal(result.status, 200, `Get workshop detail failed for ${workshopId}: ${JSON.stringify(result.body)}`);
  return result.body.data;
}

async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function runOne(): Promise<void> {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) {
        return;
      }
      results[index] = await worker(items[index], index);
    }
  }

  const workers = Array.from({ length: Math.max(1, concurrency) }, () => runOne());
  await Promise.all(workers);
  return results;
}

async function main(): Promise<void> {
  assert.ok(WORKSHOP_COUNT > 0, "TEST_PEAK_WORKSHOP_COUNT must be > 0");
  assert.ok(WORKSHOP_CAPACITY > 0, "TEST_PEAK_WORKSHOP_CAPACITY must be > 0");
  assert.ok(STUDENT_COUNT > 0, "TEST_PEAK_STUDENT_COUNT must be > 0");
  assert.ok(MIN_WORKSHOPS_PER_STUDENT >= 1, "TEST_PEAK_MIN_WORKSHOPS_PER_STUDENT must be >= 1");
  assert.ok(MAX_WORKSHOPS_PER_STUDENT >= MIN_WORKSHOPS_PER_STUDENT, "TEST_PEAK_MAX_WORKSHOPS_PER_STUDENT must be >= min");
  assert.ok(MAX_WORKSHOPS_PER_STUDENT <= WORKSHOP_COUNT, "max workshops per student cannot exceed workshop count");

  await waitForHealth();

  const startedAt = Date.now();
  const counters = makeCounters();
  const seed = RANDOM_SEED;
  const rand = mulberry32(seed);

  const adminLogin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
  assert.equal(adminLogin.role, "organizer", "Admin account must have organizer role");
  const adminToken = adminLogin.accessToken;

  const workshopIds = await mapConcurrent(
    Array.from({ length: WORKSHOP_COUNT }, (_, i) => i),
    3,
    async (index) => createWorkshop(adminToken, index, seed)
  );

  const students = await mapConcurrent(
    Array.from({ length: STUDENT_COUNT }, (_, i) => i),
    CREATE_STUDENT_CONCURRENCY,
    async (studentIndex) => {
      const email = `peak.scale.${seed}.${studentIndex}@example.com`;
      const token = await registerStudent(email, `Peak Scale Student ${studentIndex}`, STUDENT_PASSWORD);
      const desiredCount = randomInt(rand, MIN_WORKSHOPS_PER_STUDENT, MAX_WORKSHOPS_PER_STUDENT);
      const assigned = pickUnique(workshopIds, desiredCount, rand);
      return { email, token, workshopIds: assigned } as Student;
    }
  );

  await mapConcurrent(
    students,
    FLOW_CONCURRENCY,
    async (student, studentIndex) => {
      for (const workshopId of student.workshopIds) {
        const admission = await requestAdmission(student.token, workshopId);
        const admissionStatus = admission.body?.data?.status;
        if (admission.status === 200 && admissionStatus === "admitted") {
          counters.admissionAdmitted += 1;
          const admissionToken = admission.body?.data?.admission_token as string;
          if (!admissionToken) {
            counters.registrationOtherErrors += 1;
            continue;
          }

          const registration = await createRegistration(
            student.token,
            workshopId,
            `peak-scale-${seed}-${studentIndex}-${workshopId}`,
            admissionToken
          );

          if (registration.status === 201) {
            counters.registrationSuccess += 1;
            continue;
          }
          if (registration.status === 409 && registration.body?.error?.code === "WORKSHOP_FULL") {
            counters.registrationFull += 1;
            continue;
          }
          if (registration.status === 503 && registration.body?.error === "REGISTRATION_BUSY") {
            counters.registrationBusy += 1;
            continue;
          }
          if (registration.status === 429 && registration.body?.error?.code === "RATE_LIMITED") {
            counters.registrationRateLimited += 1;
            continue;
          }
          if (registration.status === 403 && registration.body?.error?.code === "ADMISSION_TOKEN_REQUIRED") {
            counters.registrationTokenRequired += 1;
            continue;
          }
          if (registration.status === 403 && registration.body?.error?.code === "ADMISSION_TOKEN_INVALID") {
            counters.registrationTokenInvalid += 1;
            continue;
          }
          counters.registrationOtherErrors += 1;
          continue;
        }

        if (admission.status === 200 && admissionStatus === "waiting") {
          counters.admissionWaiting += 1;
          continue;
        }
        if (admission.status === 200 && admissionStatus === "full") {
          counters.admissionFull += 1;
          continue;
        }
        if (admission.status === 429 && admission.body?.error?.code === "RATE_LIMITED") {
          counters.admissionRateLimited += 1;
          continue;
        }
        counters.admissionOtherErrors += 1;
      }
    }
  );

  const workshopDetails = await mapConcurrent(
    workshopIds,
    3,
    async (workshopId) => getWorkshopDetail(adminToken, workshopId)
  );

  for (const detail of workshopDetails) {
    assert.equal(detail.capacity, WORKSHOP_CAPACITY, `Unexpected capacity for workshop ${detail.id}`);
    assert.ok(detail.reservedCount <= detail.capacity, `reservedCount exceeded capacity for workshop ${detail.id}`);
    assert.ok(detail.confirmedCount <= detail.reservedCount, `confirmedCount exceeded reservedCount for workshop ${detail.id}`);
  }

  const unexpectedErrors = counters.admissionOtherErrors + counters.registrationOtherErrors;
  assert.equal(unexpectedErrors, 0, `Unexpected errors found during scale run: ${JSON.stringify(counters, null, 2)}`);

  const durationMs = Date.now() - startedAt;
  const totalAssignments = students.reduce((sum, student) => sum + student.workshopIds.length, 0);

  console.log("Peak-controller scale E2E validation succeeded.");
  console.log(JSON.stringify({
    apiBase: API_BASE,
    scenario: {
      workshops: WORKSHOP_COUNT,
      workshopCapacity: WORKSHOP_CAPACITY,
      students: STUDENT_COUNT,
      minWorkshopsPerStudent: MIN_WORKSHOPS_PER_STUDENT,
      maxWorkshopsPerStudent: MAX_WORKSHOPS_PER_STUDENT,
      totalAssignments
    },
    execution: {
      durationMs,
      randomSeed: seed,
      createStudentConcurrency: CREATE_STUDENT_CONCURRENCY,
      flowConcurrency: FLOW_CONCURRENCY
    },
    counters,
    workshops: workshopDetails.map((detail: any) => ({
      id: detail.id,
      capacity: detail.capacity,
      reservedCount: detail.reservedCount,
      confirmedCount: detail.confirmedCount,
      availableSeats: detail.availableSeats
    }))
  }, null, 2));
}

main().catch((error) => {
  console.error("Peak-controller scale E2E validation failed:", error);
  process.exit(1);
});

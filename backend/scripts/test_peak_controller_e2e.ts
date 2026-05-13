import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
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
const START_LOCAL_BACKEND = (process.env.TEST_PEAK_START_LOCAL_BACKEND ?? "false").toLowerCase() === "true";
const REQUEST_TIMEOUT_MS = Number(process.env.TEST_PEAK_REQUEST_TIMEOUT_MS ?? 15000);

interface ApiResult {
  status: number;
  body: any;
}

function npmCommand(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm";
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
      // ignore while waiting for boot
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Backend did not become healthy within ${timeoutMs}ms at ${API_BASE}`);
}

function startBackendIfNeeded(): ChildProcessWithoutNullStreams | null {
  if (!START_LOCAL_BACKEND) {
    return null;
  }
  const port = new URL(API_BASE).port || "3100";
  const child = spawn(
    npmCommand(),
    ["exec", "tsx", "src/app.ts"],
    {
      cwd: backendRoot,
      env: {
        ...process.env,
        PORT: port,
        PEAK_CONTROL_ENABLED: "true",
        PEAK_CONTROL_WORKSHOP_IDS: "",
        PEAK_CONTROL_WINDOW_START_UTC: "00:00",
        PEAK_CONTROL_WINDOW_END_UTC: "23:59",
        PEAK_CONTROL_QUEUE_BUFFER_SEATS: "0"
      },
      stdio: "pipe"
    }
  );

  child.stdout.on("data", (chunk) => process.stdout.write(`[backend] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[backend] ${chunk}`));
  return child;
}

function stopBackend(child: ChildProcessWithoutNullStreams | null): Promise<void> {
  if (!child) {
    return Promise.resolve();
  }
  if (child.killed) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    child.once("exit", () => resolve());
    child.kill("SIGTERM");
    setTimeout(() => {
      if (!child.killed) {
        child.kill("SIGKILL");
      }
    }, 3000);
  });
}

async function login(email: string, password: string): Promise<{ accessToken: string; role: string }> {
  const result = await api("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  assert.equal(result.status, 200, `Login failed for ${email}: ${JSON.stringify(result.body)}`);
  return { accessToken: result.body.access_token, role: result.body.user?.role };
}

async function registerStudent(email: string, fullName: string, password: string): Promise<string> {
  const result = await api("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, full_name: fullName, password })
  });
  assert.equal(result.status, 201, `Student register failed: ${JSON.stringify(result.body)}`);
  return result.body.access_token as string;
}

async function createWorkshop(adminToken: string): Promise<string> {
  const now = Date.now();
  const startsAt = new Date(now + (5 * 24 * 60 * 60 * 1000)).toISOString();
  const endsAt = new Date(now + (5 * 24 * 60 * 60 * 1000) + (2 * 60 * 60 * 1000)).toISOString();

  const payload = {
    title: `Peak E2E ${now}`,
    description: "Peak controller e2e validation workshop",
    speakerName: `Peak Speaker ${now}`,
    room: `PEAK-${now}`,
    startsAt,
    endsAt,
    capacity: 1,
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
  assert.equal(result.status, 201, `Create workshop failed: ${JSON.stringify(result.body)}`);
  return result.body.data.id as string;
}

async function getGate(studentToken: string, workshopId: string): Promise<any> {
  const result = await api(`/workshops/${workshopId}/registration-gate`, {
    headers: { Authorization: `Bearer ${studentToken}` }
  });
  assert.equal(result.status, 200, `Get gate failed: ${JSON.stringify(result.body)}`);
  return result.body.data;
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

async function createRegistration(studentToken: string, workshopId: string, idempotencyKey: string, admissionToken?: string): Promise<ApiResult> {
  const headers: Record<string, string> = {
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

async function getWorkshopDetail(adminToken: string, workshopId: string): Promise<any> {
  const result = await api(`/admin/workshops/${workshopId}`, {
    headers: { Authorization: `Bearer ${adminToken}` }
  });
  assert.equal(result.status, 200, `Admin workshop detail failed: ${JSON.stringify(result.body)}`);
  return result.body.data;
}

async function main(): Promise<void> {
  const backend = startBackendIfNeeded();
  try {
    await waitForHealth();

    const adminLogin = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
    assert.equal(adminLogin.role, "organizer", "Admin account must have organizer role");
    const adminToken = adminLogin.accessToken;

    const workshopId = await createWorkshop(adminToken);
    const seed = Date.now();
    const students: Array<{ email: string; token: string }> = [];
    const studentCount = Number(process.env.TEST_PEAK_STUDENT_COUNT ?? 25);
    for (let i = 0; i < studentCount; i += 1) {
      const email = `peak.e2e.student.${seed}.${i}@example.com`;
      const token = await registerStudent(email, `Peak Student ${i}`, STUDENT_PASSWORD);
      students.push({ email, token });
    }

    const initialGate = await getGate(students[0].token, workshopId);
    assert.ok(["open", "disabled"].includes(initialGate.status), `Unexpected initial gate status: ${JSON.stringify(initialGate)}`);
    assert.notEqual(initialGate.status, "disabled", "Peak control is disabled; enable PEAK_CONTROL_ENABLED for this e2e test");

    const missingTokenRegistration = await createRegistration(students[0].token, workshopId, `peak-e2e-missing-${seed}`);
    assert.equal(missingTokenRegistration.status, 403, `Expected 403 missing token: ${JSON.stringify(missingTokenRegistration.body)}`);
    assert.equal(missingTokenRegistration.body?.error?.code, "ADMISSION_TOKEN_REQUIRED");

    const admitted: Array<{ email: string; token: string; admissionToken: string }> = [];
    const waiting: Array<{ email: string; token: string; queuePosition: number }> = [];
    for (const student of students) {
      const admission = await requestAdmission(student.token, workshopId);
      assert.equal(admission.status, 200, `Admission failed for ${student.email}: ${JSON.stringify(admission.body)}`);
      const status = admission.body?.data?.status;
      if (status === "admitted") {
        admitted.push({
          email: student.email,
          token: student.token,
          admissionToken: admission.body?.data?.admission_token as string
        });
      } else if (status === "waiting") {
        waiting.push({
          email: student.email,
          token: student.token,
          queuePosition: admission.body?.data?.queue_position as number
        });
      }
    }

    assert.ok(admitted.length > 0, "Expected at least one admitted user");
    assert.ok(waiting.length > 0, `Expected at least one waiting user. Increase TEST_PEAK_STUDENT_COUNT (current: ${studentCount}).`);
    assert.ok(admitted.every((entry) => typeof entry.admissionToken === "string" && entry.admissionToken.length > 0), "Admitted users missing tokens");

    const waitingStudent = waiting[0];
    const waitingRateLimited = await requestAdmission(waitingStudent.token, workshopId);
    assert.equal(waitingRateLimited.status, 429, `Expected 429 on rapid waiting poll: ${JSON.stringify(waitingRateLimited.body)}`);
    assert.equal(waitingRateLimited.body?.error?.code, "RATE_LIMITED");
    assert.equal(typeof waitingRateLimited.body?.retry_after, "number");

    const waitingNoTokenRegistration = await createRegistration(waitingStudent.token, workshopId, `peak-e2e-waiting-${seed}`);
    assert.equal(waitingNoTokenRegistration.status, 403, `Expected 403 for waiting student registration: ${JSON.stringify(waitingNoTokenRegistration.body)}`);
    assert.equal(waitingNoTokenRegistration.body?.error?.code, "ADMISSION_TOKEN_REQUIRED");

    const admittedStudent = admitted[0];
    const admittedNoTokenRegistration = await createRegistration(admittedStudent.token, workshopId, `peak-e2e-admitted-missing-${seed}`);
    assert.equal(admittedNoTokenRegistration.status, 403, `Expected 403 for admitted student without token: ${JSON.stringify(admittedNoTokenRegistration.body)}`);
    assert.equal(admittedNoTokenRegistration.body?.error?.code, "ADMISSION_TOKEN_REQUIRED");

    const student1Registration = await createRegistration(
      admittedStudent.token,
      workshopId,
      `peak-e2e-ok-${seed}`,
      admittedStudent.admissionToken
    );
    assert.equal(student1Registration.status, 201, `Student1 registration failed: ${JSON.stringify(student1Registration.body)}`);
    assert.equal(student1Registration.body?.data?.registration_status, "confirmed");
    assert.equal(student1Registration.body?.data?.payment_required, false);

    await new Promise((resolve) => setTimeout(resolve, 3200));
    const reusedTokenRegistration = await createRegistration(
      admittedStudent.token,
      workshopId,
      `peak-e2e-reuse-${seed}`,
      admittedStudent.admissionToken
    );
    assert.equal(reusedTokenRegistration.status, 403, `Expected 403 for reused token: ${JSON.stringify(reusedTokenRegistration.body)}`);
    assert.equal(reusedTokenRegistration.body?.error?.code, "ADMISSION_TOKEN_INVALID");

    const student2GateAfterFull = await getGate(waitingStudent.token, workshopId);
    assert.equal(student2GateAfterFull.status, "full", `Expected full gate after seat consumed: ${JSON.stringify(student2GateAfterFull)}`);

    await new Promise((resolve) => setTimeout(resolve, 1200));
    const student2AdmissionAfterFull = await requestAdmission(waitingStudent.token, workshopId);
    assert.equal(student2AdmissionAfterFull.status, 200);
    assert.equal(student2AdmissionAfterFull.body?.data?.status, "full");

    const workshopDetail = await getWorkshopDetail(adminToken, workshopId);
    assert.equal(workshopDetail.capacity, 1);
    assert.equal(workshopDetail.reservedCount, 1);
    assert.equal(workshopDetail.confirmedCount, 1);
    assert.ok(workshopDetail.reservedCount <= workshopDetail.capacity, "reservedCount exceeded capacity");

    console.log("Peak-controller E2E validation succeeded.");
    console.log(JSON.stringify({
      apiBase: API_BASE,
      workshopId,
      adminEmail: ADMIN_EMAIL,
      admittedStudentEmail: admittedStudent.email,
      waitingStudentEmail: waitingStudent.email,
      admittedCount: admitted.length,
      waitingCount: waiting.length,
      assertions: {
        missingTokenRejected: true,
        waitingStateObserved: true,
        rateLimitObserved: true,
        successfulAdmissionRegistration: true,
        tokenReuseRejected: true,
        fullStateObserved: true,
        capacityInvariantPreserved: true
      }
    }, null, 2));
  } finally {
    await stopBackend(backend);
  }
}

main().catch((error) => {
  console.error("Peak-controller E2E validation failed:", error);
  process.exit(1);
});

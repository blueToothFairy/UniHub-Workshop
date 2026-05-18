import path from "node:path";
import { spawn } from "node:child_process";
import {
  DEMO_ROOT,
  DEMO_CONFIG,
  BACKEND_ROOT,
  createPartLogger,
  loadContext,
  mergeContext,
  login,
  ensureStudentToken,
  createWorkshop,
  acquireAdmissionToken,
  createRegistration,
  getWorkshopPublic,
  countPaymentsByIdempotencyKey,
  getCircuitSnapshotFromRedis,
  sleep
} from "../_shared/demo-lib.mjs";

const MOCK_MOMO_PORT = Number(process.env.DEMO_PART4_MOCK_MOMO_PORT ?? 19090);
const PART4_BACKEND_PORT = Number(process.env.DEMO_PART4_BACKEND_PORT ?? 3300);

function spawnProcess(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd ?? BACKEND_ROOT,
    env: options.env ?? process.env,
    stdio: options.stdio ?? "pipe",
    windowsHide: true
  });
  return child;
}

async function waitForUrl(url, timeoutMs = 30_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const rs = await fetch(url, { cache: "no-store" });
      if (rs.status >= 200 && rs.status < 500) {
        return;
      }
    } catch {
      // retry
    }
    await sleep(300);
  }
  throw new Error(`Timeout waiting for ${url}`);
}

async function setMockMode(mode) {
  const rs = await fetch(`http://127.0.0.1:${MOCK_MOMO_PORT}/__mode`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode })
  });
  if (rs.status !== 200) {
    const body = await rs.text();
    throw new Error(`Failed to set mock mode=${mode}: status=${rs.status}, body=${body}`);
  }
}

async function stopChild(child, name, logger) {
  if (!child || child.killed) return;
  await new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    child.once("exit", finish);
    child.kill("SIGTERM");
    setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
      finish();
    }, 4000);
  });
  logger.log(`${name} stopped.`);
}

async function run() {
  const partDir = path.resolve(DEMO_ROOT, "04_circuit_breaker");
  const logger = createPartLogger(partDir);
  const context = loadContext();

  logger.section("Part 4 - Circuit Breaker + Graceful Degradation (Mock MoMo)");
  logger.log("Part 4 will start a dedicated backend instance and a local MoMo mock server.");

  const mockServerPath = path.resolve(partDir, "mock-momo-server.mjs");
  const mockEnv = {
    ...process.env,
    MOCK_MOMO_PORT: String(MOCK_MOMO_PORT),
    MOCK_MOMO_MODE: "error"
  };
  const mockChild = spawnProcess(process.execPath, [mockServerPath], { env: mockEnv, stdio: "pipe" });
  mockChild.stdout?.on("data", (chunk) => logger.log(`[mock-momo] ${String(chunk).trim()}`));
  mockChild.stderr?.on("data", (chunk) => logger.log(`[mock-momo:err] ${String(chunk).trim()}`));

  let backendChild;
  const previousApiBase = DEMO_CONFIG.apiBase;
  try {
    await waitForUrl(`http://127.0.0.1:${MOCK_MOMO_PORT}/__health`, 20_000);
    logger.log(`Mock MoMo is healthy on port ${MOCK_MOMO_PORT}`);

    const part4ApiBase = `http://127.0.0.1:${PART4_BACKEND_PORT}`;
    const backendEnv = {
      ...process.env,
      PORT: String(PART4_BACKEND_PORT),
      START_WORKERS: "false",
      USE_REDIS: "true",
      PAYMENT_GATEWAY_MODE: "momo_sandbox",
      MOMO_ENDPOINT: `http://127.0.0.1:${MOCK_MOMO_PORT}`,
      MOMO_CREATE_ORDER_TIMEOUT_MS: "1500",
      PAYMENT_CIRCUIT_FAILURE_THRESHOLD: "3",
      PAYMENT_CIRCUIT_FAILURE_WINDOW_SECONDS: "30",
      PAYMENT_CIRCUIT_OPEN_DURATION_SECONDS: "20",
      PAYMENT_CIRCUIT_HALF_OPEN_PROBE_LIMIT: "1"
    };

    backendChild = spawnProcess(process.execPath, ["--import", "tsx", "src/app.ts"], { env: backendEnv, stdio: "pipe" });
    backendChild.stdout?.on("data", (chunk) => logger.log(`[part4-backend] ${String(chunk).trim()}`));
    backendChild.stderr?.on("data", (chunk) => logger.log(`[part4-backend:err] ${String(chunk).trim()}`));

    await waitForUrl(`${part4ApiBase}/health`, 30_000);
    DEMO_CONFIG.apiBase = part4ApiBase;
    logger.log(`Part 4 backend is healthy at ${part4ApiBase}`);

    const adminLogin = await login(DEMO_CONFIG.adminEmail, DEMO_CONFIG.adminPassword);
    if (adminLogin.status !== 200) {
      throw new Error(`Admin login failed on part4 backend: ${JSON.stringify(adminLogin.body)}`);
    }
    const adminToken = adminLogin.body.access_token;

    const runId = Date.now();
    const faultWorkshopPayload = {
      title: `CB Fault Workshop ${runId}`,
      description: "Paid workshop used to trigger payment gateway failures",
      speakerName: `CB Speaker ${runId}`,
      room: `CB-FAULT-${runId}`,
      startsAt: new Date(Date.now() + (8 * 24 * 60 * 60 * 1000)).toISOString(),
      endsAt: new Date(Date.now() + (8 * 24 * 60 * 60 * 1000) + (2 * 60 * 60 * 1000)).toISOString(),
      capacity: 200,
      priceVnd: 100000,
      status: "published"
    };
    const freeWorkshopPayload = {
      title: `CB Free Workshop ${runId}`,
      description: "Free workshop for graceful degradation validation",
      speakerName: `CB Free Speaker ${runId}`,
      room: `CB-FREE-${runId}`,
      startsAt: new Date(Date.now() + (9 * 24 * 60 * 60 * 1000)).toISOString(),
      endsAt: new Date(Date.now() + (9 * 24 * 60 * 60 * 1000) + (2 * 60 * 60 * 1000)).toISOString(),
      capacity: 20,
      priceVnd: 0,
      status: "published"
    };

    const faultWorkshopRs = await createWorkshop(adminToken, faultWorkshopPayload);
    if (faultWorkshopRs.status !== 201) {
      throw new Error(`Failed to create fault workshop: ${JSON.stringify(faultWorkshopRs.body)}`);
    }
    const freeWorkshopRs = await createWorkshop(adminToken, freeWorkshopPayload);
    if (freeWorkshopRs.status !== 201) {
      throw new Error(`Failed to create free workshop for part4: ${JSON.stringify(freeWorkshopRs.body)}`);
    }
    const faultWorkshopId = faultWorkshopRs.body.data.id;
    const freeWorkshopId = freeWorkshopRs.body.data.id;
    logger.log(`Fault workshop created: ${faultWorkshopId}`);
    logger.log(`Part4 free workshop created: ${freeWorkshopId}`);

    logger.section("Prepare Students for Breaker Test");
    logger.log(`Breaker student count target: ${DEMO_CONFIG.cbStudentCount}`);
    const breakerStudents = [];
    for (let i = 1; i <= DEMO_CONFIG.cbStudentCount; i += 1) {
      const label = `cb_student_${String(i).padStart(2, "0")}`;
      const email = `${label}.${runId}@example.com`;
      const token = await ensureStudentToken(label, email, DEMO_CONFIG.studentPassword);
      breakerStudents.push({ label, email, token });
      logger.log(`${label} ready`);
    }

    logger.section("Step 6-7 - Trigger Failures Until Breaker Opens");
    await setMockMode("error");
    const attempts = [];
    let first503 = null;
    for (let i = 0; i < breakerStudents.length; i += 1) {
      const student = breakerStudents[i];
      const admissionToken = await acquireAdmissionToken({
        studentToken: student.token,
        workshopId: faultWorkshopId,
        logger
      });
      const idem = `cb-real-${runId}-${student.label}`;
      const rs = await createRegistration(student.token, faultWorkshopId, idem, admissionToken);
      const outcome = {
        student: student.label,
        idempotencyKey: idem,
        status: rs.status,
        body: rs.body
      };
      attempts.push(outcome);
      const marker = rs.body?.error ?? rs.body?.error?.code ?? rs.body?.data?.payment_status ?? "unknown";
      logger.log(`${student.label} -> status=${rs.status}, marker=${JSON.stringify(marker)}`);

      if (rs.status === 503 && rs.body?.error === "PAYMENT_GATEWAY_UNAVAILABLE") {
        first503 = outcome;
        break;
      }
    }

    if (!first503) {
      throw new Error("PAYMENT_GATEWAY_UNAVAILABLE not observed on mocked failure flow.");
    }

    const retryAfter = Number(first503.body?.retry_after ?? 1);
    const noRowFor503Key = await countPaymentsByIdempotencyKey(first503.idempotencyKey);
    logger.log(`First 503 idempotency_key=${first503.idempotencyKey}, payments rows=${noRowFor503Key}`);

    logger.section("Step 8 - Graceful Degradation Checks");
    const workshopRead = await getWorkshopPublic(faultWorkshopId);
    logger.log(`GET /workshops/${faultWorkshopId} -> ${workshopRead.status}`);

    const freeStudent = breakerStudents[0];
    const freeAdmissionToken = await acquireAdmissionToken({
      studentToken: freeStudent.token,
      workshopId: freeWorkshopId,
      logger
    });
    const freeRs = await createRegistration(
      freeStudent.token,
      freeWorkshopId,
      `cb-free-${runId}-${freeStudent.label}`,
      freeAdmissionToken
    );
    logger.log(`Free workshop registration during breaker-open window -> status=${freeRs.status}, body=${JSON.stringify(freeRs.body)}`);

    logger.section("Step 9 - Half-Open Recovery");
    const snapshotBeforeWait = await getCircuitSnapshotFromRedis();
    logger.log(`Redis breaker snapshot before wait: ${JSON.stringify(snapshotBeforeWait)}`);

    await setMockMode("success");
    const waitSeconds = Math.max(1, Number.isFinite(retryAfter) ? retryAfter : 1) + 1;
    logger.log(`Mock mode switched to success. Waiting ${waitSeconds}s for cooldown...`);
    await sleep(waitSeconds * 1000);

    const probeStudent = breakerStudents[breakerStudents.length - 1];
    const probeToken = await acquireAdmissionToken({
      studentToken: probeStudent.token,
      workshopId: faultWorkshopId,
      logger
    });
    const probeRs = await createRegistration(
      probeStudent.token,
      faultWorkshopId,
      `cb-probe-${runId}-${probeStudent.label}`,
      probeToken
    );
    logger.log(`Probe request -> status=${probeRs.status}, body=${JSON.stringify(probeRs.body)}`);

    const snapshotAfterProbe = await getCircuitSnapshotFromRedis();
    logger.log(`Redis breaker snapshot after probe: ${JSON.stringify(snapshotAfterProbe)}`);

    mergeContext({
      part4: {
        apiBase: DEMO_CONFIG.apiBase,
        mockMomoPort: MOCK_MOMO_PORT,
        part4BackendPort: PART4_BACKEND_PORT,
        faultWorkshopId,
        freeWorkshopId,
        attempts,
        first503,
        noRowFor503Key,
        workshopReadStatus: workshopRead.status,
        freeRegistration: {
          status: freeRs.status,
          body: freeRs.body
        },
        retryAfterSeconds: retryAfter,
        snapshotBeforeWait,
        probeResponse: {
          status: probeRs.status,
          body: probeRs.body
        },
        snapshotAfterProbe
      }
    });

    logger.section("Part 4 Completed");
    logger.log(`Log file: ${logger.filePath}`);
  } finally {
    DEMO_CONFIG.apiBase = previousApiBase;
    await stopChild(backendChild, "Part4 backend", logger);
    await stopChild(mockChild, "Mock MoMo", logger);
  }
}

run().catch((error) => {
  console.error("Part 4 failed:", error);
  process.exit(1);
});


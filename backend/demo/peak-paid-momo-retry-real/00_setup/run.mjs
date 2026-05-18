import path from "node:path";
import {
  DEMO_ROOT,
  DEMO_CONFIG,
  createPartLogger,
  initRuntime,
  saveContext,
  waitForHealth,
  login,
  ensureStudentToken,
  createWorkshop,
  getRegistrationGate,
  getPeakConfigSnapshot,
  getBreakerConfigSnapshot
} from "../_shared/demo-lib.mjs";

async function run() {
  const partDir = path.resolve(DEMO_ROOT, "00_setup");
  const logger = createPartLogger(partDir);

  logger.section("Demo Setup");
  if (!Number.isFinite(DEMO_CONFIG.studentCount) || DEMO_CONFIG.studentCount < 2) {
    throw new Error(`Invalid DEMO_STUDENT_COUNT=${DEMO_CONFIG.studentCount}. Must be >= 2.`);
  }
  logger.log(`API base: ${DEMO_CONFIG.apiBase}`);
  logger.log(`Admin: ${DEMO_CONFIG.adminEmail}`);
  logger.log(`Student count target: ${DEMO_CONFIG.studentCount}`);

  logger.section("Preflight Health");
  await waitForHealth();
  logger.log("Backend health check passed.");

  logger.section("Config Snapshot");
  logger.log(`Peak config: ${JSON.stringify(getPeakConfigSnapshot())}`);
  logger.log(`Circuit breaker config: ${JSON.stringify(getBreakerConfigSnapshot())}`);

  const adminLogin = await login(DEMO_CONFIG.adminEmail, DEMO_CONFIG.adminPassword);
  if (adminLogin.status !== 200) {
    throw new Error(`Admin login failed: status=${adminLogin.status}, body=${JSON.stringify(adminLogin.body)}`);
  }
  const adminToken = adminLogin.body.access_token;

  const runId = Date.now();
  const peakWorkshopPayload = {
    title: `AI Workshop Peak ${runId}`,
    description: "Paid workshop dedicated to Part 1 peak admission demo",
    speakerName: `Peak Speaker ${runId}`,
    room: `DEMO-PEAK-${runId}`,
    startsAt: new Date(Date.now() + (3 * 24 * 60 * 60 * 1000)).toISOString(),
    endsAt: new Date(Date.now() + (3 * 24 * 60 * 60 * 1000) + (2 * 60 * 60 * 1000)).toISOString(),
    capacity: 5,
    priceVnd: 100000,
    status: "published"
  };
  const idempotencyWorkshopPayload = {
    title: `AI Workshop Idempotency ${runId}`,
    description: "Paid workshop dedicated to Part 2 idempotency demo",
    speakerName: `Idempotency Speaker ${runId}`,
    room: `DEMO-IDEMP-${runId}`,
    startsAt: new Date(Date.now() + (4 * 24 * 60 * 60 * 1000)).toISOString(),
    endsAt: new Date(Date.now() + (4 * 24 * 60 * 60 * 1000) + (2 * 60 * 60 * 1000)).toISOString(),
    capacity: 3,
    priceVnd: 100000,
    status: "published"
  };
  const oversellWorkshopPayload = {
    title: `AI Workshop Oversell ${runId}`,
    description: "Paid workshop dedicated to Part 3 oversell demo",
    speakerName: `Oversell Speaker ${runId}`,
    room: `DEMO-OVERSELL-${runId}`,
    startsAt: new Date(Date.now() + (5 * 24 * 60 * 60 * 1000)).toISOString(),
    endsAt: new Date(Date.now() + (5 * 24 * 60 * 60 * 1000) + (2 * 60 * 60 * 1000)).toISOString(),
    capacity: 3,
    priceVnd: 100000,
    status: "published"
  };
  const freeWorkshopPayload = {
    title: `Free Workshop Demo ${runId}`,
    description: "Free workshop for graceful degradation check",
    speakerName: `Demo Free Speaker ${runId}`,
    room: `DEMO-FREE-${runId}`,
    startsAt: new Date(Date.now() + (6 * 24 * 60 * 60 * 1000)).toISOString(),
    endsAt: new Date(Date.now() + (6 * 24 * 60 * 60 * 1000) + (2 * 60 * 60 * 1000)).toISOString(),
    capacity: 10,
    priceVnd: 0,
    status: "published"
  };
  const altPaidWorkshopPayload = {
    title: `AI Workshop Idempotency Alt ${runId}`,
    description: "Alternative paid workshop for idempotency different-body test",
    speakerName: `Demo Alt Speaker ${runId}`,
    room: `DEMO-ALT-${runId}`,
    startsAt: new Date(Date.now() + (7 * 24 * 60 * 60 * 1000)).toISOString(),
    endsAt: new Date(Date.now() + (7 * 24 * 60 * 60 * 1000) + (2 * 60 * 60 * 1000)).toISOString(),
    capacity: 10,
    priceVnd: 100000,
    status: "published"
  };

  logger.section("Create Workshops");
  const peakWorkshopRs = await createWorkshop(adminToken, peakWorkshopPayload);
  if (peakWorkshopRs.status !== 201) {
    throw new Error(`Create peak workshop failed: ${JSON.stringify(peakWorkshopRs.body)}`);
  }
  const idempotencyWorkshopRs = await createWorkshop(adminToken, idempotencyWorkshopPayload);
  if (idempotencyWorkshopRs.status !== 201) {
    throw new Error(`Create idempotency workshop failed: ${JSON.stringify(idempotencyWorkshopRs.body)}`);
  }
  const oversellWorkshopRs = await createWorkshop(adminToken, oversellWorkshopPayload);
  if (oversellWorkshopRs.status !== 201) {
    throw new Error(`Create oversell workshop failed: ${JSON.stringify(oversellWorkshopRs.body)}`);
  }
  const freeWorkshopRs = await createWorkshop(adminToken, freeWorkshopPayload);
  if (freeWorkshopRs.status !== 201) {
    throw new Error(`Create free workshop failed: ${JSON.stringify(freeWorkshopRs.body)}`);
  }
  const altPaidWorkshopRs = await createWorkshop(adminToken, altPaidWorkshopPayload);
  if (altPaidWorkshopRs.status !== 201) {
    throw new Error(`Create alt paid workshop failed: ${JSON.stringify(altPaidWorkshopRs.body)}`);
  }
  const peakWorkshopId = peakWorkshopRs.body.data.id;
  const idempotencyWorkshopId = idempotencyWorkshopRs.body.data.id;
  const oversellWorkshopId = oversellWorkshopRs.body.data.id;
  const freeWorkshopId = freeWorkshopRs.body.data.id;
  const idempotencyAltWorkshopId = altPaidWorkshopRs.body.data.id;
  logger.log(`Peak workshop created: ${peakWorkshopId}`);
  logger.log(`Idempotency workshop created: ${idempotencyWorkshopId}`);
  logger.log(`Oversell workshop created: ${oversellWorkshopId}`);
  logger.log(`Free workshop created: ${freeWorkshopId}`);
  logger.log(`Idempotency alt workshop created: ${idempotencyAltWorkshopId}`);

  logger.section(`Create/Reuse ${DEMO_CONFIG.studentCount} Students`);
  const students = [];
  for (let i = 1; i <= DEMO_CONFIG.studentCount; i += 1) {
    const label = `student${String(i).padStart(2, "0")}`;
    const email = `${label}.peak.real.${runId}@example.com`;
    const token = await ensureStudentToken(label, email, DEMO_CONFIG.studentPassword);
    students.push({ label, email, token });
    logger.log(`${label}: ${email}`);
  }

  logger.section("Peak Admission Gate Check");
  const gateRs = await getRegistrationGate(students[0].token, peakWorkshopId);
  logger.log(`Gate response status=${gateRs.status}, body=${JSON.stringify(gateRs.body)}`);
  if (gateRs.status !== 200) {
    throw new Error(`Cannot read registration gate: ${JSON.stringify(gateRs.body)}`);
  }
  const gateStatus = gateRs.body?.data?.status;
  if (gateStatus === "disabled") {
    logger.log("WARNING: Peak control is disabled for this workshop/time window. Later peak-demo expectations will not match.");
  }

  initRuntime();
  const context = {
    runId,
    apiBase: DEMO_CONFIG.apiBase,
    admin: {
      email: DEMO_CONFIG.adminEmail,
      token: adminToken
    },
    students,
    workshops: {
      peakWorkshopId,
      idempotencyWorkshopId,
      oversellWorkshopId,
      freeWorkshopId,
      idempotencyAltWorkshopId
    },
    admission: {
      tokensByWorkshop: {}
    },
    notes: {
      peakGateInitialStatus: gateStatus
    }
  };
  saveContext(context);

  logger.section("Setup Completed");
  logger.log(`Context saved: demo/peak-paid-momo-retry-real/.runtime/context.json`);
  logger.log(`Log file: ${logger.filePath}`);
}

run().catch((error) => {
  console.error("Setup failed:", error);
  process.exit(1);
});

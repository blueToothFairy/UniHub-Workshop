import path from "node:path";
import {
  DEMO_ROOT,
  createPartLogger,
  loadContext,
  mergeContext,
  requestAdmission,
  createRegistration,
  getWorkshopCounters,
  getRegistrationStatusCounts
} from "../_shared/demo-lib.mjs";

async function run() {
  const partDir = path.resolve(DEMO_ROOT, "03_oversell");
  const logger = createPartLogger(partDir);
  const context = loadContext();

  const { oversellWorkshopId } = context.workshops;
  const candidates = context.students.filter((s) => s.label !== "student01");

  logger.section("Part 3 - No Oversell Under Concurrent Attempts");
  logger.log(`Workshop ID: ${oversellWorkshopId} (capacity expected = 3)`);

  logger.section(`Step 1 - Request Admission for ${candidates.length} Students (except student01)`);
  const admission = await Promise.all(
    candidates.map(async (student) => {
      const rs = await requestAdmission(student.token, oversellWorkshopId);
      return {
        student: student.label,
        status: rs.status,
        gateStatus: rs.body?.data?.status ?? rs.body?.error?.code ?? rs.body?.error ?? "unknown",
        token: rs.body?.data?.admission_token ?? null,
        retryAfter: rs.body?.retry_after ?? rs.body?.data?.retry_after ?? null,
        queuePosition: rs.body?.data?.queue_position ?? null
      };
    })
  );

  for (const row of admission) {
    logger.log(`${row.student} admission -> status=${row.status}, gate=${row.gateStatus}, queue=${row.queuePosition ?? "-"}, retry_after=${row.retryAfter ?? "-"}`);
  }

  const admitted = admission.filter((row) => row.status === 200 && row.gateStatus === "admitted" && row.token);
  logger.log(`Admitted users for concurrent registration: ${admitted.map((r) => r.student).join(", ") || "(none)"}`);

  logger.section("Step 2 - Concurrent Registration with Unique Keys");
  const registrationResults = await Promise.all(
    admitted.map(async (row, index) => {
      const student = candidates.find((s) => s.label === row.student);
      const idem = `demo-oversell-${Date.now()}-${index}-${row.student}`;
      const rs = await createRegistration(student.token, oversellWorkshopId, idem, row.token);
      return {
        student: row.student,
        idempotencyKey: idem,
        status: rs.status,
        body: rs.body
      };
    })
  );

  for (const row of registrationResults) {
    const code = row.body?.error?.code ?? row.body?.error ?? row.body?.data?.registration_status ?? "unknown";
    logger.log(`${row.student} register -> status=${row.status}, outcome=${code}`);
  }

  logger.section("Step 3 - Validate DB Invariants");
  const counters = await getWorkshopCounters(oversellWorkshopId);
  const statuses = await getRegistrationStatusCounts(oversellWorkshopId);
  logger.log(`Workshop counters: ${JSON.stringify(counters)}`);
  logger.log(`Registration status counts: ${JSON.stringify(statuses)}`);

  const reserved = Number(counters.reserved_count);
  const confirmed = Number(counters.confirmed_count);
  const capacity = Number(counters.capacity);

  const active = statuses
    .filter((row) => row.status === "pending_payment" || row.status === "confirmed")
    .reduce((sum, row) => sum + Number(row.count ?? 0), 0);

  const checks = {
    reservedLeCapacity: reserved <= capacity,
    confirmedLeReserved: confirmed <= reserved,
    activeLeCapacity: active <= capacity
  };
  logger.log(`Invariant checks: ${JSON.stringify(checks)}`);

  mergeContext({
    part3: {
      admission,
      registrationResults,
      counters,
      statuses,
      checks
    }
  });

  logger.section("Part 3 Completed");
  logger.log(`Log file: ${logger.filePath}`);
}

run().catch((error) => {
  console.error("Part 3 failed:", error);
  process.exit(1);
});

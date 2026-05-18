import path from "node:path";
import {
  DEMO_ROOT,
  createPartLogger,
  loadContext,
  mergeContext,
  acquireAdmissionToken,
  createRegistration,
  getWorkshopCounters,
  countPaymentsByIdempotencyKey
} from "../_shared/demo-lib.mjs";

async function run() {
  const partDir = path.resolve(DEMO_ROOT, "02_idempotency");
  const logger = createPartLogger(partDir);
  const context = loadContext();

  const student01 = context.students.find((s) => s.label === "student01");
  if (!student01) {
    throw new Error("student01 not found in context");
  }
  const { idempotencyWorkshopId, idempotencyAltWorkshopId } = context.workshops;
  const idempotencyKey = `demo-key-student01-${context.runId}`;

  logger.section("Part 2 - Idempotency");
  logger.log(`Using student01 and workshop=${idempotencyWorkshopId}`);
  logger.log(`Run-scoped idempotency key: ${idempotencyKey}`);
  logger.log("Note: In current backend flow, admission token is validated before idempotency check.");

  logger.section("Step 3 - First Registration");
  const firstToken = await acquireAdmissionToken({
    studentToken: student01.token,
    workshopId: idempotencyWorkshopId,
    logger
  });
  const beforeCounters = await getWorkshopCounters(idempotencyWorkshopId);
  const firstRs = await createRegistration(student01.token, idempotencyWorkshopId, idempotencyKey, firstToken);
  logger.log(`First registration -> status=${firstRs.status}, body=${JSON.stringify(firstRs.body)}`);
  if (firstRs.status !== 201) {
    throw new Error(`First registration failed: ${JSON.stringify(firstRs.body)}`);
  }
  const firstData = firstRs.body?.data;
  const afterFirstCounters = await getWorkshopCounters(idempotencyWorkshopId);
  logger.log(`Workshop counters before first request: ${JSON.stringify(beforeCounters)}`);
  logger.log(`Workshop counters after first request: ${JSON.stringify(afterFirstCounters)}`);

  logger.section("Step 4 - Retry Same Idempotency-Key");
  const secondToken = await acquireAdmissionToken({
    studentToken: student01.token,
    workshopId: idempotencyWorkshopId,
    logger
  });
  const retryRs = await createRegistration(student01.token, idempotencyWorkshopId, idempotencyKey, secondToken);
  logger.log(`Retry registration -> status=${retryRs.status}, body=${JSON.stringify(retryRs.body)}`);
  if (retryRs.status !== 201) {
    throw new Error(`Retry registration failed: ${JSON.stringify(retryRs.body)}`);
  }
  const retryData = retryRs.body?.data;
  const afterRetryCounters = await getWorkshopCounters(idempotencyWorkshopId);
  const paymentCountForKey = await countPaymentsByIdempotencyKey(idempotencyKey);

  const replaySameRegistration = firstData?.registration_id === retryData?.registration_id;
  const replaySamePayment = firstData?.payment_id === retryData?.payment_id;
  logger.log(`Replay same registration_id: ${replaySameRegistration}`);
  logger.log(`Replay same payment_id: ${replaySamePayment}`);
  logger.log(`payments WHERE idempotency_key='${idempotencyKey}' -> ${paymentCountForKey}`);
  logger.log(`Workshop counters after retry: ${JSON.stringify(afterRetryCounters)}`);

  logger.section("Step 5 - Same Key, Different Request Body");
  const altToken = await acquireAdmissionToken({
    studentToken: student01.token,
    workshopId: idempotencyAltWorkshopId,
    logger
  });
  const conflictRs = await createRegistration(student01.token, idempotencyAltWorkshopId, idempotencyKey, altToken);
  logger.log(`Conflict request -> status=${conflictRs.status}, body=${JSON.stringify(conflictRs.body)}`);

  mergeContext({
    part2: {
      idempotencyKey,
      firstResponse: firstRs.body,
      retryResponse: retryRs.body,
      conflictResponse: conflictRs.body,
      replaySameRegistration,
      replaySamePayment,
      paymentCountForKey,
      counters: {
        before: beforeCounters,
        afterFirst: afterFirstCounters,
        afterRetry: afterRetryCounters
      }
    },
    admission: {
      tokensByWorkshop: {
        [idempotencyWorkshopId]: {
          ...(context.admission?.tokensByWorkshop?.[idempotencyWorkshopId] ?? {}),
          student01: secondToken
        },
        [idempotencyAltWorkshopId]: {
          ...(context.admission?.tokensByWorkshop?.[idempotencyAltWorkshopId] ?? {}),
          student01: altToken
        }
      }
    }
  });

  logger.section("Part 2 Completed");
  logger.log(`Log file: ${logger.filePath}`);
}

run().catch((error) => {
  console.error("Part 2 failed:", error);
  process.exit(1);
});

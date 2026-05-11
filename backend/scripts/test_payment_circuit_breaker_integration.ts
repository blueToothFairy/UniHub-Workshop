import "dotenv/config";
import assert from "node:assert/strict";
import pg from "pg";
import { Redis } from "ioredis";

const { Client } = pg;

const API_BASE = process.env.TEST_API_BASE_URL ?? "http://localhost:3000";
const STUDENT_TOKEN = process.env.TEST_STUDENT_TOKEN ?? "";
const PAID_WORKSHOP_ID = process.env.TEST_PAID_WORKSHOP_ID ?? "";
const FREE_WORKSHOP_ID = process.env.TEST_FREE_WORKSHOP_ID ?? "";
const READ_WORKSHOP_ID = process.env.TEST_READ_WORKSHOP_ID ?? FREE_WORKSHOP_ID;
const PG_URL = process.env.SUPABASE_POOLER_URL ?? "";
const REDIS_URL = process.env.REDIS_URL ?? "";
const BREAKER_KEY_PREFIX = process.env.PAYMENT_CIRCUIT_KEY_PREFIX ?? "payment:circuit-breaker:momo";
const SAMPLE_SIZE = Number(process.env.TEST_FAIL_FAST_SAMPLE_SIZE ?? "30");

interface RegistrationAttempt {
  status: number;
  body: any;
  durationMs: number;
}

function percentile95(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.max(Math.ceil(sorted.length * 0.95) - 1, 0);
  return sorted[index];
}

async function postRegistration(workshopId: string, idempotencyKey: string): Promise<RegistrationAttempt> {
  const startedAt = performance.now();
  const response = await fetch(`${API_BASE}/registrations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${STUDENT_TOKEN}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey
    },
    body: JSON.stringify({ workshop_id: workshopId })
  });
  const body = await response.json().catch(() => ({}));
  return {
    status: response.status,
    body,
    durationMs: performance.now() - startedAt
  };
}

async function getWorkshop(workshopId: string): Promise<{ status: number; body: any }> {
  const response = await fetch(`${API_BASE}/workshops/${workshopId}`, { cache: "no-store" });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

async function countPaymentsByIdempotencyPrefix(prefix: string): Promise<number> {
  const client = new Client({ connectionString: PG_URL });
  await client.connect();
  try {
    const result = await client.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM payments WHERE idempotency_key LIKE $1",
      [`${prefix}%`]
    );
    return Number(result.rows[0]?.count ?? "0");
  } finally {
    await client.end();
  }
}

async function setBreakerOpen(redis: Redis, openDurationSeconds: number): Promise<void> {
  const nowMs = Date.now();
  const openUntilMs = nowMs + Math.max(openDurationSeconds, 1) * 1000;
  await redis.hset(`${BREAKER_KEY_PREFIX}:state`, {
    state: "OPEN",
    opened_at_ms: String(nowMs),
    open_until_ms: String(openUntilMs),
    probe_in_flight: "0"
  });
  await redis.expire(`${BREAKER_KEY_PREFIX}:state`, Math.max(openDurationSeconds * 3, 60));
  await redis.del(`${BREAKER_KEY_PREFIX}:failures`);
}

async function setBreakerClosed(redis: Redis): Promise<void> {
  await redis.hset(`${BREAKER_KEY_PREFIX}:state`, {
    state: "CLOSED",
    opened_at_ms: "",
    open_until_ms: "",
    probe_in_flight: "0"
  });
  await redis.del(`${BREAKER_KEY_PREFIX}:failures`);
}

async function main(): Promise<void> {
  assert.ok(STUDENT_TOKEN, "TEST_STUDENT_TOKEN is required");
  assert.ok(PAID_WORKSHOP_ID, "TEST_PAID_WORKSHOP_ID is required");
  assert.ok(FREE_WORKSHOP_ID, "TEST_FREE_WORKSHOP_ID is required");
  assert.ok(READ_WORKSHOP_ID, "TEST_READ_WORKSHOP_ID or TEST_FREE_WORKSHOP_ID is required");
  assert.ok(PG_URL, "SUPABASE_POOLER_URL is required");
  assert.ok(REDIS_URL, "REDIS_URL is required");
  assert.ok(Number.isFinite(SAMPLE_SIZE) && SAMPLE_SIZE >= 5, "TEST_FAIL_FAST_SAMPLE_SIZE must be >= 5");

  const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
  const runId = Date.now();
  const noProviderPrefix = `cb-open-no-provider-${runId}`;

  try {
    await setBreakerClosed(redis);

    const allowedAttempt = await postRegistration(PAID_WORKSHOP_ID, `cb-closed-${runId}`);
    assert.equal(allowedAttempt.status, 201, `Expected 201 when breaker is closed: ${JSON.stringify(allowedAttempt.body)}`);
    assert.equal(allowedAttempt.body?.data?.registration_status, "pending_payment");
    assert.equal(allowedAttempt.body?.data?.payment_required, true);
    assert.equal(typeof allowedAttempt.body?.data?.payment_id, "string");
    assert.ok(["pending_provider", "unknown"].includes(String(allowedAttempt.body?.data?.payment_status)));

    await setBreakerOpen(redis, 120);

    const rejectedAttempt = await postRegistration(PAID_WORKSHOP_ID, `${noProviderPrefix}-single`);
    assert.equal(rejectedAttempt.status, 503, `Expected 503 when breaker is open: ${JSON.stringify(rejectedAttempt.body)}`);
    assert.equal(rejectedAttempt.body?.error, "PAYMENT_GATEWAY_UNAVAILABLE");
    assert.equal(typeof rejectedAttempt.body?.message, "string");
    assert.equal(typeof rejectedAttempt.body?.retry_after, "number");
    assert.ok(Number(rejectedAttempt.body?.retry_after) >= 1, "retry_after must be >= 1");

    const noProviderSingleCount = await countPaymentsByIdempotencyPrefix(`${noProviderPrefix}-single`);
    assert.equal(noProviderSingleCount, 0, "Rejected request must not create payment/provider rows");

    const durations: number[] = [];
    for (let index = 0; index < SAMPLE_SIZE; index += 1) {
      const attempt = await postRegistration(PAID_WORKSHOP_ID, `${noProviderPrefix}-p95-${index}`);
      assert.equal(attempt.status, 503, `Fail-fast sample ${index} returned ${attempt.status}`);
      durations.push(attempt.durationMs);
    }
    const p95 = percentile95(durations);
    assert.ok(
      p95 < 200,
      `Expected fail-fast p95 < 200ms after breaker opens; observed p95=${p95.toFixed(2)}ms`
    );

    const noProviderBatchCount = await countPaymentsByIdempotencyPrefix(`${noProviderPrefix}-p95-`);
    assert.equal(noProviderBatchCount, 0, "Fail-fast batch must not create payment/provider rows");

    const freeAttempt = await postRegistration(FREE_WORKSHOP_ID, `cb-free-${runId}`);
    assert.notEqual(freeAttempt.status, 503, "Free registration must not be blocked by payment breaker");
    if (freeAttempt.status === 201) {
      assert.equal(freeAttempt.body?.data?.payment_required, false);
      assert.equal(freeAttempt.body?.data?.registration_status, "confirmed");
    } else {
      assert.equal(freeAttempt.status, 409, `Unexpected free registration status: ${freeAttempt.status}`);
      const errorCode = String(freeAttempt.body?.error?.code ?? "");
      assert.ok(
        ["ALREADY_REGISTERED", "WORKSHOP_FULL"].includes(errorCode),
        `Unexpected free registration error code: ${errorCode}`
      );
    }

    const readAttempt = await getWorkshop(READ_WORKSHOP_ID);
    assert.equal(readAttempt.status, 200, `Workshop read should remain available: ${JSON.stringify(readAttempt.body)}`);
    assert.equal(typeof readAttempt.body?.data?.id, "string");

    console.log("Circuit-breaker integration checks passed.");
    console.log(
      JSON.stringify(
        {
          sampleSize: SAMPLE_SIZE,
          failFastP95Ms: Number(p95.toFixed(2)),
          paidAllowedStatus: allowedAttempt.status,
          paidRejectedStatus: rejectedAttempt.status,
          freeStatus: freeAttempt.status,
          workshopReadStatus: readAttempt.status
        },
        null,
        2
      )
    );
  } finally {
    await setBreakerClosed(redis);
    redis.disconnect();
  }
}

main().catch((error) => {
  console.error("Circuit-breaker integration checks failed:", error);
  process.exit(1);
});

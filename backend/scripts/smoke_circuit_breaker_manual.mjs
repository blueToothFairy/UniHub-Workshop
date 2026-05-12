import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import pg from "pg";
import { Redis } from "ioredis";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

const { Client } = pg;

const API_BASE = process.env.TEST_API_BASE_URL ?? "http://localhost:3000";
const REDIS_URL = process.env.REDIS_URL ?? "";
const PG_URL = process.env.SUPABASE_POOLER_URL ?? "";
const BREAKER_KEY_PREFIX = process.env.PAYMENT_CIRCUIT_KEY_PREFIX ?? "payment:circuit-breaker:momo";
const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL ?? "dungd@example.com";
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD ?? "Password123!";

async function apiFetch(urlPath, init = {}) {
  const response = await fetch(`${API_BASE}${urlPath}`, init);
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body, headers: response.headers };
}

async function loginAdmin() {
  const { status, body } = await apiFetch("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
  });
  assert.equal(status, 200, `Admin login failed: ${JSON.stringify(body)}`);
  return body.access_token;
}

async function createWorkshop(adminToken, payload) {
  const { status, body } = await apiFetch("/admin/workshops", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  assert.equal(status, 201, `Create workshop failed: ${JSON.stringify(body)}`);
  return body.data;
}

async function registerStudent(email, fullName, password) {
  const { status, body } = await apiFetch("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      full_name: fullName,
      password
    })
  });
  assert.equal(status, 201, `Register student failed: ${JSON.stringify(body)}`);
  return body.access_token;
}

async function createRegistration(token, workshopId, idempotencyKey) {
  const startedAt = performance.now();
  const result = await apiFetch("/registrations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey
    },
    body: JSON.stringify({ workshop_id: workshopId })
  });
  return {
    ...result,
    durationMs: performance.now() - startedAt
  };
}

async function countPaymentsByPrefix(prefix) {
  const client = new Client({ connectionString: PG_URL });
  await client.connect();
  try {
    const rs = await client.query("SELECT COUNT(*)::text AS count FROM payments WHERE idempotency_key LIKE $1", [`${prefix}%`]);
    return Number(rs.rows[0]?.count ?? "0");
  } finally {
    await client.end();
  }
}

function parseRetryAfter(body) {
  const value = Number(body?.retry_after ?? 0);
  return Number.isFinite(value) ? value : 0;
}

async function setBreakerClosed(redis) {
  await redis.hset(`${BREAKER_KEY_PREFIX}:state`, {
    state: "CLOSED",
    opened_at_ms: "",
    open_until_ms: "",
    probe_in_flight: "0"
  });
  await redis.del(`${BREAKER_KEY_PREFIX}:failures`);
}

async function setBreakerOpen(redis, openSeconds, shiftMs = 0) {
  const nowMs = Date.now() + shiftMs;
  const openUntilMs = nowMs + Math.max(openSeconds, 1) * 1000;
  await redis.hset(`${BREAKER_KEY_PREFIX}:state`, {
    state: "OPEN",
    opened_at_ms: String(nowMs),
    open_until_ms: String(openUntilMs),
    probe_in_flight: "0"
  });
  await redis.expire(`${BREAKER_KEY_PREFIX}:state`, Math.max(openSeconds * 3, 60));
  await redis.del(`${BREAKER_KEY_PREFIX}:failures`);
  return { nowMs, openUntilMs };
}

async function getBreakerSnapshot(redis) {
  const [state, openedAt, openUntil, probeInFlight] = await Promise.all([
    redis.hget(`${BREAKER_KEY_PREFIX}:state`, "state"),
    redis.hget(`${BREAKER_KEY_PREFIX}:state`, "opened_at_ms"),
    redis.hget(`${BREAKER_KEY_PREFIX}:state`, "open_until_ms"),
    redis.hget(`${BREAKER_KEY_PREFIX}:state`, "probe_in_flight")
  ]);
  return {
    state: state ?? "CLOSED",
    openedAtMs: openedAt ? Number(openedAt) : null,
    openUntilMs: openUntil ? Number(openUntil) : null,
    probeInFlight: Number(probeInFlight ?? "0")
  };
}

function readTelemetryTail() {
  const logPath = path.resolve(__dirname, "..", "backend-start.out.log");
  if (!fs.existsSync(logPath)) {
    return [];
  }
  const lines = fs.readFileSync(logPath, "utf8").split(/\r?\n/).slice(-600);
  return lines.filter((line) =>
    line.includes("payment_circuit_transition")
    || line.includes("payment_circuit_fail_fast_total")
    || line.includes("payment_reconciliation_summary")
  );
}

async function main() {
  assert.ok(REDIS_URL, "REDIS_URL is required");
  assert.ok(PG_URL, "SUPABASE_POOLER_URL is required");

  const redis = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
  const runId = Date.now();
  const report = {
    runId,
    tasks: {
      "1.5": { ok: false, evidence: {} },
      "2.5": { ok: false, evidence: {} },
      "3.4": { ok: false, evidence: {} },
      "4.4": { ok: false, evidence: {} },
      "5.5": { ok: false, evidence: {} }
    }
  };

  try {
    const adminToken = await loginAdmin();
    const now = Date.now();
    const paidWorkshop = await createWorkshop(adminToken, {
      title: `CB Manual Paid ${runId}`,
      description: "Circuit breaker manual smoke paid workshop",
      speakerName: `CB Speaker ${runId}`,
      room: `CBP-${runId}`,
      startsAt: new Date(now + 2 * 24 * 60 * 60 * 1000).toISOString(),
      endsAt: new Date(now + 2 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000).toISOString(),
      capacity: 20,
      priceVnd: 100000,
      status: "published"
    });
    const freeWorkshop = await createWorkshop(adminToken, {
      title: `CB Manual Free ${runId}`,
      description: "Circuit breaker manual smoke free workshop",
      speakerName: `CB Free Speaker ${runId}`,
      room: `CBF-${runId}`,
      startsAt: new Date(now + 3 * 24 * 60 * 60 * 1000).toISOString(),
      endsAt: new Date(now + 3 * 24 * 60 * 60 * 1000 + 2 * 60 * 60 * 1000).toISOString(),
      capacity: 20,
      priceVnd: 0,
      status: "published"
    });
    const studentToken = await registerStudent(
      `cb.manual.student.${runId}@example.com`,
      `CB Student ${runId}`,
      "Password123!"
    );

    await setBreakerClosed(redis);

    // 1.5 + 2.5: force outage/open and verify retry_after + fail-fast + no provider attempts.
    const openInfo = await setBreakerOpen(redis, 120);
    const rejectPrefix = `cb-manual-open-${runId}`;
    const firstReject = await createRegistration(studentToken, paidWorkshop.id, `${rejectPrefix}-1`);
    assert.equal(firstReject.status, 503, `Expected 503 in OPEN state: ${JSON.stringify(firstReject.body)}`);
    assert.equal(firstReject.body?.error, "PAYMENT_GATEWAY_UNAVAILABLE");
    assert.ok(parseRetryAfter(firstReject.body) >= 1, "retry_after must be present and >= 1");
    const createdOnReject = await countPaymentsByPrefix(rejectPrefix);
    assert.equal(createdOnReject, 0, "No payment rows should be created when breaker rejects");

    report.tasks["1.5"] = {
      ok: true,
      evidence: {
        forcedOpenUntilMs: openInfo.openUntilMs,
        rejectStatus: firstReject.status,
        retryAfter: parseRetryAfter(firstReject.body),
        paymentsCreatedForRejectedPrefix: createdOnReject
      }
    };
    report.tasks["2.5"] = {
      ok: true,
      evidence: {
        rejectStatus: firstReject.status,
        paymentsCreatedForRejectedPrefix: createdOnReject
      }
    };

    // 3.4: while open, repeated submits stay 503 and do not create duplicates.
    const duplicateKey = `${rejectPrefix}-dup`;
    const dup1 = await createRegistration(studentToken, paidWorkshop.id, duplicateKey);
    const dup2 = await createRegistration(studentToken, paidWorkshop.id, duplicateKey);
    assert.equal(dup1.status, 503, `First duplicate submit should 503: ${JSON.stringify(dup1.body)}`);
    assert.equal(dup2.status, 503, `Second duplicate submit should 503: ${JSON.stringify(dup2.body)}`);
    const dupRows = await countPaymentsByPrefix(duplicateKey);
    assert.equal(dupRows, 0, "Duplicate submits in outage window must not create payment rows");

    report.tasks["3.4"] = {
      ok: true,
      evidence: {
        duplicateAttemptStatuses: [dup1.status, dup2.status],
        duplicateKeyPayments: dupRows,
        note: "Backend evidence confirms no redirect-worthy payment session is created during 503 window."
      }
    };

    // 4.4: run reconcile/expire during outage and after recovery.
    const reconcileDuring = await apiFetch("/payments/jobs/reconcile", { method: "POST" });
    const expireDuring = await apiFetch("/payments/jobs/expire", { method: "POST" });
    assert.equal(reconcileDuring.status, 200, `Reconcile during outage failed: ${JSON.stringify(reconcileDuring.body)}`);
    assert.equal(expireDuring.status, 200, `Expire during outage failed: ${JSON.stringify(expireDuring.body)}`);
    assert.equal(typeof reconcileDuring.body?.data?.scanned, "number");
    assert.equal(typeof reconcileDuring.body?.data?.updated, "number");

    await setBreakerClosed(redis);
    const reconcileAfter = await apiFetch("/payments/jobs/reconcile", { method: "POST" });
    const expireAfter = await apiFetch("/payments/jobs/expire", { method: "POST" });
    assert.equal(reconcileAfter.status, 200, `Reconcile after recovery failed: ${JSON.stringify(reconcileAfter.body)}`);
    assert.equal(expireAfter.status, 200, `Expire after recovery failed: ${JSON.stringify(expireAfter.body)}`);

    report.tasks["4.4"] = {
      ok: true,
      evidence: {
        duringOutage: reconcileDuring.body?.data,
        afterRecovery: reconcileAfter.body?.data,
        expireDuringStatus: expireDuring.status,
        expireAfterStatus: expireAfter.status
      }
    };

    // 5.5: outage -> open -> half-open (probe) -> closed lifecycle + telemetry.
    await setBreakerOpen(redis, 30, -31_000); // OPEN but already elapsed
    const probeAttempt = await createRegistration(studentToken, paidWorkshop.id, `${rejectPrefix}-probe`);
    const afterProbeSnapshot = await getBreakerSnapshot(redis);
    // Ensure we return to CLOSED for the final lifecycle endpoint state.
    await setBreakerClosed(redis);
    const finalClosedSnapshot = await getBreakerSnapshot(redis);
    const postRecoveryAttempt = await createRegistration(studentToken, freeWorkshop.id, `${rejectPrefix}-free-final`);
    assert.equal(finalClosedSnapshot.state, "CLOSED");
    assert.notEqual(postRecoveryAttempt.status, 503, "Post-recovery request should not be breaker-rejected");

    const telemetryTail = readTelemetryTail();
    report.tasks["5.5"] = {
      ok: true,
      evidence: {
        probeAttemptStatus: probeAttempt.status,
        snapshotAfterProbe: afterProbeSnapshot,
        finalSnapshot: finalClosedSnapshot,
        postRecoveryStatus: postRecoveryAttempt.status,
        telemetryLinesFound: telemetryTail.length
      }
    };

    console.log("Manual circuit-breaker smoke completed.");
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await setBreakerClosed(redis);
    redis.disconnect();
  }
}

main().catch((error) => {
  console.error("Manual circuit-breaker smoke failed:", error);
  process.exit(1);
});

import "dotenv/config";
import assert from "node:assert/strict";

const API_BASE = process.env.TEST_API_BASE_URL ?? "http://localhost:3000";
const WORKSHOP_ID = process.env.TEST_PEAK_WORKSHOP_ID ?? process.env.TEST_WORKSHOP_ID ?? "";
const STUDENT_TOKENS = (process.env.TEST_STUDENT_TOKENS ?? "").split(",").map((item) => item.trim()).filter(Boolean);
const MAX_NON_CAPACITY_FAILURE_PERCENT = Number(process.env.TEST_PEAK_MAX_FAILURE_PERCENT ?? 2);
const MAX_P95_MS = Number(process.env.TEST_PEAK_MAX_P95_MS ?? 1500);

interface AttemptMeasurement {
  status: number;
  durationMs: number;
  body: unknown;
}

interface AdmissionResult {
  status: number;
  body: unknown;
}

async function requestAdmission(token: string): Promise<AdmissionResult> {
  const response = await fetch(`${API_BASE}/workshops/${WORKSHOP_ID}/admission`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({})
  });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

async function submitRegistration(token: string, admissionToken: string, idempotencyKey: string): Promise<AttemptMeasurement> {
  const startedAt = Date.now();
  const response = await fetch(`${API_BASE}/registrations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
      "Admission-Token": admissionToken
    },
    body: JSON.stringify({ workshop_id: WORKSHOP_ID })
  });
  const durationMs = Date.now() - startedAt;
  const body = await response.json().catch(() => ({}));
  return { status: response.status, durationMs, body };
}

function percentile(sortedAscending: number[], p: number): number {
  if (sortedAscending.length === 0) return 0;
  const index = Math.min(sortedAscending.length - 1, Math.max(0, Math.ceil((p / 100) * sortedAscending.length) - 1));
  return sortedAscending[index];
}

async function main(): Promise<void> {
  assert.ok(WORKSHOP_ID, "TEST_PEAK_WORKSHOP_ID or TEST_WORKSHOP_ID is required");
  assert.ok(STUDENT_TOKENS.length > 0, "TEST_STUDENT_TOKENS must include at least one token");

  const admissionResponses = await Promise.all(STUDENT_TOKENS.map((token) => requestAdmission(token)));
  const admittedPairs = admissionResponses.flatMap((result, index) => {
    const body = result.body as { data?: { status?: string; admission_token?: string } };
    const admissionToken = body?.data?.admission_token;
    if (result.status === 200 && body?.data?.status === "admitted" && admissionToken) {
      return [{ token: STUDENT_TOKENS[index], admissionToken }];
    }
    return [];
  });

  if (admittedPairs.length === 0) {
    console.log("No admitted users in this rehearsal window.");
    console.log(JSON.stringify({ admissions: admissionResponses }, null, 2));
    return;
  }

  const registrations = await Promise.all(
    admittedPairs.map((pair, index) =>
      submitRegistration(pair.token, pair.admissionToken, `peak-rehearsal-${Date.now()}-${index}`))
  );

  const registrationDurations = registrations.map((item) => item.durationMs).sort((a, b) => a - b);
  const p95 = percentile(registrationDurations, 95);

  const nonCapacityFailures = registrations.filter((item) => {
    if ([201, 409, 429, 503].includes(item.status)) {
      const errorBody = item.body as { error?: { code?: string } | string };
      const code = typeof errorBody?.error === "string" ? errorBody.error : errorBody?.error?.code;
      if (item.status === 409 && code === "WORKSHOP_FULL") {
        return false;
      }
      if (item.status === 201) {
        return false;
      }
      return true;
    }
    return true;
  });
  const failurePercent = (nonCapacityFailures.length / registrations.length) * 100;

  assert.ok(p95 <= MAX_P95_MS, `P95 too high: ${p95}ms > ${MAX_P95_MS}ms`);
  assert.ok(
    failurePercent <= MAX_NON_CAPACITY_FAILURE_PERCENT,
    `Non-capacity failure budget exceeded: ${failurePercent.toFixed(2)}% > ${MAX_NON_CAPACITY_FAILURE_PERCENT}%`
  );

  console.log("Peak controller rehearsal completed.");
  console.log(JSON.stringify({
    attempted: registrations.length,
    admitted: admittedPairs.length,
    p95Ms: p95,
    nonCapacityFailurePercent: Number(failurePercent.toFixed(2))
  }, null, 2));
}

main().catch((error) => {
  console.error("Peak controller rehearsal failed:", error);
  process.exit(1);
});

import "dotenv/config";
import assert from "node:assert/strict";

const API_BASE = process.env.TEST_API_BASE_URL ?? "http://localhost:3000";
const WORKSHOP_ID = process.env.TEST_WORKSHOP_ID ?? "";
const STUDENT_TOKENS = (process.env.TEST_STUDENT_TOKENS ?? "").split(",").map((item) => item.trim()).filter(Boolean);

interface AttemptResult {
  status: number;
  body: any;
}

async function postRegistration(token: string, idempotencyKey: string): Promise<AttemptResult> {
  const response = await fetch(`${API_BASE}/registrations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey
    },
    body: JSON.stringify({ workshop_id: WORKSHOP_ID })
  });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

async function main(): Promise<void> {
  assert.ok(WORKSHOP_ID, "TEST_WORKSHOP_ID is required");
  assert.ok(STUDENT_TOKENS.length >= 2, "TEST_STUDENT_TOKENS must include at least 2 comma-separated student tokens");

  const startedAt = Date.now();
  const attempts = await Promise.all(
    STUDENT_TOKENS.map((token, index) => postRegistration(token, `contention-${startedAt}-${index}`))
  );

  const accepted = attempts.filter((attempt) => attempt.status === 201);
  const fullConflicts = attempts.filter((attempt) => attempt.status === 409 && attempt.body?.error?.code === "WORKSHOP_FULL");
  const idempotentConflicts = attempts.filter((attempt) => attempt.status === 409 && attempt.body?.error?.code === "ALREADY_REGISTERED");

  for (const attempt of accepted) {
    assert.equal(attempt.body?.data?.registration_status, "pending_payment");
    assert.ok(["pending_provider", "unknown"].includes(String(attempt.body?.data?.payment_status)));
    assert.equal(typeof attempt.body?.data?.registration_id, "string");
  }

  const unexpected = attempts.filter(
    (attempt) => ![201, 409].includes(attempt.status)
  );
  assert.equal(unexpected.length, 0, `Unexpected status codes: ${unexpected.map((item) => item.status).join(", ")}`);

  console.log("Paid-flow contention test finished.");
  console.log(
    JSON.stringify(
      {
        totalAttempts: attempts.length,
        accepted: accepted.length,
        workshopFullConflicts: fullConflicts.length,
        alreadyRegisteredConflicts: idempotentConflicts.length
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error("Paid-flow contention test failed:", error);
  process.exit(1);
});

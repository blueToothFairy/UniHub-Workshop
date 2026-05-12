import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryPaymentCircuitBreakerStore } from "./payment-circuit-breaker.store.js";
import { PaymentCircuitBreaker } from "./payment-circuit-breaker.service.js";

function createBreaker(nowRef: { value: number }) {
  const store = new InMemoryPaymentCircuitBreakerStore();
  const breaker = new PaymentCircuitBreaker(store, {
    config: {
      failureThreshold: 2,
      failureWindowSeconds: 30,
      openDurationSeconds: 60,
      halfOpenProbeLimit: 1
    },
    now: () => new Date(nowRef.value)
  });

  return { store, breaker };
}

test("CLOSED->OPEN after threshold and OPEN rejects admission", async () => {
  const nowRef = { value: Date.now() };
  const { breaker } = createBreaker(nowRef);

  let admission = await breaker.evaluateAdmission();
  assert.equal(admission.allowed, true);
  await breaker.recordFailure({ admissionState: "CLOSED", reason: "transport_error" });

  admission = await breaker.evaluateAdmission();
  assert.equal(admission.allowed, true);
  await breaker.recordFailure({ admissionState: "CLOSED", reason: "timeout" });

  const rejected = await breaker.evaluateAdmission();
  assert.equal(rejected.allowed, false);
  if (!rejected.allowed) {
    assert.equal(rejected.state, "OPEN");
    assert.equal(rejected.reason, "breaker_open");
  }
});

test("OPEN->HALF_OPEN after duration and probe success closes breaker", async () => {
  const nowRef = { value: Date.now() };
  const { breaker } = createBreaker(nowRef);

  await breaker.recordFailure({ admissionState: "CLOSED", reason: "transport_error" });
  await breaker.recordFailure({ admissionState: "CLOSED", reason: "timeout" });

  nowRef.value += 61_000;
  const admission = await breaker.evaluateAdmission();
  assert.equal(admission.allowed, true);
  if (admission.allowed) {
    assert.equal(admission.state, "HALF_OPEN");
    await breaker.recordSuccess({ admissionState: admission.state });
  }

  const snapshot = await breaker.getSnapshot();
  assert.equal(snapshot.state, "CLOSED");
});

test("HALF_OPEN probe failure reopens and probe budget is enforced", async () => {
  const nowRef = { value: Date.now() };
  const { breaker } = createBreaker(nowRef);

  await breaker.recordFailure({ admissionState: "CLOSED", reason: "transport_error" });
  await breaker.recordFailure({ admissionState: "CLOSED", reason: "timeout" });

  nowRef.value += 61_000;
  const firstProbe = await breaker.evaluateAdmission();
  assert.equal(firstProbe.allowed, true);

  const secondProbe = await breaker.evaluateAdmission();
  assert.equal(secondProbe.allowed, false);
  if (!secondProbe.allowed) {
    assert.equal(secondProbe.reason, "probe_limit");
  }

  if (firstProbe.allowed) {
    await breaker.recordFailure({ admissionState: firstProbe.state, reason: "invalid_response" });
  }

  const snapshot = await breaker.getSnapshot();
  assert.equal(snapshot.state, "OPEN");
});

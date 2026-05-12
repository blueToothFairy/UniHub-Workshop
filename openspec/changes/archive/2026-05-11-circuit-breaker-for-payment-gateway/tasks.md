## 1. Breaker Configuration and State Infrastructure

- [x] 1.1 Add circuit-breaker environment settings (`failure_threshold`, `failure_window_seconds`, `open_duration_seconds`, `half_open_probe_limit`) and defaults in backend config/.env example (ref: design.md Decisions 1, 3; specs/payment-circuit-breaker/spec.md "Shared payment gateway circuit breaker state").
- [x] 1.2 Define TypeScript breaker contracts/enums/interfaces (`CircuitState`, transition context, admission result, metrics payload) before implementation (ref: design.md Decisions 1, 6; specs/payment-circuit-breaker/spec.md).
- [x] 1.3 Implement Redis-backed breaker state store and transition helper with TTL/counter handling (ref: design.md Decisions 1, 4; specs/payment-circuit-breaker/spec.md "Shared payment gateway circuit breaker state").
- [x] 1.4 Add unit tests for transition rules (`CLOSED->OPEN`, `OPEN->HALF_OPEN`, `HALF_OPEN->CLOSED/OPEN`) and probe-budget behavior (ref: specs/payment-circuit-breaker/spec.md "Probe-driven recovery and relapse").
- [x] 1.5 Manual smoke test: force synthetic failure outcomes and verify state transitions plus retry-after behavior from Redis state (ref: design.md Migration Plan step 7).

## 2. Paid Registration Admission and Provider Call Path

- [x] 2.1 Introduce a registration-service admission check that evaluates breaker state before provider session creation for paid flow (ref: design.md Decision 2; specs/payment-circuit-breaker/spec.md "Fail-fast admission control for paid registration").
- [x] 2.2 Implement fail-fast `503 PAYMENT_GATEWAY_UNAVAILABLE` response mapping with `retry_after` and stable body shape (ref: specs/payment-circuit-breaker/spec.md; specs/workshop-payment-momo-sandbox/spec.md modified order-creation requirement).
- [x] 2.3 Integrate provider outcome reporting (success/failure classification for timeout/transport/invalid response) into breaker counters and transitions (ref: design.md Decision 4; specs/payment-circuit-breaker/spec.md "Probe-driven recovery and relapse").
- [x] 2.4 Ensure idempotent replay semantics remain unchanged under breaker rejection and retry conditions (ref: specs/workshop-payment-momo-sandbox/spec.md "Retry with same idempotency key").
- [x] 2.5 Manual smoke test: simulate gateway outage and confirm paid registration fails fast without provider order creation attempts (ref: specs/workshop-payment-momo-sandbox/spec.md "Circuit breaker rejects provider session creation").

## 3. Half-Open Recovery Controls and UX Contract

- [x] 3.1 Implement half-open probe gating (limited concurrent probe allowance, reject excess with 503 contract) (ref: design.md Decision 3; specs/payment-circuit-breaker/spec.md "Fail-fast admission control for paid registration").
- [x] 3.2 Verify successful probe closes breaker and failed probe reopens breaker with updated retry-after metadata (ref: specs/payment-circuit-breaker/spec.md "Probe-driven recovery and relapse").
- [x] 3.3 Update frontend API typing/handling for paid-registration temporary unavailability payload and retry-after rendering path (ref: specs/workshop-payment-momo-sandbox/spec.md "Temporary gateway unavailability is surfaced").
- [x] 3.4 Manual smoke test: half-open transition under controlled recovery; validate frontend does not redirect and avoids duplicate submits during 503 windows (ref: design.md Migration Plan step 7; specs/workshop-payment-momo-sandbox/spec.md).

## 4. Reconciliation and Observability Alignment

- [x] 4.1 Extend reconciliation telemetry to capture unknown backlog growth, reconcile attempts, and breaker-open duration correlation (ref: specs/payment-reconciliation-and-recovery/spec.md "Degradation observability for recovery backlog"; design.md Decision 6).
- [x] 4.2 Add structured logs/metrics for every breaker transition and fail-fast admission event (ref: design.md Decision 6; specs/payment-circuit-breaker/spec.md).
- [x] 4.3 Ensure reconciliation endpoint retries remain idempotent and response contract unchanged (`{ scanned, updated }`) after breaker integration (ref: specs/payment-reconciliation-and-recovery/spec.md modified reconciliation requirement).
- [x] 4.4 Manual smoke test: run reconcile/expire jobs during and after outage simulation to confirm deterministic convergence and telemetry completeness (ref: specs/payment-reconciliation-and-recovery/spec.md).

## 5. Quality Gates and Rollout Readiness

- [x] 5.1 Add integration tests for paid registration 201 vs 503 behavior, including response-body shape and no-provider-call assertions when rejected (ref: specs/payment-circuit-breaker/spec.md; specs/workshop-payment-momo-sandbox/spec.md).
- [x] 5.2 Add performance-focused test scenario proving fail-fast behavior meets p95 < 200 ms target after breaker opens (ref: proposal.md Success Criteria).
- [x] 5.3 Add regression tests confirming free registration and workshop read endpoints remain unaffected during payment outage simulation (ref: proposal.md Success Criteria; design.md Goals).
- [x] 5.4 Prepare rollout notes with config toggles, alert thresholds, and rollback instructions for disabling breaker enforcement (ref: design.md Migration Plan).
- [x] 5.5 Final manual smoke test: end-to-end outage -> open -> half-open -> closed lifecycle with operational dashboard verification (ref: proposal.md Success Criteria; design.md Migration Plan).

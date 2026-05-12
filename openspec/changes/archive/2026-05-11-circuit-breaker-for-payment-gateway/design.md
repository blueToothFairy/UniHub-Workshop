## Context

The paid workshop flow currently creates a pending registration and then calls the payment provider. When provider calls are unstable, requests may degrade into repeated unknown states and slower response behavior, while non-payment features still need to remain responsive. The current architecture already uses Redis/Upstash and includes reconciliation/expiry jobs, so the change should introduce resilience without adding new infrastructure or breaking existing registration invariants.

Stakeholders:
- Students: need fast, predictable feedback when payment is temporarily unavailable.
- Organizers/support: need fewer ambiguous payment incidents and clear operational signals.
- Backend team: needs bounded failure domains and low-cost deployment on current free-tier constraints.

Constraints:
- Modular monolith with strict module boundaries.
- Existing registration/payment state machine and seat invariants MUST remain safe.
- Upstash command budget should not be exceeded by noisy breaker updates.

## Goals / Non-Goals

**Goals:**
- Protect paid registration flow from cascading gateway failures via circuit-breaker control.
- Enforce fail-fast behavior when gateway availability is already known to be degraded.
- Preserve seat correctness and idempotency semantics under failure/retry pressure.
- Keep free registration and non-payment workshop APIs unaffected during payment outages.
- Provide observable breaker state transitions and degradation metrics for alerting.

**Non-Goals:**
- Multi-provider failover orchestration.
- Refund/dispute lifecycle changes.
- Mobile app feature expansion.
- New paid-registration UX beyond temporary-unavailable contract updates.

## Decisions

1. Use a shared Redis-backed circuit breaker with three states: `CLOSED`, `OPEN`, `HALF_OPEN`.
- Decision: Store breaker state and rolling counters in Upstash keys with TTL.
- Why: Multiple backend instances must observe one consistent state; process-local memory would diverge.
- Alternative considered: in-memory breaker per instance.
  - Rejected because independent states would over-probe and under-protect during partial outages.

2. Evaluate breaker before gateway call initiation for paid registration session creation.
- Decision: For `OPEN`, return HTTP `503` with `{ error, message, retry_after }` immediately and skip provider call.
- Why: Prevent thread/connection pressure and reduce useless pending payment creation during known outages.
- Alternative considered: always reserve seat then attempt provider call.
  - Rejected because it can accumulate stranded pending reservations while provider is down.

3. Keep reservation-first behavior only for `CLOSED` and permitted `HALF_OPEN` probe requests.
- Decision: In `HALF_OPEN`, allow a small probe budget (default 1 concurrent probe) and reject excess with the same 503 contract.
- Why: Recovery should be gradual, not flood-based.
- Alternative considered: reopen full traffic immediately after open duration elapses.
  - Rejected because it risks immediate relapse under unstable provider recovery.

4. Classify provider-call outcomes into breaker signals with deterministic mapping.
- Decision: Timeouts, transport/network errors, and unknown/invalid provider responses count as failures; successful order creation with valid payment URL counts as success.
- Why: Breaker should react to user-impacting availability failures, not only explicit provider error codes.
- Alternative considered: count only explicit provider error responses.
  - Rejected because transport failures are common outage indicators and must influence state.

5. Preserve existing reconciliation and expiry mechanisms as downstream correctness guardrails.
- Decision: Breaker manages admission to provider calls; reconciliation/expiry still resolve legacy `pending_provider`/`unknown` states.
- Why: Avoid high-risk redesign of settled recovery logic while improving front-door resilience.
- Alternative considered: add new compensating data model for breaker-induced failures.
  - Rejected because current model can represent outcomes with lower migration risk.

6. Add explicit observability contract for breaker transitions and degradation windows.
- Decision: Emit state-change logs and metrics counters/gauges for fail-fast responses, open durations, and unknown-payment counts.
- Why: Operational confidence requires visibility, not just behavior.
- Alternative considered: rely on existing generic error logs.
  - Rejected because they cannot reliably reconstruct breaker lifecycle or SLA impact.

## Risks / Trade-offs

- [Risk] Redis/Upstash unavailability can disable breaker coordination. -> Mitigation: define safe fallback policy (treat as degraded and fail fast for paid path, with explicit logging).
- [Risk] Too-aggressive thresholds can deny legitimate traffic. -> Mitigation: configurable thresholds with conservative defaults and staged rollout tuning.
- [Risk] Too-lenient thresholds can delay protection. -> Mitigation: alert on high unknown-payment growth and adjust failure window/threshold from runtime config.
- [Risk] Additional Redis commands may approach free-tier limits. -> Mitigation: compact key design, TTL usage, and one write per gateway attempt outcome.
- [Risk] Behavioral drift between simulation mode and provider mode. -> Mitigation: gate breaker logic to provider-backed payment mode only and keep simulation contract unchanged.

## Migration Plan

1. Introduce breaker configuration variables and defaults in backend environment templates.
2. Implement breaker state storage and transition helper with unit tests.
3. Integrate pre-call breaker check into paid registration create-order path.
4. Integrate outcome reporting (success/failure) into provider call result handling.
5. Add 503 temporary-unavailable response mapping and `retry_after` contract.
6. Add metrics/logging instrumentation and dashboard/alert updates.
7. Run outage simulation tests (forced provider failures) and verify p95 fail-fast behavior.
8. Roll out behind feature flag/config toggle; monitor unknown-payment and open-duration metrics.

Rollback strategy:
- Disable breaker enforcement via config toggle and revert to existing gateway call behavior while preserving non-breaking code paths.

## Open Questions

- Should the safe fallback when Redis is unreachable be strict fail-fast or limited pass-through with higher risk?
- What initial values should production use for failure threshold/window/open duration beyond current baseline defaults?
- Do we expose breaker state in any internal health/admin endpoint, or keep it metrics-only?
- Should frontend receive a localized user-facing message from backend, or only stable error codes plus retry metadata?

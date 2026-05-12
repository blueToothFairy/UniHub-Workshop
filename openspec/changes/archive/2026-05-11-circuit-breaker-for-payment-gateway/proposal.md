## Why

Payment gateway instability can currently cascade into slow or uncertain paid-registration outcomes, so we need a circuit-breaker layer now to protect core registration throughput and keep non-payment workshop features responsive during gateway incidents.

## What Changes

- Add gateway circuit-breaker behavior (Closed/Open/Half-Open) for paid registration payment session creation.
- Add fail-fast paid registration behavior when breaker is Open, returning HTTP `503` with `retry_after` instead of attempting gateway calls.
- Add Half-Open probe gating to allow only limited trial calls before fully reopening traffic.
- Add resilient fallback classification for gateway call failures (`timeout`, transport error, unknown provider result) and feed breaker counters consistently.
- Add operational observability: breaker state-change logs, metrics, and alertable counters for Open duration and unknown-payment growth.
- Add configuration knobs for threshold/window/open duration/probe limits with safe defaults aligned to existing platform limits.
- Align frontend-facing paid registration error contract for temporary payment unavailability while keeping free registration and read APIs available.

## Capabilities

### New Capabilities
- `payment-circuit-breaker`: Circuit-breaker state machine and fail-fast policy for payment gateway interaction in paid workshop registration.

### Modified Capabilities
- `workshop-payment-momo-sandbox`: Paid registration behavior changes to return temporary-unavailable responses during breaker Open/Half-Open gating and to use breaker-protected gateway invocation paths.
- `payment-reconciliation-and-recovery`: Recovery and monitoring requirements are extended to track breaker-induced unknown states and prolonged degradation windows.

## Impact

- Backend:
  - Registration and payment modules (gateway invocation path, error mapping, breaker checks, config wiring).
  - Shared infra cache layer (state/counters persistence for breaker coordination).
  - Metrics/logging integration for state transitions and resilience KPIs.
- APIs:
  - `POST /registrations` (paid flow only) may return `503 PAYMENT_GATEWAY_UNAVAILABLE` with `retry_after`.
  - Existing callback/reconciliation endpoints remain but include breaker-aware observability expectations.
- Data/operations:
  - No mandatory schema change expected for breaker state itself (stored in cache), but dashboards/alerts gain new signals.
- Dependencies/cost:
  - Reuses existing Redis/Upstash footprint; no new infrastructure service is introduced and no expected monthly cost increase.

## Out of Scope

- Multi-gateway routing or active-active provider failover.
- Refund/dispute workflows.
- Replacing current payment provider adapter contract.
- Mobile app UX changes.

## Success Criteria

- During simulated gateway outage, paid registration requests fail fast with p95 response time < 200 ms after breaker opens.
- Non-payment workshop endpoints (e.g., workshop detail/read) maintain normal availability during gateway outage windows.
- Breaker transitions are fully observable (Closed->Open->Half-Open->Closed/Open) with auditable logs and counters.
- After gateway recovery, breaker returns to Closed via controlled probe path without oversubscription spikes.

## Context

UniHub currently runs paid registration with a simulation payment action. That has been useful for validating seat reservation and idempotency, but it does not exercise real provider concerns: hosted checkout redirect, callback authenticity, duplicate callback handling, and provider-side timeout/retry semantics.

This change introduces MoMo sandbox integration for paid workshop flows while preserving existing domain correctness rules in registration and workshop counters. It is cross-cutting across backend payment orchestration, registration state transitions, frontend checkout UX, and observability/recovery jobs.

## Goals / Non-Goals

**Goals:**
- Replace paid simulation action with MoMo sandbox payment flow for students.
- Preserve invariants: no oversell, idempotent registration/payment transitions, and deterministic QR issuance after confirmation.
- Implement secure callback processing with signature verification and strict payload validation.
- Provide robust recovery for unknown/pending states with reconciliation and expiry behavior.
- Keep API contracts understandable for frontend redirect-and-return UX.

**Non-Goals:**
- Production merchant hardening beyond sandbox credentials and endpoints.
- Multi-gateway orchestration (routing by provider) in this change.
- Refund, chargeback, or dispute automation.
- Mobile checkout support.

## Decisions

1. Keep unified registration state machine and swap only paid execution path.
- Decision: free workshop path remains immediate confirmation; paid path transitions to provider-driven states with MoMo order creation + callback/reconciliation.
- Why: limits blast radius and preserves established domain model.
- Alternative considered: split paid and free into separate APIs. Rejected due to duplicated idempotency/state logic.

2. Introduce MoMo adapter behind payment service interface.
- Decision: implement a provider adapter (`momo.adapter`) with methods for create order, query transaction status, and signature verification.
- Why: isolates provider protocol and keeps registration/payment services focused.
- Alternative considered: embed HTTP/signature logic directly in registration service. Rejected for SRP and testability.

3. Treat callback as synchronous correctness path with idempotent terminal checks.
- Decision: callback verifies signature + order + amount, locks payment/registration rows, applies transition once, returns `200` for duplicates.
- Why: avoids duplicate side effects and aligns with eventual production behavior.
- Alternative considered: async callback ingestion queue first. Rejected because payment correctness would be delayed and more complex.

4. Explicit unknown/recovery handling remains mandatory.
- Decision: when create-order response is uncertain/timeouts occur, mark payment `unknown` (or equivalent pending-unconfirmed state), retain reservation, and rely on reconciliation + expiry jobs.
- Why: avoids accidental seat release after possible successful charge.
- Alternative considered: immediate cancellation on timeout. Rejected due to risk of paid-but-unconfirmed mismatch.

5. Frontend flow becomes redirect-return + status polling, no simulation CTA.
- Decision: frontend uses payment URL from backend and on return relies on status endpoint to render final outcome.
- Why: closest behavior to production user experience and callback timing realities.

## Risks / Trade-offs

- [Risk] Provider sandbox instability can create flaky tests and uncertain statuses. -> Mitigation: deterministic test doubles for unit tests + reconciliation path coverage in integration tests.
- [Risk] Signature verification bugs can reject valid payments or accept forged callbacks. -> Mitigation: canonical signing utility, provider fixture tests, strict replay/order/amount checks.
- [Risk] Increased operational complexity vs simulation flow. -> Mitigation: explicit metrics, dead-letter/retry visibility, and runbook for pending/unknown states.
- [Risk] MoMo-specific fields may require schema expansion and migration ordering care. -> Mitigation: additive migrations only, backward-compatible readers, staged rollout.
- [Risk] Potential external API usage cost/limits if over-polled. -> Mitigation: poll backoff, bounded reconciliation batches, cache latest status per payment.

## Migration Plan

1. Add additive migration(s) for MoMo provider fields and callback audit metadata on payments.
2. Implement MoMo adapter + payment service integration behind feature flag/config toggle.
3. Replace simulation endpoint usage in frontend with redirect-based MoMo checkout flow.
4. Enable callback endpoint with signature verification and idempotent transition guards.
5. Enable reconciliation/expiry scheduling for pending/unknown payments.
6. Run sandbox smoke scenarios: success, failed, duplicate callback, timeout/unknown, late callback.
7. Decommission simulation CTA path after verification period.

Rollback strategy:
- Toggle back to simulation mode using config flag while keeping additive schema changes in place.
- Preserve in-flight payments by keeping status endpoint and reconciliation operational during rollback window.

## Open Questions

- Should we support dual mode (simulation + MoMo sandbox) concurrently by environment flag during transition?
- What exact status mapping from MoMo response codes to internal statuses should be standardized?
- Do we require callback source IP validation in addition to signature verification for sandbox?
- Should late success after reservation expiry route to `requires_review` immediately, or auto-attempt seat reclaim if capacity remains?

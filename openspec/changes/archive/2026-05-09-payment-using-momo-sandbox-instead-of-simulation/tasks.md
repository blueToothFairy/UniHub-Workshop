## 1. Schema and migration updates for MoMo sandbox

- [x] 1.1 Add additive migration to evolve `payments` schema with MoMo-specific provider fields (order id mapping, redirect URL fields, callback metadata, provider status code/message) (spec: workshop-payment-momo-sandbox; design: Decisions 2/4).
- [x] 1.2 Add migration constraints/indexes for idempotent callback correlation (e.g., unique provider transaction id when present) while preserving existing idempotency keys (spec: payment-gateway-security; design: Decisions 2/3).
- [x] 1.3 Add migration-safe defaults/backfill for existing simulation-origin rows so readers remain backward compatible during rollout (design: Migration Plan step 1).
- [x] 1.4 Document migration order and rollback compatibility notes for Supabase direct migration path (design: Migration Plan, rollback strategy).
- [ ] 1.5 Manual smoke test: run migrations in sandbox database and verify schema + constraints + backward compatibility queries.

## 2. Payment domain interfaces and MoMo adapter scaffolding

- [x] 2.1 Define TypeScript payment contracts/enums for MoMo create-order, callback payload, status-query, and internal status mapping before service implementation (spec: workshop-payment-momo-sandbox + payment-gateway-security).
- [x] 2.2 Create `momo.adapter` interface/implementation skeleton with methods for order creation, callback signature verification, and transaction query (design: Decision 2).
- [x] 2.3 Wire adapter dependencies via constructor injection/config (sandbox endpoint, keys, partner code) without hardcoded secrets (design: Context constraints).
- [x] 2.4 Add unit tests for adapter signature canonicalization and status mapping fixtures using provider samples (spec: payment-gateway-security).
- [ ] 2.5 Manual smoke test: call MoMo sandbox create-order/query endpoint via adapter in isolation and validate typed responses.

## 3. Paid registration flow: create order and redirect path

- [x] 3.1 Replace simulation paid-init path with MoMo create-order call while preserving free workshop immediate-confirm flow unchanged (spec: workshop-payment-momo-sandbox; design: Decision 1).
- [x] 3.2 Persist provider order correlation fields and return `payment_url` + pending payment state to frontend (spec: workshop-payment-momo-sandbox order creation requirement).
- [x] 3.3 Preserve registration idempotency semantics for repeated `POST /registrations` with same `Idempotency-Key` (spec: workshop-payment-momo-sandbox idempotency scenario).
- [x] 3.4 Implement timeout/uncertain create-order handling that marks pending/unknown state without releasing reserved seat immediately (spec: payment-reconciliation-and-recovery; design: Decision 4).
- [ ] 3.5 Manual smoke test: paid registration returns MoMo checkout URL and duplicate request replays original result.

## 4. Callback security and synchronous correctness

- [x] 4.1 Add MoMo callback endpoint in payment/registration router and enforce signature verification before state mutation (spec: payment-gateway-security invalid signature scenario).
- [x] 4.2 Validate callback order identity + amount/currency against persisted payment record and return explicit error contracts on mismatch (spec: payment-gateway-security payload validation scenarios).
- [x] 4.3 Implement transactional state transitions with row locks for success/failure callback outcomes and seat counter side-effects exactly once (spec: workshop-payment-momo-sandbox callback requirements; design: Decision 3).
- [x] 4.4 Implement callback idempotent terminal handling for replayed success/failure events with HTTP `200` no-op behavior (spec: payment-gateway-security callback idempotency).
- [ ] 4.5 Manual smoke test: sandbox callback success/failure/replay cases with verified DB state invariants.

## 5. Reconciliation, expiry, and late-success handling

- [x] 5.1 Implement reconciliation job querying MoMo for non-terminal payments and converging to terminal states (spec: payment-reconciliation-and-recovery unknown convergence).
- [x] 5.2 Implement reservation expiry handling for stale pending paid registrations with exactly-once seat release (spec: payment-reconciliation-and-recovery reservation expiry).
- [x] 5.3 Implement late-success policy after expiry/cancelled state to route to review-safe path without auto-confirm (spec: payment-reconciliation-and-recovery late success scenario).
- [x] 5.4 Ensure reconciliation/expiry retries are idempotent and safe under repeated execution (spec: payment-reconciliation-and-recovery idempotent recovery).
- [ ] 5.5 Manual smoke test: forced timeout/unknown + expiry + late callback sequences.

## 6. Frontend checkout UX migration to MoMo redirect

- [x] 6.1 Remove simulation CTA dependency from student workshop detail and integrate provider redirect flow from `payment_url` response (spec: workshop-payment-momo-sandbox redirect UX).
- [x] 6.2 Implement return-path/status polling UX for pending callback processing states and clear success/failure rendering (spec: workshop-payment-momo-sandbox return-before-finalization scenario).
- [x] 6.3 Update workshop-summary-read driven CTA behavior so full workshops never expose redirect action (spec: modified workshop-summary-read scenarios).
- [ ] 6.4 Manual smoke test: student journey register paid -> redirect MoMo sandbox -> return -> final status view.

## 7. Confirmation events, observability, and release hardening

- [x] 7.1 Keep/extend post-commit `RegistrationConfirmed` emission contract for paid confirmation path and ensure dedupe by registration id (spec: workshop-payment-momo-sandbox + payment-gateway-security offline consumer scenario).
- [x] 7.2 Add integration tests for callback error shapes (invalid signature, amount mismatch, not found), idempotent replay behavior, and status endpoint consistency (spec: payment-gateway-security + workshop-payment-momo-sandbox).
- [x] 7.3 Add concurrency and correctness tests verifying no oversell and invariant preservation under paid-flow contention (design: Decision 1/4).
- [x] 7.4 Add rollout notes with sandbox-only scope, feature toggle strategy, and rollback to simulation mode path (design: Migration Plan rollback strategy).
- [ ] 7.5 Final manual smoke test: end-to-end free + paid(MoMo sandbox) flows including callback, reconciliation edge, QR issuance, and event delivery.

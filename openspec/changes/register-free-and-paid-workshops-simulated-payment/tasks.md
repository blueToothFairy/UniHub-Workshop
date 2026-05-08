## 1. Schema and migration groundwork

- [x] 1.1 Add migration for `registrations` table with state fields, expiry timestamps, and active-registration uniqueness by `(user_id, workshop_id)` (spec: workshop-registration; design: Decisions 1/2).
- [x] 1.2 Add migration for `payments` table with simulation-compatible statuses and idempotency fields (spec: workshop-payment-simulation; design: Decisions 3/4).
- [x] 1.3 Add migration to introduce `reserved_count` and `confirmed_count` with invariant checks and backfill from existing confirmed registrations (spec: workshop-registration seat correctness; design: Decisions 2).
- [x] 1.4 Validate migration order and rollback notes for Supabase migration workflow (design: Migration Plan).
- [ ] 1.5 Manual smoke test: run migrations and verify constraints/indexes and backfill correctness.

## 2. Registration API scaffolding and contracts

- [x] 2.1 Define TypeScript contracts/enums in `registration.types.ts` for unified free/paid registration responses and error shapes before service logic (spec: workshop-registration; rule: types first).
- [x] 2.2 Implement `registration.router.ts` with `POST /registrations` and `GET /registrations/:id/payment-status` wiring, auth, and role checks (spec: workshop-registration + workshop-payment-simulation).
- [x] 2.3 Implement `registration.service.ts` skeleton with DI boundaries for DB/cache/queue and payment simulation interface, preserving SRP per module (design: Context/Decisions).
- [ ] 2.4 Manual smoke test: verify endpoint auth/error behavior and response contract shape.

## 3. Unified registration flow implementation

- [x] 3.1 Implement atomic seat reservation guard and full-workshop rejection path using PostgreSQL conditional updates (spec: workshop-registration seat correctness).
- [x] 3.2 Implement free workshop path with same-transaction confirmation + QR issuance (spec: workshop-registration free success scenario).
- [x] 3.3 Implement paid workshop path creating `pending_payment` + `pending_simulation` status with `next_action=simulate_payment` (spec: workshop-registration paid pending scenario).
- [x] 3.4 Implement registration idempotency via `Idempotency-Key` replay semantics and conflict on key/body mismatch (spec: workshop-registration idempotency).
- [ ] 3.5 Manual smoke test: free registration success, paid pending creation, duplicate/idempotent retry handling.

## 4. Simulation payment action and status progression

- [x] 4.1 Define simulation payment contracts in `payment.types.ts` including success/conflict responses and idempotent behavior (spec: workshop-payment-simulation; rule: types first).
- [x] 4.2 Implement `POST /registrations/:id/simulate-payment` ownership/state checks and transactional pending->completed->confirmed transition (spec: workshop-payment-simulation simulate action).
- [x] 4.3 Implement idempotent no-op behavior for duplicate simulation requests on already confirmed registrations (spec: workshop-payment-simulation idempotency).
- [x] 4.4 Implement `GET /registrations/:id/payment-status` responses for pre/post simulation states (spec: workshop-payment-simulation status query).
- [x] 4.5 Ensure no real gateway API calls or callback dependency in runtime path (spec: workshop-payment-simulation no external gateway requirement).
- [ ] 4.6 Manual smoke test: pending -> simulate confirm -> status poll flow, plus invalid-state and duplicate simulation requests.

## 5. Confirmation events and notifications

- [x] 5.1 Implement post-commit `RegistrationConfirmed` emission for free and simulated-paid confirmations (spec: registration-confirmation-events contract; design: Decision 5).
- [x] 5.2 Add dedupe guard to ensure at-most-once event publication per registration id (spec: registration-confirmation-events idempotency).
- [ ] 5.3 Update notification consumer behavior to stay idempotent on duplicate/replayed messages (spec: registration-confirmation-events).
- [ ] 5.4 Manual smoke test: verify exactly one confirmation event/notification per confirmed registration in both free and simulated-paid paths.

## 6. Workshop read and frontend simulation UX alignment

- [x] 6.1 Update workshop read DTO/service to expose `reserved_count`, `confirmed_count`, `available_seats`, and `payment_required` while keeping existing summary processing behavior (spec: modified workshop-summary-read).
- [x] 6.2 Update frontend registration UX for paid workshops to show `Click to pay (Simulation)` action after pending registration and consume `next_action`/status fields (spec: workshop-payment-simulation + workshop-summary-read).
- [ ] 6.3 Validate disabled CTA behavior for full workshops and payment-required workshops with no seats (spec: workshop-summary-read added scenarios).
- [ ] 6.4 Manual smoke test: student journey from workshop detail -> register -> simulate pay -> confirmed state and QR availability.

## 7. Quality gates and release readiness

- [ ] 7.1 Add unit tests for seat invariants, registration idempotency, and simulation transition guards (spec: workshop-registration + workshop-payment-simulation).
- [ ] 7.2 Add integration tests for API status/error body contracts (including 409 conflict cases) and online/offline behavior assumptions (specs error/idempotency scenarios).
- [ ] 7.3 Add concurrency test (>=100 parallel requests) confirming no oversell and invariant preservation (spec: workshop-registration seat correctness).
- [x] 7.4 Add rollout notes documenting simulation-only scope and explicit exclusion of real gateway integration in this change (proposal/design alignment).
- [ ] 7.5 Final manual smoke test: end-to-end free + paid(simulation) registration flows with event/notification validation.

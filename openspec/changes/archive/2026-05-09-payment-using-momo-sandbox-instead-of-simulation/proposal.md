## Why

Paid workshop checkout currently depends on a simulation button, which is not sufficient for validating real payment-provider behavior such as redirect flow, signature verification, callback retries, and reconciliation.

Switching to MoMo sandbox now lets the team de-risk production payment integration early while keeping seat correctness and idempotency guarantees already introduced in registration flows.

## What Changes

- Replace paid workshop simulation payment path with MoMo sandbox checkout flow for student registrations.
- Add MoMo order creation, redirect URL handling, callback/IPN verification, and transaction status query integration.
- Keep existing registration and seat-reservation invariants (`reserved_count`, `confirmed_count`, idempotency) as non-negotiable correctness constraints.
- Add payment-state convergence for timeout/unknown scenarios via reconciliation and expiry handling.
- Preserve post-confirmation behavior: generate QR and emit deduplicated `RegistrationConfirmed` event after DB commit.
- Update frontend paid registration UX from `Click to pay (Simulation)` to redirect-based MoMo sandbox payment flow.

## Capabilities

### New Capabilities
- `workshop-payment-momo-sandbox`: MoMo sandbox payment orchestration for paid workshop registrations, including create order, callback verification, retries, and reconciliation-safe status transitions.
- `payment-gateway-security`: Signature verification, callback authenticity checks, and payload validation requirements for payment callbacks.
- `payment-reconciliation-and-recovery`: Recovery rules for pending/unknown MoMo payments, reservation expiry, and manual-review edge cases.

### Modified Capabilities
- `workshop-summary-read`: Extend student workshop read/UX contract guidance to align registration CTA and payment-status presentation with MoMo redirect flow instead of simulation CTA.

## Impact

- Backend:
  - Registration module: replace simulation transition action with gateway-driven paid flow handling.
  - Payment module: add MoMo sandbox adapter/service, callback endpoint(s), status query integration, and reconciliation job logic.
  - Security/error handling: callback signature validation, idempotent terminal-state handling, and strict amount/order checks.
- Frontend:
  - Paid workshop registration UX moves from inline simulation action to redirect-and-return/payment-status flow.
  - Student workshop detail and status polling paths update to display MoMo in-progress, success, and failure outcomes.
- Database:
  - Payment schema may require additional provider fields (e.g., MoMo transaction id, request/response payload metadata, callback audit fields) while preserving existing invariants.
- Dependencies/cost:
  - Adds external dependency on MoMo sandbox endpoints during development.
  - No mandatory new paid infrastructure services expected; monitor API call volume for operational limits.

## Out of Scope

- Production MoMo go-live credentials and merchant compliance hardening beyond sandbox scope.
- Multi-gateway routing/abstraction for Stripe/VNPay/others in this same change.
- Refund/dispute automation and financial reporting UI.
- Student mobile checkout implementation.

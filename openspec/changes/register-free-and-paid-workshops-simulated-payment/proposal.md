## Why

The product needs a registration experience for both free and paid workshops now, but integrating a real payment gateway in this phase would add avoidable delivery risk and external dependency instability.

A simulated paid flow preserves seat/idempotency correctness and lets frontend/backend teams ship and validate registration behavior before real gateway rollout.

## What Changes

- Add unified registration for free and paid workshops via one student flow and one backend entrypoint.
- For paid workshops, replace real gateway integration with a simulation step (`Click to pay (Simulation)`) that mimics pending-to-confirmed transitions.
- Keep seat-reservation correctness, duplicate prevention, and idempotency behavior equivalent to the future real-payment architecture.
- Add simulated payment status endpoint behavior for polling/recovery flows.
- Add confirmation event emission and QR issuance after successful simulated payment confirmation.
- Add automated tests for concurrency, idempotency, and simulated payment transitions.

## Capabilities

### New Capabilities
- `workshop-registration`: Unified student registration flow for free and paid workshops with strong seat correctness and idempotency.
- `workshop-payment-simulation`: Deterministic paid-workshop simulation flow replacing external gateway call with explicit user-triggered simulated payment confirmation.
- `registration-confirmation-events`: Post-confirmation event contract and idempotent downstream notification behavior.

### Modified Capabilities
- `workshop-summary-read`: Extend workshop read contract with registration-facing fields (available/reserved/confirmed/payment-required) used by student registration UI.

## Impact

- Backend:
  - New/expanded `registration` module and a simulation-focused payment module path (no VNPay adapter calls in this change).
  - New endpoints: `POST /registrations`, `GET /registrations/:id/payment-status`, and simulation action endpoint (e.g. `POST /registrations/:id/simulate-payment`).
  - Notification/event integration for confirmed registrations.
- Frontend:
  - Paid workshop registration UI includes explicit simulation CTA/button: `Click to pay (Simulation)`.
  - Polling/status UX for simulated pending-to-confirmed transitions.
- Database:
  - Registration/payment state tables and constraints to preserve correctness and future gateway-compatibility.
- Dependencies/cost:
  - No new monthly infrastructure cost.
  - No external payment gateway dependency in this phase.

## Out of Scope

- Real VNPay/API integration, callback verification, and gateway reconciliation with external provider.
- Production refund/dispute workflows.
- Multi-gateway support.
- Student mobile registration flow.

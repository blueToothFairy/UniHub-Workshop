## ADDED Requirements

### Requirement: MoMo sandbox order creation for paid workshop registration
The system MUST create a MoMo sandbox order for paid workshop registrations and return checkout redirection data.

#### Scenario: Paid registration creates MoMo order successfully
- **WHEN** student registers for a paid published workshop with valid `Idempotency-Key`
- **THEN** API MUST return HTTP `201` with body including `registration_id`, `payment_id`, `payment_status`, and `payment_url` for MoMo checkout

#### Scenario: Retry with same idempotency key
- **WHEN** student retries paid registration request with same `Idempotency-Key` and same request payload
- **THEN** API MUST be idempotent, MUST NOT create a second payment record, and MUST return the original checkout/payment state

### Requirement: MoMo callback updates payment and registration states
The system MUST process MoMo callback synchronously and transition payment/registration states exactly once.

#### Scenario: Valid success callback confirms registration
- **WHEN** a valid MoMo success callback is received for a pending paid registration
- **THEN** API MUST return HTTP `200`, set payment to completed, set registration to confirmed, and trigger QR issuance

#### Scenario: Valid failure callback cancels pending registration
- **WHEN** a valid MoMo failure callback is received for a pending paid registration
- **THEN** API MUST return HTTP `200`, set payment to failed, set registration to cancelled/failed terminal policy, and release reserved seat exactly once

### Requirement: Frontend uses redirect-return payment UX
The paid checkout UX MUST use provider redirect flow instead of local simulation action.

#### Scenario: Student initiates paid checkout
- **WHEN** frontend receives `payment_url` from paid registration API
- **THEN** frontend MUST redirect student to MoMo sandbox checkout page and later restore state through status endpoint

#### Scenario: Student returns before callback is fully processed
- **WHEN** student returns to app and payment callback has not finalized
- **THEN** frontend MUST query payment-status endpoint and render pending/unknown state with retry guidance

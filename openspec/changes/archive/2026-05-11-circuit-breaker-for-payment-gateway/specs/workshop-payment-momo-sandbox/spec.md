## MODIFIED Requirements

### Requirement: MoMo sandbox order creation for paid workshop registration
The system MUST create a MoMo sandbox order for paid workshop registrations only when circuit-breaker admission allows provider calls, and MUST preserve idempotent response semantics for retries.
Reference: Architecture decision in project context "Circuit Breaker for Momo: 3 states with Redis-backed state and TTL".

#### Scenario: Paid registration creates MoMo order successfully
- **GIVEN** student is online, workshop is paid and published, breaker admission allows provider call, and request has valid `Idempotency-Key`
- **WHEN** student registers for the workshop
- **THEN** API MUST return HTTP `201` with body including `registration_id`, `payment_id`, `payment_status`, and `payment_url` for MoMo checkout

#### Scenario: Retry with same idempotency key
- **GIVEN** student is online and a prior paid registration request with the same `Idempotency-Key` and payload already produced a logical result
- **WHEN** student retries the same request
- **THEN** API MUST be idempotent, MUST NOT create a second payment record, and MUST return the original checkout/payment state

#### Scenario: Circuit breaker rejects provider session creation
- **GIVEN** student is online and breaker state disallows provider admission for paid registration
- **WHEN** student submits paid registration request
- **THEN** API MUST return HTTP `503` with body `{ "error": "PAYMENT_GATEWAY_UNAVAILABLE", "message": string, "retry_after": number }` and MUST NOT create a new provider order request

### Requirement: Frontend uses redirect-return payment UX
The paid checkout UX MUST use provider redirect flow when a payment URL is available and MUST render temporary-unavailable guidance when breaker admission blocks provider session creation.

#### Scenario: Student initiates paid checkout
- **GIVEN** student is online and frontend receives `payment_url` from paid registration API
- **WHEN** checkout starts
- **THEN** frontend MUST redirect student to MoMo sandbox checkout page and later restore state through status endpoint

#### Scenario: Student returns before callback is fully processed
- **GIVEN** student is online, returns to app, and payment callback has not finalized
- **WHEN** frontend queries payment-status endpoint
- **THEN** frontend MUST render pending/unknown state with retry guidance based on response contract

#### Scenario: Temporary gateway unavailability is surfaced
- **GIVEN** student is online and backend responds with temporary gateway unavailability
- **WHEN** frontend receives HTTP `503` body `{ "error": "PAYMENT_GATEWAY_UNAVAILABLE", "message": string, "retry_after": number }`
- **THEN** frontend MUST avoid redirect flow and MUST show a retry-after experience without creating duplicate paid registration submissions

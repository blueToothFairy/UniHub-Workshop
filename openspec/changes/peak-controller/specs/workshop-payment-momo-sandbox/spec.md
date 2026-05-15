## MODIFIED Requirements

### Requirement: MoMo sandbox order creation for paid workshop registration
The system MUST create a MoMo sandbox order for paid workshop registrations only when circuit-breaker admission allows provider calls, and during configured peak windows MUST also require valid registration admission before provider order creation.  
Reference: Architecture decision in project context "Circuit Breaker for Momo: 3 states with Redis-backed state and TTL" and ADR-PC-001/ADR-PC-003 in `openspec/changes/peak-controller/design.md`.

#### Scenario: Paid registration creates MoMo order successfully with peak admission
- **GIVEN** student is online, workshop is paid and published, breaker admission allows provider call, request has valid `Idempotency-Key`, and peak admission requirements (if enabled) are satisfied
- **WHEN** student registers for the workshop
- **THEN** API MUST return HTTP `201` with body including `registration_id`, `payment_id`, `payment_status`, and `payment_url` for MoMo checkout

#### Scenario: Retry with same idempotency key
- **GIVEN** student is online and a prior paid registration request with the same `Idempotency-Key` and payload already produced a logical result
- **WHEN** student retries the same request
- **THEN** API MUST be idempotent, MUST NOT create a second payment record, and MUST return the original checkout/payment state

#### Scenario: Admission token missing in peak mode
- **GIVEN** student is online, workshop is in configured peak mode, and request omits required admission token
- **WHEN** student submits paid registration request
- **THEN** API MUST return HTTP `403` with body shape `{ "error": { "code": "ADMISSION_TOKEN_REQUIRED", "message": string } }`

#### Scenario: Registration write is globally busy
- **GIVEN** student is online, request is otherwise valid, and global peak write protection is active
- **WHEN** student submits paid registration request
- **THEN** API MUST return HTTP `503` with body `{ "error": "REGISTRATION_BUSY", "message": string, "retry_after": number }` and MUST NOT create a new provider order request

#### Scenario: Circuit breaker rejects provider session creation
- **GIVEN** student is online and breaker state disallows provider admission for paid registration
- **WHEN** student submits paid registration request
- **THEN** API MUST return HTTP `503` with body `{ "error": "PAYMENT_GATEWAY_UNAVAILABLE", "message": string, "retry_after": number }` and MUST NOT create a new provider order request

### Requirement: Frontend uses redirect-return payment UX
The paid checkout UX MUST use provider redirect flow when a payment URL is available, MUST render temporary-unavailable guidance when breaker admission blocks provider session creation, and MUST honor peak-controller waiting/busy contracts.

#### Scenario: Student initiates paid checkout
- **GIVEN** student is online and frontend receives `payment_url` from paid registration API
- **WHEN** checkout starts
- **THEN** frontend MUST redirect student to MoMo sandbox checkout page and later restore state through status endpoint

#### Scenario: Student returns before callback is fully processed
- **GIVEN** student is online, returns to app, and payment callback has not finalized
- **WHEN** frontend queries payment-status endpoint
- **THEN** frontend MUST render pending/unknown state with retry guidance based on response contract

#### Scenario: Peak waiting is surfaced before payment initiation
- **GIVEN** student is online and workshop is in peak mode but student is not yet admitted
- **WHEN** frontend requests registration flow
- **THEN** frontend MUST render waiting state from admission/gate response and MUST NOT call paid registration submission until admitted

#### Scenario: Temporary gateway unavailability is surfaced
- **GIVEN** student is online and backend responds with temporary gateway unavailability
- **WHEN** frontend receives HTTP `503` body `{ "error": "PAYMENT_GATEWAY_UNAVAILABLE", "message": string, "retry_after": number }`
- **THEN** frontend MUST avoid redirect flow and MUST show a retry-after experience without creating duplicate paid registration submissions

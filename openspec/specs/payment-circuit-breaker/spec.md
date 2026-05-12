# payment-circuit-breaker Specification

## Purpose
TBD - created by archiving change circuit-breaker-for-payment-gateway. Update Purpose after archive.
## Requirements
### Requirement: Shared payment gateway circuit breaker state
The system MUST maintain a shared circuit-breaker state for paid registration gateway calls with states `CLOSED`, `OPEN`, and `HALF_OPEN`.
Reference: Architecture decision in project context "Circuit Breaker for Momo: 3 states with Redis-backed state and TTL".

#### Scenario: Failure threshold opens the breaker
- **GIVEN** gateway call outcomes are being recorded in online backend operation
- **WHEN** failures reach configured threshold within the configured failure window
- **THEN** breaker state MUST transition to `OPEN`, store `opened_at` and `retry_after`, and emit a state-change log/metric event

#### Scenario: Open duration elapses
- **GIVEN** breaker state is `OPEN`
- **WHEN** configured open duration expires in online backend operation
- **THEN** breaker state MUST transition to `HALF_OPEN` and initialize probe budget according to configuration

### Requirement: Fail-fast admission control for paid registration
The system MUST apply breaker admission control before creating a provider payment session for paid workshop registration.

#### Scenario: Open breaker rejects paid registration gateway admission
- **GIVEN** student is online and submits paid registration while breaker state is `OPEN`
- **WHEN** backend evaluates gateway admission
- **THEN** API MUST return HTTP `503` with body `{ "error": "PAYMENT_GATEWAY_UNAVAILABLE", "message": string, "retry_after": number }` and MUST NOT attempt provider order creation

#### Scenario: Half-open probe budget exceeded
- **GIVEN** student is online and breaker state is `HALF_OPEN` with exhausted probe allowance
- **WHEN** another paid registration request attempts gateway admission
- **THEN** API MUST return HTTP `503` with body `{ "error": "PAYMENT_GATEWAY_UNAVAILABLE", "message": string, "retry_after": number }` and MUST NOT attempt provider order creation

### Requirement: Probe-driven recovery and relapse
The system MUST use probe outcomes in `HALF_OPEN` to determine recovery or relapse.

#### Scenario: Successful probe closes breaker
- **GIVEN** breaker state is `HALF_OPEN` and probe allowance is available
- **WHEN** a probe request successfully receives valid provider session data
- **THEN** breaker state MUST transition to `CLOSED` and normal paid registration gateway admission MUST resume

#### Scenario: Failed probe reopens breaker
- **GIVEN** breaker state is `HALF_OPEN` and probe allowance is available
- **WHEN** a probe request fails due to timeout, transport error, or invalid provider response
- **THEN** breaker state MUST transition to `OPEN`, reset `retry_after`, and emit relapse telemetry


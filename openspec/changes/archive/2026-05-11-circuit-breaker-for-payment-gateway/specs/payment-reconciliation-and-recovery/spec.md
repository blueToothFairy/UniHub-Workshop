## MODIFIED Requirements

### Requirement: Unknown/pending MoMo payments converge to terminal state
The system MUST run reconciliation for paid registrations stuck in non-terminal states, including states accumulated during gateway degradation and breaker transitions.
Reference: Architecture decision in project context "Payment hold + reconciliation jobs" and "Circuit Breaker for Momo".

#### Scenario: Reconciliation resolves unknown payment to success
- **GIVEN** backend jobs are online and reconciliation inspects a pending/unknown payment
- **WHEN** reconciliation query to MoMo returns successful transaction status
- **THEN** system MUST transition payment to completed and registration to confirmed exactly once

#### Scenario: Reconciliation resolves unknown payment to failure
- **GIVEN** backend jobs are online and reconciliation inspects a pending/unknown payment
- **WHEN** reconciliation query to MoMo returns failed/cancelled/expired status
- **THEN** system MUST transition payment to failed/expired terminal policy and release reserved seat exactly once

#### Scenario: Reconciliation endpoint accepts repeated invocations safely
- **GIVEN** backend jobs are online and operator or scheduler repeatedly invokes reconciliation endpoint
- **WHEN** request `POST /payments/jobs/reconcile` is retried for overlapping candidates
- **THEN** API MUST return HTTP `200` with body `{ "data": { "scanned": number, "updated": number } }` and MUST preserve idempotent side effects for already terminal rows

## ADDED Requirements

### Requirement: Degradation observability for recovery backlog
The system MUST expose telemetry to detect prolonged payment degradation and unresolved unknown-state growth.

#### Scenario: Breaker-driven degradation increases unknown backlog
- **GIVEN** backend is online and gateway instability causes repeated provider failures
- **WHEN** payments are marked unknown and queued for reconciliation
- **THEN** system MUST emit metrics/logs for unknown-payment count, reconciliation attempts, and breaker open duration suitable for alerting

#### Scenario: Offline client mode does not alter backend recovery
- **GIVEN** client may be offline while backend remains online
- **WHEN** pending paid registrations are reconciled or expired by backend jobs
- **THEN** recovery behavior MUST remain backend-driven and deterministic, and client state MUST synchronize through next online status query

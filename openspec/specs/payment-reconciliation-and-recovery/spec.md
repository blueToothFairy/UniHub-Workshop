# payment-reconciliation-and-recovery Specification

## Purpose
TBD - created by archiving change payment-using-momo-sandbox-instead-of-simulation. Update Purpose after archive.
## Requirements
### Requirement: Unknown/pending MoMo payments converge to terminal state
The system MUST run reconciliation for paid registrations stuck in non-terminal states.

#### Scenario: Reconciliation resolves unknown payment to success
- **WHEN** reconciliation query to MoMo returns successful transaction for pending/unknown payment
- **THEN** system MUST transition payment to completed and registration to confirmed exactly once

#### Scenario: Reconciliation resolves unknown payment to failure
- **WHEN** reconciliation query to MoMo returns failed/cancelled transaction
- **THEN** system MUST transition payment to failed and release reserved seat exactly once

### Requirement: Reservation expiry for unresolved paid registrations
The system MUST expire stale pending registrations that exceed reservation TTL.

#### Scenario: Pending paid registration exceeds expiration window
- **WHEN** registration remains `pending_payment` past `reservation_expires_at`
- **THEN** system MUST transition registration/payment to expired policy states and decrement `reserved_count` exactly once

### Requirement: Late success after expiry is safe and reviewable
The system MUST prevent oversell when successful provider confirmation arrives after reservation expiry.

#### Scenario: Success callback arrives after registration expired
- **WHEN** callback reports successful payment for already expired/cancelled registration
- **THEN** system MUST NOT auto-confirm registration, MUST mark payment for review terminal policy, and MUST return HTTP `200`

### Requirement: Recovery flow is idempotent across retries
Reconciliation and expiry jobs MUST be idempotent under repeated execution.

#### Scenario: Same payment picked by multiple retries over time
- **WHEN** job reprocesses a payment already moved to terminal state
- **THEN** no additional seat/counter side effects MUST occur


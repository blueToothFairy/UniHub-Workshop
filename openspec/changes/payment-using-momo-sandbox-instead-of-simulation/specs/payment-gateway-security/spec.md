## ADDED Requirements

### Requirement: Callback signature verification is mandatory
The system MUST verify MoMo callback signatures before any payment state mutation.

#### Scenario: Invalid callback signature
- **WHEN** callback signature verification fails
- **THEN** API MUST reject the callback with HTTP `400` and body `{ "error": { "code": "INVALID_SIGNATURE", "message": string } }` and MUST NOT mutate payment/registration state

### Requirement: Callback payload validation and order integrity
The system MUST validate order identity, amount, and currency against the stored payment record.

#### Scenario: Amount mismatch
- **WHEN** callback amount differs from stored payment amount
- **THEN** API MUST return HTTP `409` with body `{ "error": { "code": "PAYMENT_AMOUNT_MISMATCH", "message": string } }` and MUST NOT confirm registration

#### Scenario: Unknown or mismatched order id
- **WHEN** callback references unknown order/payment mapping
- **THEN** API MUST return HTTP `404` with body `{ "error": { "code": "PAYMENT_NOT_FOUND", "message": string } }`

### Requirement: Callback idempotency for replayed provider events
The system MUST treat duplicate MoMo callbacks as idempotent.

#### Scenario: Duplicate success callback replay
- **WHEN** same successful callback is replayed for already completed payment
- **THEN** API MUST return HTTP `200` and MUST NOT increment counters or republish confirmation side effects

#### Scenario: Duplicate failure callback replay
- **WHEN** same failed callback is replayed for terminal failed/expired payment
- **THEN** API MUST return HTTP `200` and MUST NOT release seat a second time

### Requirement: Online/offline behavior for callback consumers
The system MUST define behavior when downstream notification processing is temporarily unavailable.

#### Scenario: Notification queue temporarily unavailable after commit
- **WHEN** payment confirmation transaction commits but event publish path is down
- **THEN** persisted payment/registration correctness MUST remain intact and event publish MUST be retried by durable mechanism/runbook without reversing confirmation

## MODIFIED Requirements

### Requirement: MoMo callback updates payment and registration states
The system MUST process MoMo callback synchronously and transition payment/registration states exactly once, then trigger non-blocking notification enqueue behavior after commit.

#### Scenario: Notification enqueue fails after successful commit
- **GIVEN** callback successfully commits registration/payment transition to confirmed/completed
- **WHEN** downstream notification enqueue fails after commit
- **THEN** API MUST return HTTP `200` with body `{ "ok": true }` (or existing success shape), MUST NOT roll back committed payment/registration state, and MUST record enqueue failure for retry/operations visibility

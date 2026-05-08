## ADDED Requirements

### Requirement: Registration confirmation event contract
The system MUST publish a `RegistrationConfirmed` event after successful registration confirmation for both free and simulated-paid flows.

#### Scenario: Free registration confirmation
- **WHEN** free registration transitions to `confirmed`
- **THEN** system MUST publish payload `{ "registration_id": string, "workshop_id": string, "user_id": string, "confirmed_at": string }`

#### Scenario: Simulated paid registration confirmation
- **WHEN** paid registration is confirmed through simulation action
- **THEN** system MUST publish the same `RegistrationConfirmed` payload contract

### Requirement: Event publication ordering and idempotency
The system MUST publish confirmation events only after DB commit and at most once per registration.

#### Scenario: Duplicate simulation confirmation attempts
- **WHEN** repeated simulation requests target the same registration
- **THEN** only one `RegistrationConfirmed` event MUST be published for that registration id

#### Scenario: Transaction failure before commit
- **WHEN** confirmation transaction fails
- **THEN** no `RegistrationConfirmed` event MUST be observable by consumers

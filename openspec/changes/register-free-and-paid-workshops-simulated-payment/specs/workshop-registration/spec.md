## ADDED Requirements

### Requirement: Unified workshop registration entrypoint
The system MUST provide a single `POST /registrations` endpoint for student registration to both free and paid workshops.

#### Scenario: Register free workshop successfully
- **WHEN** an authenticated student posts a valid workshop id for a published free workshop with available seats
- **THEN** API MUST return HTTP `201` with body `{ "registration_id": string, "registration_status": "confirmed", "payment_required": false, "qr_available": true }`
AND Free registration:
  reserved_count += 1
  confirmed_count += 1
  registration.status = confirmed
  QR generated
  RegistrationConfirmed emitted after commit
#### Scenario: Register paid workshop creates pending state
- **WHEN** an authenticated student posts a valid workshop id for a published paid workshop with available seats
- **THEN** API MUST return HTTP `201` with body `{ "registration_id": string, "registration_status": "pending_payment", "payment_required": true, "payment_status": "pending_simulation", "next_action": "simulate_payment" }`

### Requirement: Seat correctness under concurrency
The system MUST prevent oversell by enforcing `0 <= confirmed_count <= reserved_count <= capacity` and atomic reservation updates in PostgreSQL.

#### Scenario: Concurrent seat contention
- **WHEN** concurrent registration requests exceed remaining seats
- **THEN** at most `capacity` active registrations (`pending_payment` + `confirmed`) MUST exist and excess requests MUST return HTTP `409` with body `{ "error": "WORKSHOP_FULL" }`

### Requirement: Registration idempotency
The registration create operation MUST be idempotent based on `Idempotency-Key` for both free and paid paths.

#### Scenario: Retry with same key and same request
- **WHEN** client retries `POST /registrations` with identical body and same `Idempotency-Key`
- **THEN** API MUST return the original logical result and MUST NOT create additional registration or payment records

#### Scenario: Retry with same key and different request
- **WHEN** client reuses an `Idempotency-Key` with different workshop/body payload
- **THEN** API MUST return HTTP `409` with body `{ "error": "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST" }`

### Requirement: Online/offline behavior for students
The registration capability MUST explicitly distinguish online and offline behavior.

#### Scenario: Student online
- **WHEN** student submits registration while connected
- **THEN** backend MUST process real-time seat reservation and return authoritative registration status

#### Scenario: Student offline
- **WHEN** student attempts registration while offline
- **THEN** no offline registration queue is supported and client MUST treat operation as unsubmitted

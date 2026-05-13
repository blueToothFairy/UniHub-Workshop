## ADDED Requirements

### Requirement: Peak admission gate for registration writes
The system MUST expose a peak admission gate that controls when a student can submit `POST /registrations` for a workshop during configured peak windows.  
Reference: ADR-PC-001 and ADR-PC-002 in `openspec/changes/peak-controller/design.md`.

#### Scenario: Student joins waiting state before admission
- **GIVEN** peak control is enabled for the workshop and student is online with valid authentication
- **WHEN** student requests admission before being selected
- **THEN** API MUST return HTTP `200` with body shape `{ "status": "waiting", "queue_position": number, "retry_after": number }`

#### Scenario: Student receives admission token
- **GIVEN** peak control is enabled and student reaches admissible position
- **WHEN** student requests admission
- **THEN** API MUST return HTTP `200` with body shape `{ "status": "admitted", "admission_token": string, "expires_in": number }`

#### Scenario: Admission closes when workshop is full
- **GIVEN** workshop has no remaining seat capacity for active registrations
- **WHEN** student requests admission
- **THEN** API MUST return HTTP `200` with body shape `{ "status": "full" }`

### Requirement: Registration endpoint enforces admission token in peak mode
During configured peak windows, `POST /registrations` MUST require a valid admission token bound to `(user_id, workshop_id)` and MUST reject missing or invalid tokens before seat mutation.

#### Scenario: Missing admission token
- **GIVEN** peak control is enabled and request omits admission token
- **WHEN** student submits `POST /registrations`
- **THEN** API MUST return HTTP `403` with body shape `{ "error": { "code": "ADMISSION_TOKEN_REQUIRED", "message": string } }`

#### Scenario: Invalid or expired admission token
- **GIVEN** peak control is enabled and token is expired, malformed, or bound to a different user/workshop
- **WHEN** student submits `POST /registrations`
- **THEN** API MUST return HTTP `403` with body shape `{ "error": { "code": "ADMISSION_TOKEN_INVALID", "message": string } }`

#### Scenario: Valid admission token allows normal registration flow
- **GIVEN** peak control is enabled and token is valid for the current student/workshop
- **WHEN** student submits `POST /registrations` with a valid `Idempotency-Key`
- **THEN** API MUST continue through existing registration flow and preserve existing seat and idempotency guarantees

### Requirement: Admission operations are idempotent per user and workshop
Admission join/check operations MUST be idempotent for the same user/workshop while the user remains in queue or admitted.

#### Scenario: Repeated join request returns same logical queue state
- **GIVEN** student already joined waiting room for a workshop
- **WHEN** student repeats the same admission request
- **THEN** API MUST NOT create duplicate queue entries and MUST return the same logical queue identity with updated position metadata only

#### Scenario: Multi-tab join attempts do not create admission advantage
- **GIVEN** student opens multiple browser tabs while peak control is enabled
- **WHEN** each tab requests admission for the same workshop and account
- **THEN** system MUST maintain one active queue membership and one active admission context for that user/workshop

### Requirement: Overload handling returns deterministic retry guidance
When peak controller or registration path is overloaded, the system MUST return explicit retry signals and MUST NOT fail silently.

#### Scenario: Per-user throttling on admission polling
- **GIVEN** student polls admission endpoint faster than allowed interval
- **WHEN** throttle limit is exceeded
- **THEN** API MUST return HTTP `429` with body shape `{ "error": { "code": "RATE_LIMITED", "message": string }, "retry_after": number }`

#### Scenario: Global overload protection on registration writes
- **GIVEN** global peak write threshold is exceeded
- **WHEN** student submits registration with a valid admission token
- **THEN** API MUST return HTTP `503` with body shape `{ "error": "REGISTRATION_BUSY", "message": string, "retry_after": number }`

### Requirement: Online and offline behavior is explicit for peak admission
The capability MUST define behavior differences between online and offline clients.

#### Scenario: Online student can join and progress in queue
- **GIVEN** student has network connectivity
- **WHEN** student accesses admission and registration gate endpoints
- **THEN** backend MUST return authoritative queue/admission state in real time

#### Scenario: Offline student cannot enter queue
- **GIVEN** student is offline
- **WHEN** student attempts to access admission or registration gate endpoints
- **THEN** no offline queueing is supported and client MUST treat the operation as unsubmitted

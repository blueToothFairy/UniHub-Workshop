## ADDED Requirements

### Requirement: Check-in staff can validate a confirmed registration and record attendance
The system SHALL allow authenticated users with role `checkin_staff` to submit a workshop QR token for verification and record exactly one authoritative check-in for the referenced confirmed registration, following ADR-CHK-001, ADR-CHK-002, and ADR-CHK-003.

#### Scenario: Successful online scan
- **GIVEN** a `checkin_staff` user is authenticated
- **AND** the submitted QR token is validly signed and contains `registration_id`, `workshop_id`, and `user_id`
- **AND** the referenced registration exists in status `confirmed`
- **AND** no prior attendance record exists for that registration
- **WHEN** the client calls `POST /checkin/scan`
- **THEN** the API MUST return HTTP `200`
- **AND** the response body MUST include `{ "data": { "result": "checked_in", "registration_id": string, "workshop_id": string, "checked_in_at": string } }`
- **AND** the server MUST persist exactly one attendance row for that registration

#### Scenario: Duplicate scan is idempotent
- **GIVEN** a `checkin_staff` user is authenticated
- **AND** the submitted QR token maps to a registration that already has a persisted attendance row
- **WHEN** the client calls `POST /checkin/scan` again with the same valid token
- **THEN** the API MUST return HTTP `200`
- **AND** the response body MUST include `{ "data": { "result": "already_checked_in", "registration_id": string, "workshop_id": string, "checked_in_at": string } }`
- **AND** the server MUST NOT create a second attendance row

### Requirement: Invalid or ineligible scans are rejected with explicit domain errors
The system SHALL reject scans for invalid tokens, non-confirmed registrations, cancelled workshops, workshop mismatches, and unauthorized actors with explicit error contracts.

#### Scenario: Invalid QR token
- **GIVEN** the submitted QR token cannot be verified or is missing required claims
- **WHEN** the client calls `POST /checkin/scan`
- **THEN** the API MUST return HTTP `400`
- **AND** the response body MUST include `{ "error": { "code": "INVALID_QR_TOKEN", "message": string } }`

#### Scenario: Registration is not eligible for attendance
- **GIVEN** the submitted QR token is validly signed
- **AND** the referenced registration exists but is not in status `confirmed`
- **WHEN** the client calls `POST /checkin/scan`
- **THEN** the API MUST return HTTP `409`
- **AND** the response body MUST include `{ "error": { "code": "REGISTRATION_NOT_CONFIRMED", "message": string } }`

#### Scenario: Scan submitted for the wrong workshop context
- **GIVEN** the submitted QR token is validly signed
- **AND** the client supplies a workshop context that does not match the token or persisted registration
- **WHEN** the client calls `POST /checkin/scan`
- **THEN** the API MUST return HTTP `409`
- **AND** the response body MUST include `{ "error": { "code": "WORKSHOP_MISMATCH", "message": string } }`

#### Scenario: User lacks check-in permission
- **GIVEN** the caller is unauthenticated or has a role other than `checkin_staff`
- **WHEN** the client calls `POST /checkin/scan`
- **THEN** the API MUST return HTTP `401` for missing/invalid authentication or HTTP `403` for insufficient role
- **AND** the response body MUST include `{ "error": { "code": string, "message": string } }`

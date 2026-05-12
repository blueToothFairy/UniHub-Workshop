## ADDED Requirements

### Requirement: Organizer dashboard reads persisted attendance totals
The system SHALL expose organizer-facing attendance totals derived from persisted check-in records instead of estimated placeholder values, following ADR-CHK-001 and ADR-CHK-005.

#### Scenario: Dashboard returns real check-in counts
- **GIVEN** one or more workshops have persisted attendance rows
- **WHEN** an authenticated organizer requests the dashboard stats API
- **THEN** the API MUST return HTTP `200`
- **AND** the check-in total in the response MUST equal the count of persisted attendance rows included by the dashboard scope
- **AND** the value MUST NOT be derived from a heuristic percentage of registrations

#### Scenario: Non-organizer cannot read organizer attendance totals
- **GIVEN** the caller is unauthenticated or has a role other than `organizer`
- **WHEN** the caller requests the organizer dashboard stats API
- **THEN** the API MUST return HTTP `401` for missing/invalid authentication or HTTP `403` for insufficient role
- **AND** the response body MUST include `{ "error": { "code": string, "message": string } }`

### Requirement: Staff-facing check-in responses include attendee status needed for door-side confirmation
The system SHALL return enough persisted attendance information in check-in responses for the staff device to distinguish newly accepted, already processed, and rejected attendees without requiring a follow-up read.

#### Scenario: Accepted attendee result includes persisted status
- **GIVEN** a `checkin_staff` user submits a valid scan for a confirmed registration
- **WHEN** the check-in API accepts the attendee
- **THEN** the response MUST include the registration identifier, workshop identifier, normalized result code, and the persisted server-side `checked_in_at` timestamp

#### Scenario: Already processed attendee result includes original check-in timestamp
- **GIVEN** a `checkin_staff` user submits a scan for a registration that is already checked in
- **WHEN** the check-in API handles the request
- **THEN** the response MUST include `result="already_checked_in"`
- **AND** the response MUST include the original persisted `checked_in_at` timestamp so the device can explain the duplicate outcome to staff

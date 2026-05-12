## ADDED Requirements

### Requirement: Offline-captured check-ins can be replayed in batches with per-item reconciliation
The system SHALL provide a batched sync endpoint for offline-captured check-ins so the mobile app can submit queued scan records and receive deterministic per-item outcomes, following ADR-CHK-003 and ADR-CHK-004.

#### Scenario: Mixed-result sync batch
- **GIVEN** a `checkin_staff` user is authenticated
- **AND** the device has a batch containing multiple offline scan items, each with a stable `device_scan_id`, QR token, and device-captured timestamp
- **WHEN** the client calls `POST /checkin/sync`
- **THEN** the API MUST return HTTP `200`
- **AND** the response body MUST include `{ "data": { "results": [{ "device_scan_id": string, "result": string, "registration_id": string | null, "checked_in_at": string | null, "error_code": string | null }] } }`
- **AND** each item result MUST independently report one of `checked_in`, `already_checked_in`, `invalid_qr`, `registration_not_confirmed`, `workshop_mismatch`, or `workshop_cancelled`

#### Scenario: Replayed sync batch is idempotent
- **GIVEN** a `checkin_staff` user is authenticated
- **AND** the device resubmits one or more previously accepted items with the same `device_scan_id`
- **WHEN** the client calls `POST /checkin/sync`
- **THEN** the API MUST return HTTP `200`
- **AND** each repeated item MUST resolve to the same logical outcome without creating duplicate attendance rows
- **AND** the server MUST use durable idempotency based on stored attendance records and replay identifiers rather than in-memory state

### Requirement: Offline sync behavior differs from online scan only in transport, not validation rules
The system SHALL apply the same QR verification and registration/workshop eligibility rules to offline replay as to online scans, but SHALL return per-item failures inside the sync result instead of failing the whole batch for domain errors.

#### Scenario: One invalid item does not fail the full batch
- **GIVEN** a sync batch contains at least one valid item and one item with an invalid QR token
- **WHEN** the client calls `POST /checkin/sync`
- **THEN** the API MUST return HTTP `200`
- **AND** the valid item MUST still be processed normally
- **AND** the invalid item MUST appear in `results` with `result="invalid_qr"` and `error_code="INVALID_QR_TOKEN"`

#### Scenario: Malformed sync request is rejected
- **GIVEN** the request body is missing the batch array or required per-item fields such as `device_scan_id` or `qr_token`
- **WHEN** the client calls `POST /checkin/sync`
- **THEN** the API MUST return HTTP `400`
- **AND** the response body MUST include `{ "error": { "code": "INVALID_SYNC_PAYLOAD", "message": string } }`

#### Scenario: Offline mode is unavailable to unauthorized users
- **GIVEN** the caller is unauthenticated or has a role other than `checkin_staff`
- **WHEN** the client calls `POST /checkin/sync`
- **THEN** the API MUST return HTTP `401` for missing/invalid authentication or HTTP `403` for insufficient role
- **AND** the response body MUST include `{ "error": { "code": string, "message": string } }`

## ADDED Requirements

### Requirement: Staff can submit an online check-in scan and receive immediate doorway feedback
The mobile app SHALL let authenticated staff scan or enter a QR payload, SHALL attempt `POST /checkin/scan` when the device is online, and SHALL present a high-visibility result state for `checked_in` and `already_checked_in` outcomes.

#### Scenario: Online scan succeeds
- **GIVEN** a `checkin_staff` user is authenticated in the mobile app
- **AND** the device is online
- **AND** the scanned QR token is valid for the requested workshop context
- **WHEN** the app submits `POST /checkin/scan`
- **THEN** it MUST accept HTTP `200` with `{ "data": { "result": "checked_in" | "already_checked_in", "registration_id": string, "workshop_id": string, "checked_in_at": string } }`
- **AND** it MUST show a success-style confirmation for `checked_in`
- **AND** it MUST show a distinct duplicate-style confirmation for `already_checked_in`

#### Scenario: Domain validation failure is shown immediately instead of being queued
- **GIVEN** a `checkin_staff` user is authenticated in the mobile app
- **AND** the device is online
- **WHEN** `POST /checkin/scan` returns HTTP `400`, `401`, or `403` with `{ "error": { "code": string, "message": string } }`
- **THEN** the app MUST surface the result as an immediate failure state
- **AND** it MUST NOT enqueue the scan as an offline record
- **AND** it MUST distinguish this behavior from offline fallback because the server has already returned a domain decision

### Requirement: The app captures unresolved scans offline using replay-safe local records
The mobile app SHALL create a replay-safe local record when online submission cannot complete due to offline or transport-level failure, and offline capture SHALL differ from online mode only in transport as described by ADR-CHK-004.

#### Scenario: Scan is queued while offline
- **GIVEN** a `checkin_staff` user is authenticated in the mobile app
- **AND** the device is offline before submission starts
- **WHEN** the staff user scans or enters a QR payload
- **THEN** the app MUST create one SQLite pending record containing a stable `device_scan_id`, the QR token, optional workshop context, and a device-captured timestamp
- **AND** it MUST show that the scan was recorded locally and is pending sync
- **AND** it MUST make the pending queue visible without requiring app restart

#### Scenario: Transport failure falls back to queue without losing the scan
- **GIVEN** a `checkin_staff` user is authenticated in the mobile app
- **AND** the device appeared online when submission started
- **WHEN** the request fails before any HTTP response body with a domain result is received
- **THEN** the app MUST enqueue the scan locally using the same pending-record shape as offline capture
- **AND** it MUST show an offline-captured or retry-later state instead of a permanent domain error

### Requirement: Manual sync replays pending records idempotently and reports clear versus retained items
The mobile app SHALL provide a visible manual sync action that replays queued records through `POST /checkin/sync`, and the replay flow SHALL be idempotent via stable `device_scan_id` values and ADR-CHK-003 server behavior.

#### Scenario: Sync clears successful and duplicate items
- **GIVEN** the device has one or more queued pending records
- **AND** the device is online
- **WHEN** the staff user triggers sync
- **THEN** the app MUST call `POST /checkin/sync` with the queued items batch
- **AND** it MUST treat per-item results of `checked_in` and `already_checked_in` as clearable outcomes
- **AND** it MUST remove those cleared items from SQLite after the server response is processed
- **AND** it MUST show processed, cleared, and retained counts to the staff user

#### Scenario: Sync retains unresolved items for retry
- **GIVEN** the device has queued records that produce unresolved sync outcomes
- **WHEN** `POST /checkin/sync` returns HTTP `200` with `{ "data": { "results": [{ "device_scan_id": string, "result": string, "registration_id": string | null, "checked_in_at": string | null, "error_code": string | null }] } }`
- **THEN** the app MUST retain any item whose result is not `checked_in` or `already_checked_in`
- **AND** it MUST update retained queue metadata so the user can see the last known `error_code`
- **AND** it MUST keep those records available for a future retry rather than silently discarding them

#### Scenario: Repeated sync attempts remain deterministic
- **GIVEN** the same queued record is replayed multiple times with the same `device_scan_id`
- **WHEN** the staff user triggers sync again after a previous partial or uncertain attempt
- **THEN** the app MUST continue to send the same replay identifier for that record
- **AND** it MUST interpret the resulting per-item response deterministically instead of creating duplicate local records

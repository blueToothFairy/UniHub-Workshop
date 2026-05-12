## ADDED Requirements

### Requirement: Student can list in-app notifications with unread/read status
The system MUST provide an authenticated student API to read in-app notifications ordered by newest first, including read state fields.
Reference: Design Decision 5.

#### Scenario: List notifications successfully
- **GIVEN** student is online and authenticated
- **WHEN** student calls `GET /notifications`
- **THEN** API MUST return HTTP `200` with body `{ "items": [{ "id": string, "title": string, "body": string, "type": string, "created_at": string, "is_read": boolean }], "next_cursor": string | null }`

#### Scenario: Unauthenticated list request
- **GIVEN** client is online without valid bearer token
- **WHEN** client calls `GET /notifications`
- **THEN** API MUST return HTTP `401` with body `{ "error": "UNAUTHORIZED", "message": string }`

### Requirement: Student can fetch unread notification count
The system MUST provide an authenticated student API for unread count optimized for header badge display.
Reference: Design Decision 5.

#### Scenario: Read unread count successfully
- **GIVEN** student is online and authenticated
- **WHEN** student calls `GET /notifications/unread-count`
- **THEN** API MUST return HTTP `200` with body `{ "unread_count": number }`

#### Scenario: Unauthenticated unread count request
- **GIVEN** client is online without valid bearer token
- **WHEN** client calls `GET /notifications/unread-count`
- **THEN** API MUST return HTTP `401` with body `{ "error": "UNAUTHORIZED", "message": string }`

### Requirement: Mark-read operation MUST be idempotent
The system MUST allow authenticated students to mark a notification as read, and repeated calls for the same notification MUST keep a stable success response.
Reference: Design Decision 5.

#### Scenario: Mark unread notification as read
- **GIVEN** student is online, authenticated, and owns unread notification `id`
- **WHEN** student calls `POST /notifications/:id/read`
- **THEN** API MUST return HTTP `200` with body `{ "id": string, "is_read": true, "read_at": string }`

#### Scenario: Mark already-read notification again
- **GIVEN** student is online, authenticated, and owns an already-read notification `id`
- **WHEN** student calls `POST /notifications/:id/read` again
- **THEN** API MUST return HTTP `200` with body `{ "id": string, "is_read": true, "read_at": string }` and MUST NOT create duplicate rows

#### Scenario: Mark-read for missing notification
- **GIVEN** student is online and authenticated
- **WHEN** student calls `POST /notifications/:id/read` with non-existent or unauthorized `id`
- **THEN** API MUST return HTTP `404` with body `{ "error": "NOTIFICATION_NOT_FOUND", "message": string }`

### Requirement: Offline behavior for student inbox endpoints
Student inbox endpoints are online-only web APIs and MUST fail fast when network is unavailable.

#### Scenario: Client offline
- **GIVEN** student client has no network connectivity
- **WHEN** client attempts to call notification inbox endpoints
- **THEN** no request reaches backend and client MUST render offline error/retry UX using local failure state (no backend HTTP response)

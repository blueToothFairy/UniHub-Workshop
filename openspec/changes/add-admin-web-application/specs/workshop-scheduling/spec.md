## ADDED Requirements

### Requirement: Reschedule workshop date and time
Admins SHALL reschedule workshops by updating date and time via `PUT /admin/workshops/:id` or a dedicated reschedule endpoint. The system SHALL check for room and time conflicts with other workshops. If rescheduling moves the workshop in a way that creates participant conflicts, the system SHALL detect and report those conflicts. The system SHALL emit a `WorkshopRescheduled` event that triggers participant notifications asynchronously.

**Idempotency:** This operation is not inherently idempotent across different payloads. Repeating the exact same reschedule request for the same target date and time after a successful update SHOULD return the already-updated workshop state without creating duplicate schedule changes or duplicate participant notifications.

**Design References:** Admin Routes in Next.js vs. Separate Admin App; SOLID Principles Clean Architecture; Real-Time Dashboard with Polling vs. WebSocket.

#### Acceptance Criteria
- **Given** an authenticated admin and a workshop whose target date and time slot are available
- **When** the admin submits a reschedule request
- **Then** the system updates the workshop schedule, returns `200 OK`, persists the new values, and emits a single `WorkshopRescheduled` event

- **Given** an authenticated admin and a workshop with registered participants
- **When** the workshop is rescheduled successfully
- **Then** the system queues participant notifications with the new date and time without blocking the main response

- **Given** an authenticated admin and a reschedule request that causes some students to become double-booked
- **When** conflict analysis completes
- **Then** the system returns the updated scheduling result together with the list or count of affected participants so the admin can act on the conflict

#### Error Scenarios
- **Given** the reschedule target overlaps another workshop in the same room
- **When** the request is validated against existing schedules
- **Then** the system returns `409 Conflict` with response body shape `{ "error": "ROOM_TIME_CONFLICT", "message": string, "details": { "conflicting_workshop_id": string } }`

- **Given** the reschedule request payload is invalid
- **When** the system validates required fields or date-time formats
- **Then** the system returns `400 Bad Request` with response body shape `{ "error": "VALIDATION_ERROR", "message": string, "details": object }`

- **Given** the request is made without a valid JWT
- **When** the protected route is evaluated
- **Then** the system returns `401 Unauthorized` with response body shape `{ "error": "UNAUTHORIZED", "message": string }`

- **Given** the request is made by an authenticated non-admin user
- **When** authorization is evaluated
- **Then** the system returns `403 Forbidden` with response body shape `{ "error": "FORBIDDEN", "message": string }`

### Requirement: Change workshop room
Admins SHALL change workshop room assignment via `PUT /admin/workshops/:id` or a dedicated room reassignment endpoint. The system SHALL validate that the target room exists, is available for the workshop time slot, and has capacity greater than or equal to the number of already registered participants. The system SHALL emit a `WorkshopRoomChanged` event and trigger asynchronous participant notifications with the updated room information.

**Idempotency:** Repeating the exact same room assignment request after a successful update SHOULD be idempotent and return the current workshop state without emitting duplicate room-change notifications.

**Design References:** SOLID Principles Clean Architecture; Admin UI Organization and Navigation.

#### Acceptance Criteria
- **Given** an authenticated admin and an available room with sufficient capacity
- **When** the admin changes the workshop room
- **Then** the system updates the room assignment, persists the new value, and emits a single `WorkshopRoomChanged` event

- **Given** an authenticated admin and a successful room reassignment for a workshop with registered participants
- **When** the request completes
- **Then** the system queues participant notifications containing the new room information

#### Error Scenarios
- **Given** the target room does not exist
- **When** the room assignment request is validated
- **Then** the system returns `404 Not Found` with response body shape `{ "error": "ROOM_NOT_FOUND", "message": string }`

- **Given** the target room has fewer seats than the number of registered participants
- **When** the room assignment request is evaluated
- **Then** the system returns `409 Conflict` with response body shape `{ "error": "ROOM_CAPACITY_CONFLICT", "message": string, "details": { "registered_count": number, "room_capacity": number } }`

- **Given** the target room is already occupied at the workshop time
- **When** schedule conflict checks run
- **Then** the system returns `409 Conflict` with response body shape `{ "error": "ROOM_TIME_CONFLICT", "message": string, "details": { "conflicting_workshop_id": string } }`

### Requirement: Reassign speaker
Admins SHALL reassign the workshop speaker via `PUT /admin/workshops/:id/speaker` using a known `speaker_id` or an allowed speaker reference. The system SHALL validate that the speaker exists and is available for the workshop time slot. The system SHALL emit a `WorkshopSpeakerChanged` event. Participant notification for speaker reassignment MAY be optional depending on product policy, but the behavior SHALL be consistent.

**Idempotency:** Repeating the exact same speaker assignment request after a successful update SHOULD be idempotent and SHALL NOT create duplicate speaker-change events.

**Design References:** SOLID Principles Clean Architecture; Admin UI Organization and Navigation.

#### Acceptance Criteria
- **Given** an authenticated admin and an available speaker
- **When** the admin reassigns the workshop speaker
- **Then** the system updates the speaker reference, persists the new value, and emits a single `WorkshopSpeakerChanged` event

- **Given** product policy requires participant notification on speaker changes
- **When** a speaker reassignment succeeds
- **Then** the system queues the relevant participant notifications asynchronously

#### Error Scenarios
- **Given** the target speaker does not exist
- **When** the speaker reassignment request is validated
- **Then** the system returns `404 Not Found` with response body shape `{ "error": "SPEAKER_NOT_FOUND", "message": string }`

- **Given** the target speaker is already assigned to another workshop at the same time
- **When** availability checks run
- **Then** the system returns `409 Conflict` with response body shape `{ "error": "SPEAKER_TIME_CONFLICT", "message": string, "details": { "conflicting_workshop_id": string } }`

### Requirement: Scheduling operations preserve online behavior and notification consistency
Scheduling operations are admin-only online workflows. The system SHALL execute scheduling mutations only when the backend is reachable and SHALL use asynchronous notifications so that participant communication failures do not invalidate an already-committed scheduling change.

**Idempotency:** Notification side effects SHALL be deduplicated per successfully committed scheduling event.

**Design References:** Admin Authentication and Authorization; Real-Time Dashboard with Polling vs. WebSocket.

#### Acceptance Criteria
- **Given** a scheduling mutation succeeds
- **When** the downstream notification queue is healthy
- **Then** the scheduling response returns without waiting for participant delivery completion

- **Given** a scheduling mutation succeeds
- **When** the notification queue or provider is temporarily unavailable
- **Then** the scheduling change remains committed and the notification subsystem handles retry asynchronously

#### Error Scenarios
- **Given** the backend API is unreachable
- **When** an admin attempts to perform a scheduling change
- **Then** no local offline scheduling mode is available and the client SHALL surface an online failure state instead of attempting a deferred mutation

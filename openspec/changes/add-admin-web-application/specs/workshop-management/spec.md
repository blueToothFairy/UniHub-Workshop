## ADDED Requirements

### Requirement: Create workshop
Admins SHALL create new workshops via POST `/admin/workshops` with fields: title, description, speaker, date, time, room, capacity, price (optional for free workshops), and workshop_type. The system SHALL validate that date/time/room combination does not conflict with existing workshops. Upon success, system SHALL return 201 Created with the new workshop object including auto-generated workshop_id and timestamps.

#### Scenario: Successful workshop creation
- **WHEN** admin POSTs valid workshop data with non-conflicting date/time/room
- **THEN** system creates workshop in PostgreSQL and returns 201 with workshop object

#### Scenario: Workshop creation with conflicting room/time
- **WHEN** admin tries to create workshop in same room at overlapping time
- **THEN** system returns 409 Conflict with message about scheduling conflict

#### Scenario: Workshop creation validates required fields
- **WHEN** admin POSTs incomplete data (missing title, date, or capacity)
- **THEN** system returns 400 Bad Request with field validation errors

### Requirement: Read/list workshops
Admins SHALL retrieve all workshops via GET `/admin/workshops` with optional filters: date range, room, speaker, status (draft/published/cancelled). System SHALL return paginated list with timestamps, registration count, payment status, and check-in count per workshop.

#### Scenario: List all workshops
- **WHEN** admin calls GET `/admin/workshops`
- **THEN** system returns paginated list of all workshops with metadata

#### Scenario: Filter workshops by date range
- **WHEN** admin calls GET `/admin/workshops?dateFrom=2026-04-25&dateTo=2026-05-01`
- **THEN** system returns only workshops within date range

### Requirement: Update workshop
Admins SHALL update workshop details via PUT `/admin/workshops/:id` with fields: title, description, speaker, date, time, room, capacity, price, status. System SHALL validate conflicts and seat reduction rules (capacity cannot drop below existing check-in count). Upon update, system SHALL emit WorkshopModified event for notification worker.

#### Scenario: Successful workshop update
- **WHEN** admin PUTs valid updates to workshop
- **THEN** system updates workshop and returns 200 with updated object

#### Scenario: Cannot reduce capacity below check-ins
- **WHEN** admin tries to set capacity lower than current check-in count
- **THEN** system returns 409 Conflict with message about existing check-ins

#### Scenario: Workshop update triggers notification event
- **WHEN** admin updates workshop date/time/room
- **THEN** system emits WorkshopModified event to notification queue with change details

### Requirement: Delete/cancel workshop
Admins SHALL cancel workshops via DELETE `/admin/workshops/:id` or by setting status to "cancelled". System SHALL mark workshop as cancelled in database, emit WorkshopCancelled event to notification worker. Registered participants SHALL be notified. Check-in records SHALL be preserved for audit.

#### Scenario: Successful workshop cancellation
- **WHEN** admin calls DELETE `/admin/workshops/:id`
- **THEN** workshop status is set to "cancelled" and WorkshopCancelled event is emitted

#### Scenario: Cancellation notifies participants
- **WHEN** workshop is cancelled
- **THEN** all registered participants receive notification via email and in-app

#### Scenario: Cannot delete cancelled workshop again
- **WHEN** admin tries to delete already-cancelled workshop
- **THEN** system returns 400 Bad Request with message workshop already cancelled

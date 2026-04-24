## ADDED Requirements

### Requirement: Reschedule workshop date and time
Admins SHALL reschedule workshops by updating date and time via PUT `/admin/workshops/:id`. System SHALL check for room/time conflicts with other workshops. If rescheduling moves workshop to a different day, system SHALL automatically detect participant conflicts (students double-booked on same day) and flag them. System SHALL emit WorkshopRescheduled event which triggers participant notifications.

#### Scenario: Successful reschedule with no conflicts
- **WHEN** admin updates workshop date/time to available slot
- **THEN** system updates database, returns 200, and emits WorkshopRescheduled event

#### Scenario: Reschedule detects room conflict
- **WHEN** admin tries to reschedule to time slot occupied by another workshop in same room
- **THEN** system returns 409 Conflict with conflicting workshop details

#### Scenario: Reschedule notifies participants
- **WHEN** workshop is rescheduled
- **THEN** all registered participants receive notification with new date/time

#### Scenario: Reschedule flags participant conflicts
- **WHEN** rescheduling creates double-booking for some students
- **THEN** system flags affected students in response and recommends notification

### Requirement: Change workshop room
Admins SHALL change workshop room assignment via PUT `/admin/workshops/:id` with new room_id. System SHALL validate room exists and has capacity >= workshop participant count. System SHALL emit WorkshopRoomChanged event triggering participant notifications with new room info and directions if available.

#### Scenario: Successful room change
- **WHEN** admin updates room to available room with sufficient capacity
- **THEN** system updates database and notifies participants

#### Scenario: Cannot move to room with insufficient capacity
- **WHEN** admin tries to assign room with fewer seats than registered participants
- **THEN** system returns 409 Conflict with capacity mismatch details

### Requirement: Reassign speaker
Admins SHALL reassign speaker via PUT `/admin/workshops/:id/speaker` with speaker_id or speaker name. System SHALL validate speaker exists and check availability (no time conflicts). System SHALL emit WorkshopSpeakerChanged event.

#### Scenario: Successful speaker reassignment
- **WHEN** admin updates speaker to available speaker
- **THEN** system updates database and emits event (optional participant notification)

#### Scenario: Cannot assign speaker with time conflict
- **WHEN** admin tries to assign speaker who is scheduled elsewhere at same time
- **THEN** system returns 409 Conflict

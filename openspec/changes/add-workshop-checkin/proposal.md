## Why

The system already issues QR tokens for confirmed registrations, but it still has no real attendance source of truth for workshop entry, which blocks reliable door-side validation and makes admin check-in numbers inaccurate. This change is needed now to close the loop from registration to attendance and to support the event's unstable-network check-in requirement before rollout expands beyond simulated registration flows.

## What Changes

- Add a dedicated check-in capability for `checkin_staff` to validate a student's workshop QR and record attendance against the matching registration.
- Add an offline-capable sync contract so staff can capture scans without network connectivity and replay them safely when the device reconnects.
- Add real attendance persistence and duplicate-scan protection so repeated scans do not create multiple check-in records.
- Add explicit error handling for expired QR tokens, wrong-workshop scans, cancelled registrations, already checked-in attendees, and unauthorized staff access.
- Replace placeholder admin check-in counts with values derived from persisted attendance data.
- Add mobile-facing API contracts for single online check-in, batched sync, and sync result reconciliation per queued item.
- Add verification and smoke-test expectations for online scanning, offline replay, and idempotent duplicate submission handling.

## Capabilities

### New Capabilities
- `workshop-checkin`: Validate QR-backed registrations and record a single authoritative attendance event per registration/workshop.
- `workshop-checkin-sync`: Accept offline-captured scan events from staff devices, reconcile them idempotently, and return per-item sync outcomes.
- `checkin-attendance-read`: Expose persisted check-in counts and attendee status needed by staff confirmation flows and organizer dashboard views.

### Modified Capabilities
- None.

## Impact

- Backend:
  - New `checkin` module with router/service/types, wired behind `checkin_staff` authorization.
  - New endpoints such as `POST /checkin/scan`, `POST /checkin/sync`, and read helpers for attendance status/counts.
  - Admin stats logic updated to read real attendance data instead of placeholder math.
- Mobile:
  - Expo check-in app gains typed API contracts for online scan submission, offline queue replay, and sync reconciliation.
- Database:
  - New attendance/check-in persistence tables and unique constraints for idempotent replay.
  - Migrations must use the Supabase direct endpoint (port `5432`); runtime queries continue through the pooler (port `6543`).
- Dependencies and infrastructure:
  - No new paid services or Docker containers.
  - Upstash usage should remain low because offline sync is batched and online verification does not require new chatty cache patterns.

## Out of Scope

- Workshop registration changes, payment changes, or QR issuance changes beyond the fields needed to verify existing tokens.
- Rich organizer analytics beyond replacing current check-in placeholders with accurate persisted totals.
- Non-Expo mobile platform work, push notifications for staff, or advanced device-management features.
- Manual attendee override workflows such as force check-in without a QR code.

## Why

The mobile app still lacks a working staff experience even though the check-in API and offline queue helpers already exist, so event staff cannot actually use phones to scan workshop QR codes at the door. This change is needed now to turn the backend check-in foundation into a usable Expo app before rollout and to reduce operational risk in unstable-network event conditions.

## What Changes

- Build the first real mobile check-in experience for `checkin_staff`, replacing the current placeholder entry screen.
- Add a staff login/session flow in the mobile app so only authenticated `checkin_staff` users can reach scanning and sync actions.
- Add a check-in workspace screen that accepts QR payload input, submits online scans, and falls back to local queue capture when the device is offline or the request cannot complete.
- Add queue visibility and manual sync controls so staff can see pending records, trigger reconciliation, and understand which items were cleared versus retained.
- Add clear success, duplicate, offline-captured, and error states tuned for doorway scanning instead of generic API messages.
- Add any minimal mobile-only dependencies needed for QR capture and connectivity detection, while keeping infrastructure cost unchanged.

## Capabilities

### New Capabilities
- `mobile-checkin-auth`: Let `checkin_staff` users sign in on the Expo app and keep a valid session for check-in work.
- `mobile-checkin-operations`: Let staff scan or enter QR payloads, record check-ins online or offline, review pending queue state, and sync queued items deterministically.

### Modified Capabilities
- None.

## Impact

- Mobile:
  - Replace [mobile/App.tsx](/abs/c:/DiskD/HCMUS/Semester8/SoftwareDesign/final/UniHub-Workshop/mobile/App.tsx) with a real multi-state check-in app shell.
  - Extend `mobile/lib` around the existing API, SQLite queue, and sync helpers with session and UI-facing orchestration.
  - Add Expo dependencies for QR scanning and network-state awareness if the chosen implementation requires them.
- Backend:
  - Reuse existing `/auth/login`, `/auth/refresh`, `/auth/me`, `/checkin/scan`, and `/checkin/sync` endpoints; only fill gaps if the mobile UX uncovers a missing staff-safe contract.
- Operations:
  - No new service, container, or monthly infrastructure cost is expected.
  - Success target: a staff member can complete an online scan confirmation in under 2 seconds on a healthy connection and can see queued offline captures immediately after scan.

## Out of Scope

- Student-facing or organizer-facing mobile features.
- Reworking backend attendance rules that are already covered by the workshop check-in change.
- Advanced background sync, push notifications, kiosk mode, or device fleet management.
- Analytics, exports, or a multi-screen navigation overhaul beyond what the check-in staff workflow requires.

## 1. Mobile app foundation

- [ ] 1.1 Add the minimal mobile dependencies for QR capture, local token persistence, and connectivity awareness in `mobile/package.json` (design: ADR-MOB-004).
- [ ] 1.2 Define mobile auth/session types and API helpers that mirror `/auth/login`, `/auth/refresh`, and `/auth/me` response shapes before building UI state (spec: mobile-checkin-auth).
- [ ] 1.3 Define UI-facing check-in result and queue status types so presentation mapping stays separate from transport details (design: ADR-MOB-005; spec: mobile-checkin-operations).
- [ ] 1.4 Manual smoke test: install dependencies and confirm the Expo app still boots after the new packages and types are introduced (design: ADR-MOB-001/ADR-MOB-004).

## 2. Staff authentication and session restore

- [ ] 2.1 Implement a small mobile session store for persisting access and refresh tokens and clearing invalid sessions without touching the SQLite check-in queue (design: ADR-MOB-002; spec: mobile-checkin-auth).
- [ ] 2.2 Implement login, session restore, and token refresh orchestration that only admits resolved `checkin_staff` users (spec: mobile-checkin-auth).
- [ ] 2.3 Add login-state UI in `mobile/App.tsx` for sign-in, loading, unauthorized-role, and signed-out recovery flows (design: ADR-MOB-001; spec: mobile-checkin-auth).
- [ ] 2.4 Manual smoke test: verify successful staff login, blocked non-staff login, app relaunch restore, and forced sign-out after refresh failure (spec: mobile-checkin-auth).

## 3. Check-in capture workflow

- [ ] 3.1 Implement QR capture or manual token entry plumbing that feeds one normalized scan submission path (design: ADR-MOB-004; spec: mobile-checkin-operations).
- [ ] 3.2 Implement connectivity-aware online submission that calls `POST /checkin/scan`, refreshes auth once if needed, and maps `checked_in` versus `already_checked_in` into distinct staff-facing result cards (design: ADR-MOB-003/ADR-MOB-005; spec: mobile-checkin-operations).
- [ ] 3.3 Implement offline or transport-failure fallback that enqueues replay-safe records with stable `device_scan_id` values using the existing SQLite helper shape (design: ADR-MOB-003; spec: mobile-checkin-operations).
- [ ] 3.4 Manual smoke test: verify an online success, an online duplicate result, and an offline-captured scan that appears immediately in queue state (spec: mobile-checkin-operations).

## 4. Queue visibility and manual sync

- [ ] 4.1 Add queue summary reads and retained-error visibility on top of the existing SQLite pending-checkin table without changing server contracts (design: ADR-MOB-005; spec: mobile-checkin-operations).
- [ ] 4.2 Implement a visible “Sync now” action that replays queued records through `syncPendingCheckins` and reports processed, cleared, and retained counts (design: ADR-MOB-003; spec: mobile-checkin-operations).
- [ ] 4.3 Ensure repeated sync attempts preserve the original `device_scan_id` and interpret replay results deterministically instead of creating duplicate local entries (spec: mobile-checkin-operations; design: ADR-MOB-003).
- [ ] 4.4 Manual smoke test: create a mixed queue, sync it, confirm clearable items are removed, and confirm retained items keep their last `error_code` for retry (spec: mobile-checkin-operations).

## 5. App shell polish and rollout readiness

- [ ] 5.1 Replace the placeholder `mobile/App.tsx` layout with the single-shell staff workspace that conditionally renders auth, scanning, queue, and result states (design: ADR-MOB-001).
- [ ] 5.2 Add concise staff-focused copy and edge-state handling for camera denied, session expired, offline queued, and sync retained conditions (design: ADR-MOB-005; spec: mobile-checkin-auth; spec: mobile-checkin-operations).
- [ ] 5.3 Document required mobile environment variables and any new Expo setup steps needed for local development (impact: mobile dependencies and auth/check-in endpoints).
- [ ] 5.4 Final manual smoke test: complete sign-in, online scan, offline queue capture, app relaunch, manual sync replay, and duplicate-result handling end to end (spec: mobile-checkin-auth; spec: mobile-checkin-operations).

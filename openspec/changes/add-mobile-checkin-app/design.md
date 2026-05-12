## Context

The repository already contains the mobile-side primitives for check-in submission and offline replay in `mobile/lib/api.ts`, `mobile/lib/db.ts`, and `mobile/lib/sync.ts`, but the app entry point is still a placeholder screen. The backend also already exposes the staff-facing contracts this mobile client needs: `/auth/login`, `/auth/refresh`, `/auth/me`, `/checkin/scan`, and `/checkin/sync`.

This change is therefore mostly a client orchestration and UX problem rather than a new backend domain feature. The design needs to support fast doorway usage, deterministic offline capture, and minimal operational overhead while staying inside the existing Expo app footprint.

Constraints that shape the design:
- The mobile app is for `checkin_staff` only.
- Existing offline queue behavior from ADR-CHK-003 and ADR-CHK-004 must remain the source of truth for replay.
- The current mobile project does not yet use Expo Router or a camera/scanner package.
- No new infrastructure or paid service should be introduced.

## Goals / Non-Goals

**Goals:**
- Replace the placeholder mobile screen with a working staff check-in flow.
- Let staff authenticate with existing backend auth endpoints and prevent non-`checkin_staff` users from using the app.
- Support fast online scan submission and predictable offline queue fallback using the existing SQLite helpers.
- Show queue state, sync outcomes, and duplicate/error feedback in language staff can act on quickly.
- Keep the first implementation small enough to ship without requiring a navigation rewrite or backend redesign.

**Non-Goals:**
- Introducing new backend attendance semantics or changing server-side idempotency behavior.
- Building background sync workers, push notifications, or device-enrollment features.
- Adding student/admin mobile views or a generalized navigation architecture for future roles.
- Implementing advanced local JWT verification beyond what is necessary for basic client-side sanity checks.

## Decisions

### ADR-MOB-001: Use a single stateful app shell in `mobile/App.tsx` for the first release

**Decision**

Implement the first release as one stateful app shell with conditional sections for login, active check-in workspace, and sync/queue status, rather than introducing Expo Router immediately.

**Reason**

The current mobile app already boots from `App.tsx`, and the functional gap is workflow wiring rather than route architecture. A single app shell minimizes moving parts, keeps the first release small, and avoids turning the change into a structural rewrite.

**Trade-off**

This keeps initial complexity down but may eventually need refactoring if the app grows beyond the check-in staff workflow.

**Alternatives considered**

- Adopt Expo Router now.
  Rejected because the current repository does not yet depend on it, and routing does not solve the main problem.
- Split the app into many custom screens without a router.
  Rejected because it adds indirection without much value for a tightly scoped workflow.

### ADR-MOB-002: Store auth session locally and gate the app by confirmed `checkin_staff` role

**Decision**

Add a small mobile auth client that logs in against `/auth/login`, persists the access and refresh tokens locally, restores the session on launch, refreshes tokens when needed, and blocks app access if `/auth/me` or the login response indicates a role other than `checkin_staff`.

**Reason**

Staff need a persistent sign-in flow so they can reopen the app and continue scanning without logging in repeatedly. Role gating in the mobile client reduces confusion when a valid but wrong-role account is used.

**Trade-off**

Token persistence adds sensitive local state that must be managed carefully, but it avoids repeated sign-ins during event operations.

**Alternatives considered**

- Require fresh login every app launch.
  Rejected because it slows staff and increases friction during event hours.
- Trust only the login response role without session validation.
  Rejected because the app should verify the restored session on launch for correctness.

### ADR-MOB-003: Use explicit connectivity-aware submission with queue fallback, not background sync

**Decision**

When a scan is submitted, the mobile app will attempt `POST /checkin/scan` if the device appears online. If connectivity is unavailable or the request fails before a domain result is returned, the app will enqueue the record in SQLite and surface it as pending sync. Queue replay will be manual through a visible “Sync now” action using the existing `syncPendingCheckins` helper.

**Reason**

This matches the existing backend design and keeps failure handling understandable for staff. Manual sync is simpler to reason about than background retry and still satisfies the core event need.

**Trade-off**

Some queued items may wait for an explicit user action, but the implementation stays simpler and more transparent.

**Alternatives considered**

- Always submit to the server and only queue after timeout.
  Rejected because it produces slower feedback on obviously offline devices.
- Add automatic background sync.
  Rejected for the first release because it adds lifecycle complexity and is not required to make the app usable.

### ADR-MOB-004: Add minimal mobile dependencies for QR capture and network-state awareness

**Decision**

Add only the dependencies required for the first shippable flow: a QR scanning package compatible with Expo and a connectivity-status package so the app can make a better online/offline decision before submitting.

**Reason**

The app currently has no scanning capability and no network awareness. These are direct product requirements for a practical check-in experience.

**Trade-off**

Any new package adds maintenance surface, but the operational cost remains zero and the feature cannot be completed without them.

**Alternatives considered**

- Keep text-only QR input for the whole release.
  Rejected because it is too slow and error-prone for doorway operation.
- Add more ambitious offline/background packages now.
  Rejected because they are not required for the MVP.

### ADR-MOB-005: Standardize staff-facing result mapping inside the mobile app

**Decision**

Map API and queue outcomes into a small set of staff-facing result cards: success, already checked in, queued offline, sync cleared, and sync retained with human-readable reasons.

**Reason**

The backend contracts are correct but low-level. The mobile app needs a consistent, fast-to-read presentation layer so staff can act without interpreting raw error codes.

**Trade-off**

This introduces a UI mapping layer, but it isolates presentation concerns from transport details and keeps the rest of the app simpler.

**Alternatives considered**

- Display raw API messages directly.
  Rejected because they are not optimized for event-floor speed or consistency.

## Risks / Trade-offs

- [Camera permissions are denied or unavailable] -> Provide a clear blocked state and a manual QR token input fallback for debugging or emergency use.
- [Stored access token expires during scanning] -> Refresh with the saved refresh token before surfacing a login-required state.
- [Connectivity appears online but the request still fails] -> Treat transport-level failures as queueable and keep domain errors as immediate results.
- [Staff resubmits sync repeatedly] -> Rely on the existing idempotent server behavior and show deterministic clear/retain counts after each sync.
- [Single-shell UI becomes hard to maintain] -> Keep state transitions explicit and isolate auth, sync, and submission helpers into `mobile/lib` modules so a later router migration is straightforward.

## Migration Plan

1. Add mobile auth/session helpers and the minimal dependencies for scanning/connectivity.
2. Replace the placeholder `App.tsx` with the staff workflow shell wired to existing API and SQLite helpers.
3. Validate login restoration, online scan, offline queueing, and manual sync behavior in Expo on at least one device or emulator.
4. If rollout issues appear, revert the mobile UI while leaving backend check-in contracts untouched.

**Rollback strategy**

- Revert the mobile app changes only; the backend check-in contracts can remain deployed because this change is a client on-ramp, not a schema migration.
- If scanning dependencies prove unstable, temporarily keep manual QR entry enabled while removing camera-based capture.

## Open Questions

- Should the first release require staff to enter or select a current workshop context, or should the QR payload alone determine the workshop every time?
- Is secure token storage required for the first release, or is the team comfortable starting with AsyncStorage-level persistence and tightening later?
- Do we want the pending queue list to show each record in detail, or is a count plus the last retained error enough for the first ship?

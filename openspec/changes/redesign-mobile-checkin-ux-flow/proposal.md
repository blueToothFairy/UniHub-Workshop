## Why

The current mobile check-in app presents sign-in, workshop context, capture tools, queue state, and logs as separate or stacked utility screens instead of one guided operator workflow. This matters now because check-in staff need a faster, lower-cognitive-load experience at workshop doors, especially when switching between online scanning, offline queue review, and audit visibility under time pressure.

## What Changes

- Redesign the mobile check-in UX into a staged flow: sign in, choose workshop, operate capture with queue visibility, and review logs.
- Replace the current long-scroll main workspace with a role-focused operator surface that prioritizes scanning and immediate feedback.
- Introduce a dedicated workshop-selection experience that acts as preflight before entering the capture workspace when no workshop is active.
- Reframe pending queue visibility as an always-nearby operational status element instead of a late-page summary.
- Reposition logs as an accessible secondary view for audit and troubleshooting instead of a separate top-level escape from the main task.
- Preserve existing online scan, offline queue, workshop sync, and local log behaviors while changing how staff navigate and understand them.

## Capabilities

### New Capabilities
- `mobile-checkin-operator-flow`: Guided mobile flow for staff login, workshop preflight, capture workspace, pending queue awareness, and log access.

### Modified Capabilities
- None.

## Impact

- Affected code: `mobile/App.tsx`, supporting mobile UI helpers/styles, and any route/state structure needed to separate login, workshop selection, operator workspace, and logs.
- Affected systems: Expo mobile app for `checkin_staff` users only; no backend API contract changes are required.
- Dependencies: existing Expo camera, local SQLite queue/log storage, authentication/session handling, and workshop cache remain in use.
- Success criteria: staff can reach an active capture screen in at most 3 guided steps after sign-in, queue count remains visible from the capture workspace, and logs stay reachable within 1 navigation action.

## Out of Scope

- Changing backend check-in validation, sync contracts, roster APIs, or dashboard attendance reads.
- Adding new student or organizer mobile features.
- Reworking QR verification rules, offline storage schema, or analytics beyond what is needed to support the new UX flow.

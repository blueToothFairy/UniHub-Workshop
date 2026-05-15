## Context

The current mobile check-in app already supports staff authentication, workshop caching, QR capture, offline queueing, manual sync, and local logs, but it exposes those capabilities as a long utility-style screen plus a separate logs view. Staff at workshop doors need a guided operator experience that makes the active workshop and the next scan action obvious, while still keeping queue state and logs close enough for recovery and audit.

This change is mobile-only and sits on top of existing check-in contracts. The design therefore focuses on navigation/state decomposition inside the Expo app rather than API or storage redesign. The current implementation lives largely in `mobile/App.tsx`, so the main technical challenge is separating concerns cleanly without regressing offline behavior.

## Goals / Non-Goals

**Goals:**
- Create a staged mobile flow with clear transitions between sign-in, workshop selection, operator capture workspace, and logs.
- Reduce cognitive load on the operator screen by making capture the primary action and moving secondary controls behind lower-emphasis affordances.
- Keep pending queue awareness visible from the main capture experience in both online and offline modes.
- Preserve all existing backend interactions, offline queue semantics, session restoration, and local log behavior while re-presenting them through a more intentional UX structure.
- Keep the redesign compatible with the current single-file app first, while allowing follow-up extraction into smaller screen components.

**Non-Goals:**
- Introducing new backend endpoints, changing sync payloads, or altering QR validation logic.
- Redesigning SQLite schemas, sync reconciliation logic, or server-side idempotency behavior.
- Adding analytics dashboards, new attendee detail views, or organizer tools in mobile.
- Requiring tablet-style literal split screen; phones remain the primary target layout.

## Decisions

### Decision 1: Model the mobile experience as a staged state machine instead of one long scroll

**Decision**

Represent the app as explicit workflow states: `signed_out`, `workshop_select`, `operator`, and `logs`, with `booting` remaining for restore. The operator state becomes the default post-selection home and owns capture plus compact queue status.

**Rationale**

The current `viewState = main | logs` split is too coarse for a real workflow. Adding a dedicated workshop selection state lets the app enforce preflight naturally and reduces the amount of conditional UI rendered on the operator screen.

**Alternatives considered**

- Keep one scroll screen and only reorder sections.
  Rejected because it still mixes setup, operation, and audit concerns.
- Introduce full Expo Router route restructuring immediately.
  Rejected for this change because the current app is still centralized and can gain most UX value through local state decomposition first.

### Decision 2: Treat workshop selection as preflight gating, not a collapsible sub-panel

**Decision**

If no workshop is selected after boot or sign-in, the app SHALL send staff into a workshop-selection screen before exposing capture controls. Once selected, workshop changes become a secondary action from the operator workspace.

**Rationale**

Scanning without clear context is the main operational risk. A dedicated preflight step makes the selected workshop feel authoritative and avoids burying selection controls in a crowded workspace.

**Alternatives considered**

- Continue allowing capture UI to render before selection.
  Rejected because it invites “why can’t I scan?” confusion and pushes validation errors too late.
- Let QR claims alone define the workshop context.
  Rejected because the existing check-in design intentionally uses explicit workshop context as a guardrail.

### Decision 3: Keep capture and queue in the same workspace, but with asymmetric emphasis

**Decision**

The operator workspace SHALL prioritize scan entry and result feedback while surfacing queue state as a compact status card or panel in the same screen. The queue summary stays visible without requiring a full navigation change, and deeper log details move to the logs screen.

**Rationale**

Door staff mostly alternate between “scan next attendee” and “do I need to sync or retry anything?” The queue must stay nearby, but it should not compete visually with capture.

**Alternatives considered**

- Put queue details only in logs.
  Rejected because queued/offline behavior is an active operational concern, not just historical audit data.
- Give queue and capture equal visual weight.
  Rejected because it dilutes the primary task and slows repeated scans.

### Decision 4: Promote logs to a secondary workspace reachable in one action from operator mode

**Decision**

Logs remain a dedicated screen, but navigation to logs SHALL be framed as secondary audit/troubleshooting from the operator workspace, with a direct return path back to operator mode.

**Rationale**

Logs contain detailed sync and device-scan history that is useful, but not part of the scan loop. Keeping them separate avoids clutter while still satisfying support and audit needs.

**Alternatives considered**

- Merge logs inline below the queue.
  Rejected because tabular history would dominate the operator surface on mobile.
- Hide logs behind settings-level navigation.
  Rejected because staff may need them during live operations.

### Decision 5: Preserve existing data operations and move UX semantics into view models/helpers

**Decision**

Existing auth, queue, sync, workshop cache, and result-card logic SHALL remain authoritative. The redesign should extract display-oriented helpers and state derivation where needed, but avoid changing operational functions unless required to support the new flow.

**Rationale**

The user request is about UX quality, not reworking validated check-in mechanics. Keeping business actions stable reduces regression risk and keeps implementation bounded.

**Alternatives considered**

- Refactor the entire mobile feature into a multi-file architecture before redesigning UI.
  Rejected because it increases delivery risk without being required to achieve the operator-flow improvement.

## Risks / Trade-offs

- [Risk] Navigation-state refactoring inside a single screen component could introduce regressions in session restore or auto-sync behavior. → Mitigation: keep existing side-effect functions intact and add focused UI-state tests/manual verification for boot, sign-in, workshop restore, and reconnect sync.
- [Risk] A dedicated workshop-selection step may feel slower for returning staff. → Mitigation: preserve persisted workshop restore so returning staff land directly in operator mode when a valid selection already exists.
- [Risk] Queue visibility may still be overlooked if the compact summary is too subtle. → Mitigation: show pending count in the operator header or primary status region and visually differentiate retry-needed items.
- [Risk] Scanner presentation changes can affect throughput if the camera is hidden behind too many taps. → Mitigation: keep scanner launch as the dominant primary action and cap the path from operator workspace to active scanner at one tap.

## Migration Plan

1. Introduce the new view-state model and split rendering paths for signed out, workshop selection, operator workspace, and logs.
2. Recompose the current main screen into smaller sections or local render helpers, keeping existing command handlers for login, workshop sync, scan submit, queue refresh, and log refresh.
3. Move queue summary into the operator workspace and demote session/workshop maintenance controls to secondary actions.
4. Retain current logs data sources while adjusting navigation entry and return behavior.
5. Verify restored sessions, restored selected workshop, online scanning, offline queueing, reconnect sync, and logs access manually.

**Rollback strategy**

- Revert to the prior single-scroll main screen and existing `main | logs` view split if the new workflow introduces operational confusion or regressions.
- No backend, database, or API rollback is required because this change is presentation-only.

## Open Questions

- Should the operator workspace open the camera automatically on entry when permission is already granted, or should scanner launch remain explicitly user-driven?
- Should queue detail remain a compact summary only in this change, with retained-item drilldown deferred to logs?
- Is it worth introducing Expo Router screen files during implementation, or should the first pass stay within `mobile/App.tsx` plus extracted local components?

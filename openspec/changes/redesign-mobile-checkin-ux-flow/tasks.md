## 1. Workflow state decomposition

- [x] 1.1 Define the mobile view-state types and screen-entry rules for `booting`, `signed_out`, `workshop_select`, `operator`, and `logs` in `mobile/App.tsx` or extracted mobile types, based on spec `mobile-checkin-operator-flow` and design Decision 1.
- [x] 1.2 Refactor top-level render branching so restored sessions route to workshop selection or operator mode according to active workshop availability, based on spec requirement "Staff sign-in SHALL lead into an operator workflow" and design Decisions 1 and 2.
- [ ] 1.3 Run a manual smoke test for boot, sign-in, session restore, and sign-out transitions to confirm pending offline check-ins remain preserved, based on spec requirement "Staff sign-in SHALL lead into an operator workflow".

## 2. Workshop preflight experience

- [x] 2.1 Rework the current workshop section into a dedicated workshop-selection step that blocks capture access until a workshop is active, based on spec requirement "Workshop selection SHALL act as preflight for capture" and design Decision 2.
- [x] 2.2 Preserve and surface cached workshop metadata plus offline title/room filtering inside the preflight step, based on spec requirement "Workshop selection SHALL act as preflight for capture".
- [x] 2.3 Move workshop maintenance actions such as refresh, sync roster/cancellations, and change/clear selection into secondary controls that do not compete with the selection decision, based on design Decisions 2 and 5.
- [ ] 2.4 Run a manual smoke test for empty cache, offline cached search, workshop selection, workshop change, and workshop clear behavior, based on spec requirement "Workshop selection SHALL act as preflight for capture".

## 3. Operator workspace and queue-aware capture

- [x] 3.1 Recompose the main check-in UI into an operator workspace that emphasizes scanner/manual token entry, active workshop context, and immediate result feedback, based on spec requirement "Operator workspace SHALL prioritize capture while keeping queue awareness visible" and design Decision 3.
- [x] 3.2 Add a persistent queue summary within the operator workspace showing pending total and retry-needed state without requiring navigation to logs, based on spec requirement "Operator workspace SHALL prioritize capture while keeping queue awareness visible".
- [x] 3.3 Demote session and maintenance controls to secondary actions while keeping sync actions available when operationally relevant, based on design Decisions 3 and 5.
- [ ] 3.4 Verify online and offline operator behavior manually, including scan submission, offline queueing, result feedback, and reconnect sync visibility, based on spec requirement "Operator workspace SHALL prioritize capture while keeping queue awareness visible".

## 4. Logs access and navigation polish

- [x] 4.1 Adjust navigation affordances so logs are reachable within one action from operator mode and return directly to the same active workshop context, based on spec requirement "Logs SHALL remain reachable as a secondary audit view" and design Decision 4.
- [x] 4.2 Refresh the logs screen copy and layout emphasis so sync history and local check-in history read as audit/troubleshooting tools rather than the primary workflow, based on design Decision 4.
- [ ] 4.3 Run a manual smoke test for opening logs, refreshing logs, and returning to operator mode with context preserved, based on spec requirement "Logs SHALL remain reachable as a secondary audit view".

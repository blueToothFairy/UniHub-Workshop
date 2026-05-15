## ADDED Requirements

### Requirement: Staff sign-in SHALL lead into an operator workflow
The mobile app SHALL treat staff sign-in as the first step of a guided operator workflow for check-in staff. After session restore or successful sign-in, the app MUST route staff to workshop selection when no workshop is active, and MUST route staff to the operator workspace when a previously selected workshop is still available locally.

#### Scenario: Restored session without workshop selection
- **WHEN** the app restores a valid staff session and no workshop is selected on the device
- **THEN** the app SHALL show the workshop-selection step before any capture controls

#### Scenario: Restored session with workshop selection
- **WHEN** the app restores a valid staff session and a selected workshop is still available in local cache
- **THEN** the app SHALL open the operator workspace with that workshop as the active context

#### Scenario: Sign-out resets workflow entry
- **WHEN** the staff user signs out
- **THEN** the app SHALL return to the sign-in screen while preserving pending offline check-ins on the device

### Requirement: Workshop selection SHALL act as preflight for capture
The mobile app SHALL require an explicit workshop context before staff can access the operator capture workspace. The workshop-selection step MUST support offline filtering over cached workshops by title and room/location, and MUST expose workshop metadata needed for staff to confirm the selected session.

#### Scenario: No cached workshops available
- **WHEN** the staff user enters workshop selection and the device has no cached workshops
- **THEN** the app SHALL explain that capture cannot begin until workshop data is refreshed while online

#### Scenario: Staff filters cached workshops
- **WHEN** the staff user enters search text on the workshop-selection step
- **THEN** the app SHALL filter cached workshops by title and room/location without requiring a network request

#### Scenario: Workshop selected
- **WHEN** the staff user selects a workshop from the cached list
- **THEN** the app SHALL store that workshop as the active context and enter the operator workspace

### Requirement: Operator workspace SHALL prioritize capture while keeping queue awareness visible
The mobile app SHALL present an operator workspace where scan capture is the primary action and pending queue awareness remains visible without leaving the screen. The workspace MUST show the active workshop, online/offline state, an immediate path to scanner or manual token entry, recent result feedback, and a visible queue summary that distinguishes total pending items from retry-needed items when such data exists.

#### Scenario: Operator workspace while online
- **WHEN** the staff user is in the operator workspace and the device is online
- **THEN** the app SHALL show capture as the dominant action and SHALL expose queue status and sync actions as secondary operational controls

#### Scenario: Operator workspace while offline
- **WHEN** the staff user is in the operator workspace and the device is offline
- **THEN** the app SHALL continue to allow offline capture, SHALL keep queue counts visible, and SHALL clearly indicate that sync requires reconnection

#### Scenario: Scan result feedback
- **WHEN** a scan or manual token submission completes
- **THEN** the app SHALL show immediate result feedback in the operator workspace without forcing navigation away from the next capture action

### Requirement: Logs SHALL remain reachable as a secondary audit view
The mobile app SHALL provide a dedicated logs view for sync history and recent device-stored check-ins, reachable within one navigation action from the operator workspace. Returning from logs MUST restore the operator workspace without requiring workshop reselection.

#### Scenario: Open logs from operator workspace
- **WHEN** the staff user chooses to review logs from the operator workspace
- **THEN** the app SHALL open a logs view that shows sync attempts and recent local check-in records

#### Scenario: Return from logs
- **WHEN** the staff user leaves the logs view
- **THEN** the app SHALL return to the same operator workspace context with the active workshop preserved

## ADDED Requirements

### Requirement: Student workshop list supports backend-powered discovery controls
The system SHALL allow student web clients to narrow the published current-month workshop list using backend-powered search and filter controls on the workshop listing page.

#### Scenario: Student searches workshops by text
- **GIVEN** student web client is online
- **WHEN** the student enters search text on the listing page
- **THEN** the frontend MUST request updated discovery results from the backend and MUST render workshops matching the active search query

#### Scenario: Student filters workshops by payment mode
- **GIVEN** student web client is online
- **WHEN** the student selects a payment mode filter
- **THEN** the UI MUST show only workshops whose returned `paymentRequired` state matches the selected filter

#### Scenario: Student filters workshops by seat availability
- **GIVEN** student web client is online
- **WHEN** the student enables the available-only filter
- **THEN** the UI MUST show only workshops whose returned `availableSeats` value is greater than zero

#### Scenario: Student combines search and filters
- **GIVEN** student web client is online
- **WHEN** the student applies search text and one or more filters together
- **THEN** the UI MUST show only workshops that satisfy all active discovery criteria in the backend response

### Requirement: Discovery UI exposes result count, empty state, and reset behavior
The system SHALL make the outcome of workshop discovery actions explicit so students can understand and recover from restrictive criteria.

#### Scenario: Discovery results remain available
- **GIVEN** student web client is online and one or more discovery controls are active
- **WHEN** at least one workshop matches the current criteria
- **THEN** the UI MUST display the number of matching workshops and render only those matching cards

#### Scenario: No workshops match the current criteria
- **GIVEN** student web client is online and one or more discovery controls are active
- **WHEN** no workshop matches the current criteria
- **THEN** the UI MUST show a dedicated empty-result state and MUST offer a clear way to reset or clear the active discovery controls

#### Scenario: Student clears active discovery criteria
- **GIVEN** student web client is online and one or more discovery controls are active
- **WHEN** the student clears the active discovery controls
- **THEN** the UI MUST restore the default published monthly workshop list order and visible result set

### Requirement: Discovery behavior declares idempotency and connectivity limits
The system MUST make repeated discovery requests predictable and declare how discovery behaves when online search is unavailable.

#### Scenario: Repeated discovery request with same criteria
- **GIVEN** workshop data has not changed
- **WHEN** the client repeats the same discovery request with the same query parameters
- **THEN** the system MUST return a semantically equivalent result set

#### Scenario: Student is offline during discovery
- **GIVEN** student web client is offline
- **WHEN** the student attempts to search or refresh filtered workshop discovery
- **THEN** no offline search cache is provided by this capability and the UI MUST show an unavailable or retry-oriented state

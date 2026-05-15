## ADDED Requirements

### Requirement: Staff can search workshops from cached list
The staff mobile check-in app SHALL provide a text search input inside the workshop picker that filters the locally cached workshop list.

#### Scenario: Search filters by workshop title
- **WHEN** staff enters a query that matches a cached workshop title
- **THEN** the picker shows only cached workshops whose title contains the query

#### Scenario: Search filters by room/location
- **WHEN** staff enters a query that matches a cached workshop room/location
- **THEN** the picker shows only cached workshops whose room/location contains the query

#### Scenario: Search is case-insensitive and diacritics-insensitive
- **WHEN** staff enters a query without matching case or Vietnamese diacritics
- **THEN** the picker still matches the cached workshop title/room text

#### Scenario: Search works while offline
- **WHEN** the device is offline
- **THEN** staff can still search and filter the cached workshop list without network calls

#### Scenario: Empty query shows full cached list
- **WHEN** the search query is empty
- **THEN** the picker shows the full cached workshop list

#### Scenario: No matches shows an empty hint
- **WHEN** the search query yields no matches
- **THEN** the picker shows a “no matches” hint and no workshop items

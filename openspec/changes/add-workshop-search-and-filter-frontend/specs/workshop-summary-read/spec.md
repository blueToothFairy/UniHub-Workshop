## MODIFIED Requirements

### Requirement: Workshop detail read API exposes summary state consistently
The system SHALL expose workshop summary fields and registration-facing checkout context in read APIs for student web clients.

#### Scenario: Read workshop with generated summary and payment context
- **GIVEN** workshop has `summary_status=ready`
- **WHEN** client calls workshop detail API
- **THEN** response MUST include `pdf_url`, `ai_summary`, `summary_status`, `summary_generated_at`, `payment_required`, and registration-facing seat availability fields used by checkout CTA decisions

#### Scenario: Read workshop during processing
- **GIVEN** workshop has `summary_status=processing`
- **WHEN** client calls workshop detail API
- **THEN** response MUST include `summary_status=processing` and clients MUST NOT receive stale previous summary

## ADDED Requirements

### Requirement: Workshop list read supports search and filter query parameters
The public monthly workshop list endpoint SHALL support discovery query parameters while preserving the existing list response shape for student clients.

#### Scenario: Read monthly workshop list without search query
- **GIVEN** student web client is online
- **WHEN** client calls `GET /workshops` without discovery query parameters
- **THEN** the API MUST return the default published current-month workshop list response shape

#### Scenario: Read monthly workshop list with search and filters
- **GIVEN** student web client is online
- **WHEN** client calls `GET /workshops` with supported discovery query parameters such as `q`, `payment`, or `available_only`
- **THEN** the API MUST return the same top-level response shape with workshops limited to published current-month workshops matching the supplied discovery criteria

#### Scenario: Invalid discovery query parameter
- **GIVEN** client supplies an unsupported discovery query parameter value
- **WHEN** the API validates the request
- **THEN** the API MUST return HTTP `400` with body shape `{ "error": { "code": "INVALID_DISCOVERY_QUERY", "message": string } }`

#### Scenario: Search backend unavailable for query-driven discovery
- **GIVEN** client supplies a text search query and the Elasticsearch backend is unavailable
- **WHEN** the API cannot complete the search request
- **THEN** the API MUST return HTTP `503` with body shape `{ "error": { "code": "WORKSHOP_SEARCH_UNAVAILABLE", "message": string } }`

### Requirement: Workshop list read exposes discovery fields for student listing UX
The system SHALL expose enough workshop list data for the student monthly listing page to render cards and apply discovery controls without additional workshop-detail reads.

#### Scenario: Student reads monthly workshop list for discovery
- **GIVEN** student web client is online
- **WHEN** client calls the published monthly workshop list endpoint
- **THEN** each workshop list item MUST include `id`, `title`, `description`, `speakerName`, `room` or equivalent display location, `startsAt`, `availableSeats`, and `paymentRequired`

#### Scenario: Student receives filtered discovery results
- **GIVEN** student web client has requested workshop discovery with search or filters
- **WHEN** the API returns matching workshop list items
- **THEN** the frontend MUST be able to render discovery cards and empty-state decisions from the list payload alone without requiring `GET /workshops/:id`

### Requirement: Workshop list read operation is idempotent
The workshop list discovery read operation MUST be idempotent.

#### Scenario: Repeated GET with unchanged data and criteria
- **GIVEN** no workshop data changes between requests
- **WHEN** client performs repeated `GET /workshops` calls with the same discovery query parameters
- **THEN** the API MUST return semantically equivalent workshop list results in both responses

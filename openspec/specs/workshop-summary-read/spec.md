## ADDED Requirements

### Requirement: Workshop detail read API exposes summary state consistently
The system SHALL expose workshop summary fields in read APIs for both admin and student web clients.

#### Scenario: Read workshop with generated summary
- **GIVEN** workshop has `summary_status=ready`
- **WHEN** client calls workshop detail API
- **THEN** response MUST include `pdf_url`, `ai_summary`, `summary_status`, and `summary_generated_at`

#### Scenario: Read workshop during processing
- **GIVEN** workshop has `summary_status=processing`
- **WHEN** client calls workshop detail API
- **THEN** response MUST include `summary_status=processing` and clients MUST NOT receive stale previous summary

### Requirement: Error contract for workshop read failures
The API MUST return explicit HTTP codes and error body shape for summary-related read failures.

#### Scenario: Workshop not found
- **GIVEN** requested workshop id does not exist
- **WHEN** client calls detail endpoint
- **THEN** API MUST return HTTP `404` with body shape `{ "error": { "code": "WORKSHOP_NOT_FOUND", "message": string } }`

#### Scenario: Unauthorized read on protected admin endpoint
- **GIVEN** unauthenticated user requests admin detail endpoint
- **WHEN** auth check fails
- **THEN** API MUST return HTTP `401` with body shape `{ "error": { "code": "UNAUTHORIZED", "message": string } }`

### Requirement: Read operation idempotency
Workshop summary read operation MUST be idempotent.

#### Scenario: Repeated GET returns same state when no write occurs
- **GIVEN** no update is made between two requests
- **WHEN** client performs repeated GET for same workshop
- **THEN** API MUST return semantically equivalent summary fields in both responses

### Requirement: Online/offline behavior for consumers
The system MUST declare how read behavior differs by client mode.

#### Scenario: Web online read
- **GIVEN** student/admin web client has network connectivity
- **WHEN** calling workshop detail API
- **THEN** latest persisted summary state MUST be returned from backend

#### Scenario: Offline client behavior
- **GIVEN** client is offline
- **WHEN** attempting to fetch workshop summary from API
- **THEN** no offline summary sync is provided by this capability and client MUST show offline/unavailable state

---

Implemented-by: openspec/changes/view-workshop-for-student

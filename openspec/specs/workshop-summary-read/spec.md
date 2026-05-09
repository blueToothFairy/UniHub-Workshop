## Purpose
Define the API and UX-facing contract for reading workshop summary and registration context safely and consistently.

## Requirements

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

### Requirement: Student checkout CTA aligns with redirect payment flow
The workshop read + student UX contract MUST support MoMo redirect checkout instead of simulation action.

#### Scenario: Paid workshop with available seats
- **WHEN** client reads a paid published workshop with available seats
- **THEN** frontend MUST render registration CTA that leads to provider checkout redirect flow after registration API response

#### Scenario: Full workshop regardless of payment mode
- **WHEN** workshop has no available seats
- **THEN** frontend MUST disable paid/free registration CTA consistently and MUST NOT expose payment redirect action

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

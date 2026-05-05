## ADDED Requirements

### Requirement: Asynchronous AI summary generation from workshop PDF
The system SHALL generate workshop summaries asynchronously after PDF upload using BullMQ and Gemini, following ADR-009 and ADR-012.

#### Scenario: Successful async generation flow
- **GIVEN** organizer has uploaded a valid PDF for an existing workshop
- **WHEN** the upload API returns `202 Accepted`
- **THEN** a queue job `ai-summary.generate` MUST be enqueued and workshop summary status MUST become `processing`

#### Scenario: Summary becomes ready after worker success
- **GIVEN** an `ai-summary.generate` job is being processed
- **WHEN** Gemini returns summary text
- **THEN** system MUST persist `ai_summary`, set `summary_status=ready`, and set `summary_generated_at`

### Requirement: Fallback and retry behavior for error scenarios
The system MUST handle non-happy paths without crashing user flows, and MUST apply retry policy defined in ADR-009.

#### Scenario: Gemini rate limit retry
- **GIVEN** Gemini responds with rate-limit error
- **WHEN** worker handles that failure
- **THEN** worker MUST retry up to 3 times with 60-second delay before marking the job failed

#### Scenario: Error response contract for failed upload
- **GIVEN** organizer sends invalid upload request
- **WHEN** file is not PDF or exceeds 10MB
- **THEN** API MUST return HTTP `400` with body shape `{ "error": { "code": string, "message": string } }`

### Requirement: Idempotent final write for summary updates
The worker MUST write summary state in an idempotent manner so duplicate job delivery does not produce conflicting final state.

#### Scenario: Duplicate job delivery
- **GIVEN** same workshop has duplicate `ai-summary.generate` jobs due to retry/at-least-once delivery
- **WHEN** both jobs attempt final DB update
- **THEN** system MUST keep a single consistent terminal state (`ready`, `fallback`, or `failed`) based on latest valid write and MUST NOT create duplicate workshop records

### Requirement: Online/offline behavior declaration
The capability MUST explicitly distinguish web online requirements from mobile offline expectations.

#### Scenario: Web clients require online API access
- **GIVEN** admin/student uses web frontend
- **WHEN** requesting upload or summary data
- **THEN** behavior MUST require online backend connectivity; no offline summary generation is supported

#### Scenario: Mobile check-in app unaffected
- **GIVEN** check-in staff uses mobile app offline mode
- **WHEN** this capability is deployed
- **THEN** existing mobile offline check-in behavior MUST remain unchanged because AI summary is web/admin scope only

## ADDED Requirements

### Requirement: Admin PDF upload contract
The system SHALL expose an admin-only endpoint to upload workshop PDFs and return `202 Accepted` when the file is queued for processing.

#### Scenario: Successful upload
- **GIVEN** authenticated organizer requests upload with valid PDF <=10MB
- **WHEN** request is accepted
- **THEN** API MUST return `202 Accepted` and response MUST include `pdf_url` and `summary_status=processing`

#### Scenario: Validation errors
- **GIVEN** invalid file type or size
- **WHEN** organizer submits upload
- **THEN** API MUST return `400` with body `{ "error": { "code": "INVALID_FILE", "message": string } }`

#### Scenario: Unauthorized
- **GIVEN** unauthenticated or unauthorized user
- **WHEN** trying to upload
- **THEN** API MUST return `401` or `403` depending on authentication vs authorization failure

### Requirement: Idempotency for upload markers
If an organizer retries a previously accepted upload, the system MUST be resilient to duplicate uploads and should avoid duplicate job enqueues for identical content when possible.

#### Scenario: Duplicate upload attempts
- **GIVEN** same file is uploaded multiple times
- **WHEN** the system detects matching file hash
- **THEN** it SHOULD avoid re-enqueueing jobs and SHOULD allow admin to force replace if desired

### Requirement: Storage behavior
Uploaded PDF files SHALL be stored in configured storage (Cloudinary by default) and the returned `pdf_url` MUST be usable by worker processes. If storage is private, system MUST supply signed-access for worker fetch.

#### Scenario: Private storage
- **GIVEN** storage requires signed access
- **WHEN** worker attempts to fetch PDF
- **THEN** system MUST provide signed URL or include inline bytes in job payload to enable worker processing

### Non-functional: Latency and size
- **GIVEN** a 5MB PDF
- **WHEN** upload occurs
- **THEN** API SHALL accept and return `202` in under `2s` on a standard dev machine

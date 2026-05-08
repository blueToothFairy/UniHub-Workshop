## ADDED Requirements

### Requirement: Organizer can upload workshop PDF asynchronously
The system SHALL allow only organizer-role users to upload PDF files to a workshop and receive immediate async acknowledgment.

#### Scenario: Organizer upload success response
- **GIVEN** authenticated user with role `organizer` uploads a valid PDF (<=10MB)
- **WHEN** API `POST /admin/workshops/:id/pdf` processes request
- **THEN** API MUST return HTTP `202` with body shape `{ "data": { "status": "processing", "workshop_id": string } }`

#### Scenario: Forbidden for non-organizer
- **GIVEN** authenticated user with role different from `organizer`
- **WHEN** user calls upload endpoint
- **THEN** API MUST return HTTP `403` with body shape `{ "error": { "code": "FORBIDDEN", "message": string } }`

### Requirement: Upload validation and storage contract
The upload endpoint MUST validate file constraints and persist PDF metadata before enqueueing summary job.

#### Scenario: Reject invalid mime type
- **GIVEN** organizer uploads non-PDF file
- **WHEN** endpoint validates content
- **THEN** API MUST return HTTP `400` with body shape `{ "error": { "code": "INVALID_PDF_TYPE", "message": string } }`

#### Scenario: Reject oversized PDF
- **GIVEN** organizer uploads a file larger than 10MB
- **WHEN** endpoint validates size
- **THEN** API MUST return HTTP `400` with body shape `{ "error": { "code": "PDF_TOO_LARGE", "message": string } }`

#### Scenario: Persist metadata then enqueue
- **GIVEN** valid PDF upload
- **WHEN** file is stored in Cloudinary successfully
- **THEN** system MUST update workshop `pdf_url`, reset existing `ai_summary`, set `summary_status=processing`, and only then enqueue queue job

### Requirement: Upload operation idempotency declaration
Upload operation MUST be explicitly non-idempotent unless client reuses identical payload semantics.

#### Scenario: Re-upload same file
- **GIVEN** organizer uploads the same PDF twice at different times
- **WHEN** second request is accepted
- **THEN** system MUST treat as a new upload version, reset summary state again, and enqueue a new processing job

### Requirement: Admin can override generated summary manually
The system SHALL allow organizer to manually edit and save `ai_summary` regardless of AI worker outcome.

#### Scenario: Override after fallback
- **GIVEN** workshop summary status is `fallback`
- **WHEN** organizer saves manual summary text
- **THEN** system MUST persist override text and set status to `ready`

## ADDED Requirements

### Requirement: Upload PDF workshop description
Admins SHALL upload PDF files for workshops via POST `/admin/workshops/:id/pdf` accepting file upload (multipart/form-data). System SHALL validate file: must be PDF, max 2MB, scan for malware (optional). Upon success, system SHALL store file in Cloudflare R2 (or self-hosted storage), save metadata (filename, size, upload timestamp, uploader) to PostgreSQL, and return 200 with file reference URL.

#### Scenario: Successful PDF upload
- **WHEN** admin uploads valid PDF file for workshop
- **THEN** system stores file in R2, saves metadata, and returns success with file URL

#### Scenario: PDF upload triggers AI summary
- **WHEN** admin uploads PDF
- **THEN** system emits PDFUploaded event to AI summary queue

#### Scenario: Reject non-PDF file
- **WHEN** admin tries to upload non-PDF file (e.g., .docx)
- **THEN** system returns 400 Bad Request with message "Only PDF files allowed"

#### Scenario: Reject file exceeding size limit
- **WHEN** admin tries to upload PDF > 2MB
- **THEN** system returns 413 Payload Too Large

### Requirement: AI-powered summary generation
Upon PDFUploaded event, system SHALL extract text from PDF, call Gemini API (free tier 60 RPM limit) with prompt to generate 2-3 sentence summary, store summary in PostgreSQL workshops.description_summary field, and emit SummaryGenerated event. If API fails or rate limit hit, system SHALL retry with exponential backoff (max 3 retries). If all retries fail, system SHALL log error and notify admin.

#### Scenario: Successful summary generation
- **WHEN** PDF is uploaded
- **THEN** system extracts text, calls Gemini API, and stores summary within 60 seconds

#### Scenario: Summary generation respects rate limit
- **WHEN** multiple PDFs uploaded exceeding 60 RPM Gemini limit
- **THEN** queue worker respects limit and delays subsequent calls

#### Scenario: Summary generation fails after retries
- **WHEN** Gemini API is unavailable and retries exhausted
- **THEN** system logs error, saves PDF as is (without summary), and alerts admin

### Requirement: Display PDF and summary in workshop detail
Students and admins SHALL view workshop detail page showing uploaded PDF link and auto-generated summary. PDF link SHALL open in new tab/modal. Summary SHALL be displayed as plain text, editable by admins via PUT `/admin/workshops/:id/description-summary` to override AI-generated text.

#### Scenario: Student views workshop with PDF
- **WHEN** student views workshop detail for workshop with uploaded PDF
- **THEN** page displays PDF link and generated summary

#### Scenario: Admin overrides AI summary
- **WHEN** admin edits summary text via admin panel
- **THEN** system updates description_summary and stores override flag

## Why

The workshop process currently lacks the ability to automatically summarize PDF content for students. This slows down information updates and creates additional manual work for the organizing committee right before the peak registration period.

## What Changes

*   Add a PDF upload flow for workshops by the `organizer`, validate the PDF format, and limit the file size to 10MB.
*   Store the PDF file in Cloudinary, update `workshops.pdf_url`, and reset `workshops.ai_summary` upon a new upload.
*   Add asynchronous processing via BullMQ to call the Gemini API, and then update `workshops.ai_summary` and `summary_generated_at`.
*   Add a fallback mechanism for when the Gemini API errors out: the system should not crash, but rather return a fallback message and allow the admin to override it manually.
*   Add a retry policy for Gemini rate-limit errors: maximum 3 retries, with a 60-second delay.
*   Add an API/response contract so the admin frontend can track the processing status (`processing/ready/fallback`) and the student frontend can read the summary when available.
*   Quantitative success criteria:
    *   A 5MB PDF upload returns `202 Accepted` in `< 2s`.
    *   The summary appears on the workshop page in `< 60s` after a successful upload.
    *   Unrecoverable failed job rate (after retries) is `< 1%` during internal smoke testing.
*   Out of Scope:
    *   OCR for scanned-image PDFs.
    *   Advanced content moderation beyond basic checks.
    *   Automatic multi-language translation or personalized summaries for individual users.

## Capabilities

### New Capabilities
*   `ai-summary`: Automatically generate workshop summaries from PDFs using an async BullMQ + Gemini flow, including a fallback mechanism and admin override capability.
*   `admin-workshop-pdf`: Support admins in uploading/updating PDFs and observing the summary processing status per workshop.
*   `workshop-summary-read`: Provide a contract for reading the summary/fallback to ensure consistent display across student and admin interfaces.

### Modified Capabilities
*   None.

## Impact

*   **Backend modules:** `admin`, `ai-summary`, `workshop`, `shared/infra/queue`, `workers`.
*   **Frontend:** admin workshop page (upload/override), student workshop detail page (display summary/fallback).
*   **Database:** add summary metadata columns (to workshops table in migrations) if not already present (`pdf_url`, `ai_summary`, `summary_generated_at`,  `processing_status`).
*   **External systems:** Clouudinary (file storage), Gemini API (AI summary), BullMQ + Upstash Redis (job queue).
*   **Infrastructure cost:** no new paid services or containers added; utilize the existing free-tiers (Cloudinary/Gemini/Upstash).
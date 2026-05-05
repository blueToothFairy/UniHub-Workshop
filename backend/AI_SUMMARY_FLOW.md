# AI Summary Request Flow

This document describes the complete request flow for the AI Summary feature: what the user does, how the frontend behaves, the server-side handling, storage and queue interactions, worker processing, retries, idempotency, and UI update behaviour.

## Actors
- Organizer (admin role) — uploads workshop PDF and may override summary.
- Frontend (Admin web) — presents upload UI, progress state, and override control.
- Backend API — handles upload, validation, metadata persistence, and queue production.
- Storage (Cloudinary) — stores PDF files and exposes public URLs.
- Queue (BullMQ) — job transport for asynchronous AI summary generation.
- Worker — consumes `ai-summary.generate` jobs, extracts text, calls Gemini, and writes final state.
- Database (Postgres/Supabase) — stores `workshops` table with summary metadata.

## High-level Flow
1. Organizer uploads PDF via admin UI.
2. Frontend sends `POST /admin/workshops/:id/pdf` with file as multipart/form-data or base64 payload.
3. Backend validates request (authz, mime type, size).
4. Backend stores PDF in Cloudinary using `CloudinaryPdfStorage.putPdf()` and obtains `pdf_url`.
5. Backend updates `workshops` row: set `pdf_url`, `ai_summary=null`, `summary_status='processing'`, `summary_generated_at=null`, `summary_error_code=null`.
6. Backend enqueues `ai-summary.generate` job with payload `{ workshopId, traceId, pdfUrl }` to BullMQ.
7. Frontend receives `202 Accepted` with `{ data: { status: 'processing', workshop_id } }` and shows processing state in UI.
8. Worker picks up job and calls `AiSummaryService.processSummaryJob(payload)`.
9. Worker fetches PDF bytes from Cloudinary via `CloudinaryPdfStorage.getPdf(url)`.
10. Worker extracts text (fallback: lightweight extractor) and truncates to token/char guard.
11. If extracted text empty → write `summary_status='fallback'` and `ai_summary=EMPTY_TEXT_FALLBACK`.
12. Otherwise, call Gemini via `GeminiSummarizer.summarizeVietnamese(text)`.
13. Apply retry policy for retryable errors (3 attempts, 60s delay for rate limits/5xx/timeouts).
14. On success: write `ai_summary`, `summary_status='ready'`, `summary_generated_at=NOW()`.
15. On permanent failure: write `summary_status='failed'` and `summary_error_code`.
16. Frontend polls or subscribes to changes and updates UI when status moves to `ready`/`fallback`.
17. Organizer can manually override summary via `PUT /admin/workshops/:id/summary`.

## API Contracts
### POST /admin/workshops/:id/pdf
- Auth: Organizer role required (`403` if not).
- Body: multipart/form-data (`file`) or JSON with `fileName`, `contentType`, `bytes` (base64).
- Validation:
  - `contentType` must be `application/pdf` → `400` `INVALID_PDF_TYPE`.
  - Size must be <=10MB → `400` `PDF_TOO_LARGE`.
- Success: `202 Accepted` with body: `{ "data": { "status": "processing", "workshop_id": string } }`.

### PUT /admin/workshops/:id/summary
- Auth: Organizer.
- Body: `{ "summary": string }`.
- Validation: non-empty → `400` `INVALID_SUMMARY`.
- Success: `200 OK` or `204 No Content`.

### GET /workshops/:id
- Returns `pdf_url`, `ai_summary`, `summary_status`, `summary_generated_at`.
- `404` `WORKSHOP_NOT_FOUND` if missing.

## Database Writes and Idempotency
- `markProcessing(workshopId, pdfUrl)` updates `pdf_url`, clears `ai_summary`, sets `summary_status='processing'`.
- Worker uses idempotency guard: it compares repository `pdf_url` against job `pdfUrl` and aborts if mismatched.
- Final writes (`markReady`, `markFallback`, `markFailed`) are idempotent updates to the same workshop row.

## Retry and Error Handling
- Retry policy implemented in `AiSummaryService.summarizeWithRetry()`.
- Retry only for retryable errors detected by message matching (`rate|429|temporar|timeout|5xx`).
- After MAX_RETRIES, worker marks the job as failed and records `summary_error_code`.
- Empty-text extraction triggers `fallback` with `EMPTY_TEXT_FALLBACK` message.

## Frontend Behavior
- Upload UI shows file selection and immediately POSTs to the API.
- On `202` response, UI shows `processing` state and polls `GET /workshops/:id` every few seconds or subscribes via WebSocket.
- When status becomes `ready`, show `ai_summary` text. When `fallback`, show fallback message and an edit button for manual override.

## Observability
- Logs: trace id, job attempts, Gemini latency, and final status.
- Metrics: queue attempts, retry counts, fallback count, Gemini error rate.

## Deployment Notes
- Required env variables for Cloudinary: `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`.
- Required env variables for Gemini: `GEMINI_API_KEY`.
- BullMQ requires `REDIS_URL` env.

## Security & Privacy
- PDFs may contain PII; ensure access controls applied to `pdf_url` if necessary.
- Consider signed URLs or restricted access if PDFs must be private.

## Troubleshooting
- If `summary_status` stays `processing`, verify the queue worker is running and connected to Redis.
- If Gemini calls fail, inspect Gemini API key and logs for rate-limit responses.

---

Document created programmatically by assistant.
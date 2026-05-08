## Overview

Provide a stable, public workshop detail API that returns the complete set of fields necessary for the student UI, including AI summary metadata. The design prioritizes correctness (no stale summary), low latency, and cacheability.

## API contract

Endpoint: `GET /workshops/:id`

Response (200):

{
  "data": {
    "id": string,
    "title": string,
    "description": string,
    "speakerName": string,
    "room": string,
    "startsAt": string, // ISO8601
    "endsAt": string, // ISO8601
    "capacity": number,
    "confirmedRegistrations": number,
    "priceVnd": number,
    "paymentRequired": boolean,
    "status": string, // draft|published|cancelled
    "pdfUrl": string | null,
    "aiSummary": string | null,
    "summaryStatus": "idle" | "processing" | "ready" | "fallback" | "failed",
    "summaryGeneratedAt": string | null,
    "summaryErrorCode": string | null,
    "createdAt": string,
    "updatedAt": string
  }
}

Error responses:
- 404 `{ "error": { "code": "WORKSHOP_NOT_FOUND", "message": string } }`
- 401/403 if access restricted (not expected for public student view but included for deployments that gate access)
- 500 `{ "error": { "code": "INTERNAL_SERVER_ERROR", "message": string } }`

## Behavioral rules

- When `summaryStatus` is `processing`, `aiSummary` MUST be `null` (do not surface an older summary while processing a new upload).
- When `summaryStatus` is `ready`, `aiSummary` MUST include the latest persisted summary string and `summaryGeneratedAt` must be non-null.
- When `summaryStatus` is `fallback`, `aiSummary` SHOULD contain the fallback summary text and `summaryErrorCode` SHOULD explain the failure.

## Implementation notes

- Reuse existing DB-to-DTO mapper used in `AdminService#getWorkshopDetail` but create a dedicated public-facing mapping function (e.g., `toPublicWorkshopDto`) to avoid leaking admin-only fields in future.
- Prefer a small service function `WorkshopService.getPublicWorkshop(id)` that performs the DB read and mapping. This keeps router thin and testable.
- Add ETag/Last-Modified headers computed from `updated_at`.
- Use `Cache-Control: public, max-age=30, stale-while-revalidate=60` as a suggestion for frontend caching of read-heavy pages.

## Testing

- Unit tests: mapping function and edge-cases for `processing` vs `ready` vs `fallback`.
- Integration test: API returns correct shapes and headers (ETag), and repeated GETs behave idempotently when no write occurs.

## Frontend guidance

- Student page must render three summary states:
  - Processing: show loading indicator and message "Summary is being generated"
  - Ready: show `aiSummary` content
  - Fallback: show `aiSummary` with a subtle admin-provided override option (admin-only on UI)
- UI design must base on: `UI_DESIGN.md`


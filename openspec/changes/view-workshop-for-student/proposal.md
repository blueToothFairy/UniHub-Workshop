## Why

Students need a reliable, consistent workshop detail view that includes the AI-generated summary when available. Currently the repository contains admin-focused APIs and AI summary generation flows, but the student-facing contract and UX expectations are not captured as a standalone change. This leads to subtle inconsistencies between admin and student views and can cause stale or confusing summary presentation.

## What this change delivers

- Add a well-defined student-facing workshop detail capability that exposes the required workshop fields and AI summary metadata consistently.
- Provide an explicit API contract for `GET /workshops/:id` (student/public) that documents response shape, error contracts, and caching expectations.
- Clarify how `summary_status` maps to UI behavior (processing, ready, fallback) and ensure the API does not return stale summary content while `summary_status` is `processing`.
- Provide non-functional SLOs and testing expectations so frontend and QA teams can validate behavior.

## Success criteria

- `GET /workshops/:id` returns the documented JSON shape and status codes in all supported cases (ready/processing/fallback/not-found).
- Student UI can render `processing`, `ready`, and `fallback` states without showing stale summaries.
- Integration tests cover the three summary states and validate caching/ETag behavior.

## Scope and out-of-scope

In scope:
- Backend API contract and tests for student workshop read.
- Spec and frontend guidance for student UI rendering of summary states.

Out of scope:
- Implementing AI summarization or storage changes (already part of other changes).
- Offline sync or client-side caching beyond suggested headers.

## Impact

- Backend modules: `workshop` (router/service), small updates to `shared` mapping helpers.
- Frontend: student workshop detail page (consume new fields and render states).
- Database: none (reads only; relies on existing columns `pdf_url`, `ai_summary`, `summary_status`, `summary_generated_at`).

## Artifacts created
- `specs/workshop-summary-read/spec.md` (reference) — this change will reuse that spec and provide implementation tasks.
 
Note: This change is intended to be lightweight and apply quickly so frontend teams can begin integration testing against a stable read contract.


# Release notes for change: view-workshop-for-student

Summary:
- Adds a stable public API contract for `GET /workshops/:id` consumed by the student UI.
- Ensures `aiSummary` is not exposed while a new summary is `processing` to avoid stale content.
- Adds HTTP caching headers (`ETag`, `Last-Modified`, `Cache-Control`) to improve read performance for student pages.

Developer notes:
- Backend: `src/modules/workshop` updated.
- Frontend: student detail page already consumes `summaryStatus` and `aiSummary` and requires no change.
- Tests: unit mapping test and basic integration check scripts added in `backend/scripts`.

How to validate (smoke):
1. Start backend: `npm run dev` (from `backend/`).
2. Open student workshop endpoint: `GET http://localhost:3000/workshops/<id>` (replace `<id>`).
3. Validate response JSON contains `summaryStatus` and that `aiSummary` is `null` when `summaryStatus` is `processing`.
4. Check HTTP headers: `ETag`, `Last-Modified`, and `Cache-Control: public, max-age=30, stale-while-revalidate=60`.

Rollout notes:
- Non-breaking read-only change; safe to deploy with existing frontend.
- Optionally coordinate with `add-ai-summary-feature` rollout if their `summary_status` semantics change.

## Why

Students need faster, more relevant workshop discovery than simple page-local substring filtering can provide, especially once monthly workshop volume and richer descriptions grow. We should upgrade this change now to use Elasticsearch-backed search so search quality improves without sacrificing authoritative workshop availability and registration behavior.

## What Changes

- Add Elasticsearch-backed text search for the student workshop listing experience.
- Extend the public monthly workshop list read contract to accept search and filter query parameters while preserving the existing workshop card payload shape.
- Keep payment mode and open-seat filtering available to students, but evaluate final workshop visibility from authoritative backend data rather than a stale browser snapshot.
- Add workshop search-index synchronization so organizer create/update/cancel actions are reflected in search results after indexing completes.
- Preserve the existing workshop detail and registration flows so this change improves discovery, not checkout or attendance behavior.

## Capabilities

### New Capabilities
- `workshop-discovery`: Student web clients can search and filter the published monthly workshop list through a backend-powered discovery flow.
- `workshop-search-index`: The system maintains an Elasticsearch-backed workshop search index that stays aligned with searchable workshop content and visibility.

### Modified Capabilities
- `workshop-summary-read`: The public workshop list read contract expands to support search/filter query parameters and to guarantee the discovery fields required by the student listing UI.

## Impact

- Frontend: student listing page in `frontend/app/(student)/page.tsx` plus a client discovery component that sends debounced search/filter requests and renders result/empty states.
- Backend: `workshop` module router/service gains query-aware list behavior; admin workshop write flows must trigger search-index synchronization.
- Shared infrastructure: introduce an Elasticsearch client dependency, environment configuration, index mapping/bootstrap logic, and a worker or queue-backed sync path.
- Testing: API contract coverage for query params and failure modes, index-sync verification, and frontend interaction coverage for debounced search plus combined filters.
- **Cost / operations**: Elasticsearch is a new operational dependency and may increase monthly infrastructure cost if the current VPS cannot host it reliably and a managed cluster or larger instance is required.

## Out of Scope

- Semantic recommendations, personalized ranking, typo analytics, or category/tag taxonomy design.
- Cross-month catalog browsing, pagination, or a separate admin search console.
- Changes to workshop registration, payment, notifications, check-in, or AI summary generation behavior.

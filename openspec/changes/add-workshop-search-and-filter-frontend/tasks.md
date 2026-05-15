## 1. Discovery contracts and search abstractions

- [x] 1.1 Define backend and frontend TypeScript types for workshop discovery query parameters and list responses before service implementation (Spec: `workshop-summary-read` search/filter query parameters; Design Decisions 2 and 7).
- [x] 1.2 Define a narrow Elasticsearch-facing interface and workshop search document shape owned by the workshop domain before wiring infra clients (Spec: `workshop-search-index`; Design Decisions 5 and 7).

## 2. Backend discovery API

- [x] 2.1 Add Elasticsearch client configuration and a workshop search adapter in the backend, including environment-variable documentation and index name ownership (Spec: `workshop-search-index`; Design Decision 7).
- [x] 2.2 Extend `GET /workshops` router and workshop service to validate `q`, `payment`, and `available_only` query parameters and return explicit `400/503` error contracts where required (Spec: `workshop-summary-read` search/filter query parameters; Design Decisions 1 and 2).
- [x] 2.3 Implement hybrid discovery logic: query Elasticsearch for matching workshop IDs when `q` is present, hydrate authoritative workshop rows from PostgreSQL, and apply final availability/visibility rules before responding (Spec: `workshop-discovery`; Spec: `workshop-summary-read`; Design Decisions 1, 3, and 5).

## 3. Search index synchronization

- [x] 3.1 Update organizer create/update/cancel workshop flows so all search-relevant changes consistently enqueue workshop-changed events, including the current create path (Spec: `workshop-search-index`; Design Decision 4).
- [x] 3.2 Implement the queue-backed workshop indexing worker/service to upsert or suppress search documents idempotently and retry on temporary Elasticsearch failures (Spec: `workshop-search-index`; Design Decision 4).
- [x] 3.3 Add an index bootstrap or rebuild script for existing workshops so production rollout does not depend on future edits alone (Spec: `workshop-search-index` bootstrap and rebuild; Design Migration Plan).
- [ ] 3.4 Run a manual smoke test for create, update, and cancel flows to verify search visibility changes propagate through the index path (Spec: `workshop-search-index`; Design Risks / Trade-offs).

## 4. Frontend discovery experience

- [x] 4.1 Extract the student workshop listing into a client discovery component that accepts initial server-rendered results and issues debounced backend discovery requests as criteria change (Spec: `workshop-discovery`; Design Decision 6).
- [x] 4.2 Implement text search, payment filter, and available-only filter controls against the backend discovery API while preserving workshop detail links and default list reset behavior (Spec: `workshop-discovery`; Design Decisions 2 and 6).
- [x] 4.3 Add result count, empty-result state, unavailable-search messaging, and clear/reset controls for the student listing page (Spec: `workshop-discovery`; Design Risks / Trade-offs).

## 5. Verification

- [x] 5.1 Add backend tests for discovery query validation, idempotent GET behavior, and Elasticsearch-unavailable error handling (Spec: `workshop-summary-read`; Design Decision 2).
- [x] 5.2 Add backend tests for workshop search-index upsert/remove/retry behavior and bootstrap coverage (Spec: `workshop-search-index`; Design Decision 4).
- [x] 5.3 Add frontend verification for debounced discovery requests, combined filters, empty-result recovery, and offline/unavailable search states (Spec: `workshop-discovery`; Design Decision 6).
- [ ] 5.4 Run an end-to-end manual smoke test covering default list load, text search, free/paid filter, available-only filter, combined criteria, zero results, and a search result reflecting an organizer edit after indexing completes (Spec: `workshop-discovery`; Spec: `workshop-search-index`; Design Migration Plan).

## Context

The current student workshop discovery experience is a server-rendered monthly listing page backed by `GET /workshops`, and the first draft of this change assumed frontend-local substring filtering on a single fetched payload. That approach is lightweight, but it does not give us ranked search, typo tolerance headroom, or a scalable path once workshop descriptions become richer.

At the same time, not every discovery field is equally safe to index. Workshop availability is derived from canonical PostgreSQL data and changes during registration flows, while organizer edits change titles, speakers, rooms, and descriptions. The design therefore needs to introduce Elasticsearch for text search without allowing the search index to become the source of truth for seat availability or workshop visibility semantics.

## Goals / Non-Goals

**Goals:**
- Provide Elasticsearch-backed text search for student workshop discovery.
- Preserve current-month and published-workshop scoping in public discovery results.
- Keep final workshop cards hydrated from authoritative PostgreSQL reads so `availableSeats` and related display fields remain current.
- Synchronize search documents after organizer create/update/cancel actions with an explicit indexing flow.
- Keep the student UI responsive with debounced search/filter interactions and explicit empty-result handling.

**Non-Goals:**
- Replace PostgreSQL as the source of truth for workshop state.
- Introduce semantic/vector search, personalization, or taxonomy-driven facets.
- Add pagination or browsing across all months.
- Rework registration, payment, notification, or check-in behavior.

## Decisions

### Decision 1: Use Elasticsearch for text matching, but hydrate final workshop cards from PostgreSQL
- **Decision**: When a search query is present, the backend will query Elasticsearch for matching workshop IDs and ranking, then fetch authoritative workshop rows from PostgreSQL before returning the final response.
- **Rationale**: This avoids stale `availableSeats`, `summaryStatus`, and other volatile fields while still gaining Elasticsearch ranking and search flexibility.
- **Alternatives considered**:
  - Return search documents directly from Elasticsearch. Rejected because registrations can change availability independently of organizer edits, making the index a poor source of truth for seats.
  - Keep browser-local substring search only. Rejected because it does not satisfy the request for Elasticsearch-backed search.

### Decision 2: Extend the existing `GET /workshops` endpoint instead of creating a separate public search route
- **Decision**: `GET /workshops` will remain the student listing endpoint and gain optional query parameters such as `q`, `payment`, and `available_only`.
- **Rationale**: The frontend already depends on this route for the monthly listing, and keeping one public discovery endpoint reduces client branching and keeps the contract cohesive.
- **Alternatives considered**:
  - Create `GET /workshops/search`. Rejected because it duplicates discovery concerns and complicates the client for little gain at this scope.

### Decision 3: Keep search scoped to published workshops in the current month
- **Decision**: Elasticsearch queries will only surface workshops that are still valid for the existing public listing scope: `status=published` and `startsAt` within the current month.
- **Rationale**: This preserves current product behavior and prevents the new search backend from silently expanding the catalog.
- **Alternatives considered**:
  - Search all workshops in the index. Rejected because it changes user-facing behavior and would surface drafts, cancelled sessions, or out-of-scope dates unless heavily filtered.

### Decision 4: Synchronize the search index asynchronously through the existing workshop-changed queue seam
- **Decision**: Organizer create/update/cancel flows will enqueue workshop-changed jobs, and a dedicated indexing worker/service will upsert or remove documents in Elasticsearch.
- **Rationale**: The codebase already has an `enqueueWorkshopChanged` seam, even though it is currently a no-op. Reusing that hook keeps admin writes focused on database correctness and makes indexing retries possible.
- **Alternatives considered**:
  - Write to Elasticsearch synchronously inside `AdminService`. Rejected because organizer writes would become more fragile and latency-sensitive.
  - Poll PostgreSQL for index changes. Rejected because it adds avoidable background complexity and delayed propagation.

### Decision 5: Use the index for relatively stable discovery fields only
- **Decision**: Search documents will include searchable and scoping fields such as `id`, `title`, `description`, `speakerName`, `room`, `startsAt`, `status`, `paymentRequired`, and last-updated metadata, but the response payload returned to clients will still come from PostgreSQL hydration.
- **Rationale**: This keeps the index small and focused while avoiding duplication of volatile registration-derived counters as the primary response source.
- **Alternatives considered**:
  - Index every workshop response field and trust it fully. Rejected because the staleness window would be larger and more user-visible.

### Decision 6: Frontend search becomes request-driven, with debouncing and initial server-rendered results
- **Decision**: The student page will keep its initial server-rendered monthly results, then a client component will send debounced requests when search/filter controls change.
- **Rationale**: This preserves fast first paint while letting search be backed by Elasticsearch instead of in-browser filtering over a stale initial snapshot.
- **Alternatives considered**:
  - Convert the whole page to client-only data loading. Rejected because it worsens the initial render path unnecessarily.

### Decision 7: Accept the operational cost of a new search dependency, but isolate it behind an interface
- **Decision**: Introduce an Elasticsearch client behind a narrow interface such as `IWorkshopSearchIndex` or `IWorkshopSearchGateway`, with configuration in environment variables and one index name owned by the workshop domain.
- **Rationale**: Dependency inversion keeps search testable and makes future provider changes less invasive.
- **Alternatives considered**:
  - Import the Elasticsearch client directly throughout services. Rejected because it couples workshop logic to infra details.
- **Cost note**: This decision may increase monthly infrastructure cost if the existing Oracle free-tier VPS cannot safely host Elasticsearch and the team must use a managed cluster or larger machine.

## Risks / Trade-offs

- [Risk] Search results can be temporarily stale after organizer updates because indexing is asynchronous. -> Mitigation: specify an indexing propagation target, make jobs retryable, and keep PostgreSQL hydration authoritative for returned cards.
- [Risk] Search infrastructure adds operational burden and may exceed current VPS memory budget. -> Mitigation: isolate the dependency, document env/bootstrap needs, and explicitly flag the possibility of managed-cluster cost.
- [Risk] Availability filtering can diverge if applied purely in Elasticsearch. -> Mitigation: apply authoritative availability checks after PostgreSQL hydration before returning results.
- [Risk] Debounced request-driven search increases frontend/backend chatter compared to local filtering. -> Mitigation: debounce input, keep filters compact, and continue using the existing list payload shape.
- [Risk] Existing create flow does not currently emit `enqueueWorkshopChanged`, so newly created workshops would never enter the index if left unchanged. -> Mitigation: update create, update, and cancel flows to enqueue index sync consistently.

## Migration Plan

1. Introduce Elasticsearch configuration, a workshop search interface, and index document mapping.
2. Extend `GET /workshops` to accept discovery query parameters and use Elasticsearch when `q` is present.
3. Add queue-backed search-index synchronization for workshop create/update/cancel flows, including create-path enqueueing.
4. Backfill or rebuild the initial workshop search index from existing workshop rows before relying on search in production.
5. Update the student frontend to use debounced request-driven discovery while preserving the current default list render.
6. Run API, indexing, and frontend smoke tests before rollout.

Rollback:
- Disable Elasticsearch-backed query behavior and fall back to the plain monthly PostgreSQL-backed listing.
- Stop or ignore workshop index-sync jobs.
- Leave PostgreSQL workshop data untouched; no schema rollback is required unless implementation later introduces search-specific persistence.

## Open Questions

- Can the current deployment environment host Elasticsearch reliably, or should this change assume a managed cluster from the start?
- What propagation SLO is acceptable for organizer edits to appear in search results: sub-second, under 10 seconds, or best effort?
- Should an unavailable Elasticsearch cluster cause `GET /workshops?q=...` to fail with `503`, or should the backend fall back to a lower-quality PostgreSQL substring search?

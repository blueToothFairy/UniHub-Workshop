## Context

Organizers review workshop audit history at `/admin/audit-logs`. The page is server-rendered and calls `GET /admin/audit-logs`, which today executes `SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 200` and returns every column including large JSON state blobs. There is no pagination, no index tuned for paging, and no client affordance to load older entries.

The notification module already implements cursor pagination (`limit`, `cursor`, `next_cursor`) over `(created_at DESC, id DESC)`. This change applies the same pattern to audit logs to stay consistent and avoid offset-scan costs on a growing table.

## Goals / Non-Goals

**Goals:**
- Allow organizers to browse audit history beyond the newest 200 rows using stable cursor pagination.
- Keep list responses small by omitting `before_state` and `after_state` from the paginated list projection.
- Preserve newest-first ordering across pages.
- Reuse established cursor encode/decode and query patterns from notifications where practical.

**Non-Goals:**
- Page-number navigation or total-count queries.
- Filtering by action, actor, or date range.
- Audit detail view with state diffs.
- Actor display-name resolution.
- Changes to how audit rows are written on workshop mutations.

## Decisions

### Decision 1: Cursor pagination keyed by `(created_at, id)`

**Decision:** `GET /admin/audit-logs` accepts optional `limit` (default 25, max 100) and `cursor`. The cursor encodes the last row's `created_at` and `id` from the previous page (base64url JSON, same approach as notifications). The query uses:

```sql
WHERE (created_at, id) < ($cursor_created_at, $cursor_id)
ORDER BY created_at DESC, id DESC
LIMIT $limit
```

**Rationale:** Stable under concurrent inserts; avoids large `OFFSET` scans; matches an existing in-repo pattern.

**Alternatives considered:**
- **Offset (`page`, `page_size`)** — simpler page UI but slower and can skip/duplicate rows when new audits arrive between requests.
- **Keep `LIMIT 200`** — no UX improvement.

### Decision 2: Lean list DTO without JSON state blobs

**Decision:** Paginated items include `id`, `actorUserId`, `action`, `targetType`, `targetId`, and `createdAt` only.

**Rationale:** The current table UI does not render `before_state` / `after_state`; excluding them reduces payload size materially on peak-test datasets.

**Alternatives considered:**
- **Return full `AuditLog` objects** — backward compatible shape but wasteful for list browsing.

### Decision 3: Breaking API shape wrapped in existing `{ data }` envelope

**Decision:** Response body becomes:

```json
{
  "data": {
    "items": [ /* AuditLogListItem[] */ ],
    "next_cursor": "..." | null
  }
}
```

**Rationale:** Only the admin audit logs page consumes this endpoint today; a structured page object is clearer than a bare array with an implicit cap.

**Alternatives considered:**
- **Versioned route (`/audit-logs/v2`)** — unnecessary for a single internal consumer.

### Decision 4: Hybrid SSR + client "Load more"

**Decision:** The audit logs page server-renders the first page for fast initial paint. A client `AuditLogsPanel` appends subsequent pages when the organizer clicks **Load more**, passing `next_cursor` from the prior response.

**Rationale:** Matches how other interactive admin flows evolve without converting the entire admin shell to client-only data loading.

**Alternatives considered:**
- **Full client fetch after mount** — worse first paint.
- **URL-synced cursor** — useful later; not required for v1.

### Decision 5: Add supporting index via migration

**Decision:** Add `CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at_id ON audit_logs (created_at DESC, id DESC);` in a new migration file.

**Rationale:** Ensures predictable pagination cost as `audit_logs` grows; no new infrastructure.

## Risks / Trade-offs

- **[Risk] Breaking change for any undocumented consumer of `/admin/audit-logs`** → Mitigation: grep confirms only the admin audit logs page uses it; document in proposal.
- **[Risk] Organizers cannot inspect state diffs from the list** → Mitigation: out of scope; list remains summary-only as today.
- **[Risk] Cursor tampering returns 400** → Mitigation: validate decode; return `INVALID_AUDIT_LOG_CURSOR` with 400.
- **[Risk] Duplicate timestamps without `id` tie-break could reorder** → Mitigation: always sort and compare on `(created_at, id)`.

## Migration Plan

1. Add migration for `audit_logs` pagination index.
2. Deploy backend with new paginated handler (breaking response shape).
3. Deploy frontend audit logs panel that expects `{ items, next_cursor }`.
4. Smoke test: first page load, load more until `next_cursor` is null, invalid cursor returns 400.

**Rollback:** Revert backend to fixed `LIMIT 200` array response and restore previous page component. Index can remain (harmless).

## Open Questions

- Should v1 expose `limit` on the frontend or hardcode 25? (Default: hardcode 25 in UI, allow query override in API for tests.)
- Is a future audit detail endpoint (`GET /admin/audit-logs/:id`) needed before demo? (Default: defer.)

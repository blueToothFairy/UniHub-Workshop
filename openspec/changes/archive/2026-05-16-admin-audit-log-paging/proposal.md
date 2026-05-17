## Why

The admin audit log page currently loads at most 200 rows in a single request with no way to browse older history. As workshop CRUD, peak testing, and CSV import activity grow, organizers lose visibility into earlier actions and each response carries full `before_state` / `after_state` JSON payloads even though the table UI only shows summary columns.

## What Changes

- Replace the fixed `LIMIT 200` audit log query with **cursor-based pagination** on `GET /admin/audit-logs` (`limit`, `cursor`, `next_cursor` response).
- Return a **lean list projection** for paginated rows (summary fields only); omit heavy JSON state blobs from the list endpoint.
- Update the admin audit logs page to render the first page on load and support **Load more** for subsequent pages.
- Add a database index supporting `ORDER BY created_at DESC, id DESC` pagination.
- Add backend and frontend tests for cursor validation, empty results, and end-of-list behavior.

## Out of Scope

- Offset/page-number navigation UI (e.g. jump to page 7).
- Filters by action, actor, date range, or target workshop (can be a follow-up change).
- Audit log detail drawer showing `before_state` / `after_state` diffs.
- Resolving `actorUserId` to display names or emails.
- Real-time push updates to the audit log table.

## Capabilities

### New Capabilities

- `admin-audit-log-read`: Organizer-facing read API and UI for browsing workshop audit history with cursor pagination and stable newest-first ordering.

### Modified Capabilities

- _(none — no existing OpenSpec capability spec for admin audit log reads)_

## Impact

- **Backend**: `admin.service.ts` (`listAuditLogs`), `admin.router.ts` (`GET /audit-logs`), new pagination types, optional migration for `audit_logs` index.
- **Frontend**: `frontend/app/admin/audit-logs/page.tsx`, `frontend/lib/api.ts` (`getAuditLogs`), new client panel for load-more behavior.
- **API contract**: **BREAKING** for clients expecting `GET /admin/audit-logs` to return a bare array; response becomes `{ items, next_cursor }` wrapped in existing `{ data }` envelope.
- **Infrastructure**: No new services; one additional indexed query pattern on PostgreSQL only.

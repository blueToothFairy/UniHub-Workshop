## 1. Database and types

- [x] 1.1 Add migration `idx_audit_logs_created_at_id` on `(created_at DESC, id DESC)` (Design: Decision 5)
- [x] 1.2 Define `AuditLogListItem`, `ListAuditLogsQuery`, and `ListAuditLogsResponse` in `admin.types.ts` (Spec: lean projection)
- [x] 1.3 Add cursor encode/decode helpers for audit log pagination (mirror notification pattern) (Design: Decision 1)

## 2. Backend API

- [x] 2.1 Replace `listAuditLogs()` with cursor-based query excluding `before_state` / `after_state` (Spec: pagination + lean projection)
- [x] 2.2 Parse and validate `limit` / `cursor` in `GET /admin/audit-logs` router; return `400` for invalid input (Spec: validation scenarios)
- [x] 2.3 Return `{ items, next_cursor }` in the existing `{ data }` envelope (Design: Decision 3)
- [x] 2.4 Add backend tests for first page, next page, end of list, invalid cursor, and invalid limit (Spec: all scenarios)

## 3. Frontend admin UI

- [x] 3.1 Update `adminApi.getAuditLogs` to accept `{ limit?, cursor? }` and return paginated response type (Design: Decision 3)
- [x] 3.2 Create client `AuditLogsPanel` with Load more append behavior (Spec: UI load more)
- [x] 3.3 Update `/admin/audit-logs` page to SSR first page and render `AuditLogsPanel` (Design: Decision 4)
- [x] 3.4 Hide Load more when `next_cursor` is null; show loading state while fetching (Spec: UI scenarios)

## 4. Verification

- [ ] 4.1 Manual smoke test: open audit logs, load more until exhausted, confirm no duplicates and stable order (Spec: organizer browse)
- [ ] 4.2 Manual smoke test: verify non-organizer still receives `403` on API (Spec: authorization)

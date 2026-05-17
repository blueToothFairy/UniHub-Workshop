## Purpose
Define the API and UI contract for organizers to browse workshop audit logs with cursor pagination and lean list projections.

## Requirements

### Requirement: Organizers can list audit logs with cursor pagination

The system SHALL expose `GET /admin/audit-logs` for authenticated users with role `organizer` and return audit log entries in stable newest-first order using cursor-based pagination.

#### Scenario: Organizer requests the first page

- **WHEN** an organizer calls `GET /admin/audit-logs` without a `cursor` query parameter
- **THEN** the system MUST return HTTP `200` with a body shaped as `{ data: { items: AuditLogListItem[], next_cursor: string | null } }`
- **THEN** `items` MUST be ordered by `createdAt` descending, with `id` descending as a tie-breaker
- **THEN** the default page size MUST be `25` rows when `limit` is omitted

#### Scenario: Organizer requests the next page

- **WHEN** an organizer calls `GET /admin/audit-logs` with a valid `cursor` from a previous response where `next_cursor` was not null
- **THEN** the system MUST return HTTP `200` with the next oldest page of audit rows after the cursor position
- **THEN** no row from the previous page MUST appear again in the new `items` array

#### Scenario: Organizer reaches the end of the audit log

- **WHEN** an organizer requests a page and fewer than `limit` rows remain after the cursor position
- **THEN** the system MUST return HTTP `200` with the remaining rows in `items`
- **THEN** `next_cursor` MUST be `null`

### Requirement: Audit log list responses use a lean projection

The system MUST NOT include `before_state` or `after_state` in paginated audit log list items.

#### Scenario: List item fields are summary-only

- **WHEN** an organizer receives a successful paginated audit log response
- **THEN** each item MUST include `id`, `actorUserId`, `action`, `targetType`, `targetId`, and `createdAt`
- **THEN** each item MUST NOT include `beforeState` or `afterState`

### Requirement: Pagination parameters are validated

The system MUST reject invalid pagination input with explicit errors.

#### Scenario: Limit is out of allowed range

- **WHEN** an organizer calls `GET /admin/audit-logs` with `limit` less than `1` or greater than `100`
- **THEN** the system MUST return HTTP `400` with error code `INVALID_AUDIT_LOG_QUERY`

#### Scenario: Cursor is malformed

- **WHEN** an organizer calls `GET /admin/audit-logs` with a `cursor` that cannot be decoded to a valid `(createdAt, id)` pair
- **THEN** the system MUST return HTTP `400` with error code `INVALID_AUDIT_LOG_CURSOR`

### Requirement: Non-organizers cannot read audit logs

The system MUST enforce existing admin authorization rules for audit log reads.

#### Scenario: Student is denied

- **WHEN** a non-organizer authenticated user calls `GET /admin/audit-logs`
- **THEN** the system MUST return HTTP `403 Forbidden`

### Requirement: Admin audit logs UI supports browsing beyond the first page

The organizer audit logs page MUST render the first page on initial load and allow loading additional pages without losing already visible rows.

#### Scenario: Initial page render

- **WHEN** an organizer opens `/admin/audit-logs`
- **THEN** the UI MUST display the newest audit rows returned by the first API page
- **THEN** the UI MUST show a loading or disabled state while additional pages are being fetched

#### Scenario: Load more appends results

- **WHEN** an organizer activates the load-more control and `next_cursor` from the latest response is not null
- **THEN** the UI MUST request the next page using that cursor
- **THEN** the UI MUST append the new rows below existing rows while preserving newest-first order

#### Scenario: Load more is hidden at end of list

- **WHEN** the latest API response has `next_cursor` equal to `null`
- **THEN** the UI MUST NOT offer a load-more action for additional pages

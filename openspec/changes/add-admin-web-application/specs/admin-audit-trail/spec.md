## ADDED Requirements

### Requirement: Comprehensive action audit logging
System SHALL log all admin actions to `audit_logs` with: `action_type`, `resource_type`, `resource_id`, `admin_id`, `admin_email`, `timestamp`, `before_state`, `after_state`, `ip_address`, and `user_agent`. Student actions such as registration and check-in SHALL be recorded in `user_actions` with a lighter schema that omits `before_state` when no prior mutable state exists.

**Idempotency:** Audit logging for mutation requests is effectively idempotent per successfully committed business action. The system SHALL create exactly one audit record for one committed mutation, even if downstream notification or response serialization retries occur.

**Design References:** Audit Logging Strategy; Admin Authentication and Authorization; SOLID Principles Clean Architecture.

#### Acceptance Criteria
- **Given** an authenticated admin with role `admin`
- **When** the admin creates a workshop via `POST /admin/workshops`
- **Then** the system creates an `audit_logs` entry with `action_type=create`, `resource_type=workshop`, `after_state` containing the created workshop state, and a server-generated timestamp

- **Given** an authenticated admin with role `admin`
- **When** the admin updates a workshop via `PUT /admin/workshops/:id`
- **Then** the system creates an `audit_logs` entry containing both `before_state` and `after_state` for that workshop mutation

- **Given** an authenticated admin with role `admin`
- **When** the admin updates notification, payment, rate-limit, or default settings
- **Then** the system creates an `audit_logs` entry that captures the old and new configuration values and identifies the acting admin

- **Given** a student completes a registration or a check-in staff member completes a check-in
- **When** the business action is committed successfully
- **Then** the system records a corresponding `user_actions` entry linked to the actor and affected resource

#### Error Scenarios
- **Given** a request to mutate an admin-managed resource without a valid JWT
- **When** the request reaches the protected route
- **Then** the system returns `401 Unauthorized` with response body shape `{ "error": "UNAUTHORIZED", "message": string }` and SHALL NOT create an audit record

- **Given** a request from an authenticated non-admin user to mutate an admin-managed resource
- **When** authorization is evaluated
- **Then** the system returns `403 Forbidden` with response body shape `{ "error": "FORBIDDEN", "message": string }` and SHALL NOT create an audit record

- **Given** a mutation request that fails validation before persistence
- **When** the application rejects the request
- **Then** the system returns `400 Bad Request` with response body shape `{ "error": "VALIDATION_ERROR", "message": string, "details": object }` and SHALL NOT create an audit record for a non-committed change

- **Given** a business mutation succeeds but audit persistence fails before the request transaction completes
- **When** the system attempts to finalize the request
- **Then** the system returns `500 Internal Server Error` with response body shape `{ "error": "AUDIT_LOG_WRITE_FAILED", "message": string }` and SHALL roll back the mutation to avoid an untracked admin change

### Requirement: Audit log query and filtering
Admins SHALL query audit logs via `GET /admin/audit-logs` with filters for date range, `action_type`, `resource_type`, actor, `resource_id`, and keyword search over changed state. The system SHALL return paginated results with default sort order newest first and enough metadata for clients to request detail views.

**Idempotency:** This read operation is idempotent.

**Design References:** Audit Logging Strategy; Real-Time Dashboard with Polling vs. WebSocket.

#### Acceptance Criteria
- **Given** an authenticated admin
- **When** the admin requests `GET /admin/audit-logs?from=2026-04-20&to=2026-04-25`
- **Then** the system returns only log entries whose timestamps fall within the requested date range

- **Given** an authenticated admin
- **When** the admin requests `GET /admin/audit-logs?action_type=delete`
- **Then** the system returns only matching delete actions with pagination metadata

- **Given** an authenticated admin
- **When** the admin requests the audit log list without an explicit sort parameter
- **Then** the system returns results sorted by `timestamp DESC`

- **Given** an authenticated admin
- **When** the admin filters by actor, resource type, or resource identifier
- **Then** the system returns only records matching those filters and preserves pagination behavior

#### Error Scenarios
- **Given** an authenticated admin supplies an invalid date range or malformed filter
- **When** the query is validated
- **Then** the system returns `400 Bad Request` with response body shape `{ "error": "INVALID_QUERY", "message": string, "details": object }`

- **Given** an authenticated non-admin user requests `GET /admin/audit-logs`
- **When** authorization is evaluated
- **Then** the system returns `403 Forbidden` with response body shape `{ "error": "FORBIDDEN", "message": string }`

- **Given** the audit log store is temporarily unavailable
- **When** the admin requests filtered logs
- **Then** the system returns `503 Service Unavailable` with response body shape `{ "error": "AUDIT_LOGS_UNAVAILABLE", "message": string }`

### Requirement: Audit log detail and state diff view
Admins SHALL inspect a single audit log entry in detail and view `before_state` and `after_state` as structured JSON with highlighted differences.

**Idempotency:** This read operation is idempotent.

**Design References:** Audit Logging Strategy.

#### Acceptance Criteria
- **Given** an authenticated admin and an existing audit log entry
- **When** the admin opens the audit log detail view
- **Then** the system returns the full entry, including `before_state`, `after_state`, actor metadata, and timestamp

- **Given** an authenticated admin and an audit log entry containing both prior and new state
- **When** the detail view is rendered
- **Then** the response includes sufficient structured JSON for the client to highlight differences between states

#### Error Scenarios
- **Given** an authenticated admin requests a non-existent audit log identifier
- **When** the detail endpoint is evaluated
- **Then** the system returns `404 Not Found` with response body shape `{ "error": "AUDIT_LOG_NOT_FOUND", "message": string }`

### Requirement: Admin activity timeline
Admins SHALL view an admin activity timeline via `GET /admin/admin-activity` showing a chronological feed of admin actions with actor name, action description, timestamp, and linkable audit log identifier. The timeline SHALL refresh within 10 seconds through polling or another mechanism that preserves the project architecture constraints.

**Idempotency:** This read operation is idempotent.

**Design References:** Real-Time Dashboard with Polling vs. WebSocket; Admin UI Organization and Navigation.

#### Acceptance Criteria
- **Given** an authenticated admin
- **When** the admin opens the activity timeline page
- **Then** the system returns a feed of recent admin actions in reverse chronological order

- **Given** one admin is viewing the activity timeline
- **When** another admin creates, updates, deletes, or reconfigures a resource
- **Then** the new activity appears in the feed within 10 seconds of the next refresh cycle

#### Error Scenarios
- **Given** the timeline data source is delayed but still available
- **When** the admin refreshes the activity feed
- **Then** the system may return slightly stale data but SHALL include a timestamp indicating the latest refresh point

### Requirement: Export audit logs
Admins SHALL export audit logs via `GET /admin/audit-logs/export?format=csv`. CSV export SHALL honor the same active filters as the list query and SHALL include: `timestamp`, `admin_email`, `action_type`, `resource_type`, `resource_id`, `before_state`, `after_state`, and `ip_address`.

**Idempotency:** This export operation is idempotent for the same dataset and filter set.

**Design References:** Audit Logging Strategy.

#### Acceptance Criteria
- **Given** an authenticated admin has applied filters to the audit log query
- **When** the admin requests CSV export
- **Then** the system returns a downloadable CSV containing only the filtered audit log rows

- **Given** an authenticated admin requests export without filters
- **When** the export is generated
- **Then** the system returns a CSV for the default sorted result set permitted by the export endpoint

#### Error Scenarios
- **Given** the admin requests an unsupported export format
- **When** the export endpoint validates the query
- **Then** the system returns `400 Bad Request` with response body shape `{ "error": "UNSUPPORTED_EXPORT_FORMAT", "message": string }`

- **Given** the filtered export would exceed the system's synchronous export limits
- **When** the system cannot complete the export inline
- **Then** the system returns `413 Payload Too Large` or `422 Unprocessable Entity` with response body shape `{ "error": "EXPORT_TOO_LARGE", "message": string }`

### Requirement: Audit trail retention and archival
System SHALL retain audit logs in PostgreSQL for at least 90 days. Logs older than 90 days MAY be archived to R2 using the pattern `audit-logs-{year}-{month}.json.gz`. Admin users SHALL NOT directly delete audit logs.

**Idempotency:** The archival job SHALL be idempotent per archive window; rerunning the same archival batch SHALL NOT duplicate or lose archived records.

**Design References:** Audit Logging Strategy; Cloud Providers: Supabase PostgreSQL and Upstash Redis.

#### Acceptance Criteria
- **Given** audit log records older than 90 days exist
- **When** the nightly archival job runs
- **Then** the system compresses and archives eligible logs to R2 and removes only the successfully archived rows from PostgreSQL

- **Given** an admin searches for records that are no longer stored in PostgreSQL
- **When** the requested date range falls into an archived time window
- **Then** the system indicates that matching logs are archived and provides a way to retrieve or download the archived dataset

- **Given** an authenticated admin
- **When** the admin attempts to manually delete audit records through the admin interface or API
- **Then** the system does not provide such a delete capability

#### Error Scenarios
- **Given** the archival job cannot upload the archive file to R2
- **When** archival processing reaches the upload step
- **Then** the system SHALL NOT delete the source PostgreSQL rows and SHALL record an operational error for retry

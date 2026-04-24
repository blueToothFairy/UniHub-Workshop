## ADDED Requirements

### Requirement: Comprehensive action audit logging
System SHALL log all admin actions to audit_logs table with: action_type (create, update, delete, approve, configure), resource_type (workshop, payment, settings, user), resource_id, admin_id, admin_email, timestamp, before_state (JSON), after_state (JSON), ip_address, user_agent. Student actions (registration, check-in) SHALL also be logged to user_actions table with similar structure but without before_state.

#### Scenario: Workshop creation is logged
- **WHEN** admin creates workshop via POST `/admin/workshops`
- **THEN** audit_logs entry is created with action_type=create, after_state=workshop JSON, timestamp

#### Scenario: Workshop update is logged
- **WHEN** admin updates workshop via PUT `/admin/workshops/:id`
- **THEN** audit_logs entry shows both before_state (old workshop) and after_state (new workshop)

#### Scenario: Settings change is logged
- **WHEN** admin updates notification settings
- **THEN** audit_logs entry captures old and new settings values

### Requirement: Audit log query and filtering
Admins SHALL query audit logs via GET `/admin/audit-logs` with filters: date range, action_type, resource_type, admin (actor), resource_id, keyword search on state changes. System SHALL return paginated results (20 per page) with links to view full before/after states. Query SHALL support sorting by timestamp descending (default: newest first).

#### Scenario: Filter audit logs by date range
- **WHEN** admin queries `/admin/audit-logs?from=2026-04-20&to=2026-04-25`
- **THEN** system returns logs only within date range

#### Scenario: Search audit logs by action type
- **WHEN** admin queries `/admin/audit-logs?action_type=delete`
- **THEN** system returns all delete actions (workshop deletions, etc.)

#### Scenario: View audit log detail with state diff
- **WHEN** admin clicks on audit log entry
- **THEN** system displays before_state and after_state as JSON with highlighted differences

### Requirement: Admin activity timeline
Admins SHALL view admin activity timeline via GET `/admin/admin-activity` showing feed of all admin actions (create, update, delete, settings change) in chronological order with actor name, action description, timestamp, and link to audit log detail. Timeline SHALL auto-update every 10 seconds if page is open (WebSocket or polling).

#### Scenario: View admin activity timeline
- **WHEN** admin opens admin-activity page
- **THEN** system displays feed of recent admin actions

#### Scenario: Activity feed updates in real-time
- **WHEN** another admin creates a workshop while page is open
- **THEN** new activity appears in feed within 10 seconds (or immediately if WebSocket)

### Requirement: Export audit logs
Admins SHALL export audit logs via GET `/admin/audit-logs/export?format=csv` to download CSV file with columns: timestamp, admin_email, action_type, resource_type, resource_id, before_state, after_state, ip_address. CSV export SHALL honor current filters (date range, action_type, etc.).

#### Scenario: Export audit logs as CSV
- **WHEN** admin applies filters and clicks Export
- **THEN** system downloads CSV file with filtered audit logs

### Requirement: Audit trail retention and archival
System SHALL retain audit logs for minimum 90 days in PostgreSQL. Logs older than 90 days MAY be archived to cold storage (R2 bucket) with naming pattern `audit-logs-{year}-{month}.json.gz`. Admins SHALL NOT manually delete audit logs; only system cron can archive.

#### Scenario: Audit logs auto-archive after 90 days
- **WHEN** nightly cron job runs
- **THEN** logs older than 90 days are compressed and moved to R2, removed from PostgreSQL

#### Scenario: Archived logs are queryable
- **WHEN** admin searches for logs in archived time range
- **THEN** system indicates logs are archived and provides download option

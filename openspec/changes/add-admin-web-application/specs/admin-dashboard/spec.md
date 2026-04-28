## ADDED Requirements

### Requirement: Admin-only dashboard access
Only authenticated admins SHALL access admin dashboard endpoints and dashboard pages. Student users and check-in staff SHALL NOT access dashboard statistics, payment analytics, or check-in monitoring routes.

#### Scenario: Admin accesses dashboard statistics
- **GIVEN** an authenticated user with role `admin`
- **WHEN** the user requests GET `/admin/dashboard/stats`
- **THEN** the system returns the dashboard statistics response

#### Scenario: Student is denied dashboard access
- **GIVEN** an authenticated user with role `student`
- **WHEN** the user requests GET `/admin/dashboard/stats`
- **THEN** the system returns `403 Forbidden`

#### Scenario: Unauthenticated user is denied dashboard access
- **GIVEN** a request without a valid JWT
- **WHEN** the request targets an admin dashboard endpoint
- **THEN** the system returns `401 Unauthorized`

### Requirement: Dashboard summary statistics
Admins SHALL access GET `/admin/dashboard/stats` to retrieve real-time system statistics: total workshops, total registrations (lifetime), active registrations (for upcoming workshops), total payment collected, pending payments, check-in count today, and cancellation rate. System SHALL return data points with timestamps for trend analysis.

#### Scenario: Retrieve dashboard statistics
- **GIVEN** an authenticated admin opens the dashboard page
- **WHEN** the frontend requests GET `/admin/dashboard/stats`
- **THEN** system calls `/admin/dashboard/stats` and returns latest counters

#### Scenario: Statistics are real-time
- **GIVEN** the dashboard is already open
- **WHEN** a new registration is made after the previous refresh
- **THEN** next stats request reflects updated registration count

#### Scenario: Statistics include freshness metadata
- **GIVEN** an authenticated admin requests dashboard statistics
- **WHEN** the system returns the stats payload
- **THEN** the response includes a timestamp or equivalent freshness marker indicating when the counters were generated

#### Scenario: Dashboard shows stale state during temporary delay
- **GIVEN** the dashboard has previously loaded statistics successfully
- **WHEN** a later refresh is delayed or temporarily fails
- **THEN** the UI may continue showing the last successful statistics together with the most recent update timestamp

### Requirement: Workshop-level registration metrics
Admins SHALL view registration status per workshop via GET `/admin/workshops/:id/registrations` with breakdown: registered (confirmed), pending payment, cancelled, no-show (post check-in), and attended (post check-in). System SHALL show registration over time (hours until workshop start) to identify peak registration windows.

#### Scenario: View workshop registrations
- **WHEN** admin clicks on workshop in dashboard
- **THEN** system shows registration status breakdown and count by status

#### Scenario: View registration timeline
- **WHEN** admin views workshop detail page
- **THEN** admin can see graph of registrations over time (e.g., cumulative registrations per hour)

### Requirement: Payment status dashboard
Admins SHALL view payment analytics via GET `/admin/dashboard/payments`: total revenue, pending payments (awaiting gateway response), failed payments, refunded payments, payment distribution by workshop. System SHALL highlight payment gateway errors or anomalies.

#### Scenario: View payment summary
- **GIVEN** an authenticated admin opens payment analytics
- **WHEN** the frontend requests GET `/admin/dashboard/payments`
- **THEN** system shows revenue metrics and payment status breakdown

#### Scenario: Payment anomalies are surfaced
- **GIVEN** payment failures or gateway anomalies exist
- **WHEN** admin views payment analytics
- **THEN** the system highlights the abnormal payment state in the dashboard response or associated alert state

### Requirement: Check-in progress tracking
Admins SHALL monitor real-time check-in status via GET `/admin/dashboard/checkin-today` showing: workshops today, expected participants per workshop, current check-in count, no-show count, and live update feed. System SHALL support filtering by room or time range.

#### Scenario: View today's check-in status
- **GIVEN** an authenticated admin opens the check-in tracker on an event day
- **WHEN** the frontend requests GET `/admin/dashboard/checkin-today`
- **THEN** system displays workshops scheduled today with live check-in counts and expected vs actual

#### Scenario: Filter check-in tracker by room
- **GIVEN** multiple workshops are scheduled on the same day
- **WHEN** admin requests the check-in tracker with a room filter
- **THEN** the system returns only check-in data for workshops in that room

#### Scenario: Filter check-in tracker by time range
- **GIVEN** multiple workshops are scheduled on the same day
- **WHEN** admin requests the check-in tracker with a time-range filter
- **THEN** the system returns only check-in data for workshops inside the requested time range

### Requirement: Dashboard alerts and anomalies
System SHALL highlight anomalies on dashboard: workshops nearing capacity, workshops with zero registrations 48 hours before start, payment failures, check-in rate significantly below expected, or notification delivery failures. Admins SHALL dismiss alerts.

#### Scenario: Alert for workshop nearing capacity
- **GIVEN** a workshop registrations count reaches 90% of capacity
- **WHEN** the dashboard alerts are computed
- **THEN** system shows alert on dashboard

#### Scenario: Alert for low registrations
- **GIVEN** a workshop has fewer than 10% registrations 48 hours before start
- **WHEN** the dashboard alerts are computed
- **THEN** system shows alert with recommendation to promote or cancel

#### Scenario: Alert for notification delivery failures
- **GIVEN** notification jobs have failed or exhausted retries
- **WHEN** the dashboard alerts are computed
- **THEN** the system shows an alert indicating delivery failure risk

#### Scenario: Admin dismisses an alert
- **GIVEN** an alert is visible on the dashboard
- **WHEN** an admin dismisses the alert
- **THEN** the dismissed alert is hidden for that admin until the underlying condition changes or a new alert instance is generated

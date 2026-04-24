## ADDED Requirements

### Requirement: Dashboard summary statistics
Admins SHALL access GET `/admin/dashboard/stats` to retrieve real-time system statistics: total workshops, total registrations (lifetime), active registrations (for upcoming workshops), total payment collected, pending payments, check-in count today, and cancellation rate. System SHALL return data points with timestamps for trend analysis.

#### Scenario: Retrieve dashboard statistics
- **WHEN** admin opens dashboard page
- **THEN** system calls `/admin/dashboard/stats` and returns latest counters

#### Scenario: Statistics are real-time
- **WHEN** new registration is made after dashboard loaded
- **THEN** next stats request reflects updated registration count

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
- **WHEN** admin opens payment analytics
- **THEN** system shows revenue metrics and payment status breakdown

### Requirement: Check-in progress tracking
Admins SHALL monitor real-time check-in status via GET `/admin/dashboard/checkin-today` showing: workshops today, expected participants per workshop, current check-in count, no-show count, and live update feed. System SHALL support filtering by room or time range.

#### Scenario: View today's check-in status
- **WHEN** admin opens check-in tracker on event day
- **THEN** system displays workshops scheduled today with live check-in counts and expected vs actual

### Requirement: Dashboard alerts and anomalies
System SHALL highlight anomalies on dashboard: workshops nearing capacity, workshops with zero registrations 48 hours before start, payment failures, check-in rate significantly below expected, or notification delivery failures. Admins SHALL dismiss alerts.

#### Scenario: Alert for workshop nearing capacity
- **WHEN** workshop registrations reach 90% of capacity
- **THEN** system shows alert on dashboard

#### Scenario: Alert for low registrations
- **WHEN** workshop has < 10% registrations 48 hours before start
- **THEN** system shows alert with recommendation to promote or cancel

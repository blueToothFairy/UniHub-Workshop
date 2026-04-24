## ADDED Requirements

### Requirement: Notification settings configuration
Admins SHALL configure notification settings via GET `/admin/settings/notifications` and PUT `/admin/settings/notifications`. Configurable options: enabled/disabled per channel (email, in-app), email provider (Resend or SMTP), sender email, notification templates (registration confirmation, payment receipt, check-in reminder, cancellation notice). Changes SHALL take effect immediately for new notifications.

#### Scenario: Enable/disable email notifications
- **WHEN** admin toggles email notifications on/off
- **THEN** system updates setting and new notifications follow setting

#### Scenario: Configure email template
- **WHEN** admin edits registration confirmation template
- **THEN** system validates template has required placeholders (student name, workshop title, QR code) and saves template

#### Scenario: Template validation prevents incomplete templates
- **WHEN** admin saves template missing required placeholders
- **THEN** system returns 400 Bad Request with list of missing placeholders

### Requirement: Payment gateway configuration
Admins SHALL configure payment gateway via GET/PUT `/admin/settings/payment` with fields: gateway_name (VNPay), sandbox_mode (boolean), merchant_id, merchant_secret, return_url, notification_url. System SHALL validate credentials format. Admins SHALL NOT view secret in plaintext (show masked value with last 4 chars).

#### Scenario: Configure payment gateway
- **WHEN** admin enters VNPay merchant credentials
- **THEN** system validates format, encrypts secret, and saves configuration

#### Scenario: Payment setting takes effect after save
- **WHEN** admin updates merchant_id and saves
- **THEN** next payment transaction uses new configuration

#### Scenario: Secret is masked in UI
- **WHEN** admin views payment settings
- **THEN** secret is displayed as `••••••••••••1234` (last 4 chars visible)

### Requirement: Rate limiting and throttling configuration
Admins SHALL configure rate limits via GET/PUT `/admin/settings/rate-limits` with per-endpoint settings: registrations per user per day, registrations per IP per hour, login attempts per email per hour, API requests per IP per minute. Settings apply to both API gateway and application layer. Changes take effect after Redis cache refresh (within 5 seconds).

#### Scenario: Update registration rate limit
- **WHEN** admin sets max 3 registrations per user per day
- **THEN** system updates Redis config and enforces limit for new requests

### Requirement: System defaults configuration
Admins SHALL configure system defaults via GET/PUT `/admin/settings/defaults` including: default workshop capacity, default workshop price (if any), email delay for batch notifications (seconds), check-in QR code expiry time (hours), session timeout for admins and students. Defaults apply to new resources.

#### Scenario: Set default workshop capacity
- **WHEN** admin sets default capacity to 60
- **THEN** new workshop creation form pre-fills capacity = 60

#### Scenario: Update session timeout
- **WHEN** admin changes session timeout to 30 minutes
- **THEN** new logins respect 30-minute timeout; existing sessions unaffected

### Requirement: Settings audit and rollback
System SHALL log all settings changes with admin name, timestamp, old value, new value. Admins SHALL view GET `/admin/settings/audit` with change history. Admins MAY revert to previous setting value via POST `/admin/settings/rollback/{change_id}`.

#### Scenario: View settings change history
- **WHEN** admin opens settings audit page
- **THEN** system shows log of all changes with timestamps and actor names

#### Scenario: Rollback setting change
- **WHEN** admin clicks revert on a historical settings change
- **THEN** system reverts to old value and logs rollback action

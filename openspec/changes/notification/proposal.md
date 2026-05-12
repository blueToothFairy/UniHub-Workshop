## Why

Confirmed registrations currently emit `RegistrationConfirmed` events, but notification delivery is not implemented end-to-end, so students may receive no confirmation message even when registration succeeds. We should close this gap now to make confirmation outcomes visible and trustworthy before broader payment and operations rollout.

## What Changes

- Build asynchronous notification processing for `RegistrationConfirmed` events with per-channel retry and idempotent delivery.
- Add in-app notification persistence so students can view confirmation messages in the web app.
- Add email notification delivery for registration confirmation using existing provider configuration.
- Add delivery and processing observability (status, attempt counts, timestamps) to support operations and troubleshooting.
- Add queue wiring and worker runtime integration for notification jobs.
- Define failure handling so registration correctness remains independent from notification success.

## Capabilities

### New Capabilities
- `registration-notification-delivery`: Consume post-confirmation events and deliver confirmation notifications exactly-once per registration per channel with retry-safe behavior.
- `student-inapp-notification-inbox`: Persist and expose student in-app notifications with unread/read state transitions.

### Modified Capabilities
- `workshop-payment-momo-sandbox`: Clarify downstream notification enqueue behavior and non-blocking failure semantics after registration confirmation.

## Impact

- Backend modules: new `notification` module, channel adapters, worker wiring, and queue implementation updates.
- Database: new notification delivery and in-app notification tables plus idempotency constraints and indexes.
- APIs: new student notification read/update endpoints for inbox and read-state updates.
- Infrastructure/runtime: increased Redis queue usage and outbound email volume; no new paid service required under current free-tier assumptions.
- Testing: add unit/integration coverage for idempotency, retry handling, and duplicate/replayed event behavior.

## Out of Scope

- Push notifications to mobile devices.
- SMS, Telegram, Zalo, or other channels beyond email and in-app.
- Rich preference management beyond basic channel enablement needed for this flow.
- Replacing current registration confirmation event contract.

## Success Criteria

- 100% of successful registration confirmations create notification delivery records for enabled channels.
- Duplicate or replayed confirmation events do not create duplicate deliveries for the same `(registration_id, channel)`.
- For transient channel failures, retry policy completes or marks terminal failure without blocking registration completion.
- Student inbox API returns newly created in-app confirmation notifications within 2 seconds under normal load.

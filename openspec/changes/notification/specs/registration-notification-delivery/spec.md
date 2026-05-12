## ADDED Requirements

### Requirement: Registration confirmation events MUST produce idempotent per-channel delivery records
The system MUST consume `RegistrationConfirmed` events and create at most one logical delivery record per `(registration_id, channel)`. This processing MUST be idempotent for duplicate or replayed events.
Reference: Design Decision 1 and Decision 2.

#### Scenario: First-time confirmation event fan-out
- **GIVEN** a confirmed registration event for `registration_id` and enabled channels `email` and `in_app`
- **WHEN** notification orchestrator processes the event
- **THEN** the system MUST create exactly two delivery records with status `pending`, one for each channel

#### Scenario: Duplicate or replayed confirmation event
- **GIVEN** delivery records already exist for `(registration_id, email)` and `(registration_id, in_app)`
- **WHEN** the same confirmation event is replayed or duplicated
- **THEN** the system MUST NOT create additional delivery rows and MUST keep one logical delivery per channel

### Requirement: Channel delivery processing MUST use bounded retries and terminal states
The system MUST process each pending delivery asynchronously and transition delivery state as `pending -> sent` or `pending -> failed` with attempt tracking. Retry behavior MUST be bounded and deterministic.
Reference: Design Decision 4.

#### Scenario: Delivery succeeds on first attempt
- **GIVEN** a pending delivery job and channel adapter succeeds
- **WHEN** worker executes the job
- **THEN** the system MUST set delivery status to `sent`, record `sent_at`, and persist `attempt_count = 1`

#### Scenario: Transient channel failure recovers within retry budget
- **GIVEN** channel adapter fails with a retryable error on first attempt
- **WHEN** worker retries according to configured backoff policy
- **THEN** the system MUST eventually mark delivery `sent` if a retry succeeds and MUST persist all attempts

#### Scenario: Retries exhausted
- **GIVEN** channel adapter keeps failing with retryable errors until max attempts is reached
- **WHEN** final retry fails
- **THEN** the system MUST mark delivery status `failed`, store `last_error`, and stop automatic retries

### Requirement: Registration confirmation APIs MUST stay non-blocking for notification failures
The confirmation source flow MUST remain correct even if notification enqueue or downstream delivery fails.
Reference: Design Decision 1 and Migration Strategy.

#### Scenario: Notification enqueue unavailable after confirmation commit
- **GIVEN** registration confirmation has already committed in database
- **WHEN** notification enqueue fails due to temporary queue outage
- **THEN** the originating confirmation API MUST preserve its success response contract (`HTTP 201` for create flow or `HTTP 200` for callback/status flow) and MUST NOT roll back registration state

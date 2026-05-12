## Context

`RegistrationConfirmed` events are already emitted from registration flows after database commit, but the queue implementation currently no-ops this event and no notification consumer/worker processes it. This leaves a product gap: successful registrations may have no user-visible confirmation signal outside payment status polling.

Constraints and current state:
- Keep modular monolith boundaries: registration publishes, notification consumes.
- Keep registration correctness independent from notification side effects.
- Use PostgreSQL (Supabase pooler port 6543) for app queries and direct connection only for migrations.
- Use existing Redis + BullMQ infrastructure; no new paid service/container.
- Keep channel extension open for future Telegram/SMS without touching registration module.

Stakeholders:
- Students: need reliable confirmation in app/email.
- Organizers/support: need delivery observability to resolve incidents.
- Backend team: needs idempotent, retry-safe async flow.

## Goals / Non-Goals

**Goals:**
- Deliver confirmation notifications asynchronously for each successful registration.
- Guarantee at-most-once logical delivery record per `(registration_id, channel)` despite duplicate/replayed events.
- Provide in-app inbox read APIs and read-state mutation for students.
- Provide retry and failure visibility for operational troubleshooting.
- Keep registration API latency and commit path unaffected by downstream channel failures.

**Non-Goals:**
- Mobile push notifications.
- New channels beyond email and in-app.
- Full user preference center.
- Replacing existing registration confirmation event contract.

## Decisions

### Decision 1: Keep producer contract, implement durable notification ingestion via queue + idempotent DB gate
- **Decision**: Keep `RegistrationConfirmed` payload unchanged; registration continues post-commit enqueue call. Notification consumer performs DB-backed idempotency guard before creating per-channel delivery records.
- **Reason**: Preserves existing upstream contract and avoids cross-module rewrite while meeting duplicate/replay safety.
- **Trade-off**: Without outbox, there remains a small post-commit/pre-enqueue failure window.
- **Alternatives considered**:
  - Add outbox immediately: stronger durability but larger migration/scope increase for this change.
  - Synchronous channel send in registration flow: rejected due to coupling and latency risk.

### Decision 2: Two-table model for orchestration and inbox
- **Decision**: Introduce `notification_deliveries` (channel delivery state machine) and `app_notifications` (student-visible inbox records).
- **Reason**: Separates transport lifecycle from product read-model; supports channel-specific retries and independent UX queries.
- **Trade-off**: More schema and write paths than a single table.
- **Alternatives considered**:
  - Single `notification_logs` table with mixed semantics: simpler schema but harder idempotency and query ergonomics.

### Decision 3: Channel strategy interface + worker delegation
- **Decision**: Notification service resolves channel adapters (`EmailChannel`, `InAppChannel`) via interface registry; workers only consume and delegate.
- **Reason**: Satisfies OCP/SRP, keeps future channel additions isolated.
- **Trade-off**: Slightly more boilerplate abstraction.
- **Alternatives considered**:
  - Switch-based channel logic in one service: quicker short-term, brittle for extension.

### Decision 4: Retry policy and terminal-state semantics per delivery
- **Decision**: BullMQ job retries transient failures (e.g., 3 attempts with fixed/exponential backoff); delivery row stores `pending -> sent | failed` with `attempt_count`, `last_error`, timestamps.
- **Reason**: Makes failure handling observable and deterministic.
- **Trade-off**: Requires consistent error classification in adapters.
- **Alternatives considered**:
  - Infinite retries: rejected due to queue buildup and noisy operations.
  - No retries: rejected due to provider transient failures.

### Decision 5: Student inbox API minimal surface
- **Decision**: Add read endpoints (`GET /notifications`, `GET /notifications/unread-count`) and mutation endpoint (`POST /notifications/:id/read`) for authenticated students.
- **Reason**: Covers immediate UX need with low coupling.
- **Trade-off**: Bulk operations/preferences deferred.
- **Alternatives considered**:
  - GraphQL/subscription model: rejected as out-of-scope architectural expansion.

### Sequence Diagram

```text
Student registration confirmed
    |
    | RegistrationService commits transaction
    v
Queue.enqueueRegistrationConfirmed(event)
    |
    v
BullMQ registration-confirmed worker
    |
    | idempotency guard on (event_type, registration_id)
    v
NotificationOrchestrator
    |                     \
    | create delivery(email) \ create delivery(in_app)
    v                      v
EmailChannel worker      InAppChannel worker
    |                      |
    | send email            | insert app_notifications row
    v                      v
update delivery status sent/failed + attempts/last_error
```

Queue job definition:
- Trigger event: `RegistrationConfirmed` enqueue after commit.
- Consumer: notification worker(s) in backend process.
- Retry policy: bounded retries (initial 3 attempts, backoff), then mark terminal failure.

## Risks / Trade-offs

- [Risk] Lost enqueue if process crashes between commit and queue add. -> Mitigation: document and monitor; optionally add outbox in follow-up hardening change.
- [Risk] Duplicate worker execution under retry/replay. -> Mitigation: unique DB constraints on idempotency keys and safe upserts.
- [Risk] Email provider outage spikes failures. -> Mitigation: bounded retries, terminal failure state, admin monitoring query.
- [Risk] Upstash command budget pressure from added jobs. -> Mitigation: keep single event fan-out path, avoid chatty polling, use concise retry counts.

## Migration Plan

1. Add SQL migration for `notification_deliveries` and `app_notifications` with indexes and uniqueness constraints.
2. Implement queue enqueue path for `RegistrationConfirmed` in shared queue infra.
3. Implement notification module (types, service, channel interfaces, adapters, repositories).
4. Implement notification worker startup wiring in backend app bootstrap.
5. Implement student notification APIs and frontend client consumption for inbox/unread badge.
6. Add tests for duplicate/replay idempotency, retry transitions, and API contracts.
7. Deploy behind migration-first sequence.

Rollback strategy:
- Disable notification worker and new routes via config while leaving additive tables in place.
- Registration remains functional because notifications are non-blocking side effects.

## Open Questions

- Should this change include an organizer/admin dashboard for failed deliveries, or keep ops visibility SQL/log-only for now?
- Should we introduce outbox in the same change or schedule it as explicit follow-up hardening?
- What unread inbox pagination size should be default for frontend UX and DB efficiency?

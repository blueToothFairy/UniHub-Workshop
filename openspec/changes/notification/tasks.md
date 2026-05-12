## 1. Database schema for notification delivery and inbox

- [x] 1.1 Add migration to create `notification_deliveries` with unique idempotency key on `(event_type, registration_id, channel)`, delivery status fields, attempt counters, and timestamps (spec: registration-notification-delivery "idempotent per-channel delivery"; design: Decision 2).
- [x] 1.2 Add migration to create `app_notifications` with `user_id`, content fields, read-state fields, and indexes for newest-first list + unread count queries (spec: student-inapp-notification-inbox list/count requirements; design: Decision 2).
- [x] 1.3 Validate migration order and rollback notes for Supabase workflow (pooler for app traffic, direct endpoint for migration execution) (design: Migration Plan).
- [x] 1.4 Manual smoke test: run migrations and verify tables, unique constraints, and indexes exist as expected.

## 2. Queue contract and enqueue semantics

- [x] 2.1 Define notification queue payload/types for `RegistrationConfirmed` processing before implementation (`notification.types.ts` and queue payload contract) (design: Decision 1, Decision 3).
- [x] 2.2 Implement `enqueueRegistrationConfirmed` in shared queue infrastructure with deterministic job naming/id strategy for replay-safe ingestion (spec: registration-notification-delivery idempotency; design: Decision 1).
- [x] 2.3 Update callback/create confirmation success-path semantics so notification enqueue failures are recorded but do not roll back confirmed registration state (spec: workshop-payment-momo-sandbox MODIFIED requirement; design: Decision 1).
- [x] 2.4 Manual smoke test: confirm registration still succeeds with expected HTTP contract when enqueue path is temporarily unavailable.

## 3. Notification module core (types first, then orchestration)

- [x] 3.1 Define TypeScript interfaces and enums for delivery lifecycle, channel adapter contract, and orchestrator inputs/outputs before service logic (design: Decision 3/4; rule: types first).
- [x] 3.2 Implement notification repository methods for idempotent delivery upsert/select/transition and in-app row creation (spec: registration-notification-delivery + student-inapp-notification-inbox; design: Decision 2).
- [x] 3.3 Implement notification orchestrator to fan out one confirmed registration event into channel delivery records once per channel (spec: registration-notification-delivery first-time + duplicate scenarios; design: Decision 1/2).
- [x] 3.4 Manual smoke test: replay the same event payload and verify no duplicate delivery rows are created.

## 4. Channel adapters and worker retry behavior

- [x] 4.1 Implement `InAppChannel` adapter that materializes inbox records from pending delivery jobs and marks delivery `sent` on success (spec: registration-notification-delivery bounded retry; design: Decision 3/4).
- [x] 4.2 Implement `EmailChannel` adapter with provider call boundary and retryable vs terminal error classification (spec: registration-notification-delivery bounded retry; design: Decision 4).
- [x] 4.3 Implement notification worker(s) that consume queued jobs, apply bounded retries, and persist attempt/error metadata per delivery (spec: retries exhausted scenario; design: Decision 4).
- [x] 4.4 Wire worker startup in backend bootstrap without embedding business logic in worker classes (design: SRP constraint + Decision 3).
- [x] 4.5 Manual smoke test: force transient email failure and verify retry attempts then terminal `failed` status after max retries.

## 5. Student notification inbox APIs

- [x] 5.1 Define API request/response types for list, unread count, and mark-read endpoints before router/service implementation (spec: student-inapp-notification-inbox requirements; rule: types first).
- [x] 5.2 Implement authenticated student routes: `GET /notifications`, `GET /notifications/unread-count`, and `POST /notifications/:id/read` with required status/body contracts (spec: student-inapp-notification-inbox success/error scenarios; design: Decision 5).
- [x] 5.3 Implement idempotent mark-read behavior so repeated calls return stable `200` response without duplicate writes (spec: mark-read idempotency).
- [x] 5.4 Manual smoke test: verify list pagination shape, unread count, repeated mark-read, unauthorized `401`, and missing-resource `404` responses.

## 6. Frontend integration for in-app inbox

- [x] 6.1 Add frontend API client methods and types for inbox list/unread count/mark-read endpoints (spec: student-inapp-notification-inbox; design: Decision 5).
- [x] 6.2 Implement student UI elements for unread badge and inbox list with read-state updates and retry messaging (spec: list/count/read scenarios).
- [x] 6.3 Implement offline UX fallback for inbox endpoints (client-side error state with retry action) without assuming backend response when offline (spec: offline behavior requirement).
- [ ] 6.4 Manual smoke test: authenticated student can view, read, and refresh notifications; offline mode shows local retry UX.

## 7. Quality gates and release readiness

- [x] 7.1 Add unit tests for delivery idempotency keys, duplicate event handling, and delivery state transitions (spec: registration-notification-delivery).
- [x] 7.2 Add integration tests for notification inbox HTTP contracts (`200/401/404`) and callback non-blocking behavior on enqueue failure (spec: student-inapp-notification-inbox + workshop-payment-momo-sandbox MODIFIED).
- [x] 7.3 Add worker retry-path test coverage for transient failure recovery and retry exhaustion terminal state (spec: registration-notification-delivery retries).
- [x] 7.4 Final manual smoke test: end-to-end free and paid confirmation emits exactly one logical delivery per channel and surfaces in inbox/email paths.

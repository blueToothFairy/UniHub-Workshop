## Context

The repository already supports student registration and QR issuance, but it stops short of recording attendance. `checkin_staff` exists as a role, the registration module signs QR JWTs containing `{registration_id, workshop_id, user_id}`, and the project context already assumes offline-capable staff devices; however, there is no `checkin` module, no attendance table, and admin check-in numbers are currently derived from placeholder math rather than persisted data.

This change crosses backend, mobile, and admin-read concerns:
- Backend must verify QR tokens and write a durable attendance record.
- Mobile must support both immediate online submission and deferred offline replay.
- Admin/dashboard reads must switch from estimates to real counts.

Because the event environment includes unstable connectivity and repeated scans at doorways, the design prioritizes idempotency, low-latency validation, and a single attendance source of truth.

## Goals / Non-Goals

**Goals:**
- Add a dedicated `checkin` module that validates existing QR JWTs and records one authoritative attendance event per registration/workshop.
- Support two staff flows: online scan submission and batched offline sync replay from Expo SQLite.
- Make workshop selection faster on staff devices by allowing offline search over cached workshops by title/room.
- Keep check-in idempotent so duplicate scans or sync retries do not create duplicate attendance rows.
- Provide real attendance counts for organizer dashboards and staff confirmation responses.
- Preserve the current registration QR contract so this change composes with the existing registration flow instead of replacing it.

**Non-Goals:**
- Redesigning registration issuance, payment logic, or JWT signing format beyond what is necessary for verification.
- Shipping advanced organizer analytics, attendance exports, or manual override workflows.
- Adding advanced workshop discovery filters/sorting on mobile beyond a single offline search box.
- Adding a new paid service, background container, or real-time websocket channel for check-in.
- Solving device enrollment, push notifications, or anti-fraud controls beyond basic token validation and duplicate protection.

## Decisions

### ADR-CHK-001: Use a dedicated `workshop_checkins` table as the attendance source of truth

**Decision**

Create a new table (for example `workshop_checkins`) keyed by `registration_id` with a uniqueness guarantee that enforces at most one successful attendance record per registration. Each row stores `id`, `registration_id`, `workshop_id`, `user_id`, `checked_in_by`, `source` (`online_scan` or `offline_sync`), optional `device_scan_id`, optional `scanned_at_device`, and server timestamps.

**Reason**

Attendance must be queryable independently of registration status and must survive retries, reconnects, and dashboard reads. A dedicated table keeps check-in ownership inside the `checkin` module and avoids overloading the `registrations` table with mutable door-side data.

**Trade-off**

This adds a migration and one more join path for admin statistics, but it keeps the model explicit and makes replay/idempotency logic much easier to reason about.

**Alternatives considered**

- Store `checked_in_at` directly on `registrations`.
  Rejected because it mixes attendance concerns into registration state and makes replay metadata awkward.
- Store only aggregate counts on `workshops`.
  Rejected because it loses per-attendee traceability and cannot support duplicate handling safely.

### ADR-CHK-002: Verify QR tokens statelessly first, then confirm registration/workshop validity from PostgreSQL

**Decision**

The `checkin` service will first verify the JWT signature and required claims locally, then query PostgreSQL through the Supabase pooler endpoint (port `6543`) to confirm that the referenced registration still exists, belongs to the claimed workshop/user, is in a `confirmed` state, and the workshop is not cancelled.

**Reason**

Local JWT verification keeps the scan path fast and compatible with offline client-side prechecks, while the database read remains the authoritative validation step for business state such as cancellation, duplicate attendance, or stale registrations.

**Trade-off**

A stateless token alone is not enough; the service still needs a DB read for correctness. That adds one query, but avoids granting attendance based solely on a previously valid token.

**Alternatives considered**

- Trust only the JWT.
  Rejected because cancelled or invalidated registrations could still be accepted.
- Query the DB before JWT verification.
  Rejected because invalid tokens would trigger unnecessary database work.

### ADR-CHK-003: Make server-side idempotency rely on unique constraints plus `INSERT ... ON CONFLICT DO NOTHING`

**Decision**

Online scans and offline sync replays will be idempotent at the database layer. The primary protection is a unique constraint on `registration_id` in `workshop_checkins`. Offline sync additionally records a per-device `device_scan_id` unique within a staff user/device scope to let the server return stable outcomes for repeated batch submissions.

**Reason**

Door-side retry behavior is unavoidable: users may be rescanned, the app may resubmit pending records after timeout, and sync batches may be replayed after partial failures. Database-enforced idempotency is more reliable than in-memory tracking and matches the project’s existing preference for durable correctness.

**Trade-off**

Responses must distinguish `created` from `already_checked_in`, and sync handling becomes slightly more verbose, but correctness is much stronger.

**Alternatives considered**

- Use Upstash as the primary dedupe store.
  Rejected because free-tier command budgets and transient cache state make it a poor durability boundary.
- Let duplicate inserts error and handle them generically.
  Rejected because the client needs deterministic, domain-specific results.

### ADR-CHK-004: Treat offline sync as batched reconciliation, not background queue work

**Decision**

Offline records stored on-device in Expo SQLite are pushed to `POST /checkin/sync` in bounded batches. The request is processed synchronously and returns per-item outcomes such as `checked_in`, `already_checked_in`, `invalid_qr`, `registration_not_confirmed`, or `workshop_mismatch`. No BullMQ job is introduced for this feature.

**Reason**

Staff need immediate reconciliation results so the device can clear successful queue items and retain only unresolved failures. A synchronous batch API keeps the flow simple and avoids new infrastructure or worker complexity.

**Trade-off**

Large sync batches must be size-limited to keep latency predictable, but the mobile app controls queue chunking and the server remains operationally simpler.

**Alternatives considered**

- Queue sync jobs asynchronously and poll status later.
  Rejected because it complicates mobile reconciliation and adds worker/operator overhead.
- Sync one scan per request.
  Rejected because it is too chatty for unstable networks and wastes Upstash/API budgets if retries occur.

### ADR-CHK-005: Expose attendance reads through dedicated check-in/admin contracts

**Decision**

Organizer-facing attendance totals and staff-facing confirmation responses will read from `workshop_checkins` rather than derived estimates. The `checkin` module will own attendee-status reads, while admin services may consume aggregated counts through narrow interfaces or helper queries.

**Reason**

This satisfies Interface Segregation: the admin/dashboard path needs aggregates, while the check-in flow needs per-registration status. Separating those reads keeps the `checkin` module focused and prevents registration or admin modules from directly owning attendance invariants.

**Trade-off**

There is some extra query/mapping code, but it avoids a future tangle where dashboard logic reimplements check-in semantics.

**Alternatives considered**

- Keep admin’s placeholder percentage until later.
  Rejected because it would make the new capability look complete while still showing incorrect numbers.

### ADR-CHK-MOB-001: Workshop picker search filters cached workshops offline

**Decision**

When selecting a workshop in the staff mobile app, the workshop picker provides a single text search input that filters the locally cached workshop list (Expo SQLite) by workshop `title` and `room/location`. Search works fully offline and does not require network calls.

**Reason**

Events often have many workshops, and staff devices are frequently offline or on unstable networks. Filtering the cached list keeps the UX fast and reliable while reducing dependence on backend search availability.

**Trade-off**

Offline search is limited to fields already cached on-device (title + room/location). More advanced discovery (speaker/description) is out of scope for this change.

## Sequence Diagrams

### Online scan flow

```text
Check-in Staff App        Backend /checkin        PostgreSQL
       |                        |                     |
1. scan QR                     |                     |
       |---- POST /scan ------>|                     |
       |    token/workshop     |                     |
       |                       | 2. verify JWT       |
       |                       |-------------------->|
       |                       | 3. read registration/workshop
       |                       |<--------------------|
       |                       | 4. INSERT check-in ON CONFLICT DO NOTHING
       |                       |-------------------->|
       |                       |<--------------------|
       |<--- result JSON ------|                     |
```

### Offline sync replay flow

```text
Expo SQLite Queue       Staff App Sync Client     Backend /checkin/sync     PostgreSQL
       |                        |                         |                    |
1. pending rows                |                         |                    |
       |---- load batch ------>|                         |                    |
       |                       |---- POST batch -------->|                    |
       |                       |    [{device_scan_id}]   |                    |
       |                       |                         | 2. verify each JWT |
       |                       |                         | 3. read registration/workshop
       |                       |                         | 4. INSERT ... ON CONFLICT
       |                       |                         |------------------->|
       |                       |                         |<-------------------|
       |                       |<--- per-item results ---|                    |
       |<--- clear/retry map---|                         |                    |
```

## Risks / Trade-offs

- [High scan concurrency at room doors] -> Use database uniqueness on `registration_id` plus atomic insert semantics so repeated or simultaneous scans converge safely.
- [Offline devices replay very old scans] -> Validate workshop/registration state at sync time and return itemized failure reasons instead of assuming queued scans are still valid.
- [JWT secret rotation invalidates offline verification unexpectedly] -> Keep server verification authoritative and document that mobile offline precheck is advisory; unresolved rotations can be handled operationally before event windows.
- [Batch sync payloads become too large for mobile reconnection windows] -> Enforce a modest batch size and require the mobile client to chunk uploads.
- [Admin dashboards become slower due to live aggregates] -> Use indexed `workshop_id` lookups on `workshop_checkins`; defer cached rollups unless profiling proves necessary.

## Migration Plan

1. Add SQL migration(s) using the Supabase direct endpoint (port `5432`) to create `workshop_checkins`, indexes on `workshop_id` and `checked_in_by`, and uniqueness constraints for `registration_id` and replay-safe device identifiers.
2. Deploy backend code that mounts the new `checkin` router behind `authenticate` + `authorize(["checkin_staff"])` for write flows, plus organizer-safe read helpers for dashboard counts.
3. Update admin stats logic to query persisted attendance totals.
4. Roll out mobile support for online scan and offline queue replay using the new contracts.
5. Run smoke tests for:
   - online scan success and duplicate scan behavior,
   - offline queue replay with repeated submission,
   - cancelled/expired/invalid QR handling,
   - dashboard count correctness.

**Rollback strategy**

- If backend rollout fails before mobile cutover, unmount the `checkin` routes and revert dashboard reads to the old placeholder logic temporarily.
- The new table is additive, so rollback does not require destructive migration reversal unless the schema itself is invalid.
- If sync behavior is unstable, the mobile app can disable replay submission while keeping local queue storage intact until a fix is deployed.

## Open Questions

- Should staff be required to select the current workshop/session explicitly before scanning, or should the QR token’s embedded `workshop_id` alone drive acceptance?
- Does the organizer UI need a per-attendee attendance list in this change, or are aggregate counts sufficient for the first release?
- Should the server accept check-ins for workshops that have not yet started, or enforce a configurable early-entry window?

## 1. Schema and persistence groundwork

- [x] 1.1 Add migration for `workshop_checkins` table with attendance columns, `registration_id` uniqueness, replay-safe device identifiers, and indexes for `workshop_id`/`checked_in_by` (spec: workshop-checkin; design: ADR-CHK-001/ADR-CHK-003).
- [x] 1.2 Add migration notes for Supabase direct-connection execution order and additive rollback guidance (design: Migration Plan).
- [x] 1.3 Manual smoke test: run migrations and verify constraints/indexes on a local or staging database before wiring services (design: Migration Plan).

## 2. Backend check-in module scaffolding

- [x] 2.1 Define TypeScript request/response contracts and result/error enums for `POST /checkin/scan` and `POST /checkin/sync` before service logic (spec: workshop-checkin + workshop-checkin-sync; rule: types first).
- [x] 2.2 Create `checkin` module structure with router/service/types and wire routes in `backend/src/app.ts` behind `authenticate` + `authorize(["checkin_staff"])` (spec: workshop-checkin; design: ADR-CHK-002).
- [x] 2.3 Introduce narrow read/write interfaces or query helpers for registration/workshop validation and attendance persistence so the check-in module owns attendance logic without violating SRP (design: ADR-CHK-005).
- [x] 2.4 Manual smoke test: verify auth and role protection for check-in routes and baseline 401/403 error contracts (spec: workshop-checkin error scenarios).

## 3. Online scan validation and attendance recording

- [x] 3.1 Implement QR verification flow that validates JWT signature/claims before database lookup using the existing QR token contract (spec: workshop-checkin; design: ADR-CHK-002).
- [x] 3.2 Implement confirmed-registration and workshop-state eligibility checks, including invalid token, wrong workshop, non-confirmed registration, and cancelled-workshop paths (spec: workshop-checkin invalid/ineligible scenarios).
- [x] 3.3 Implement durable attendance insert with `ON CONFLICT DO NOTHING` and response mapping for `checked_in` vs `already_checked_in` outcomes (spec: workshop-checkin successful + duplicate scenarios; design: ADR-CHK-003).
- [x] 3.4 Manual smoke test: verify successful online scan, duplicate scan idempotency, invalid QR rejection, and workshop mismatch handling (spec: workshop-checkin).

## 4. Offline sync reconciliation

- [x] 4.1 Define sync payload validation and per-item result mapping for stable `device_scan_id` reconciliation (spec: workshop-checkin-sync; design: ADR-CHK-003/ADR-CHK-004).
- [x] 4.2 Implement batched `POST /checkin/sync` processing that applies the same business validation as online scan while returning per-item outcomes instead of failing the whole batch for domain errors (spec: workshop-checkin-sync; design: ADR-CHK-004).
- [x] 4.3 Implement replay-safe dedupe behavior for repeated sync submissions so previously accepted items resolve deterministically without duplicate rows (spec: workshop-checkin-sync replay scenario; design: ADR-CHK-003).
- [x] 4.4 Manual smoke test: submit a mixed-result sync batch, replay the same batch, and confirm the device can distinguish clearable vs retryable items (spec: workshop-checkin-sync).

## 5. Attendance reads and admin integration

- [x] 5.1 Replace placeholder dashboard check-in math with persisted attendance totals derived from `workshop_checkins` (spec: checkin-attendance-read organizer dashboard requirement; design: ADR-CHK-005).
- [x] 5.2 Ensure check-in success and duplicate responses include the persisted `checked_in_at` data needed for door-side staff confirmation without a follow-up read (spec: checkin-attendance-read staff-facing requirement).
- [x] 5.3 Manual smoke test: confirm organizer dashboard totals match persisted attendance rows and staff responses show original timestamps for duplicate scans (spec: checkin-attendance-read).

## 6. Mobile app sync and scan integration

- [x] 6.1 Add typed mobile API helpers for online scan submission and batched sync responses, mirroring backend contracts exactly (spec: workshop-checkin + workshop-checkin-sync; rule: types first).
- [x] 6.2 Implement local Expo SQLite queue shape for offline scan records with `device_scan_id`, QR token, and device-captured timestamp (spec: workshop-checkin-sync; design: ADR-CHK-004).
- [x] 6.3 Implement mobile sync orchestration that chunks queued records, clears successful items, and retains unresolved failures for retry (spec: workshop-checkin-sync mixed-result scenario).
- [ ] 6.4 Manual smoke test: simulate offline capture, reconnect, sync in batches, and verify queue cleanup behavior end-to-end (spec: workshop-checkin-sync).

## 7. Quality gates and rollout readiness

- [x] 7.1 Add backend unit/integration tests for online scan success, invalid token handling, duplicate scan idempotency, and sync replay behavior (spec: workshop-checkin + workshop-checkin-sync).
- [x] 7.2 Add admin/dashboard coverage confirming persisted attendance totals replace placeholder values (spec: checkin-attendance-read).
- [x] 7.3 Add a concurrency-oriented test proving simultaneous duplicate scans for the same registration still produce a single attendance row (design: ADR-CHK-003).
- [x] 7.4 Document rollout notes, including additive schema deployment, no-new-service impact, and temporary rollback path to disable check-in routes if needed (proposal: Impact; design: Migration Plan).
- [ ] 7.5 Final manual smoke test: complete registration-to-QR-to-check-in flow across online scan, offline sync replay, and organizer count verification (spec: all; design: Sequence Diagrams).

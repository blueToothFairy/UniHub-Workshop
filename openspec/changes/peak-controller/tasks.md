## 1. Peak Controller Foundations

- [x] 1.1 Add peak-control configuration flags and workshop/window toggles in backend config types and env templates (Spec: `registration-peak-admission-control` / Requirement: Peak admission gate for registration writes; Design: ADR-PC-001).
- [x] 1.2 Define `IPeakAdmissionService` interface and DTO types for gate/admission responses before service implementation (Spec: `registration-peak-admission-control` / Requirement: Peak admission gate for registration writes; Design: ADR-PC-005).
- [x] 1.3 Implement Redis key schema helpers and TTL constants for queue membership, admission tokens, and limiter counters (Spec: `registration-peak-admission-control` / Requirements: Peak admission gate + Admission idempotency; Design: ADR-PC-002).
- [x] 1.4 Add unit tests for token payload validation, TTL behavior, and duplicate join idempotency (Spec: `registration-peak-admission-control` / Requirement: Admission operations are idempotent; Design: ADR-PC-004).
- [x] 1.5 Manual smoke test: verify a single student can join waiting state, receive admitted token, and see token expiry behavior with no duplicate queue entries (Spec: `registration-peak-admission-control` / Scenarios: waiting + admitted + repeated join).

## 2. Backend API and Registration Enforcement

- [x] 2.1 Add `GET /workshops/:id/registration-gate` and `POST /workshops/:id/admission` router endpoints with typed response contracts (Spec: `registration-peak-admission-control` / Requirement: Peak admission gate for registration writes; Spec: `workshop-summary-read` / modified gate metadata scenario).
- [x] 2.2 Implement per-user admission poll throttling and global registration protection responses with `retry_after` payloads (Spec: `registration-peak-admission-control` / Requirement: Overload handling returns deterministic retry guidance; Design: ADR-PC-003).
- [x] 2.3 Integrate admission-token enforcement at registration entry before seat mutation while preserving existing `Idempotency-Key` flow (Spec: `registration-peak-admission-control` / Requirement: Registration endpoint enforces admission token in peak mode; Spec: `workshop-payment-momo-sandbox` modified admission scenarios).
- [x] 2.4 Add integration tests for `403 ADMISSION_TOKEN_REQUIRED`, `403 ADMISSION_TOKEN_INVALID`, `429 RATE_LIMITED`, and `503 REGISTRATION_BUSY` contracts (Spec: `registration-peak-admission-control` / error scenarios; Spec: `workshop-payment-momo-sandbox` modified busy scenario).
- [x] 2.5 Manual smoke test: in peak-enabled mode, verify registration is blocked without admission token and accepted with valid token while keeping normal non-peak flow unchanged (Spec: `registration-peak-admission-control`; Design: ADR-PC-001).

## 3. Frontend Student Peak UX

- [x] 3.1 Extend frontend API types for gate/admission responses and peak-related error bodies before wiring UI behavior (Spec: `workshop-summary-read` modified requirements; Spec: `registration-peak-admission-control` response scenarios).
- [x] 3.2 Update student workshop detail flow to call gate/admission endpoints and render waiting/admitted/full/busy states (Spec: `workshop-summary-read` / modified CTA scenarios; Spec: `registration-peak-admission-control` waiting/full scenarios).
- [x] 3.3 Gate registration submit button to require admitted state in peak mode and keep existing redirect checkout UX after successful registration response (Spec: `workshop-payment-momo-sandbox` / modified frontend requirement).
- [x] 3.4 Implement retry cadence using backend `retry_after` with jitter to avoid synchronized polling (Spec: `registration-peak-admission-control` / overload scenarios; Design: ADR-PC-003).
- [x] 3.5 Manual smoke test: multi-tab same account shows single logical queue behavior and no duplicate registration attempts (Spec: `registration-peak-admission-control` / multi-tab scenario).

## 4. Observability, Load Validation, and Rollout Controls

- [x] 4.1 Add structured logs/metrics for admission queue depth, token issuance/use/expiry, throttle counts, and peak-path latency (Spec: `registration-peak-admission-control` / monitoring impact; Design: Risks + Migration Plan).
- [x] 4.2 Add a peak-load rehearsal script and assertions for p95 latency and non-capacity failure budget targets (Proposal impact success criteria; Design: Migration step 7).
- [x] 4.3 Add rollout/rollback runbook notes for feature-flag enablement by workshop cohort and immediate disable fallback (Design: Migration Plan rollback strategy).
- [x] 4.4 Manual smoke test: enable feature flag for one workshop, verify metrics dashboards and safe fallback when flag is disabled (Design: Risks / Migration Plan).

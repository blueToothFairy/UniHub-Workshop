## Context

Peak registration traffic currently reaches `POST /registrations` directly, where correctness is protected by PostgreSQL locking and idempotency, but ingress is not shape-controlled. During opening bursts, this can produce retry storms, uneven fairness, and degraded latency even when seat invariants remain correct.

Current constraints:
- Modular monolith with student registration in backend `registration` + `workshop` modules.
- PostgreSQL (Supabase pooler endpoint, port 6543) is the source of truth for seat/counter correctness.
- Existing Redis footprint already backs rate limiting and circuit-breaker state.
- No new paid services or containers are allowed.

Stakeholders:
- Students need fair access and predictable feedback during opening peaks.
- Backend team needs bounded write pressure without weakening idempotency/seat safety.
- Support/ops need visibility when system is busy, waiting, or full.

## Goals / Non-Goals

**Goals:**
- Introduce admission control so only a bounded number of clients can attempt registration writes concurrently during peak windows.
- Preserve existing correctness guarantees (`reserved_count <= capacity`, idempotent registration create behavior).
- Provide deterministic client states (`waiting`, `admitted`, `busy`, `full`) with `retry_after` guidance.
- Keep read endpoints available under pressure and avoid introducing paid infrastructure.

**Non-Goals:**
- Replacing existing payment callback/reconciliation architecture.
- Rewriting registration state machine for free/paid workflows.
- Adding mobile student registration or offline registration queueing.
- Guaranteeing strict global fairness across all network conditions (goal is practical fairness and anti-spam).

## Decisions

### ADR-PC-001: Add a virtual waiting-room admission layer before registration writes

**Decision**  
Introduce a new peak controller capability with:
- `POST /workshops/:id/admission` (join/check waiting state)
- `GET /workshops/:id/registration-gate` (read gate state)
- short-lived admission token required by `POST /registrations` during configured peak window.

**Reason**  
Bounding ingress before DB-intensive registration logic reduces burst amplification from refresh/retry behavior and improves fairness by serializing attempts.

**Trade-off**  
Adds API and state complexity (queue position, token lifecycle, and expiry handling) and requires frontend behavior changes.

**Alternatives considered**
- Only add rate limit: simpler, but weaker fairness and poorer user transparency.
- Only scale backend workers: higher infra cost and still vulnerable to synchronized client retries.

### ADR-PC-002: Use Redis as admission/rate coordination plane, PostgreSQL as seat authority

**Decision**  
Use Redis for queue rank, token issuance/consumption markers, and limiter counters; keep seat finalization exclusively in PostgreSQL transactions via existing registration flow.

**Reason**  
Redis offers low-latency coordination primitives for peak control while preserving seat correctness in the durable store.

**Trade-off**  
More Redis command volume and operational sensitivity to Redis latency.

**Alternatives considered**
- DB-only queue tables: stronger durability but significantly higher write contention in peak windows.
- In-memory process queue: not safe across restarts or horizontal processes.

**Upstash command impact**
- Incremental commands concentrated in peak windows:
  - admission poll/check: ~1-2 reads/request
  - join/position writes: ~1 write on first join, then reads
  - token consume: 1 atomic write/check on registration submit
- To stay within free-tier budgets, apply:
  - min poll interval (`retry_after >= 3s`)
  - deduplicated join (one active queue membership per user/workshop)
  - short TTL keys and low-chatter response design.

### ADR-PC-003: Enforce layered throttling with explicit retry contracts

**Decision**  
Apply:
- per-user throttling on admission polling and registration writes,
- global registration write guardrail, and
- consistent `429/503` response shapes with `retry_after`.

**Reason**  
Layered limits prevent both user-level spam and system-wide overload, while retry contracts reduce thundering-herd retries.

**Trade-off**  
Some legitimate users may be deferred or rate-limited during bursts.

**Alternatives considered**
- IP-only throttling: unfair in shared campus networks.
- Silent drops/timeouts: poor UX and causes more retries.

### ADR-PC-004: Preserve existing registration idempotency as final dedupe layer

**Decision**  
Admission token checks happen before or at registration entry, but existing `Idempotency-Key` semantics in registration remain unchanged and mandatory.

**Reason**  
Admission controls ingress; idempotency protects duplicate submission semantics and payment side effects.

**Trade-off**  
Two control layers (admission + idempotency) increase conceptual complexity.

**Alternatives considered**
- Replace idempotency with admission-only dedupe: unsafe for retries and network ambiguity.

### ADR-PC-005: Introduce a narrow peak-controller interface for SRP/ISP

**Decision**  
Add a `IPeakAdmissionService` (or equivalent narrow interface) consumed by registration/workshop routers.

**Reason**  
Satisfies:
- **SRP**: registration service remains focused on registration/payment state transitions.
- **ISP**: consumers depend only on admission methods they need.
- **DIP**: routers/services depend on abstraction, enabling in-memory fakes in tests.

**Trade-off**  
Requires additional wiring and test doubles.

### Sequence Diagram

```text
Student Client
    |
    | 1) GET /workshops/:id/registration-gate
    v
Workshop Router/Service ------------------------------> Redis
    |                                                    |
    |<---------------------- gate state + retry_after ---|
    |
    | 2) POST /workshops/:id/admission
    v
Peak Admission Service -------------------------------> Redis
    |                                                    |
    |<------ waiting position OR admitted token ---------|
    |
    | 3) POST /registrations + Idempotency-Key + Admission-Token
    v
Registration Router -> Peak Admission Service -------> Redis
    |                      (token consume check)
    |<--------------------- pass/fail
    |
    v
Registration Service --------------------------------> PostgreSQL (pooler 6543)
    |                     (existing lock + seat + idempotency/payment)
    |<------------------------------------- commit result
    v
Client result (confirmed/pending/full/busy with retry guidance)
```

Queue-job note:
- This change does not add a mandatory new BullMQ worker. Existing registration-confirmed notification jobs remain unchanged.

## Risks / Trade-offs

- [Risk] Redis latency or outage can block admission checks.  
  → Mitigation: fail-safe mode returns explicit `503 REGISTRATION_BUSY` with `retry_after`; do not bypass to uncontrolled write flood.

- [Risk] Polling endpoints become high-volume and consume command budget.  
  → Mitigation: enforce poll interval, return stable queue state, and avoid per-poll writes.

- [Risk] Token expiry race may frustrate users.  
  → Mitigation: short grace handling and clear client message to re-request admission without losing fairness position if still valid.

- [Risk] Misconfigured peak window could over-gate normal traffic.  
  → Mitigation: feature flag + per-workshop/time toggle, canary rollout, and immediate disable switch.

- [Risk] Fairness perception issues if network-fast users appear advantaged.  
  → Mitigation: deterministic queue semantics and optional pre-open waiting window policy.

## Migration Plan

1. Add feature flag/config for peak-control enablement and window policy.
2. Introduce Redis-backed admission primitives and limiter utilities (no DB schema changes required for initial rollout).
3. Add new gate/admission endpoints and response contracts.
4. Integrate admission-token enforcement in registration entry path (without changing existing idempotency semantics).
5. Update student frontend to admission-first flow and retry-after-driven polling.
6. Add metrics/logging dashboards and alert thresholds for peak signals.
7. Run load test rehearsal, then rollout by workshop cohort (small -> medium -> high demand).

Rollback strategy:
- Disable peak-control feature flag to revert to current direct registration flow while preserving existing seat/idempotency behavior.
- Keep endpoint handlers available but dormant if disabled, returning current non-queued behavior.

## Open Questions

- Should fairness mode be pure first-come-first-served or include a short pre-open randomization window for ties?
- Do we require single-use admission tokens strictly, or allow one replay for network failure within TTL?
- Should global write limits be static or adaptive based on observed latency/connection pool utilization?
- What is the minimum acceptable student UX when Redis is degraded (retry-only vs fallback queue bypass)?

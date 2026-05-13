## Why

Peak-time registration traffic can overwhelm the backend before seat-correctness logic executes, causing unstable latency, retry storms, and unfair access during the first minutes after opening. We need controlled admission now to protect reliability for the upcoming high-volume workshop windows (~12,000 students in a short burst) without adding paid infrastructure.

## What Changes

- Introduce a peak admission control layer for registration writes with virtual waiting behavior and short-lived admission tokens.
- Add multi-layer throttling behavior for peak-sensitive endpoints (per-user plus global protection) with explicit `Retry-After` semantics.
- Add registration gate/read models so clients can show waiting, admitted, full, and busy states without hammering `POST /registrations`.
- Update registration create contract to enforce admission requirements during configured peak windows while preserving existing idempotency and seat correctness guarantees.
- Add observability requirements for queue depth, admission issuance, rejection reasons, and peak-path latency.

## Capabilities

### New Capabilities
- `registration-peak-admission-control`: Controlled peak ingress using waiting-room style admission, signed/opaque short-lived tokens, and fairness-safe token issuance.

### Modified Capabilities
- `workshop-payment-momo-sandbox`: Registration initiation requirements are extended for peak windows (admission token checks, busy/waiting responses, and retry guidance).
- `workshop-summary-read`: Workshop and registration-read endpoints are extended to expose registration gate status fields needed for peak UX.

## Out of Scope

- Replacing PostgreSQL as source of truth for seats or payment state.
- New external paid services, new containers, or multi-region architecture.
- Mobile student registration features.
- Redesign of payment gateway callback, reconciliation core, or QR generation flow.

## Impact

- **Backend modules**: `registration`, `workshop`, shared middleware/rate control, and Redis-backed coordination logic.
- **Frontend (student web)**: workshop detail registration UX, waiting state rendering, retry/backoff behavior, and polling cadence changes.
- **API contracts**: new/extended gate endpoints and explicit overload responses (`429`/`503` + `retry_after`).
- **Data/infra**: additional short-TTL Redis keys/counters for queue/admission/rate signals; PostgreSQL remains the final seat authority.
- **Success criteria**:
  - Under peak simulation, registration write path p95 latency remains `< 1.5s`.
  - `POST /registrations` error budget for non-capacity failures stays `< 2%` during first 3 peak minutes.
  - No oversell events (`reserved_count <= capacity`) in contention tests.
  - Waiting clients receive deterministic retry guidance (`retry_after`) for 100% of throttled/busy responses.
- **Cost note**: This proposal is intentionally constrained to existing Supabase + Upstash free-tier footprint and does not introduce monthly infrastructure cost increases.

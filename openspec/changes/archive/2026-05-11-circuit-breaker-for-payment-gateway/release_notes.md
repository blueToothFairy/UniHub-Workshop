## Rollout Notes: circuit-breaker-for-payment-gateway

### Feature toggles / runtime controls
- `PAYMENT_CIRCUIT_FAILURE_THRESHOLD` (default `5`)
- `PAYMENT_CIRCUIT_FAILURE_WINDOW_SECONDS` (default `30`)
- `PAYMENT_CIRCUIT_OPEN_DURATION_SECONDS` (default `60`)
- `PAYMENT_CIRCUIT_HALF_OPEN_PROBE_LIMIT` (default `1`)
- `MOMO_CREATE_ORDER_TIMEOUT_MS` (default `10000`)
- `MOMO_QUERY_TIMEOUT_MS` (default `10000`)

### Alert thresholds
- Alert when repeated `payment_circuit_transition` events indicate `OPEN` state for > 5 minutes.
- Alert when `payment_reconciliation_summary.unknownBacklog` grows continuously across reconciliation intervals.
- Alert on spikes of `payment_circuit_fail_fast_total` with tag `reason=open`.

### Safe rollback
1. Set `PAYMENT_CIRCUIT_FAILURE_THRESHOLD` to a very high value temporarily (or redeploy without circuit-breaker wiring) to effectively disable trips.
2. Keep existing reconciliation/expiry jobs enabled to converge pending/unknown states.
3. Verify `POST /registrations` paid flow returns to pre-change behavior and track unknown backlog.

### Post-rollout verification checklist
- Confirm `PAYMENT_GATEWAY_UNAVAILABLE` responses include `retry_after`.
- Confirm frontend surfaces retry guidance and avoids redirect when 503 is returned.
- Confirm transition logs are emitted for `CLOSED->OPEN->HALF_OPEN->CLOSED/OPEN`.
- Confirm reconciliation summary logs include `unknownBacklog` and breaker state correlation.

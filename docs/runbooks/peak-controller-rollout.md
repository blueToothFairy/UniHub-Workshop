# Peak Controller Rollout Runbook

## Scope

This runbook covers rollout and rollback for peak admission control on workshop registration.

## Preconditions

- Backend deployed with peak controller routes:
  - `GET /workshops/:id/registration-gate`
  - `POST /workshops/:id/admission`
- Frontend deployed with waiting-room aware registration UX.
- Env variables configured on target environment.

## Required Configuration

- `PEAK_CONTROL_ENABLED=true|false`
- `PEAK_CONTROL_WORKSHOP_IDS=<comma-separated workshop ids>` (empty = all workshops)
- `PEAK_CONTROL_WINDOW_START_UTC=HH:mm`
- `PEAK_CONTROL_WINDOW_END_UTC=HH:mm`
- `PEAK_CONTROL_USER_POLL_MIN_INTERVAL_SECONDS`
- `PEAK_CONTROL_USER_WRITE_MIN_INTERVAL_SECONDS`
- `PEAK_CONTROL_GLOBAL_WRITE_LIMIT_PER_SECOND`
- `PEAK_CONTROL_ADMISSION_TOKEN_TTL_SECONDS`
- `PEAK_CONTROL_QUEUE_BUFFER_SEATS`
- `PEAK_CONTROL_QUEUE_RETRY_AFTER_SECONDS`

## Canary Rollout (Recommended)

1. Set `PEAK_CONTROL_ENABLED=true`.
2. Set `PEAK_CONTROL_WORKSHOP_IDS` to one low-demand workshop.
3. Set a narrow peak window around a controlled rehearsal period.
4. Monitor logs for:
   - `peak_admission_issued`
   - `peak_admission_waiting`
   - `peak_registration_global_busy`
   - `peak_admission_poll_rate_limited`
5. Verify student UX states:
   - waiting queue displayed
   - admission granted before submit
   - `retry_after` respected.

If healthy, expand allow-list in cohorts:
- low demand -> medium demand -> highest demand.

## Success Checks

- Registration write path remains stable under rehearsal.
- No `reserved_count > capacity` violations.
- Non-capacity failures remain within error budget.
- Busy/rate-limited responses include deterministic `retry_after`.

## Immediate Rollback

1. Set `PEAK_CONTROL_ENABLED=false`.
2. Redeploy/restart backend config.
3. Confirm:
   - direct `POST /registrations` flow works without admission token
   - no continuing burst of `REGISTRATION_BUSY` responses.

## Partial Rollback (Scoped)

- Keep `PEAK_CONTROL_ENABLED=true` but clear or narrow `PEAK_CONTROL_WORKSHOP_IDS`.
- Reduce scope to one workshop or disable during non-peak windows.

## Incident Notes

- If Redis is degraded, expect increased `REGISTRATION_BUSY` responses.
- Prefer fail-closed behavior over bypassing admission, to prevent write storms.

## Rollout Notes: register-free-and-paid-workshops-simulated-payment

### Scope
- This rollout implements free + paid workshop registration with **simulated payment only**.
- No VNPay callback/signature verification or external gateway calls are included.
- Student paid flow uses `Click to pay (Simulation)` after pending registration creation.

### Migration Order (Supabase)
1. `20260501_create_admin_tables.sql`
2. `20260501_create_auth_tables.sql`
3. `20260502_add_workshop_summary_fields.sql`
4. `20260506_create_registration_and_payment_simulation_tables.sql`
5. `20260506_add_workshop_reservation_counters.sql`

### Rollback Guidance
- Route-level rollback: disable `/registrations` API exposure (feature flag or route toggle).
- Schema rollback: keep additive schema changes in place; do not drop new tables/columns during live rollback.
- Data rollback: if required, revert application behavior first, then clean registration/payment rows offline.

### Operational Notes
- `reserved_count` and `confirmed_count` are the source for seat availability (`availableSeats = capacity - reserved_count`).
- Registration idempotency depends on `Idempotency-Key` and `payments.idempotency_key` uniqueness.
- Simulation payment statuses are `pending_simulation`, `completed`, and `expired`.

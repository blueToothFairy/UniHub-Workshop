# MoMo Sandbox Rollout Notes

## Supabase Migration Order

Run migrations in chronological order:

1. `20260501_create_auth_tables.sql`
2. `20260501_create_admin_tables.sql`
3. `20260502_add_workshop_summary_fields.sql`
4. `20260506_add_workshop_reservation_counters.sql`
5. `20260506_create_registration_and_payment_simulation_tables.sql`
6. `20260508_add_momo_sandbox_payment_fields.sql`

## Compatibility and Backfill

- `20260508_add_momo_sandbox_payment_fields.sql` is additive only.
- Existing simulation rows are backfilled with:
  - `provider_order_id = merchant_order_id`
  - `provider_result_code = 'SIMULATION'` when missing
  - `provider_message = 'Legacy simulation payment'` when missing
- Existing idempotency columns (`idempotency_key`, `request_hash`, `merchant_order_id`) remain unchanged.

## Rollback Path

- Application rollback can be done by toggling payment mode back to simulation config.
- Schema rollback is not required for emergency app rollback because migration is additive.
- Keep reconciliation/status endpoints enabled during rollback to safely converge in-flight paid registrations.

# Workshop Check-in Rollout

## Migration order

1. Run existing migrations in order through `20260508_add_momo_sandbox_payment_fields.sql`.
2. Run `20260510_create_workshop_checkins.sql` using the Supabase direct endpoint on port `5432`.
3. Deploy backend application code that mounts `/checkin` routes and reads persisted attendance totals.
4. Deploy mobile/client code that starts writing `device_id` and `device_scan_id` for offline replay.

Runtime application queries continue to use the Supabase pooler endpoint on port `6543`.

## Rollback guidance

- The `workshop_checkins` table is additive. If rollout issues occur, disable `/checkin` route usage and revert dashboard reads before considering schema rollback.
- Existing registration and QR issuance flows are unchanged, so disabling the new routes restores the previous behavior without data loss.
- If duplicate handling or sync reconciliation behaves unexpectedly, pause mobile sync submission and keep locally queued records until a patched backend is deployed.

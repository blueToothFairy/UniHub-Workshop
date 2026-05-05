# AI Summary Release Checklist

## Rollout Steps

1. Apply SQL migration `backend/migrations/20260502_add_workshop_summary_fields.sql` using Supabase direct endpoint (port 5432).
2. Deploy backend API and worker code together (same image) to avoid queue payload mismatch.
3. Verify `.env` contains required runtime values:
   - `SUPABASE_POOLER_URL`
   - `SUPABASE_DIRECT_URL` (migration only)
   - `ALLOWED_ORIGINS`
4. Perform smoke tests:
   - login + workshop list
   - upload valid PDF (`202`)
   - upload invalid file (`400 INVALID_PDF_TYPE`)
   - upload >10MB (`400 PDF_TOO_LARGE`)
5. Verify read path:
   - `/admin/workshops/:id` includes summary fields
   - `/workshops/:id` includes summary fields

## Rollback Strategy

1. Roll back application to previous image if runtime errors are detected.
2. Keep new DB columns in place (backward-compatible additive migration).
3. Disable new upload UI entry points if emergency mitigation is needed.

## Upstash Command Budget Notes

- Expected queue command volume for this feature: ~2-4 commands per upload job plus retries.
- Alert threshold recommendation: trigger warning at `>= 8,000` commands/day to preserve headroom for auth/rate-limit/payment modules.

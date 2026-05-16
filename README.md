# UniHub Workshop

Monorepo scaffold following blueprint with:
- `backend/`: Express + TypeScript strict
- `frontend/`: Next.js 14 App Router + TypeScript strict
- `mobile/`: Expo skeleton

## CSV Import Scheduling
- Backend supports scheduled student CSV import from `CSV_DROP_DIR/CSV_IMPORT_FILENAME`.
- Configure nightly and evening windows with `CSV_IMPORT_NIGHTLY_CRON` and `CSV_IMPORT_EVENING_CRON`.
- Set `CSV_IMPORT_ENABLED=true` to register the schedulers and `CSV_IMPORT_TIMEZONE` for local run interpretation.
- Import runs persist outcomes so operators can distinguish `processed`, `skipped_missing`, `skipped_stale`, `failed_validation`, and `failed_runtime`.
- If an evening import fails or no fresh file is present, the system keeps the last successful student dataset in place.

## Admin Features Implemented
- Frontend route protection for `/admin/*`
- Admin dashboard/workshop/audit-log pages
- Backend RBAC for organizer-only admin APIs
- Workshop create/update/cancel with conflict checks
- Audit logging for create/update/cancel
- Async queue contract for notifications on impactful changes

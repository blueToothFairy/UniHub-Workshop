# UniHub Workshop

Monorepo scaffold following blueprint with:
- `backend/`: Express + TypeScript strict
- `frontend/`: Next.js 14 App Router + TypeScript strict
- `mobile/`: Expo skeleton

## Admin Features Implemented
- Frontend route protection for `/admin/*`
- Admin dashboard/workshop/audit-log pages
- Backend RBAC for organizer-only admin APIs
- Workshop create/update/cancel with conflict checks
- Audit logging for create/update/cancel
- Async queue contract for notifications on impactful changes

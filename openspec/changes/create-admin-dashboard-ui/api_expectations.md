# API Expectations: Admin Dashboard UI

## GET /admin/dashboard/stats
- Given a valid organizer token
- When UI requests dashboard stats
- Then API returns `200` with `{ data: DashboardStats }`

## GET /admin/dashboard/stats forbidden
- Given a valid non-organizer token
- When request reaches backend
- Then API returns `403` with `{ error: { code: "FORBIDDEN", message: string } }`

## Idempotency
- This read endpoint is idempotent.

## Online/Offline
- Dashboard is online-only for web admin.

# Design: Admin Authentication and Authorization

## Decision
Use JWT bearer token at backend and cookie token check at frontend middleware. Admin APIs require `organizer` role.

## Reason
This matches blueprint auth + RBAC flow and prevents student/checkin staff from entering `/admin/*`.

## Trade-off
Frontend-only middleware can be bypassed by direct API calls, so backend role check is mandatory and implemented.

## Sequence Diagram
Client -> Frontend Middleware -> Backend `/admin/*` -> Auth middleware -> Authorize organizer -> Admin service

## Supabase Endpoint
- Runtime queries: Supabase pooler endpoint (port 6543)
- Migrations: direct endpoint (port 5432)

## Upstash Command Impact
No new Redis command pattern added in this change. Queue is abstracted with in-memory adapter for local scaffold.

## Queue Job Policy
- Trigger event: workshop schedule/status changed, workshop cancelled
- Consumer: notification worker (planned)
- Retry policy: 3 retries with exponential backoff (planned contract)

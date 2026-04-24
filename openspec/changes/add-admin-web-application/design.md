## Context

The UniHub Workshop system is a modular monolith with a Next.js frontend and Express.js backend. The organization team (Ban tổ chức) currently has no dedicated admin interface and must perform workshop management through direct database access or manual API calls. This change adds a full-featured admin dashboard and management interface integrated into the existing Next.js web application at `/admin/*` routes, with corresponding backend API routes at `/admin/*`.

**Stakeholders:**
- Organization team (~10 people) who manage workshop creation, scheduling, and monitoring
- System operators who configure notifications, payments, and audit settings
- Developers who need clean separation between student UI and admin UI

**Constraints:**
- Sub-200k VND/month budget maintained → **zero-cost infrastructure**: Supabase PostgreSQL free tier, Upstash Redis free tier
- Single Next.js deployment (no separate admin app)
- OAuth/email-based authentication (no LDAP/enterprise auth)
- Gemini API free tier (60 RPM limit for PDF summaries)
- Cloudflare R2 free tier (10GB) for file storage
- Code must follow SOLID principles: clean architecture with separated concerns (route handlers, service layer, domain logic)

---

## Goals / Non-Goals

**Goals:**

1. **Self-service workshop management** - Organization team can create, edit, reschedule, and cancel workshops without IT support
2. **Real-time analytics** - Dashboard shows live registration counts, payment status, check-in progress, and system alerts
3. **Audit and compliance** - All admin actions logged with before/after state for compliance and debugging
4. **System configuration** - Admins can configure notifications, payments, rate limits, and session defaults without code changes
5. **PDF workflows** - Admins upload workshop PDFs; AI automatically generates summaries within 60 seconds (free tier respecting 60 RPM)
6. **Secure access** - Role-based access control via JWT tokens; admin role required for all admin routes
7. **Operational visibility** - Alerts and anomaly detection (low registrations, nearing capacity, payment failures, etc.)

**Non-Goals:**

- Multi-tenancy or organization-level isolation (single organization per deployment)
- Advanced data analytics or BI tools (basic dashboards only)
- Custom workflow builder or automation rules (fixed workflows only)
- Integration with external HR or accounting systems (admin config only)
- Mobile admin app (web-only, responsive design sufficient)

---

## Decisions

### 1. Admin Routes in Next.js vs. Separate Admin App

**Decision:** Integrate admin interface into existing Next.js app at `/admin/*` routes, behind authentication middleware.

**Rationale:**
- Single deployment and dependency footprint (cost constraint)
- Shared authentication, styling, and infrastructure with student app
- Simpler CORS and HTTPS configuration
- Code reuse for common components (tables, forms, modals)

**Alternatives Considered:**
- Separate Next.js admin app → doubles deployment, dependency maintenance, auth complexity
- Admin Single Page App (React SPA) served from `/admin` → duplicates frontend dependencies
- Rejected: Both would exceed budget/maintenance constraints

**Implementation:**
- Next.js App Router with layout hierarchy: `(auth)/admin/layout.tsx` wraps all admin routes
- Client-side middleware to check JWT token has `role: "admin"` claim before rendering
- Server-side validation on each admin route handler and API call
- Shared `AdminLayout` component with sidebar navigation

### 2. Admin Authentication and Authorization

**Decision:** Extend JWT token to include `role` claim ("admin" or "student"). Admin routes validate presence of `role: "admin"` claim in JWT.

**Rationale:**
- No new auth service required (existing JWT infrastructure)
- Roles encoded in token; stateless verification on every request
- Supports future role expansion (e.g., "audit-viewer", "payment-reviewer")

**Alternatives Considered:**
- Separate admin table with admin_id keys → complex sync with users table
- Redis-based role cache → adds statefulness and invalidation complexity
- Rejected: JWT approach is simpler and fits existing auth patterns

**Implementation:**
- Backend: `/auth/login` endpoint checks user.role in database; if role = "admin", JWT includes `role: "admin"` claim
- Middleware: `requireAdmin()` middleware on Express routes checks `req.user.role === "admin"`
- Frontend: `useAuth()` hook exposes `user.role`; protect routes with `<ProtectedRoute role="admin">`
- Logout: Add JWT token to Redis blacklist with TTL = token expiry time

### 3. Cloud Providers: Supabase PostgreSQL and Upstash Redis

**Decision:** Use Supabase (PostgreSQL free tier) for primary database and Upstash Redis (free tier) for caching, rate limiting, and job queue backend.

**Rationale:**
- **Zero infrastructure cost**: Both services offer perpetual free tiers with no time limits
- Supabase provides PostgreSQL 5GB storage, 500MB egress/month, enough for admin audit logs and configuration
- Upstash Redis provides 10,000 commands/day free tier, sufficient for rate limiting tokens, session cache, and Bull job queue
- No vendor lock-in: Both use standard PostgreSQL and Redis protocols; easy to migrate
- Managed services reduce operational overhead for student project

**Alternatives Considered:**
- Self-host PostgreSQL and Redis on VPS → requires manual backup, monitoring, upgrades; limited by single node capacity
- AWS RDS + ElastiCache → not free tier after 12 months; complex cost estimation
- Firebase/Firestore → SQL-less; doesn't fit existing PostgreSQL schema
- Rejected: Supabase + Upstash offers best free tier + managed experience combo

**Implementation:**
- Supabase: PostgreSQL 14+, automatic SSL, connection pooling, real-time subscriptions (can use in future)
- Upstash: Redis API compatible, persistent (RDB snapshots), automatic failover in pro tier (not needed for MVP)
- Connection strings stored in environment: `SUPABASE_DB_URL`, `UPSTASH_REDIS_URL`
- Client libraries: `pg` for Supabase, `@upstash/redis` or standard `redis` for Upstash

### 4. SOLID Principles Clean Architecture

**Decision:** Implement backend with explicit SOLID principles: separate Express route handlers from business logic, use dependency injection for external integrations, apply single responsibility to queue workers.

**Rationale:**
- **Maintainability**: Clear separation makes code easier to test, understand, and extend
- **Testability**: Mock external dependencies (R2, Gemini, Redis) via dependency injection
- **Scalability**: Each concern can evolve independently (e.g., swap Gemini for Claude without touching route handlers)
- **SOLID compliance**:
  - **S**ingle Responsibility: Workshop service handles workshop logic only; NotificationService handles notifications
  - **O**pen/Closed: Add new features (e.g., SMS notifications) without modifying existing code
  - **L**iskov Substitution: All cache providers implement same interface; all AI providers implement same interface
  - **I**nterface Segregation: Small, focused interfaces (AIProvider, CacheProvider, StorageProvider)
  - **D**ependency Inversion: Route handlers depend on interfaces, not concrete implementations

**Alternatives Considered:**
- Monolithic route handlers with all logic inline → harder to test, refactor, and reuse
- Rails-style MVC with thick models → works but less flexible for complex workflows
- Rejected: Clean architecture with DI pattern is worth the upfront structure for maintainability

**Implementation:**
```
src/
├── routes/          # Express route handlers (thin, only HTTP concerns)
├── services/        # Business logic (WorkshopService, NotificationService, etc.)
├── domain/          # Core domain models and logic (Workshop, Registration, etc.)
├── repositories/    # Data access abstraction (WorkshopRepository, AuditLogRepository)
├── providers/       # External integrations (AIProvider interface, StorageProvider interface)
└── workers/         # Bull queue workers (each has single responsibility)
```
- Route handler calls service method; service uses repositories and providers via DI
- Each queue worker is stateless, pure function: event → side effect

### 5. Real-Time Dashboard with Polling vs. WebSocket

**Decision:** Use polling (5-10 second interval) for dashboard stats; reserve WebSocket for future when concurrent admin operations increase.

**Rationale:**
- Polling is simpler to implement, deploy, and scale with single VPS
- 10-second refresh is acceptable for admin use cases (registration stats don't need sub-second latency)
- No extra service dependencies (no Socket.io cluster Redis)
- Easy to switch to WebSocket later if needed

**Alternatives Considered:**
- WebSocket for real-time updates → adds Socket.io deployment, Redis adapter complexity, browser memory overhead
- Server-Sent Events (SSE) → simpler than WebSocket but still adds server-side state
- Rejected: Polling sufficient for current requirements

**Implementation:**
- Frontend: `useEffect` with `setInterval` calling `/admin/dashboard/stats` every 10 seconds
- Backend: `/admin/dashboard/stats` is a simple GET route with no caching (fast SQL queries with indexes)
- Optional: Add Cache-Control headers and Redis caching for repeated requests within 5 seconds

### 4. PDF Upload Storage and AI Summary Queueing

**Decision:** Store PDFs in Cloudflare R2 (free tier); trigger AI summary generation asynchronously via Bull queue with exponential backoff retry.

**Rationale:**
- R2 free tier: 10GB storage, no egress fees (perfect for small number of PDFs)
- Bull queue respects Gemini API free tier (60 RPM limit) automatically
- Async processing allows immediate response to user without waiting for AI API
- Exponential backoff handles transient API failures gracefully

**Alternatives Considered:**
- Synchronous PDF upload + AI summary in request/response → user waits 5-30 seconds for AI response, poor UX
- Store PDFs on VPS disk → manual backup, limited storage, no redundancy
- Multiple concurrent Gemini calls → will hit rate limit; need queue
- Rejected: Async queue is the right pattern

**Implementation:**
- Endpoint: POST `/admin/workshops/:id/pdf` accepts multipart/form-data with file
- Backend: Validate file (PDF, max 10MB), upload to R2, save metadata to workshops table (pdf_url, pdf_uploaded_at)
- Event: Emit `PDFUploaded` event to Bull queue (`ai-summary-queue`)
- Worker: Process `PDFUploaded` jobs sequentially (respects 60 RPM); extract PDF text, call Gemini, store summary in workshops.description_summary
- Retry: Exponential backoff (1s, 2s, 4s) for transient failures; alert admin if all retries fail
- UI: Show loading spinner while summary generates; update when complete (can poll `/admin/workshops/:id` for summary status)

### 5. Audit Logging Strategy

**Decision:** Log all admin actions to `audit_logs` table with before/after JSON state. Separate user action logging (registrations, check-ins) to `user_actions` table. Archive logs older than 90 days to R2.

**Rationale:**
- Before/after JSON captures full change context without schema changes
- Separate tables keep queries fast (audit logs can grow large)
- 90-day retention balances compliance with storage costs
- R2 archival keeps PostgreSQL lean (no bloat)

**Alternatives Considered:**
- Audit events in message broker (Kafka/RabbitMQ) → adds service, overkill for small scale
- Centralized logging (ELK stack) → too expensive
- Rejected: Database-based audit with archival is simplest

**Implementation:**
- Database: New `audit_logs` table with columns: id, action_type, resource_type, resource_id, admin_id, timestamp, before_state (JSON), after_state (JSON), ip_address
- Middleware: `auditAction()` middleware wraps admin mutation handlers; captures request/response
- Archival: Nightly cron job gzips logs older than 90 days, uploads to R2 as `audit-logs-{YYYY-MM}.json.gz`, deletes from PostgreSQL
- Query: `/admin/audit-logs` supports filtering by date, action_type, admin, resource_type; can search archived logs (returns download link)

### 6. Rate Limiting Configuration Strategy

**Decision:** Store rate limit settings in PostgreSQL `config_settings` table; load into Redis on startup and on admin update. Each rate limit check queries Redis (fast).

**Rationale:**
- PostgreSQL as system of record; updates persist across restarts
- Redis as cache for fast lookup during request handling
- Admin changes to limits take effect within 5 seconds (Redis invalidation)

**Alternatives Considered:**
- Hardcode limits in `.env` file → requires code change and redeploy to update
- All config in Redis → loss of data on Redis restart, no backup
- Rejected: Hybrid approach (PostgreSQL + Redis cache) is best

**Implementation:**
- Schema: `config_settings` table with fields: key (string), value (JSON), updated_at
- Keys: "registration_rate_limit", "login_rate_limit", "api_rate_limit", etc.
- Endpoint: PUT `/admin/settings/rate-limits` validates and updates `config_settings`
- On update: Publish event to invalidate Redis; workers re-fetch from PostgreSQL
- Rate limiting middleware: Check Redis; if miss, fetch from PostgreSQL and cache

### 7. Admin UI Organization and Navigation

**Decision:** Organize admin pages under `/admin/` with sections: Dashboard, Workshops, Registrations, Payments, Notifications, Settings, Audit Logs. Use sidebar navigation with role-based visibility (planned for future).

**Rationale:**
- Clear information hierarchy; easy to find features
- Sidebar pattern familiar to admin users
- Extensible for future role-based page visibility
- Consistent with existing Next.js structure

**Implementation:**
- Layout: `(auth)/admin/layout.tsx` with Sidebar component
- Pages:
  - `/admin/dashboard` - stats, alerts, activity feed
  - `/admin/workshops` - list and CRUD forms
  - `/admin/workshops/[id]/detail` - single workshop with PDF upload, registrations, check-in stats
  - `/admin/registrations` - filter and manage registrations
  - `/admin/payments` - payment analytics and refunds
  - `/admin/notifications` - template and channel settings
  - `/admin/settings` - rate limits, session timeout, defaults
  - `/admin/audit-logs` - action history and export
- Components: Reusable table, form, modal, chart components from existing student UI

---

## Risks / Trade-offs

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| **Admin token leakage (XSS)** | Medium | High | Store JWT in HttpOnly cookie (inaccessible to JS); use CSP headers; validate JWT signature on every request |
| **Gemini API rate limit hit during bulk PDF uploads** | Low | Medium | Bull queue enforces 60 RPM; batch uploads queued; admin sees pending status; retries with backoff |
| **Audit log table bloats if many admins** | Low | Medium | Archive to R2 after 90 days; add index on timestamp for fast queries; consider partitioning later |
| **Admin misconfiguration (rate limits too high/low)** | Medium | Low | UI provides defaults and validation; changes are logged and reversible; alerts notify if limits change |
| **Concurrent admin edits to same workshop** | Low | Low | Last-write-wins (simple); OR add optimistic locking with version field and conflict detection |
| **PDF upload fails silently** | Low | Medium | Return error to admin; log to audit_logs; notify admin if retry exhausted; show error in UI |
| **Check-in rate spike during event day** | Medium | High | Polling refreshes every 10 seconds (not per-second); UI shows slightly stale data (acceptable); queries have indexes |
| **R2 storage exceeds free tier (10GB)** | Low | Medium | Monitor usage; archive old PDFs; alert if nearing limit |

**Trade-offs:**

- **Real-time vs. simplicity**: Polling every 10 seconds vs. WebSocket real-time. Trade real-time for simplicity and scalability.
- **Audit verbosity vs. storage**: JSON before/after states are verbose but fully queryable. Accept extra storage for compliance value.
- **Admin role in JWT vs. Redis cache**: JWT is stateless but tokens live for hours (role changes take time to propagate). Accept eventual consistency.

---

## Migration Plan

### Phase 1: Backend Preparation (Week 1)
1. Add `role` column to `users` table (nullable string, default NULL)
2. Create `audit_logs` and `config_settings` tables
3. Implement `/auth/login` and `/auth/logout` endpoints with role support
4. Add `requireAdmin()` middleware to Express
5. Create `/admin/workshops` CRUD routes with validation and conflict detection
6. Create `/admin/dashboard/stats` endpoint
7. Deploy backend; test with manual API calls

### Phase 2: Frontend Pages (Week 2)
1. Create Next.js admin layout and sidebar
2. Build `/admin/dashboard` page with stats polling
3. Build `/admin/workshops` list and CRUD forms
4. Build `/admin/settings` configuration pages
5. Test authentication and role checks
6. Deploy frontend

### Phase 3: Advanced Features (Week 3)
1. PDF upload endpoint and R2 integration
2. AI summary queue and worker
3. Audit logging middleware
4. `/admin/audit-logs` query and export
5. Notification settings panel
6. Payment settings validation

### Phase 4: Testing and Hardening (Week 4)
1. Load testing (rate limiting, concurrent edits)
2. Security audit (XSS, CSRF, SQL injection)
3. Integration testing (workshop lifecycle with notifications)
4. User acceptance testing with organization team
5. Documentation

### Rollback Strategy
- Feature flags: Add `ADMIN_ENABLED=false` environment variable to disable `/admin` routes
- Database backward compatibility: `role` column allows NULL (existing users remain students)
- API versioning: Keep `/api/v1/*` student routes intact; admin routes at `/api/v1/admin/*` (separate URL path)
- Rollback steps: Disable feature flag → existing data unaffected → can re-enable if bugs fixed

---

## Open Questions

1. **Bulk operations:** Should admins be able to bulk edit workshops (e.g., reschedule 5 workshops to new date)? Defer to tasks phase if needed.
2. **Payment refunds:** Should refund workflow be in admin panel or handled manually? Assume manual for MVP; can add later.
3. **Admin user management:** Can super-admins add/remove other admins via UI, or is this provisioned in database only? Assume provisioned for MVP.
4. **Notification timing:** Should admins preview notification templates before sending? Or always send immediately? Assume immediate for MVP.
5. **Check-in corrections:** Can admins manually mark student as checked-in (e.g., if QR scanner failed)? Defer to tasks.
6. **Workshop capacity limits:** Should there be a system-wide hard limit on capacity? Or unlimited? Assume unlimited for MVP.

---

## Data Model Additions

**New columns on `users` table:**
- `role: string (NULL | 'admin' | 'student')` — default NULL means student for backward compatibility

**New tables:**
```sql
CREATE TABLE audit_logs (
  id SERIAL PRIMARY KEY,
  action_type VARCHAR(50),           -- create, update, delete, configure
  resource_type VARCHAR(50),         -- workshop, payment, settings, user
  resource_id UUID,                  -- FK to resource
  admin_id UUID REFERENCES users(id),
  timestamp TIMESTAMP DEFAULT NOW(),
  before_state JSONB,                -- full state before change
  after_state JSONB,                 -- full state after change
  ip_address INET,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_audit_logs_timestamp ON audit_logs(timestamp DESC);
CREATE INDEX idx_audit_logs_admin_id ON audit_logs(admin_id);

CREATE TABLE config_settings (
  key VARCHAR(255) PRIMARY KEY,
  value JSONB,
  updated_at TIMESTAMP DEFAULT NOW(),
  updated_by UUID REFERENCES users(id)
);
```

**New columns on `workshops` table:**
- `pdf_url: string` — R2 URL to uploaded PDF
- `pdf_uploaded_at: timestamp` — when PDF was uploaded
- `description_summary: text` — AI-generated summary
- `description_summary_override: boolean` — admin manually edited summary

## 1. SOLID Principles Architecture Setup

- [ ] 1.1 Create project structure: `src/routes`, `src/services`, `src/domain`, `src/repositories`, `src/providers`, `src/workers`, `src/middleware`
- [ ] 1.2 Design provider interfaces for dependency injection: `AIProvider`, `StorageProvider`, `CacheProvider` (abstract classes or interfaces)
- [ ] 1.3 Implement concrete providers: `GeminiAIProvider`, `CloudflareR2Provider`, `UpstashRedisProvider` implementing interfaces
- [ ] 1.4 Set up dependency injection container: register providers, services, repositories with explicit bindings
- [ ] 1.5 Create base service classes with injected dependencies: `WorkshopService(repository, auditLogger, eventEmitter)`, etc.
- [ ] 1.6 Configure route handlers as thin adapters: parse HTTP → call service → return response (no business logic in routes)
- [ ] 1.7 Set up TypeScript strict mode and interfaces for all services and repositories

## 2. Database Schema and Setup

- [ ] 2.1 Migrate to Supabase: create PostgreSQL database with Supabase free tier, test connection via `SUPABASE_DB_URL` env var
- [ ] 2.2 Migrate to Upstash Redis: create Redis instance, test connection via `UPSTASH_REDIS_URL` env var
- [ ] 2.3 Add `role` column to `users` table (VARCHAR nullable, default NULL)
- [ ] 2.4 Create `audit_logs` table with columns: id, action_type, resource_type, resource_id, admin_id, timestamp, before_state, after_state, ip_address
- [ ] 2.5 Create index on `audit_logs(timestamp DESC)` for efficient log queries
- [ ] 2.6 Create index on `audit_logs(admin_id)` for admin action filtering
- [ ] 2.7 Create `config_settings` table with columns: key (PRIMARY), value (JSONB), updated_at, updated_by
- [ ] 2.8 Add `pdf_url`, `pdf_uploaded_at`, `description_summary`, `description_summary_override` columns to `workshops` table
- [ ] 2.9 Write database migration scripts and test on local environment with Supabase

## 3. Backend Authentication and Authorization

- [ ] 2.1 Update `/auth/login` endpoint to fetch `role` field from users table and include in JWT payload
- [ ] 2.2 Generate JWT with `role: "admin"` claim only for users with role='admin' in database
- [ ] 2.3 Implement `requireAdmin()` middleware that checks JWT token for `role: "admin"` claim
- [ ] 2.4 Apply `requireAdmin()` middleware to all `/admin/*` routes in Express router
- [ ] 2.5 Update `/auth/logout` endpoint to add JWT token to Redis blacklist with TTL=token expiry
- [ ] 2.6 Add unit tests for role-based middleware (admin access allowed, student access denied, no token denied)

## 3. Admin CRUD Routes - Workshops

- [ ] 3.1 Implement POST `/admin/workshops` to create workshop with conflict detection for room/time
- [ ] 3.2 Implement GET `/admin/workshops` to list all workshops with optional filters (date range, room, speaker, status)
- [ ] 3.3 Add pagination support to workshop list (20 per page, offset-based)
- [ ] 3.4 Implement PUT `/admin/workshops/:id` to update workshop with validation (cannot reduce capacity below check-ins)
- [ ] 3.5 Implement DELETE `/admin/workshops/:id` to soft-delete (set status='cancelled') and emit WorkshopCancelled event
- [ ] 3.6 Add conflict detection: same room, overlapping time, speaker unavailable
- [ ] 3.7 Write integration tests for CRUD operations and conflict scenarios

## 4. Admin Routes - Scheduling Features

- [ ] 4.1 Implement PUT `/admin/workshops/:id/reschedule` to update date/time with new conflict checks
- [ ] 4.2 Add detection of participant double-bookings when rescheduling to different day
- [ ] 4.3 Implement PUT `/admin/workshops/:id/room` to change room assignment
- [ ] 4.4 Implement PUT `/admin/workshops/:id/speaker` to reassign speaker with availability check
- [ ] 4.5 Emit WorkshopRescheduled, WorkshopRoomChanged, WorkshopSpeakerChanged events for each operation
- [ ] 4.6 Test all scheduling scenarios (conflicts, concurrent edits)

## 5. Admin Dashboard Backend Routes

- [ ] 5.1 Implement GET `/admin/dashboard/stats` returning: total workshops, registrations, payments, check-in count, cancellation rate
- [ ] 5.2 Implement GET `/admin/workshops/:id/registrations` with status breakdown and registration timeline data
- [ ] 5.3 Implement GET `/admin/dashboard/payments` returning revenue metrics, payment status breakdown
- [ ] 5.4 Implement GET `/admin/dashboard/checkin-today` with workshops today, expected vs actual check-in counts
- [ ] 5.5 Add indexes to queries for performance (workshops.date, registrations.created_at, checkins.workshop_id)
- [ ] 5.6 Performance test: ensure /admin/dashboard/stats responds in < 500ms under load

## 6. Audit Logging Middleware

- [ ] 6.1 Create `auditAction()` middleware that captures request body and response data
- [ ] 6.2 Implement JSON diff logic to record before/after states
- [ ] 6.3 Extract admin_id, ip_address, user_agent from request context
- [ ] 6.4 Write captured audit data to `audit_logs` table after successful response
- [ ] 6.5 Ensure middleware doesn't leak sensitive data (passwords, API keys) in before/after states
- [ ] 6.6 Test: verify audit log entries created for workshop create, update, delete operations

## 7. Admin Audit Log Routes

- [ ] 7.1 Implement GET `/admin/audit-logs` with filters: date range, action_type, admin_id, resource_type, resource_id
- [ ] 7.2 Add search by keyword in before/after state
- [ ] 7.3 Implement pagination and sorting (timestamp DESC default)
- [ ] 7.4 Implement GET `/admin/audit-logs/{id}` to view full before/after state with JSON diff highlighting
- [ ] 7.5 Implement GET `/admin/audit-logs/export?format=csv` to export filtered logs
- [ ] 7.6 Create nightly cron job to archive logs older than 90 days: compress to gzip, upload to R2, delete from PostgreSQL
- [ ] 7.7 Test: export audit logs and verify CSV format and completeness

## 8. Configuration Settings Routes

- [ ] 8.1 Implement GET `/admin/settings/rate-limits` returning current rate limit config from config_settings
- [ ] 8.2 Implement PUT `/admin/settings/rate-limits` to update rate limit settings and invalidate Redis cache
- [ ] 8.3 Implement GET `/admin/settings/notifications` for notification channel and template config
- [ ] 8.4 Implement PUT `/admin/settings/notifications` with template validation (required placeholders check)
- [ ] 8.5 Implement GET `/admin/settings/payment` returning payment gateway config (with masked secret)
- [ ] 8.6 Implement PUT `/admin/settings/payment` to update and encrypt merchant secret
- [ ] 8.7 Implement GET `/admin/settings/defaults` for system defaults (capacity, price, timeouts)
- [ ] 8.8 Implement PUT `/admin/settings/defaults` to update system defaults
- [ ] 8.9 Implement GET `/admin/settings/audit` to show settings change history
- [ ] 8.10 Implement POST `/admin/settings/rollback/{change_id}` to revert setting change
- [ ] 8.11 Audit all settings changes (log to audit_logs)

## 9. PDF Upload and Storage

- [ ] 9.1 Set up Cloudflare R2 SDK and credentials (use free tier account)
- [ ] 9.2 Implement POST `/admin/workshops/:id/pdf` to accept file upload and validate (PDF only, max 10MB)
- [ ] 9.3 Upload file to R2 with path structure: `uploads/{workshop_id}/{filename}`
- [ ] 9.4 Save metadata to workshops table: pdf_url, pdf_uploaded_at, uploader_id
- [ ] 9.5 Emit PDFUploaded event to Bull queue for async summary generation
- [ ] 9.6 Return 200 with file URL to client
- [ ] 9.7 Add error handling for invalid file format and upload failures
- [ ] 9.8 Test: upload PDF, verify R2 storage, verify event published

## 11. AI Summary Generation Queue (Worker Pattern with SOLID)

- [ ] 11.1 Create `AIProvider` interface with generate(text: string): Promise<string> method
- [ ] 11.2 Implement `GeminiAIProvider` class injecting API credentials and rate limiter
- [ ] 11.3 Create Bull queue worker for `ai-summary-queue` (single responsibility: PDF → summary only)
- [ ] 11.4 Implement `PDFExtractService` for text extraction from PDF (separate from AI service)
- [ ] 11.5 Create `SummaryGenerationService` injecting AIProvider, PDFExtractService, and Supabase repository
- [ ] 11.6 Implement worker: receive PDFUploaded event → call SummaryGenerationService → store result
- [ ] 11.7 Implement Gemini API call with prompt to generate 2-3 sentence summary
- [ ] 11.8 Store summary in Supabase workshops.description_summary upon success
- [ ] 11.9 Implement exponential backoff retry: 1s, 2s, 4s (max 3 retries) in worker
- [ ] 11.10 On all retries exhausted: log error to audit_logs via AuditLogger and notify admin
- [ ] 11.11 Respect Gemini API rate limit (60 RPM): queue worker respects limit automatically via rate limiter
- [ ] 11.12 Test: upload PDF, verify summary generated within 60 seconds (mock Gemini for speed)

## 12. Admin Dashboard Frontend - Layout and Navigation

- [ ] 12.1 Create `(auth)/admin/layout.tsx` with sidebar navigation component
- [ ] 12.2 Build `Sidebar` component with links: Dashboard, Workshops, Registrations, Payments, Notifications, Settings, Audit Logs
- [ ] 12.3 Create `useAdmin()` hook to check if user has admin role; redirect to `/` if not
- [ ] 12.4 Apply `useAdmin()` to all admin layout (enforce at page level)
- [ ] 12.5 Style sidebar and layout with Tailwind CSS (responsive mobile/tablet/desktop)
- [ ] 12.6 Create breadcrumb navigation component for sub-pages

## 13. Admin Dashboard Frontend - Dashboard Page

- [ ] 13.1 Create `/admin/dashboard/page.tsx` component
- [ ] 13.2 Implement stats polling: useEffect with setInterval calling `/admin/dashboard/stats` every 10 seconds
- [ ] 13.3 Display stats in cards: workshops count, registrations count, payments total, check-in count, cancellation rate
- [ ] 13.4 Add last-updated timestamp to stats display
- [ ] 13.5 Implement dashboard alerts section (nearing capacity, low registrations, payment failures, etc.)
- [ ] 13.6 Build activity feed component showing recent admin actions (workshop created, updated, etc.)
- [ ] 13.7 Design and build alert cards with severity levels (warning, error, info)
- [ ] 13.8 Test: verify polling works, alerts display correctly

## 14. Admin Dashboard Frontend - Workshop Management

- [ ] 14.1 Create `/admin/workshops/page.tsx` list component
- [ ] 14.2 Build workshop list table with columns: title, date, time, room, speaker, capacity, registered, status, actions
- [ ] 14.3 Add filters: date range selector, room dropdown, speaker search, status dropdown
- [ ] 14.4 Implement pagination (show 20 per page with next/prev buttons)
- [ ] 14.5 Build "Create Workshop" button → modal or new page with form
- [ ] 14.6 Create `/admin/workshops/[id]/page.tsx` detail page with full workshop info
- [ ] 14.7 Add PDF upload section: drag-drop or file input, show loading state during upload and summary generation
- [ ] 14.8 Display generated summary; allow admin to edit/override
- [ ] 14.9 Add "Edit" button → form with workshop fields and conflict warnings
- [ ] 14.10 Add "Reschedule" button → modal with date/time picker and conflict detection
- [ ] 14.11 Add "Change Room" button → room selector modal
- [ ] 14.12 Add "Assign Speaker" button → speaker selector modal
- [ ] 14.13 Add "Cancel" button → confirm dialog with notification options
- [ ] 14.14 Show registration breakdown table: confirmed, pending payment, cancelled, no-show, attended
- [ ] 14.15 Show check-in progress bar and timeline if event is today/ongoing
- [ ] 14.16 Test: CRUD operations, form validation, error handling

## 15. Admin Dashboard Frontend - Settings Pages

- [ ] 15.1 Create `/admin/settings/page.tsx` main settings page with tabs: Notifications, Payment, Rate Limits, Defaults
- [ ] 15.2 Build Notifications tab: toggle channels on/off, select email provider, configure templates
- [ ] 15.3 Add template editor with live preview and required placeholder validation
- [ ] 15.4 Build Payment tab: display current gateway, merchant_id, masked secret, test connection button
- [ ] 15.5 Build Rate Limits tab: form fields for registrations per user/day, login attempts per hour, API requests per minute
- [ ] 15.6 Build Defaults tab: input fields for workshop capacity, price, session timeout, notification delay
- [ ] 15.7 Add save button with success/error feedback
- [ ] 15.8 Create `/admin/settings/audit/page.tsx` to view settings change history
- [ ] 15.9 Display settings audit log table with columns: timestamp, admin, setting, old value, new value, actions (rollback)
- [ ] 15.10 Implement rollback button with confirm dialog
- [ ] 15.11 Test: update settings, verify changes take effect, view and rollback history

## 16. Admin Dashboard Frontend - Audit Logs Page

- [ ] 16.1 Create `/admin/audit-logs/page.tsx` component
- [ ] 16.2 Build audit log table with columns: timestamp, admin, action, resource, before/after link, details
- [ ] 16.3 Add filters: date range picker, action type dropdown, admin dropdown, resource type dropdown
- [ ] 16.4 Implement search input for keyword in before/after state
- [ ] 16.5 Add pagination (20 per page)
- [ ] 16.6 Build modal/drawer to display full before/after JSON with diff highlighting
- [ ] 16.7 Add export button → download CSV
- [ ] 16.8 Test: filter, search, view details, export audit logs

## 17. Error Handling and Notifications

- [ ] 17.1 Add toast/notification component for user feedback (success, error, warning)
- [ ] 17.2 Implement error boundary component for admin pages (graceful fallback)
- [ ] 17.3 Add loading states to all async operations (workshop create, PDF upload, settings save)
- [ ] 17.4 Implement retry logic for failed API calls (client-side with exponential backoff)
- [ ] 17.5 Add form validation with helpful error messages
- [ ] 17.6 Test: simulate API errors and verify error messages display

## 18. Testing and Quality Assurance

- [ ] 18.1 Write end-to-end tests for workshop CRUD workflow (create, edit, reschedule, cancel)
- [ ] 18.2 Write tests for rate limiting: exceeded rate limit returns 429, settings update takes effect via Upstash
- [ ] 18.3 Write tests for audit logging: verify all actions logged, before/after states captured in Supabase
- [ ] 18.4 Write tests for PDF upload: valid upload succeeds, invalid files rejected, max 2MB limit enforced
- [ ] 18.5 Write tests for concurrent admin operations: last-write-wins or conflict detection works
- [ ] 18.6 Load test: simulate 5 concurrent admins using dashboard from Supabase, verify performance acceptable
- [ ] 18.7 Security test: verify XSS protection (input sanitization, content encoding)
- [ ] 18.8 Security test: verify CSRF protection (state token in forms)
- [ ] 18.9 Security test: verify unauthorized users cannot access admin routes via JWT validation
- [ ] 18.10 Manual UAT with organization team: walkthrough all features, gather feedback

## 19. Documentation and Deployment

- [ ] 19.1 Document admin API endpoints with request/response examples
- [ ] 19.2 Document admin user workflow: login, navigate, perform common tasks
- [ ] 19.3 Document settings available and their impact on system behavior
- [ ] 19.4 Write admin quick-start guide (onboarding new admin user)
- [ ] 19.5 Document audit log structure and how to export/query for compliance
- [ ] 19.6 Add admin feature to deployment checklist (set ADMIN_ENABLED=true in .env, provision SUPABASE_DB_URL and UPSTASH_REDIS_URL)
- [ ] 19.7 Document rollback procedure (disable feature flag, no data loss)
- [ ] 19.8 Deploy to production with Supabase and Upstash credentials configured
- [ ] 19.9 Verify production deployment: test login from Supabase, create workshop, view dashboard
- [ ] 19.10 Enable feature flag in production (gradual rollout if possible)
- [ ] 19.11 Monitor Supabase and Upstash for errors and performance issues
- [ ] 19.12 Gather feedback from organization team and iterate on UX

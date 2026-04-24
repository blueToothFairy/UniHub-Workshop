## Why

The organization team currently has no unified interface to manage workshops, monitor registrations, or configure system settings. Admin work is currently fragmented and requires IT support. By building a dedicated admin web application, the organizing committee can self-serve: create, edit, reschedule, or cancel workshops; upload workshop descriptions; view real-time registration statistics; and configure notifications and payment settings—all from a single, secure dashboard.

## What Changes

- New admin-only web interface (part of Next.js application) with role-based access control
- Admin authentication flow with distinct permissions from student users
- Workshop management: full CRUD operations (create, edit, reschedule, cancel) with real-time validation against database constraints
- Analytics and statistics dashboard: live registration counts, cancellation rates, payment status, check-in progress
- PDF upload and storage for workshop descriptions with automatic summary generation via AI
- Configuration panel for system settings: notification templates, payment gateway settings, rate limits
- Audit trail for all admin actions (creation, modification, deletion timestamps and responsible admin)

## Capabilities

### New Capabilities

- `admin-authentication`: Secure login and authorization for organizing committee members with role-based access control (admin role validation against JWT tokens)
- `workshop-management`: Admin CRUD operations for workshops including create, read, update, delete, with conflict detection and seat management
- `workshop-scheduling`: Edit workshop date, time, room, and speaker assignments with automatic conflict detection and participant notification on changes
- `admin-dashboard`: Real-time statistics view showing registration counts, payment status, check-in progress, and cancellation status
- `pdf-upload-and-summary`: Upload workshop descriptions as PDF files and trigger automatic AI-powered summary generation
- `admin-settings-panel`: Configure notification channels, payment gateway credentials (sandboxed), rate limits, and system-wide defaults
- `admin-audit-trail`: Comprehensive logging of all admin actions with timestamps and actor identification for compliance and debugging

### Modified Capabilities

<!-- No existing specs to modify; all capabilities are new to this change -->

## Impact

- **Backend API**: New `/admin/*` route group with admin-only middleware; new database tables for audit logs; new message queue events for admin actions (WorkshopCreated, WorkshopModified, etc.)
- **Frontend**: New pages under `/admin` in Next.js application (dashboard, workshop CRUD forms, settings, audit log viewer)
- **Database**: New admin audit log table; extended workshops and users tables to support admin roles and permissions; hosted on **Supabase** (PostgreSQL free tier)
- **Caching & Queue**: Uses **Upstash Redis** (free-tier provider) for caching, rate limiting, and Bull job queue backend
- **Deployment**: Role-based access control requires JWT token validation; admin credentials must be securely provisioned in environment
- **Infrastructure Costs**: $0/month with Supabase free tier PostgreSQL and Upstash free-tier Redis
- **Architecture**: Backend implements SOLID principles with clean separation: Express route handlers → service layer → domain logic; queue workers have single responsibility; external integrations (R2, Gemini, Redis) abstracted via dependency injection
- **Dependencies**: Uses existing BullMQ, Resend email, Gemini API; adds pdf-parse for PDF text extraction and Upstash Redis client

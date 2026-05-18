# UniHub Workshop

<p align="center"><strong>Run university workshops end-to-end: discovery, registration, payments, AI summaries, notifications, and check-in operations.</strong></p>

<p align="center">
  <a href="https://img.shields.io/badge/build-local%20scripts-blue"><img src="https://img.shields.io/badge/build-local%20scripts-blue" alt="Build Status" /></a>
  <a href="https://img.shields.io/badge/license-unlicensed-lightgrey"><img src="https://img.shields.io/badge/license-unlicensed-lightgrey" alt="License" /></a>
  <a href="https://img.shields.io/badge/version-1.0.0-informational"><img src="https://img.shields.io/badge/version-1.0.0-informational" alt="Version" /></a>
  <a href="https://img.shields.io/github/last-commit/blueToothFairy/UniHub-Workshop"><img src="https://img.shields.io/github/last-commit/blueToothFairy/UniHub-Workshop" alt="Last Commit" /></a>
  <a href="https://img.shields.io/github/issues/blueToothFairy/UniHub-Workshop"><img src="https://img.shields.io/github/issues/blueToothFairy/UniHub-Workshop" alt="Open Issues" /></a>
</p>

## Table of Contents
- [Overview](#overview)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Installation \& Setup](#installation--setup)
- [Environment Variables](#environment-variables)
- [Usage / Examples](#usage--examples)
- [API Reference](#api-reference)
- [Project Structure](#project-structure)
- [Contributing](#contributing)
- [License](#license)

## Overview

UniHub Workshop is a full-stack workshop operations platform for universities and student communities. It solves the common problem of fragmented workshop handling by centralizing public discovery, role-based registration, paid/free enrollment flow, operational dashboards, notifications, and check-in logistics.

The system is built for:
- Students who need a smooth workshop browsing and registration experience.
- Organizers who need reliable scheduling, seat control, payment tracking, and admin auditability.
- Check-in staff who need dependable online/offline check-in tools in real event conditions.

### Product Preview
<p align="center">
  <img src="./assets/screenshot-hero.png" alt="UniHub Workshop Logo / Hero" width="660" />
  <img src="./assets/screenshot1.png" alt="screen1" width="660" />
  <img src="./assets/screenshot2.png" alt="screen2" width="660" />
  <img src="./assets/screenshot3.png" alt="screen3" width="660" />
</p>

## Features

- Role-based auth with `student`, `organizer`, and `checkin_staff`.
- JWT access/refresh token flow with refresh token rotation.
- Student-facing workshop catalog with:
  - Search text query support.
  - Payment type filter (`all` / `free` / `paid`).
  - Seat-availability filtering.
- Optional Elasticsearch-backed discovery ranking and fuzzy search.
- Workshop detail pages with AI summary display and summary status.
- Peak registration control with queue/admission token workflow to handle burst traffic.
- Idempotent registration API using `Idempotency-Key` header.
- Paid registration flow via MoMo sandbox integration.
- Payment resiliency features:
  - Circuit breaker for gateway degradation.
  - Reconciliation cron jobs for payment status recovery.
  - Expiry sweep job for stale pending registrations.
- QR issuance for confirmed registrations.
- Organizer admin panel:
  - Dashboard stats.
  - Workshop CRUD.
  - Workshop cancellation.
  - PDF upload for AI summary generation.
  - Manual summary override.
  - Cursor-based audit log pagination.
- AI workshop summarization pipeline:
  - PDF storage upload.
  - Background job queue.
  - Gemini-based summary generation with retry/fallback.
- Notification system:
  - In-app inbox with unread counts and mark-as-read.
  - Email channel support via Resend API.
- Check-in module (staff role):
  - Online QR scan endpoint.
  - Batched sync endpoint.
  - Workshop roster and cancellation-sync endpoints.
- Mobile Expo app for check-in staff:
  - Workshop selection context.
  - Camera scanning and manual token fallback.
  - Offline queue persistence in SQLite.
  - Retry-aware sync logs and conflict handling.
- Scheduled CSV student import jobs (nightly/evening windows), deduplication, validation thresholds, and run tracking.

## Tech Stack

| Layer | Technologies |
|---|---|
| Frontend Web | Next.js 14 (App Router), React 18, TypeScript |
| Backend API | Node.js, Express, TypeScript |
| Mobile | React Native, Expo 53, TypeScript |
| Database | PostgreSQL (Supabase pooler/direct URLs) |
| Queue / Jobs | BullMQ, Redis (optional in dev via in-memory stubs) |
| Search | Elasticsearch (optional) |
| Payments | MoMo Sandbox API, simulation mode fallback |
| AI | Google Gemini (`gemini-2.5-flash`) |
| File Storage | Cloudinary (active path), Cloudflare R2/local adapters available in code |
| Notifications | In-app DB notifications, Resend Email API |
| Infra style | Monorepo with separate `backend`, `frontend`, and `mobile` apps |

## Prerequisites

- Node.js `>= 20` recommended.
- npm `>= 10`.
- PostgreSQL instance (or Supabase project).
- `psql` CLI to run SQL migrations.
- Redis (required only when `USE_REDIS=true` or workers enabled).
- Optional integrations depending on features you enable:
  - MoMo sandbox credentials.
  - Cloudinary credentials.
  - Gemini API key.
  - Resend API key.
  - Elasticsearch endpoint/credentials.

## Installation & Setup

### 1) Clone the repository

```bash
git clone https://github.com/blueToothFairy/UniHub-Workshop.git
cd UniHub-Workshop
```

### 2) Install dependencies

```bash
cd backend && npm install
cd ../frontend && npm install
cd ../mobile && npm install
cd ..
```

### 3) Configure environment files

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
cp mobile/.env.example mobile/.env
```

Set values in `backend/.env`, `frontend/.env`, `mobile/.env` for your local stack.

### 4) Run database migrations

Run SQL files in timestamp order from `backend/migrations/`.

PowerShell:
```powershell
Get-ChildItem backend/migrations/*.sql |
  Sort-Object Name |
  ForEach-Object { psql $env:SUPABASE_POOLER_URL -f $_.FullName }
```

Bash:
```bash
for file in $(ls backend/migrations/*.sql | sort); do
  psql "$SUPABASE_POOLER_URL" -f "$file"
done
```

Optional demo data:
```bash
psql "$SUPABASE_POOLER_URL" -f backend/migrations/20260517_seed_demo_data.sql
```

### 5) Start backend

```bash
cd backend
npm run dev
```

Backend default URL: `http://localhost:3000`

### 6) Start frontend

```bash
cd frontend
npm run dev -- -p 3001
```

Frontend URL in this setup: `http://localhost:3001`

### 7) Start mobile app (optional check-in app)

```bash
cd mobile
npm start
```

## Environment Variables

### Backend (`backend/.env`)

| Variable | Required | Default | Description | Example |
|---|---|---|---|---|
| `PORT` | No | `3000` | Backend HTTP port. | `3000` |
| `NODE_ENV` | No | Runtime default | Influences worker/cron defaults. | `development` |
| `ALLOWED_ORIGINS` | No | `http://localhost:3001` | Comma-separated CORS allowlist. | `http://localhost:3001,http://localhost:3000` |
| `SUPABASE_POOLER_URL` | Yes | None | PostgreSQL connection string used by app queries. | `postgres://user:pass@host:6543/db` |
| `SUPABASE_DIRECT_URL` | Optional | None | Direct DB URL kept for scripts/manual tasks (not used by runtime app wiring). | `postgres://user:pass@host:5432/db` |
| `JWT_SECRET` | Yes | Empty string | Secret for access token signing/verification. | `super-secret-access-key` |
| `JWT_REFRESH_SECRET` | No | Falls back to `JWT_SECRET` | Separate secret for refresh tokens. | `super-secret-refresh-key` |
| `JWT_ACCESS_TTL_MINUTES` | Optional | Not consumed in current code | Legacy/example variable in `.env.example`. | `15` |
| `REDIS_URL` | Conditional | Empty string | Redis URL for BullMQ/peak control/circuit breaker when enabled. | `rediss://:pass@host:6379` |
| `REDIS_TOKEN` | Optional | Not consumed in current code | Legacy/example variable in `.env.example`. | `replace_me` |
| `USE_REDIS` | No | Auto from worker mode | Enables BullMQ + Redis-backed circuit breaker. | `true` |
| `START_WORKERS` | No | `false` in dev, `true` in prod | Starts background workers and related cron defaults. | `true` |
| `PAYMENT_GATEWAY_MODE` | No | `momo_sandbox` | Payment mode (`simulation` or `momo_sandbox`). | `simulation` |
| `MOMO_ENDPOINT` | No | `https://test-payment.momo.vn` | MoMo base endpoint. | `https://test-payment.momo.vn` |
| `MOMO_PARTNER_CODE` | Conditional | Empty string | MoMo partner code. | `MOMOXXXX` |
| `MOMO_ACCESS_KEY` | Conditional | Empty string | MoMo access key. | `access-key` |
| `MOMO_SECRET_KEY` | Conditional | Empty string | MoMo secret key. | `secret-key` |
| `MOMO_REDIRECT_URL` | No | `http://localhost:3001/payment-return` | Browser return URL after MoMo flow. | `http://localhost:3001/payment-return` |
| `MOMO_IPN_URL` | No | `http://localhost:3000/payments/momo/callback` | MoMo callback URL. | `https://api.example.com/payments/momo/callback` |
| `MOMO_CREATE_ORDER_TIMEOUT_MS` | No | `10000` | Timeout for create-order call. | `10000` |
| `MOMO_QUERY_TIMEOUT_MS` | No | `10000` | Timeout for payment status query call. | `10000` |
| `PAYMENT_CIRCUIT_FAILURE_THRESHOLD` | No | `5` | Circuit breaker failure threshold. | `5` |
| `PAYMENT_CIRCUIT_FAILURE_WINDOW_SECONDS` | No | `30` | Circuit breaker rolling window. | `30` |
| `PAYMENT_CIRCUIT_OPEN_DURATION_SECONDS` | No | `60` | Open-state cooldown duration. | `60` |
| `PAYMENT_CIRCUIT_HALF_OPEN_PROBE_LIMIT` | No | `1` | Allowed probes in half-open state. | `1` |
| `PAYMENT_RECONCILIATION_CRON_ENABLED` | No | Auto from worker mode | Enable scheduled reconciliation tick. | `true` |
| `PAYMENT_RECONCILIATION_CRON_INTERVAL_SECONDS` | No | `60` | Reconciliation run interval. | `60` |
| `PAYMENT_RECONCILIATION_LIMIT` | No | `100` | Max records per reconciliation run. | `100` |
| `PEAK_CONTROL_ENABLED` | No | `false` | Enable peak registration gate logic. | `true` |
| `PEAK_CONTROL_WORKSHOP_IDS` | No | Empty | Comma-separated workshop IDs under peak control. | `id1,id2` |
| `PEAK_CONTROL_WINDOW_START_UTC` | No | `00:00` | Peak window start (UTC). | `12:00` |
| `PEAK_CONTROL_WINDOW_END_UTC` | No | `23:59` | Peak window end (UTC). | `14:00` |
| `PEAK_CONTROL_USER_POLL_MIN_INTERVAL_SECONDS` | No | `3` | Minimum per-user poll interval. | `3` |
| `PEAK_CONTROL_USER_WRITE_MIN_INTERVAL_SECONDS` | No | `3` | Minimum per-user write interval. | `3` |
| `PEAK_CONTROL_GLOBAL_WRITE_LIMIT_PER_SECOND` | No | `100` | Global write throttle ceiling. | `100` |
| `PEAK_CONTROL_ADMISSION_TOKEN_TTL_SECONDS` | No | `45` | Admission token lifetime. | `45` |
| `PEAK_CONTROL_QUEUE_BUFFER_SEATS` | No | `20` | Queue buffer for admission control. | `20` |
| `PEAK_CONTROL_QUEUE_RETRY_AFTER_SECONDS` | No | `5` | Suggested retry interval for waiting clients. | `5` |
| `CSV_IMPORT_ENABLED` | No | `false` | Enables scheduled CSV import jobs. | `true` |
| `CSV_DROP_DIR` | No | `backend/data/csv` | Directory where source CSV arrives. | `./data/csv` |
| `CSV_IMPORT_FILENAME` | No | `students.csv` | Expected import file name. | `students.csv` |
| `CSV_IMPORT_TIMEZONE` | No | `Asia/Ho_Chi_Minh` | Scheduler timezone. | `Asia/Ho_Chi_Minh` |
| `CSV_IMPORT_NIGHTLY_CRON` | No | `5 2 * * *` | Nightly import schedule (`m h * * *`). | `5 2 * * *` |
| `CSV_IMPORT_EVENING_CRON` | No | `5 18 * * *` | Evening import schedule (`m h * * *`). | `5 18 * * *` |
| `CSV_ERROR_THRESHOLD` | No | `0.1` | Max validation error ratio before fail. | `0.1` |
| `CSV_IMPORT_BCRYPT_ROUNDS` | No | `8` | Password hash rounds for imported students. | `8` |
| `CLOUDINARY_CLOUD_NAME` | Conditional | None | Cloudinary cloud name (required by active PDF storage path). | `demo-cloud` |
| `CLOUDINARY_API_KEY` | Conditional | None | Cloudinary API key. | `123456` |
| `CLOUDINARY_API_SECRET` | Conditional | None | Cloudinary API secret. | `super-secret` |
| `CLOUDINARY_PDF_FOLDER` | No | `workshop-pdfs` | Cloudinary folder for PDF uploads. | `workshop-pdfs` |
| `GEMINI_API_KEY` | Conditional | None | API key for summary generation. | `AIza...` |
| `AI_SUMMARY_MAX_PDF_SIZE_BYTES` | No | `10485760` | Max upload size accepted by AI summary flow. | `10485760` |
| `AI_SUMMARY_EMPTY_TEXT_FALLBACK` | No | Built-in Vietnamese fallback | Fallback summary if summarization fails with empty input. | `Unable to summarize automatically.` |
| `AI_SUMMARY_MAX_TEXT_CHARS` | No | `32000` | Max input text chars for text summarization path. | `32000` |
| `AI_SUMMARY_MAX_RETRIES` | No | `3` | Retry attempts for AI summary generation. | `3` |
| `AI_SUMMARY_RETRY_DELAY_MS` | No | `60000` | Delay between AI retries. | `60000` |
| `RESEND_API_KEY` | Optional | Empty string | Enables email notification channel when set. | `re_...` |
| `NOTIFICATION_EMAIL_FROM` | Optional | Empty string | Sender address for Resend emails. | `noreply@example.com` |
| `ELASTICSEARCH_URL` | Optional | Empty string | Enables external search integration when set. | `http://localhost:9200` |
| `ELASTICSEARCH_INDEX` | No | `unihub-workshops` | Index name for workshop search docs. | `unihub-workshops` |
| `ELASTICSEARCH_API_KEY` | Optional | Empty string | API key auth for Elasticsearch. | `base64apikey` |
| `ELASTICSEARCH_USERNAME` | Optional | Empty string | Basic auth username if API key is not used. | `elastic` |
| `ELASTICSEARCH_PASSWORD` | Optional | Empty string | Basic auth password. | `changeme` |
| `ELASTICSEARCH_REQUEST_TIMEOUT_MS` | No | `5000` | Request timeout for Elasticsearch calls. | `5000` |
| `CLOUDFLARE_R2_ENDPOINT` | Optional | None | Required only if switching to R2 storage adapter. | `https://<account>.r2.cloudflarestorage.com` |
| `CLOUDFLARE_R2_ACCESS_KEY` | Optional | None | R2 access key for S3-compatible SDK. | `r2-access-key` |
| `CLOUDFLARE_R2_SECRET_KEY` | Optional | None | R2 secret key. | `r2-secret-key` |
| `CLOUDFLARE_R2_BUCKET` | Optional | None | R2 bucket name. | `unihub` |
| `CLOUDFLARE_R2_PUBLIC_BASE_URL` | Optional | Uses endpoint | Public base URL for R2 object links. | `https://cdn.example.com` |

### Frontend (`frontend/.env`)

| Variable | Required | Default | Description | Example |
|---|---|---|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | Yes | `http://localhost:3000` | Backend API base URL consumed by web app. | `http://localhost:3000` |

### Mobile (`mobile/.env`)

| Variable | Required | Default | Description | Example |
|---|---|---|---|---|
| `EXPO_PUBLIC_API_BASE_URL` | Yes | `http://localhost:3000` | Backend URL reachable from emulator/device. | `http://10.0.2.2:3000` |

## Usage / Examples

### Web app flow (student)

1. Open `/register` to create a student account.
2. Browse workshops on `/`.
3. Open a workshop detail page (`/workshops/:id`).
4. Click register.
5. For paid workshops, continue to MoMo and return via `/payment-return`.
6. Once confirmed, retrieve and present the QR for check-in.

### Organizer flow

1. Login with organizer credentials.
2. Open `/admin/dashboard` for live metrics.
3. Open `/admin/workshops` to create/update/cancel sessions.
4. Upload PDF to trigger AI summary generation.
5. Review `/admin/audit-logs`.

### Check-in staff flow (mobile)

1. Login with a `checkin_staff` account in Expo app.
2. Select active workshop context.
3. Sync roster/cancellations while online.
4. Scan attendee QR codes.
5. If offline, captures queue locally in SQLite.
6. Reconnect and run queue sync to flush pending check-ins.

### Quick API smoke examples

Register:
```bash
curl -X POST http://localhost:3000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"student@example.com","full_name":"Student Demo","password":"Password123!"}'
```

Login:
```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"student@example.com","password":"Password123!"}'
```

Create registration (student token + idempotency key):
```bash
curl -X POST http://localhost:3000/registrations \
  -H "Authorization: Bearer <student_access_token>" \
  -H "Idempotency-Key: 5c6eb9f3-2741-4bc6-95d6-b49fa7c79bb3" \
  -H "Content-Type: application/json" \
  -d '{"workshop_id":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}'
```

## API Reference

Most module responses use a `data` envelope:

```json
{
  "data": {}
}
```

Auth endpoints are the main exception and return direct payloads (for example `/auth/login`, `/auth/register`, `/auth/refresh`).

Error envelope (common):

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable message"
  }
}
```

### System / Public

| Method | Endpoint | Description | Auth Required | Request Body | Response |
|---|---|---|---|---|---|
| `GET` | `/health` | Service health probe. | No | None | `{ "ok": true }` |
| `GET` | `/workshops` | List current-month workshops with query filters (`q`, `payment`, `available_only`). | No | None | `WorkshopListResponse` |
| `GET` | `/workshops/:id` | Public workshop detail. | No | None | `Workshop` |
| `POST` | `/payments/momo/callback` | MoMo IPN callback endpoint. | No | `MomoCallbackPayload` | `{ "data": { "status": "ok" } }` |
| `POST` | `/payments/jobs/reconcile` | Manual reconciliation trigger. | No | None | Reconciliation summary counters |
| `POST` | `/payments/jobs/expire` | Manual stale pending payment expiration sweep. | No | None | `{ "data": { "status": "ok" } }` |

### Auth

| Method | Endpoint | Description | Auth Required | Request Body | Response |
|---|---|---|---|---|---|
| `POST` | `/auth/register` | Register new student account. | No | `{ email, full_name, password }` | `LoginResponse` |
| `POST` | `/auth/login` | Login by email/password. Rate-limited by IP. | No | `{ email, password }` | `LoginResponse` |
| `POST` | `/auth/refresh` | Rotate refresh token and issue new access token. | No | `{ refresh_token }` or cookie fallback | `RefreshResponse` |
| `POST` | `/auth/logout` | Revoke refresh token. | Yes | `{ refresh_token }` | `204 No Content` |
| `POST` | `/auth/change-password` | Change current user password. | Yes | `{ old_password, new_password }` | `204 No Content` |
| `GET` | `/auth/me` | Retrieve authenticated user profile. | Yes | None | `{ "user": AuthUser }` |

Example request:
```json
{
  "email": "student@example.com",
  "password": "Password123!"
}
```

Example response:
```json
{
  "access_token": "<jwt>",
  "refresh_token": "<jwt>",
  "user": {
    "id": "22222222-2222-2222-2222-222222222222",
    "email": "student@example.com",
    "full_name": "Student Demo",
    "role": "student",
    "force_change_password": false
  },
  "force_change_password": false
}
```

### Admin (Organizer Role)

| Method | Endpoint | Description | Auth Required | Request Body | Response |
|---|---|---|---|---|---|
| `GET` | `/admin/dashboard/stats` | Dashboard summary metrics. | Yes (`organizer`) | None | `DashboardStats` |
| `GET` | `/admin/workshops` | List workshops for admin panel. | Yes (`organizer`) | None | `Workshop[]` |
| `GET` | `/admin/workshops/:id` | Workshop detail. | Yes (`organizer`) | None | `Workshop` |
| `POST` | `/admin/workshops` | Create workshop. | Yes (`organizer`) | `CreateWorkshopInput` | `Workshop` |
| `PUT` | `/admin/workshops/:id` | Update workshop fields. | Yes (`organizer`) | `UpdateWorkshopInput` | `Workshop` |
| `POST` | `/admin/workshops/:id/pdf` | Upload PDF for AI summary processing. | Yes (`organizer`) | `multipart/form-data` with `file` | `{ status: "processing", workshop_id }` |
| `PUT` | `/admin/workshops/:id/summary` | Manual summary override. | Yes (`organizer`) | `{ summary }` | `204 No Content` |
| `POST` | `/admin/workshops/:id/cancel` | Cancel workshop. | Yes (`organizer`) | `{}` | `Workshop` |
| `GET` | `/admin/audit-logs` | Cursor-based audit logs (`limit`, `cursor`). | Yes (`organizer`) | None | `{ items, next_cursor }` |

### Registration / Peak Control (Student Role)

| Method | Endpoint | Description | Auth Required | Request Body | Response |
|---|---|---|---|---|---|
| `GET` | `/workshops/:id/registration-gate` | Read registration gate status. | Yes (`student`) | None | `RegistrationGateResponse` |
| `POST` | `/workshops/:id/admission` | Request admission token or queue state. | Yes (`student`) | `{}` | `RegistrationAdmissionResponse` |
| `POST` | `/registrations` | Create registration (idempotent). | Yes (`student`) | `{ workshop_id }` + `Idempotency-Key` header (+ optional `Admission-Token`) | `CreateRegistrationResponse` |
| `GET` | `/registrations/workshops/:workshopId/current` | Fetch current active registration for workshop. | Yes (`student`) | None | `CurrentRegistrationResponse` |
| `GET` | `/registrations/:id/payment-status` | Get payment/registration status snapshot. | Yes (`student`) | None | `PaymentStatusResponse` |
| `GET` | `/registrations/:id/qr` | Fetch check-in QR payload/token metadata. | Yes (`student`) | None | `RegistrationQrResponse` |

Example create registration request:
```json
{
  "workshop_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
}
```

Example paid response:
```json
{
  "data": {
    "registration_id": "f6fc355e-c8d7-4a67-9dcf-aa8ea5b7602f",
    "registration_status": "pending_payment",
    "payment_required": true,
    "payment_id": "5e1e5fc6-9d90-4554-84c9-810e987d8c6c",
    "payment_status": "pending_provider",
    "payment_url": "https://test-payment.momo.vn/...",
    "next_action": "redirect_to_payment"
  }
}
```

### Notifications (Student Role)

| Method | Endpoint | Description | Auth Required | Request Body | Response |
|---|---|---|---|---|---|
| `GET` | `/notifications` | List in-app notifications (`limit`, `cursor`). | Yes (`student`) | None | `{ items, next_cursor }` |
| `GET` | `/notifications/unread-count` | Count unread notifications. | Yes (`student`) | None | `{ unread_count }` |
| `POST` | `/notifications/:id/read` | Mark a notification as read. | Yes (`student`) | `{}` | `{ id, is_read, read_at }` |

### Check-in (Check-in Staff Role)

| Method | Endpoint | Description | Auth Required | Request Body | Response |
|---|---|---|---|---|---|
| `GET` | `/checkin/roster` | Get workshop roster (`workshop_id`, optional `after`). | Yes (`checkin_staff`) | None | `{ workshop_id, server_time, roster[] }` |
| `GET` | `/checkin/cancelled-since` | Get cancelled registrations since timestamp (`after`). | Yes (`checkin_staff`) | None | `{ cancelled[], server_time }` |
| `POST` | `/checkin/scan` | Validate and apply single QR check-in. | Yes (`checkin_staff`) | `{ qr_token, workshop_id? }` | `CheckinScanResponse` |
| `POST` | `/checkin/sync` | Batch-sync offline scans from device. | Yes (`checkin_staff`) | `{ items: CheckinSyncItemRequest[] }` | `{ results: CheckinSyncItemResponse[] }` |

Example batch sync request:
```json
{
  "items": [
    {
      "device_id": "device-1716000000000-ab12cd34",
      "device_scan_id": "scan-1716000011111-x9y8z7w6",
      "qr_token": "<jwt_qr_token>",
      "workshop_id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      "scanned_at_device": "2026-05-18T13:20:11.111Z"
    }
  ]
}
```

## Project Structure

```text
UniHub-Workshop/
+-- backend/                        # Express + TS backend API
|   +-- src/
|   |   +-- app.ts                 # App bootstrap, router mounting, worker/cron wiring
|   |   +-- modules/
|   |   |   +-- auth/              # Registration, login, refresh, profile, password change
|   |   |   +-- admin/             # Organizer dashboard, workshop management, audit logs
|   |   |   +-- workshop/          # Public workshop list/detail + search index integration
|   |   |   +-- registration/      # Registration lifecycle + peak admission handling
|   |   |   +-- payment/           # MoMo callback, reconciliation, expiry, circuit breaker
|   |   |   +-- ai-summary/        # PDF upload and AI summary processing pipeline
|   |   |   +-- notification/      # In-app + email notification delivery
|   |   |   +-- checkin/           # Staff check-in APIs and sync flows
|   |   |   +-- csv-import/        # Student CSV import scheduler/service/repository
|   |   +-- shared/                # DB, queue, middleware, interfaces, errors
|   |   +-- workers/               # Queue consumers for async processing
|   +-- migrations/                # SQL schema and evolution scripts
|   +-- scripts/                   # Smoke, integration, and scenario scripts
|   +-- demo/                      # Peak/payment scenario demos
+-- frontend/                       # Next.js web app (student + admin experiences)
|   +-- app/                       # App Router pages/layouts
|   +-- components/                # UI components for auth/admin/student/layout
|   +-- lib/                       # API clients, auth helpers, discovery utils
|   +-- types/                     # Shared frontend type definitions
+-- mobile/                         # Expo app for check-in staff operations
|   +-- App.tsx                    # Main mobile experience
|   +-- lib/                       # Mobile auth/api/offline queue/sync/storage logic
+-- assets/                         # README visuals and screenshots
+-- blueprint/                      # Product/spec design documents
+-- UI_DESIGN.md                    # UI design notes
```

## Contributing

### Fork and branch workflow

1. Fork this repository on GitHub.
2. Clone your fork and create a branch:
   ```bash
   git checkout -b feat/short-descriptive-name
   ```
3. Implement your changes with tests or validation scripts.
4. Commit using Conventional Commits.
5. Push and open a Pull Request against `main`.

### Conventional commit examples

```text
feat(registration): add retry-after hint on busy responses
fix(checkin): prevent duplicate offline sync replay
docs(readme): expand env variable matrix
```

### Code style and linting

- TypeScript is used across all apps.
- Keep API contracts explicit and consistent with existing `types.ts` modules.
- Follow existing naming conventions (`snake_case` API payload fields where already established).
- Run checks/build before submitting:

```bash
cd backend && npm run build
cd ../frontend && npm run build
```

Optional validation scripts (backend):
```bash
cd backend
npm run smoke:local
npm run test:workshop:integration
npm run test:notification:integration
```

### Reporting bugs and requesting features

- Open a GitHub issue: https://github.com/blueToothFairy/UniHub-Workshop/issues
- Include:
  - What you expected.
  - What happened.
  - Steps to reproduce.
  - Logs/screenshots/payloads when relevant.

## License

This repository currently does not include a `LICENSE` file and is effectively unlicensed by default.

If you intend public reuse/contribution at scale, add an explicit OSI license (for example MIT or Apache-2.0) at repository root.


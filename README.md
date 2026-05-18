
# UniHub Workshop

> Manage workshops, registrations, payments, and check‑ins for university events.

![Build Status](https://img.shields.io/badge/build-unknown-lightgrey)
![License](https://img.shields.io/badge/license-MIT-blue)
![Version](https://img.shields.io/badge/version-1.0.0-blue)
![Last Commit](https://img.shields.io/badge/last--commit-unknown-lightgrey)
![Open Issues](https://img.shields.io/badge/open--issues-0-lightgrey)

<!-- Project context (filled from repository) -->

- **App name:** UniHub Workshop
- **Short description:** A focused platform to create and manage university workshops — organizers publish sessions, students register and pay, staff perform check‑ins, and admins monitor events.
- **Tech stack:** Next.js (frontend), React, Node.js + TypeScript + Express (backend), PostgreSQL (via Supabase pooler), Redis + BullMQ (optional workers), Elasticsearch (search), Cloudinary (PDF/image storage), Gemini (AI summarization), MoMo payment integration.
- **Auth method:** JWT access + refresh tokens

![Hero screenshot](assets/screenshot-hero.png)
![screenshot1](assets/screenshot1.png)
![screenshot2](assets/screenshot2.png)
![screenshot3](assets/screenshot3.png)

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Installation & Setup](#installation--setup)
- [Environment Variables](#environment-variables)
- [Usage / Examples](#usage--examples)
- [API Reference](#api-reference)
- [Project Structure](#project-structure)
- [Contributing](#contributing)
- [License](#license)

## Overview

UniHub Workshop is a small monorepo that implements the server and clients for managing university workshops. It targets three main user personas:

- Organizers: create and manage workshops, upload materials (PDF), view stats and audit logs.
- Students: discover workshops, register (paid or free), receive registration confirmations and in‑app notifications.
- Check‑in staff: scan student QR codes and sync offline scans.

The backend focuses on robustness around payments (simulation + MoMo sandbox), idempotent registration flows, a payment reconciliation process, and a peak admission controller to protect the payment gateway during flash events.

## Features

- Public workshop discovery and detail pages with caching (ETag / Last-Modified).
- Admin dashboard: workshop CRUD, upload PDF, force override AI summary, cancel workshops, audit logs with cursor pagination.
- Student flows: register (idempotent), payment handling (simulation or MoMo sandbox), registration QR issuance for confirmed registrations.
- Payment features: MoMo callback handling, reconciliation job, payment circuit-breaker to protect providers.
- Peak admission controller: admission tokens and queueing to limit writes under peak load.
- Notifications: in‑app notifications and email channel (Resend), background workers to deliver notifications.
- Check‑in system: QR scanning, offline sync, roster and cancelled-since endpoints.
- CSV import pipeline for student data (nightly/evening windows) with run tracking and validation.
- AI-generated workshop summaries for uploaded PDFs using Cloudinary + Gemini connector and a background worker.
- ElasticSearch-backed workshop search with indexing worker.
- Idempotency support for registration/payment requests (Idempotency-Key header).

## Tech Stack

- Frontend: Next.js 14, React 18
- Backend: Node.js (ESM) + TypeScript, Express
- Database: PostgreSQL (accessed via a Supabase pooler/connection string)
- Queue & Workers: Redis + BullMQ (optional; in-memory stub available for local dev)
- Search: Elasticsearch (indexing service)
- Storage: Cloudinary for PDF/image storage, optionally Cloudflare R2
- Payment: MoMo sandbox (adapter implemented) plus a `simulation` mode
- Auth: JWT access + refresh tokens
- Dev tooling: tsx, TypeScript, npm scripts

## Prerequisites

- Node.js >= 18
- npm >= 8 (or yarn)
- PostgreSQL (12+) accessible via connection string
- psql CLI (recommended for running seeds)
- Redis (optional, required only for workers and BullMQ)
- Elasticsearch (optional, required for search)

Docker is optional and recommended for easy local Postgres/Redis/Elasticsearch instances.

## Installation & Setup

Follow these steps to get a local development environment running.

1. Clone the repository

```bash
git clone https://github.com/blueToothFairy/UniHub-Workshop.git unihub-workshop
cd unihub-workshop
```

2. Backend setup

```bash
cd backend
npm install
# copy env template and edit required vars
cp .env.example .env
# Edit backend/.env and set SUPABASE_POOLER_URL and JWT_SECRET at minimum
```

Important environment variables: set `SUPABASE_POOLER_URL` to a Postgres connection (the code expects this), and `JWT_SECRET` for signing access tokens.

3. Run migrations

```bash
cd backend
npm run migrate:run
```

4. (Optional) Seed demo data

```bash
# from repository root
psql -d yourdb -f backend/migrations/20260517_seed_demo_data.sql
```

5. Start backend (dev)

```bash
cd backend
npm run dev
```

6. Frontend setup

```bash
cd frontend
npm install
npm run dev
```

7. (Optional) Mobile (Expo)

```bash
cd mobile
npm install
npm run start
```

## Environment Variables

Below is a curated list of the most important `.env` variables. See `backend/.env.example` for the full set.

| Variable | Required | Example | Description |
|---|---:|---|---|
| `SUPABASE_POOLER_URL` | Yes | `postgres://user:pass@localhost:6543/postgres` | Postgres connection string used by the backend (pooler). REQUIRED. |
| `JWT_SECRET` | Yes | `replace_me` | Secret for signing access tokens. |
| `JWT_REFRESH_SECRET` | No | `replace_refresh` | Optional refresh token secret; defaults to `JWT_SECRET` if not set. |
| `PORT` | No | `3000` | Backend listen port. |
| `REDIS_URL` | No | `redis://localhost:6379` | Redis URL for BullMQ and workers. Set `USE_REDIS=true` to enable. |
| `USE_REDIS` | No | `false` | If `true`, workers and BullMQ use Redis; otherwise an in-memory stub is used. |
| `START_WORKERS` | No | `false` | Set to `true` to start background workers. |
| `PAYMENT_GATEWAY_MODE` | No | `simulation` | `simulation` or `momo_sandbox` to select payment mode. |
| `MOMO_ENDPOINT` | No | `https://test-payment.momo.vn` | MoMo API endpoint (sandbox by default). |
| `ELASTICSEARCH_URL` | No | `http://localhost:9200` | URL for Elasticsearch if using search. |
| `RESEND_API_KEY` | No | `rsk_...` | API key for Resend email provider (optional). |
| `CSV_IMPORT_ENABLED` | No | `false` | Enable CSV import cron jobs. |

For the full list of environment variables and defaults see: [backend/.env.example](backend/.env.example)

## Usage / Examples

Below are common tasks and `curl` examples to exercise the API. The backend returns JSON payloads under a `data` wrapper for successful responses, and `error` objects for failures.

1) Register a student

```bash
curl -X POST http://localhost:3000/auth/register \
	-H "Content-Type: application/json" \
	-d '{"email":"student1@example.com","full_name":"Student One","password":"Password123!"}'
```

Response (201):

```json
{
	"access_token": "<jwt>",
	"refresh_token": "<refresh-jwt>",
	"user": { "id": "...","email":"student1@example.com","full_name":"Student One","role":"student" }
}
```

2) Login

```bash
curl -X POST http://localhost:3000/auth/login \
	-H "Content-Type: application/json" \
	-d '{"email":"student1@example.com","password":"Password123!"}'
```

Take the returned `access_token` and use it for subsequent authenticated calls:

```bash
curl -H "Authorization: Bearer <access_token>" http://localhost:3000/workshops
```

3) Create a registration (requires `Idempotency-Key` header)

```bash
curl -X POST http://localhost:3000/registrations \
	-H "Authorization: Bearer <access_token>" \
	-H "Content-Type: application/json" \
	-H "Idempotency-Key: demo-req-1" \
	-d '{"workshop_id":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}'
```

If the workshop is paid and `PAYMENT_GATEWAY_MODE` is `simulation`, the response will include a `payment_url` when the external gateway flow is required, or a `next_action` indicating client next steps.

## API Reference

Notes: all successful responses follow the wrapper `{ "data": ... }` unless otherwise documented. Error responses follow `{ "error": { code, message } }` or extended error forms that include `retry_after` when rate-limited.

### Authentication

| Method | Endpoint | Description | Auth Required | Request Body | Response |
|---|---|---:|---:|---|---|
| POST | `/auth/register` | Create a new student user and issue tokens | No | `{ "email", "full_name", "password" }` | `{ access_token, refresh_token, user }` |
| POST | `/auth/login` | Authenticate and receive tokens | No | `{ "email", "password" }` | `{ access_token, refresh_token, user }` |
| POST | `/auth/refresh` | Exchange refresh token for a new access token | No | `{ "refresh_token" }` or cookie `refresh_token` | `{ access_token, refresh_token }` |
| POST | `/auth/logout` | Revoke a refresh token | Yes | `{ "refresh_token" }` | `204 No Content` |
| POST | `/auth/change-password` | Change current user's password | Yes | `{ old_password, new_password }` | `204 No Content` |
| GET | `/auth/me` | Get current user profile | Yes | - | `{ user }` |

### Public Workshops

| Method | Endpoint | Description | Auth Required | Request Body | Response |
|---|---|---:|---:|---|---|
| GET | `/workshops` | List workshops (search & filters) | No | Query: `q`, `payment`, `available_only` | `{ data: [...workshops] }` |
| GET | `/workshops/:id` | Get workshop detail | No | - | `{ data: workshop }` |

Workshop object example (partial):

```json
{
	"id":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
	"title":"Intro to RAG",
	"description":"...",
	"speaker_name":"Dr. Example",
	"starts_at":"2026-06-01T03:00:00.000Z",
	"ends_at":"2026-06-01T05:00:00.000Z",
	"capacity":100,
	"confirmed_count":1,
	"price_vnd":200000,
	"payment_required":true
}
```

### Registration & Payments (students)

| Method | Endpoint | Description | Auth Required | Request Body | Response |
|---|---|---:|---:|---|---|
| POST | `/registrations` | Create registration (idempotent) | Yes (student) | `{ "workshop_id": "..." }` + header `Idempotency-Key` | `201 { data: CreateRegistrationResponse }` |
| GET | `/registrations/workshops/:workshopId/current` | Get user's current registration for a workshop | Yes | - | `{ data: CurrentRegistrationResponse }` |
| GET | `/registrations/:id/payment-status` | Check payment status for a registration | Yes | - | `{ data: PaymentStatusResponse }` |
| GET | `/registrations/:id/qr` | Get QR token for a confirmed registration | Yes | - | `{ data: { registration_id, qr_token, qr_issued_at } }` |

CreateRegistrationResponse (example):

```json
{
	"registration_id":"99999999-9999-...",
	"registration_status":"pending_payment",
	"payment_required":true,
	"payment_id":"77777777-...",
	"payment_status":"pending_provider",
	"payment_url":"https://payment-gateway/checkout/..."
}
```

### Admin (organizer only)

| Method | Endpoint | Description | Auth Required | Request Body | Response |
|---|---|---:|---:|---|---|
| GET | `/admin/dashboard/stats` | Dashboard statistics | Yes (organizer) | - | `{ data: {...} }` |
| GET | `/admin/workshops` | List all workshops (admin view) | Yes | - | `{ data: [...] }` |
| GET | `/admin/workshops/:id` | Workshop detail (admin) | Yes | - | `{ data: workshop }` |
| POST | `/admin/workshops` | Create a workshop | Yes | Create workshop JSON | `201 { data: newWorkshop }` |
| PUT | `/admin/workshops/:id` | Update workshop | Yes | Update JSON | `{ data: updatedWorkshop }` |
| POST | `/admin/workshops/:id/pdf` | Upload PDF (multipart/form-data) | Yes | multipart `file` field | `202 { data: {...} }` |
| PUT | `/admin/workshops/:id/summary` | Override AI summary | Yes | `{ summary_status, ai_summary }` | `204 No Content` |
| POST | `/admin/workshops/:id/cancel` | Cancel a workshop | Yes | - | `{ data: {...} }` |
| GET | `/admin/audit-logs` | Cursor-paginated audit logs | Yes | Query: `limit`, `cursor` | `{ data: { items: [...], cursor } }` |

### Notifications (student)

| Method | Endpoint | Description | Auth Required | Request Body | Response |
|---|---|---:|---:|---|---|
| GET | `/notifications` | List notifications (paginated cursor) | Yes (student) | Query: `limit`, `cursor` | `{ data: [...] }` |
| GET | `/notifications/unread-count` | Unread count for current user | Yes | - | `{ data: { count: number } }` |
| POST | `/notifications/:id/read` | Mark notification read | Yes | - | `{ data: {...} }` |

### Check‑in (staff)

| Method | Endpoint | Description | Auth Required | Request Body | Response |
|---|---|---:|---:|---|---|
| GET | `/checkin/roster?workshop_id=` | Get roster for workshop | Yes (checkin_staff) | Query: `workshop_id`, `after` | `{ data: [...] }` |
| GET | `/checkin/cancelled-since?after=` | List cancellations since timestamp | Yes | Query: `after` | `{ data: [...] }` |
| POST | `/checkin/scan` | Perform a QR scan | Yes | `{ qr_token, workshop_id }` | `{ data: {...} }` |
| POST | `/checkin/sync` | Upload offline sync items | Yes | `{ items: [...] }` | `{ data: {...} }` |

### Payments (webhooks & jobs)

| Method | Endpoint | Description | Auth Required | Request Body | Response |
|---|---|---:|---:|---|---|
| POST | `/payments/momo/callback` | MoMo IPN callback | No (provider) | MoMo callback payload (see `payment.types.ts`) | `{ data: { status: "ok" } }` |
| POST | `/payments/jobs/reconcile` | Manually trigger reconciliation job | No | - | `{ data: { scanned, updated } }` |
| POST | `/payments/jobs/expire` | Manually expire stale registrations | No | - | `{ data: { status: "ok" } }` |

## Project Structure

Top-level layout (annotated):

```
.\
├─ backend/                 # Express API, migrations, scripts
│  ├─ src/                  # TypeScript source for API & services
│  ├─ migrations/           # SQL migrations + seed scripts
│  ├─ scripts/              # helper scripts & smoke tests
│  └─ package.json
├─ frontend/                # Next.js app (App Router)
├─ mobile/                  # Expo mobile app
├─ openspec/                # API change specs and OpenSpec configs
└─ README.md
```

Key backend folders:

- `src/modules/` – feature modules (auth, admin, registration, payment, checkin, notification, workshop)
- `src/shared/` – infra and shared utilities (db, queue, errors, middleware)
- `migrations/` – SQL migrations and seed scripts (see `20260517_seed_demo_data.sql`)

## Contributing

We welcome contributions. Suggested workflow:

1. Fork the repository and create a feature branch: `git checkout -b feat/your-feature`
2. Follow conventional commits: `feat: add X`, `fix: Y`, `chore: ...`
3. Run tests and linting locally (backend has test helpers in `package.json` scripts).
4. Push your branch and open a pull request with a clear description and linked issue.

Code style & linting:

- The project uses TypeScript with `tsconfig.json`. Keep types strict and prefer small, well‑tested functions.
- Use `npm run build` in `backend` to ensure TypeScript compiles.
- Prefer descriptive commits and keep PRs focused.

Reporting bugs & feature requests:

- Open an issue describing steps to reproduce, expected vs actual behavior, and attach logs if available.

## License

This repository currently does not include a license file. The example badges above use `MIT` as a placeholder.

Choose and add a license file (for example, `MIT`) at the repository root and update this section accordingly.

---
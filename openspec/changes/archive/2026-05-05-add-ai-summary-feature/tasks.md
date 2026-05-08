## 1. Database & Contracts Foundation

- [x] 1.1 Add migration for workshop summary metadata fields (`pdf_url`, `ai_summary`, `summary_status`, `summary_generated_at`, `summary_error_code`) and verify it runs via Supabase direct connection (design ADR-010, specs/ai-summary).
- [x] 1.2 Define TypeScript domain types and narrow interfaces (`IWorkshopSummaryWriter`, `IPdfStorage`, `IAiSummarizer`, `IJobQueue`) before service implementation (design ADR-011, specs/ai-summary).
- [x] 1.3 Add/adjust API response DTOs for upload status and workshop summary read contract (specs/admin-workshop-pdf, specs/workshop-summary-read).
- [ ] 1.4 Manual smoke test: run migration on local/staging DB and confirm new columns are readable by existing workshop queries without regression.

## 2. Backend Upload & Queue Orchestration

- [x] 2.1 Implement `POST /admin/workshops/:id/pdf` with organizer authorization, PDF type/size validation, and explicit 400/403/404 error contracts (specs/admin-workshop-pdf).
- [] 2.2 Implement Cloudinary upload adapter and metadata persistence sequence: update workshop summary state to `processing` before enqueue (design ADR-009, specs/admin-workshop-pdf).
- [x] 2.3 Implement queue producer for `ai-summary.generate` with payload schema and tracing identifiers (design ADR-009, specs/ai-summary).
- [ ] 2.4 Manual smoke test: upload valid/invalid PDF and verify API latency `<2s` for accepted case + expected error body shapes.

## 3. AI Summary Worker Pipeline

- [x] 3.1 Implement BullMQ worker consumer for `ai-summary.generate` with SRP boundary (worker delegates business logic to service) (design ADR-009).
- [] 3.2 PDF extraction/cleaning must not be implemented before Gemini call (design ADR-012, specs/ai-summary).
- [x] 3.3 Implement retry policy (3 retries, 60s delay for Gemini rate-limit/5xx) and terminal status transitions (`ready`/`fallback`/`failed`) (design ADR-009, ADR-010, specs/ai-summary).
- [x] 3.4 Implement idempotent final write strategy for duplicate delivery scenarios (specs/ai-summary).
- [x] 3.5 Manual smoke test: simulate empty-text PDF, Gemini rate-limit, and duplicate job delivery; verify persisted states and fallback message.

## 4. Read APIs & Frontend Integration

- [x] 4.1 Extend workshop detail read endpoint(s) to return `pdf_url`, `ai_summary`, `summary_status`, `summary_generated_at` with stable contract (specs/workshop-summary-read).
- [x] 4.2 Add admin UI flow for upload progress/status display and manual summary override action (specs/admin-workshop-pdf).
- [x] 4.3 Add student workshop detail rendering logic for `processing`/`ready`/`fallback`/offline-unavailable states (specs/workshop-summary-read).
- [ ] 4.4 Manual smoke test: verify admin and student views show consistent summary status after upload and after manual override.

## 5. Observability, Cost Guardrails & Release

- [x] 5.1 Add logging/metrics for queue attempts, Gemini latency/error rate, and fallback count to monitor SLA and quality (design Risks/Trade-offs).
- [x] 5.2 Add command-budget telemetry notes for Upstash usage and alert threshold guidance (design ADR-012).
- [x] 5.3 Create release checklist and rollback steps (backward-compatible DB rollback strategy) (design Migration Plan).
- [ ] 5.4 Manual smoke test: end-to-end run with 5MB PDF confirms `202 <2s` and summary visible `<60s`.

## 6. SRP Safety Flags

- [x] 6.1 SRP review checkpoint: if any task combines router validation, storage IO, queue orchestration, and AI prompt logic in one class/function, split into separate tasks/modules before merge (design ADR-009, ADR-011).

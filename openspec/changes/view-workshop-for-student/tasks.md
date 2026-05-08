## Tasks

- [x] 1. Add change scaffold `openspec/changes/view-workshop-for-student/.openspec.yaml` (this change)
- [x] 2. Implement backend API `GET /workshops/:id` (or reuse existing `workshop` router) returning public DTO.
  - Create `WorkshopService.getPublicWorkshop(id)` that queries DB and maps to public DTO.
  - Add route in `src/modules/workshop/workshop.router.ts` or confirm existing route returns correct public shape.
- [x] 3. Add mapping tests for `toPublicWorkshopDto` covering `processing`/`ready`/`fallback` states. (added `backend/scripts/test_workshop_mapping.ts`)
- [x] 4. Add integration tests for `GET /workshops/:id` ensuring headers (ETag/Cache-Control) and error shapes. (added `backend/scripts/test_integration_workshop_read.ts`)
- [x] 5. Update frontend student workshop detail to consume fields and render summary states accordingly.
- [x] 6. Document the API contract in `/openspec/specs/workshop-summary-read/spec.md` and link this change.
- [ ] 7. Manual smoke tests: verify student page shows correct transitions after admin PDF upload and AI summary processing.
- [x] 8. Release notes and rollout checklist (non-breaking): include guidance for caching and examples for frontend implementers. (added `release_notes.md`)

Notes:
- This change is read-only for DB; no migration required.
- Coordinate with the `add-ai-summary-feature` change owners if simultaneous deployments change `summary_status` semantics.

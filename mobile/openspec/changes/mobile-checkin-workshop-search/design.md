## Context

The staff mobile check-in app already supports selecting a workshop from a locally cached list restored from Expo SQLite (`workshops_cache`). In event conditions, staff devices may be offline or have unstable connectivity, so the workshop picker must remain usable without relying on server-side search.

The existing workshop list UI is a simple scrollable list of cached workshops (title + time + room/location + workshop id). The current pain point is quickly finding the correct workshop when the list is long.

## Goals / Non-Goals

**Goals:**
- Add a single search input to the existing workshop picker.
- Filter the cached workshop list locally by `title` and `room/location`.
- Ensure search works fully offline and does not require any backend query parameters.
- Keep the UX minimal: no new screens and no advanced filtering controls.

**Non-Goals:**
- Adding backend search for staff workflows.
- Adding filters (payment, availability, date presets) or sorting changes.
- Expanding the on-device workshop cache schema (speaker, description, etc.).

## Decisions

### DEC-001: Client-side filtering over cached workshops

**Decision**

Implement search as an in-memory filter over the already-loaded cached workshop list.

**Rationale**

- Works identically online/offline.
- Avoids introducing any additional backend load or dependency on workshop search services.
- Requires no new SQLite schema or migration.

**Alternatives considered**

- Online-only search using `GET /workshops?q=...`:
  - Rejected because staff must be able to search while offline.
- Extending the SQLite cache to store additional searchable fields:
  - Rejected to keep this change small and avoid local DB migrations.

### DEC-002: Case-insensitive and diacritics-insensitive matching

**Decision**

Normalize both the query and candidate strings by lowercasing and removing diacritics (Unicode NFD + stripping combining marks) before substring matching.

**Rationale**

Workshop titles/rooms may include Vietnamese diacritics, and staff may type without diacritics under time pressure. Diacritics-insensitive matching reduces friction and improves recall.

**Alternatives considered**

- Plain `toLowerCase()` only:
  - Rejected because it makes the search less forgiving for Vietnamese input.

## Risks / Trade-offs

- [Unicode normalization availability] → Wrap `.normalize("NFD")` in a try/catch and fall back to `toLowerCase()`.
- [Search scope too narrow] → Restrict to title + room/location to match the cached fields; avoid adding filters or schema changes.
- [No matches confusion] → Show a lightweight “No matches in cached workshops.” hint when filtering yields an empty list.

## Migration Plan

- No server deployment steps.
- No database migrations.
- Mobile-only UI change can ship in the next app release; rollback is simply removing the search input/filtering logic.

## Open Questions

- Should search also match workshop ID? (Current scope is title + room/location only.)

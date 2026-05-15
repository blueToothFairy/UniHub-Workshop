## Why

Staff check-in devices often need to select the correct workshop quickly while operating offline or on unstable networks. Scrolling through a long cached list is slow and error-prone.

## What Changes

- Add a single text search input inside the existing workshop picker in the staff mobile check-in app.
- Filter the locally cached workshop list (Expo SQLite cache) by workshop title and room/location.
- Keep the behavior fully offline: search operates only on cached data and does not require any backend query params or new endpoints.

## Capabilities

### New Capabilities
- `mobile-checkin-workshop-picker-search`: Offline search within the staff mobile workshop picker (match on title and room/location).

### Modified Capabilities
- (none)

## Impact

- Mobile app UI: `App.tsx` workshop picker renders a search `TextInput` and filters the in-memory workshop list.
- No backend API changes required.
- No database schema changes required (uses existing cached workshop fields: title + location).

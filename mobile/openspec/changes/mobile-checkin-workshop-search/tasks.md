## 1. Spec Alignment

- [x] 1.1 Confirm workshop picker uses cached list and remains functional offline
- [x] 1.2 Confirm search scope is title + room/location only (no extra filters)

## 2. Mobile Implementation

- [x] 2.1 Add workshop search query state to the workshop picker UI
- [x] 2.2 Implement case-insensitive and diacritics-insensitive normalization for matching
- [x] 2.3 Filter cached workshops by title or room/location based on the query
- [x] 2.4 Show a “no matches” hint when the query yields zero cached results

## 3. Verification

- [x] 3.1 Run `npx tsc -p tsconfig.json --noEmit` in `mobile/`
- [ ] 3.2 Manual QA: open picker with cached workshops, verify title match
- [ ] 3.3 Manual QA: verify room/location match
- [ ] 3.4 Manual QA: verify diacritics-insensitive match (e.g., type without accents)
- [ ] 3.5 Manual QA: enable airplane mode, verify search still filters cached list

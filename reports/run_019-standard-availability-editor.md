# Run Report — 019: Standard weekly availability editor (recurring hours)

- Profile: React Frontend
- Timestamp: 2026-08-22T10:35:00.000Z
- DoD status: pass

## [ARCHITECT OUTPUT]

### 1) Scope & Assumptions

- Frontend-only, as specified — no backend files touched. Confirmed by reading `backend/src/routes/adminAvailability.ts` and `adminAvailabilitySchema.ts`: `GET`/`POST /admin/availability-rules` and `DELETE /admin/availability-rules/:id` exist, are behind `requireMasseurAuth` + `adminRateLimit`, and validate `weekday` (1–7), `start_time`/`end_time` (strict `HH:MM:SS`), and `end_time > start_time`. `PATCH` also exists but the task doesn't require it (delete+recreate is acceptable and simpler, matches the task's explicit call).
- Confirmed no overlap/conflict validation exists anywhere (schema or `adminCatalogService.ts`'s `createAvailabilityRule`) — only the ordering check. The UI must not invent one either.
- `listAvailabilityRules()` already returns rows `ORDER BY weekday, start_time` — grouping by weekday client-side is a simple `reduce`, no client-side sort needed.
- **Weekday numbering mismatch to watch**: the API's `weekday` is 1=Monday..7=Sunday, but JS `Date.getDay()` is 0=Sunday..6=Saturday. The static weekday-label array must be built directly from the API's 1–7 convention, never from `Date.getDay()`/`Intl` weekday indices.
- No existing frontend precedent for admin-CRUD-with-delete beyond `getAdminBookings` (GET) + `confirmBooking`/`declineBooking`/`cancelBookingAsAdmin` (POST). Followed the `authRequest`-wrapped pattern those establish.
- Not a new architectural pattern for this codebase (unlike task 018's calendar) — list-fetch + add-row + delete-row, the same shape as the existing pending-bookings list's actions. No learning-workflow deep-dive checkpoint needed.

### 2) File Impact List

**Backend** — none.

**Frontend**
- `frontend/src/api/types.ts` — `AvailabilityRule`, `CreateAvailabilityRuleRequest`, `DeleteAvailabilityRuleResponse`
- `frontend/src/api/client.ts` — `getAvailabilityRules`, `createAvailabilityRule`, `deleteAvailabilityRule`
- `frontend/src/pages/AdminAvailability.tsx` (new)
- `frontend/src/pages/AdminDashboard.tsx` — third `"availability"` view-toggle option
- `frontend/test/AdminAvailability.test.tsx` (new)
- `frontend/test/AdminDashboard.test.tsx` — one new toggle test

### 3) Implementation Plan

1. Add `AvailabilityRule` types to `api/types.ts`.
2. Add the three `client.ts` functions, reusing `authRequest`/`ApiError` exactly as existing admin calls do.
3. `AdminAvailability.tsx`: own `useEffect` fetch of `getAvailabilityRules()` on mount, independent of `AdminDashboard`'s booking-list state (same isolation strategy as `AdminCalendar` in task 018).
4. Group fetched rules by `weekday` into a `Map`, iterate a static `WEEKDAYS` array (1=Monday..7=Sunday) to render — never derive labels from `Date`.
5. Per weekday: render each existing rule as a row (time range + Delete button) if any exist, else an explicit "No hours set" state.
6. Per weekday: an add-row form (`<input type="time">` × 2) with client-side `end_time > start_time` validation before calling the API.
7. On success: update local state immediately from the response (no full refetch) — same pattern as `applyBookingUpdate` in `AdminDashboard`.
8. Surface `ApiError` messages from failed add/delete calls inline, reusing the `error instanceof ApiError` pattern used everywhere else in this app.
9. Wire the third toggle button in `AdminDashboard.tsx`, following the exact `{viewMode === "..." && (...)}` isolation pattern from task 018.
10. Mobile-first CSS/layout: verify no horizontal overflow at ~375px before calling this done, same verification process as task 018 (headless browser + screenshot).
11. Tests per the Test Strategy below.
12. Run full toolchain in both projects (backend expected to be a no-op diff, run anyway to confirm).

### 4) Validation Strategy (server-side)

No new server-side validation possible or needed — zero backend code changes. The existing `createAvailabilityRuleSchema` remains the actual source of truth; the client-side check is a UX mirror, not a replacement.

### 5) Test Strategy

All 7 weekdays Monday-first; correct grouping including multiple ranges per day; empty-day state; add happy path (optimistic update, no refetch); add client-side rejection (no request sent); add backend-rejection (message surfaced verbatim); delete happy path; delete failure (message surfaced, row stays); 401 handling; toggle test in `AdminDashboard.test.tsx` (mirrors task 018's). Narrow-viewport check via the same headless-browser screenshot process used in task 018's Release stage.

### 6) CIA Impact

- **Confidentiality**: None.
- **Integrity**: Low — first UI exposing create/delete (not just status-transition) mutations in this admin surface, but against an already-implemented, already-reviewed endpoint with its own server-side validation as the real backstop.
- **Availability**: None — no new dependencies.

### 7) Dependency Decision

**New dependency needed: No.** Native `<input type="time">` and list rendering — no calendar-grid math, no date-library need.

---

## [IMPLEMENTER OUTPUT]

Implemented per the approved plan, with the one addition specified by the user: `toWireTime()` appends `":00"` to both start/end `<input type="time">` values before `POST /admin/availability-rules`, since the backend's `timeOfDay` regex requires strict `HH:MM:SS` and native time inputs emit `HH:MM` by default. No `step="1"` used, per instruction — no reason to expose seconds-level precision to the masseur.

**Types/client** (`api/types.ts`, `api/client.ts`): `AvailabilityRule { id, weekday, start_time, end_time }`, `CreateAvailabilityRuleRequest`, `DeleteAvailabilityRuleResponse`; `getAvailabilityRules`/`createAvailabilityRule`/`deleteAvailabilityRule`, all `authRequest`-wrapped identically to the existing admin-booking calls.

**`AdminAvailability.tsx`** (new): a static `WEEKDAYS` array built directly from the API's 1=Monday..7=Sunday convention (explicitly never from `Date.getDay()`). Owns its own `getAvailabilityRules()` fetch, groups rules into a `Map<weekday, AvailabilityRule[]>` via `useMemo`. Per-weekday add form state is a `Record<number, { start, end, error }>`, validated client-side (`end <= start` → inline error, matching the backend's strict-greater-than check exactly) before calling the API. On success, state updates optimistically from the response (no refetch) — same pattern as `AdminDashboard`'s `applyBookingUpdate`. On failure, `ApiError.message` is shown verbatim (not a generic fallback) — a deliberate, explicitly-required deviation from `AdminDashboard`'s more conservative pattern, justified directly by acceptance criterion 6 and safe because `ApiError.message` is always the backend's already-curated `clientMessage` (never a stack trace).

**`AdminDashboard.tsx`**: added a third `"availability"` `ViewMode` value, one new toggle button, one new conditional render line (`{viewMode === "availability" && <AdminAvailability ... />}`). Zero changes to List or Calendar branches.

No migration/compat notes — additive only, zero backend changes (confirmed via `git diff --porcelain -- backend/` returning nothing).

---

## [REVIEWER OUTPUT]

**Review summary**: Backend untouched (confirmed empty diff). `AdminDashboard.tsx` diff is purely additive. `AdminAvailability.tsx` correctly follows the `AdminCalendar` isolation pattern, uses the API's weekday convention explicitly, appends `:00` exactly as directed, and mirrors the backend's `end_time > start_time` check precisely.

**Required fixes (blockers)**
1. No test covered a failed delete (`handleDeleteRule`'s catch branch). **Addressed in Tester stage below.**

**Suggested improvements (nice-to-have, not blocking)**
1. Seven identical "Start time"/"End time" labels across the page — unambiguous in the DOM, mildly repetitive for screen-reader navigation-by-label. Consistent with this app's existing accessibility effort level elsewhere.
2. `rule.start_time.slice(0, 5)` would silently drop non-`:00` seconds if a rule were ever seeded with them outside this UI's own create path — purely theoretical, this UI always writes `:00`.

---

## [TESTER OUTPUT]

Added a delete-failure test asserting the backend's error message renders as readable text and the row stays (since the delete didn't actually succeed). Full frontend suite: 7 files, 51 tests, all green. `tsc --noEmit` and `eslint src` clean.

---

## [SECURITY OUTPUT]

### 1) CIA Impact
Confidentiality: None. Integrity: Low (first create/delete UI in this admin surface, against an already-reviewed, already-validated endpoint). Availability: None.

### 2) OWASP-style Checks
No new input surface, no new authz decision, no new PII exposure, no new config/logging surface. `AdminAvailability` reuses `authRequest()`'s existing 401 handling identically across load/add/delete.

### 3) Dependency & Supply Chain Review
Zero new dependencies (confirmed via empty `frontend/package.json` diff). `npm audit --audit-level=high` → 0 vulnerabilities (frontend). Backend: zero file changes, pre-existing accepted exception untouched.

### 4) Threat Mini-Model
Assets: provider's recurring schedule (business config, not PII). Entry points: the three pre-existing, unchanged `/admin/availability-rules` routes. No new threats identified.

### 5) Risk Summary
Severity: Low. No mitigations required before merge.

### 6) Secure SDLC Phase
Implementation. No re-review required.

### Merge Decision
**Approved for merge: Yes.**

---

## [RELEASE OUTPUT]

### DoD Checklist — all items pass. Backend confirmed zero-diff and fully green (216/216 tests, typecheck/lint/build/audit unchanged). Frontend fully green (51/51 tests, typecheck/lint/build, 0 audit vulnerabilities).

### Acceptance Criteria — all 9 met; see conversation for full mapping. Highlights:
- Mobile verification actually performed this run (not assumed): headless Playwright at 375×700, before and after an add action. No horizontal overflow, no bugs found (unlike task 018, which caught a real CSS-specificity bug during this same verification step).
- `toWireTime()`'s `:00`-appending verified directly via a test asserting the exact `POST` request body.
- Backend-error-surfacing (acceptance criterion 6) verified for both add-failure and delete-failure paths.

### Deliberate Convention Deviation (flagged, not a defect)
`AdminAvailability` shows backend `ApiError.message` verbatim on failure, unlike `AdminDashboard`'s generic-fallback pattern — required directly by acceptance criterion 6, safe because the message is always the backend's curated `clientMessage`.

### Files Changed
`frontend/src/api/types.ts`, `frontend/src/api/client.ts`, `frontend/src/pages/AdminAvailability.tsx` (new), `frontend/src/pages/AdminDashboard.tsx`, `frontend/test/AdminAvailability.test.tsx` (new), `frontend/test/AdminDashboard.test.tsx`. Backend: none.

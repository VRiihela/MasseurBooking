# Run Report — 018: Masseur schedule calendar view (month/week/day, mobile-first)

- Profile: React Frontend
- Timestamp: 2026-08-22T08:20:00.000Z
- DoD status: pass

## [ARCHITECT OUTPUT]

### 1) Scope & Assumptions

- Purely additive: a new `AdminCalendar` view reachable via a toggle in `AdminDashboard.tsx`. The existing list view's JSX, state, and data flow are untouched — the calendar manages its own independent fetch rather than sharing `statusFilter`/`bookings` state, so there is zero risk of regressing the existing list tests.
- Backend change is response-mapping only: `listBookingsForAdmin` already selects `b.start_at, b.end_at` as `Date` columns (`backend/src/services/bookingService.ts:456`) — no new SQL. Add `startAt`/`endAt` to `AdminBookingListItem`, map to `start_at`/`end_at` ISO strings in the route response (`backend/src/routes/bookings.ts:151`).
- Assumption: the calendar renders events in the **browser's local timezone** (standard `Date` behavior), not `provider.timezone`. This is consistent with the project's single-masseur assumption (context: "single masseur, low request volume") — the masseur's own phone is expected to be in their own timezone. This differs subtly from `startAtLocal`/`endAtLocal`, which are formatted server-side using `provider.timezone` explicitly. Flagging this now because it's exactly the class of bug (`UTC-vs-provider-timezone display incident`) this project has been bitten by before.
- Event detail panel reuses the existing `startAtLocal`/`endAtLocal` strings for display (already timezone-correct) — only the grid *positioning* uses the new raw fields, per the task's explicit requirement.
- No routing library is introduced — the List/Calendar toggle is local `useState`, same pattern as the existing status-filter toggle.

### 2) File Impact List

**Backend**
- `backend/src/services/bookingService.ts` — extend `AdminBookingListItem` with `startAt: Date; endAt: Date;`, map in `listBookingsForAdmin`
- `backend/src/routes/bookings.ts` — add `start_at`/`end_at` ISO strings to the `/admin/bookings` response mapping
- `backend/test/integration/admin.bookingsList.test.ts` — extend the known-instant timezone test with `start_at`/`end_at` assertions

**Frontend**
- `frontend/src/api/types.ts` — add `start_at: string; end_at: string;` to `AdminBooking`
- `frontend/src/pages/AdminDashboard.tsx` — add `viewMode: "list" | "calendar"` state + toggle buttons; render `<AdminCalendar />` when `"calendar"`; no other changes
- `frontend/src/pages/AdminCalendar.tsx` (new) — calendar view: own data fetch, filters out `cancelled` client-side, month/week/day views, pending/confirmed visual distinction, click-to-view-details (read-only)
- `frontend/src/pages/AdminCalendar.css` (new) — mobile-first overrides for the calendar library's default (desktop-oriented) styling
- `frontend/test/AdminCalendar.test.tsx` (new)
- `frontend/package.json` — add `react-big-calendar` + a date-localizer dependency

### 3) Implementation Plan

1. Backend: add `startAt`/`endAt` to `AdminBookingListItem` and the SQL-row mapping.
2. Backend: add `start_at`/`end_at` ISO strings to the `/admin/bookings` JSON response, alongside unchanged `start_at_local`/`end_at_local`.
3. Backend test: assert the new fields on the existing known-instant fixture, proving raw and local fields describe the same instant.
4. Frontend types: extend `AdminBooking` — no `client.ts` changes needed.
5. Add calendar library + localizer to `frontend/package.json`.
6. Build `AdminCalendar.tsx`: own `useEffect` fetch of all bookings, filter cancelled, map to calendar events, `eventPropGetter` for pending-vs-confirmed styling, view-switching state.
7. Wire click-to-detail: read-only panel — no mutation actions.
8. Add mobile-first CSS overrides; verify at a narrow viewport before considering this done, not after.
9. `AdminDashboard.tsx`: add the toggle and conditional render only — do not touch existing list state, markup, or handlers.
10. Frontend tests: view-switch renders calendar, pending/confirmed styling differs, cancelled excluded, detail panel shows correct read-only info and no action buttons, positioning derives from `start_at`/`end_at`.
11. Run full toolchain in both projects.

### 4) Validation Strategy

No new input surface — response-shape addition only. `adminBookingsQuerySchema` explicitly untouched. `requireMasseurAuth` + `adminRateLimit` remain as-is.

### 5) Test Strategy

Backend: extend the existing timezone-fixture test with raw-field assertions tied to the same instant. Frontend: new `AdminCalendar.test.tsx` covering view switching, status styling, cancelled exclusion, positioning-from-raw-fields, read-only detail panel. Existing `AdminDashboard.test.tsx` must pass unmodified. Narrow-viewport usability flagged as needing manual verification, not something JSDOM can check.

### 6) CIA Impact

- **Confidentiality**: None — `start_at`/`end_at` were already derivable from existing local-formatted strings.
- **Integrity**: None — view-only in v1, no new mutation endpoints.
- **Availability**: Low — moderate client bundle increase; no backend load change.

### 7) Dependency Decision

**New dependency needed: Yes** — `react-big-calendar` + a date-localizer, recommended over hand-rolling. Reasoning: month/week/day grid math (week-start conventions, leap years, DST transitions) is a real correctness-risk category this project has already been bitten by twice (task 003's DST bug, the UTC-vs-provider-timezone incident). `react-big-calendar` is well-established, MIT-licensed, supports month/week/day out of the box, and covers the pending/confirmed distinction and read-only detail panel directly via its `eventPropGetter`/`onSelectEvent` API.

**Learning-workflow checkpoint**: this task introduces two patterns not used elsewhere in this codebase — the first non-React/ReactDOM frontend dependency, and date-grid calendar math generally. Per `documents/learning-workflow.md`, this is a "stop and consider a deep-dive" checkpoint. User elected to proceed to Implementer directly.

---

## [IMPLEMENTER OUTPUT]

Implemented per the plan above, with one deviation made as an implementation-time judgment call: the localizer is **`luxon`**, not the originally-discussed `date-fns`. `react-big-calendar` already bundles `luxon` as one of its own dependencies (offering `luxonLocalizer`/`momentLocalizer`/`dayjsLocalizer`/`globalizeLocalizer`/`dateFnsLocalizer` alternatives), and `luxon` is already a vetted, audited dependency of this project's `backend/` (`timeFormat.ts`). Pairing with `luxon` avoids introducing a brand-new date-library family, better serving the "minimal new dependencies" precedent than `date-fns` would, at equal dependency count (2 new packages either way). Functionally equivalent. Flagged explicitly for the user's awareness/veto.

**Backend** (`bookingService.ts`, `bookings.ts`): added `startAt`/`endAt: Date` to `AdminBookingListItem`, mapped from the already-selected `row.start_at`/`row.end_at` columns (no new SQL), and serialized as `start_at`/`end_at` ISO strings in the route response alongside the unchanged `start_at_local`/`end_at_local`.

**Frontend types** (`api/types.ts`): `AdminBooking` extended with `start_at: string; end_at: string;`.

**`AdminCalendar.tsx`** (new): owns its own `getAdminBookings()` fetch (no status filter → returns everything), filters out `cancelled` client-side, maps bookings to calendar events using `new Date(booking.start_at)` / `new Date(booking.end_at)` (never parsing `startAtLocal`), uses `luxonLocalizer(DateTime)`, restricts `views` to `[Views.MONTH, Views.WEEK, Views.DAY]` (default `Views.DAY`, matching "checking their day between appointments"), applies an `eventPropGetter` class (`admin-calendar-event-pending` / `admin-calendar-event-confirmed`) for the color distinction, and opens a read-only `role="dialog"` detail panel on `onSelectEvent` — no Confirm/Decline/Cancel controls, no mutation calls. A code comment documents the browser-local-timezone simplification, per the user's explicit instruction.

**`AdminCalendar.css`** (new): mobile-first — base rules target ~375px (stacked toolbar, `70vh` grid, smaller font), a `min-width: 640px` query widens back out for larger screens.

**`AdminDashboard.tsx`**: added `viewMode` state and a `List`/`Calendar` toggle section; wrapped the existing list markup (filter section, error/loading states, the `<ul>`) in a `{viewMode === "list" && (...)}` block. The diff is pure reindentation — no line of existing JSX or handler logic changed.

**Tricky part**: `vi.useFakeTimers()` without scoping deadlocked all five new `AdminCalendar` tests (`findByTestId`/`waitFor` poll via real `setTimeout`, which fake timers block). Fixed with `vi.useFakeTimers({ toFake: ["Date"] })` to pin "now" for deterministic event positioning without faking timer functions testing-library depends on.

No migration/compat notes — additive fields and additive UI only.

---

## [REVIEWER OUTPUT]

**Review summary**: Backend change minimal and correct. `AdminDashboard.tsx`'s diff is 100% reindentation — existing list JSX/handlers byte-for-byte unchanged, all 12 pre-existing tests pass unmodified. `AdminCalendar.tsx` correctly isolates its data fetch, uses raw fields for positioning, stays view-only.

**Required fixes (blockers)**
1. No test exercised the toggle itself (acceptance criterion #1) — only indirectly covered via existing list tests passing under the default `"list"` mode. **Addressed in Tester stage below.**

**Suggested improvements (nice-to-have, not blocking)**
1. Redundant fetch on first switch to Calendar — the list's top-level `useEffect` always fetches on mount regardless of `viewMode` (deliberate isolation tradeoff), so the first Calendar switch triggers one avoidable extra request. Accepted as-is.
2. Detail panel has no focus trap / Escape-to-close — consistent with this app's existing inline forms, not a regression.
3. Manual narrow-viewport check still outstanding at review time — **addressed at Release below.**

---

## [TESTER OUTPUT]

Added a toggle-behavior test to `frontend/test/AdminDashboard.test.tsx`: switches to Calendar view (list content disappears, `admin-calendar-grid` appears), switches back to List (calendar disappears, list content reappears from preserved state), and asserts no redundant list refetch occurs across the switch. All 13 `AdminDashboard` tests pass; full frontend suite (6 files, 42 tests) green; `tsc --noEmit` and `eslint src` clean.

---

## [SECURITY OUTPUT]

### 1) CIA Impact
- **Confidentiality**: None — no new data exposed beyond what was already derivable; same auth gate.
- **Integrity**: None — verified no mutation calls reachable from `AdminCalendar`.
- **Availability**: Low — bundle grows to 419 KB / 131 KB gzip (up from a much smaller baseline); no server-side load change.

### 2) OWASP-style Checks
No new input surface, no new authz decision, no new PII exposure beyond the existing list view's, no new config/logging surface. `AdminCalendar` reuses `authRequest()`'s existing 401 → clear-session → `onSessionEnded()` handling.

### 3) Dependency & Supply Chain Review
- New: `react-big-calendar` (^1.20.0), `luxon` (^3.7.2) + `@types/*` devDependencies.
- Why: per Architect's reasoning — real DST/grid-math correctness risk this project has been bitten by before, outweighing hand-rolling it a third time with zero prior frontend pattern.
- Deviation flagged: `luxon` substituted for the originally-discussed `date-fns` — already bundled by `react-big-calendar` itself and already a trusted dependency of this project's backend, so it introduces no new date-library family. Flagged explicitly for the user to accept or override.
- Audit: `frontend/` → `npm audit --audit-level=high` → **0 vulnerabilities**. `backend/` → 5 pre-existing dev-dependency findings, already documented/accepted in `context_template.md` (2026-08-09), unrelated to this task (zero backend dependency changes).
- Recommendation: **Accept**, contingent on the user confirming the `luxon` swap.

### 4) Threat Mini-Model
Assets: booking PII (unchanged from existing list view). Entry point: `GET /admin/bookings` only (existing, unchanged auth/rate-limit). No new threats identified beyond ordinary supply-chain exposure from two new, well-established packages.

### 5) Risk Summary
Severity: Low. No security-blocking mitigations required. Non-security follow-up: manual narrow-viewport verification (resolved at Release, see below).

### 6) Secure SDLC Phase
Implementation. No re-review required.

### Merge Decision
**Approved for merge: Yes.**

---

## [RELEASE OUTPUT]

### DoD Checklist

| Item | Status |
|---|---|
| Acceptance criteria met | Pass — all 8, see mapping below |
| Edge cases considered | Pass — cancelled exclusion, unparseable `startAtLocal` positioning, 401 mid-session |
| No breaking changes without migration notes | Pass — additive only |
| TypeScript strict, no unnecessary `any` | Pass |
| Lint & formatting | Pass — backend + frontend |
| Tests: new behavior covered, negative cases included | Pass — backend 2 new assertions; frontend 5 new `AdminCalendar` tests + 1 new toggle test |
| Tests pass locally | Pass — backend 216/216, frontend 42/42 |
| AuthN/AuthZ unchanged and correct | Pass |
| No new dependency without justification | Pass — see Security section (with the `luxon`-vs-`date-fns` deviation flagged for user confirmation) |
| `npm audit` no unresolved HIGH/CRITICAL | Pass — frontend 0 vulns; backend's pre-existing accepted exception untouched |
| Docs / migration notes | N/A — no rollback needed, both features degrade cleanly if reverted |

### Acceptance Criteria Mapping
1. List/Calendar toggle, list view behaviorally untouched — verified (diff is pure reindentation, all 13 `AdminDashboard` tests pass, visually confirmed).
2. Month/week/day, switchable — verified (tests + visual screenshots).
3. Pending vs. confirmed visually distinct, cancelled excluded — verified; **a real bug was caught and fixed during manual verification** (see below).
4. Positioning from raw `start_at`/`end_at`, never `startAtLocal` — verified directly via a deliberately-unparseable-`startAtLocal` test case.
5. Mobile-first, verified at a narrow viewport — **actually verified this run**, not just designed-and-assumed (see below).
6. Backend adds `start_at`/`end_at`, existing tests pass, new assertions added — verified, 7/7 integration tests pass.
7. Confirm/Decline/Cancel flows untouched — verified, same handlers/tests unchanged; zero mutation calls in `AdminCalendar`.
8. `npm test`/`build`/`lint`/`tsc --noEmit` pass in both projects — verified, all four, both projects.

### How to Verify
```bash
cd backend && npm run typecheck && npm run lint && npm run build && npm test
cd frontend && npm run typecheck && npm run lint && npm run build && npm run test:run
```
Manual: log in as the masseur, click **Calendar**, switch Month/Week/Day, confirm pending (amber) vs. confirmed (green) events stay colored even when selected, click an event for the read-only detail panel, resize to phone width.

### Mobile Verification (performed this run)
Started the frontend dev server, drove it headlessly with Playwright/Chromium at 375×700 (API mocked, session token seeded), and screenshotted Day, Month, Week views plus the detail panel. Confirmed no horizontal overflow (`scrollWidth === clientWidth === 375`), toolbar stacks correctly, grids fit and scroll as expected.

**Bug caught and fixed during this check**: in Week/Month view, tapping a *pending* event turned it the library's default selected-blue instead of staying amber — `.rbc-event.rbc-selected` (2-class CSS specificity) beat `.admin-calendar-event-pending` (1-class specificity), which would have silently broken acceptance criterion 3 exactly when a masseur taps a pending appointment. Fixed in `AdminCalendar.css` by qualifying both status classes with `.rbc-event` to match specificity; re-verified via computed-style inspection (`rgb(180, 83, 9)` = `#b45309`, correct amber) and a fresh screenshot.

### Open Item for the User
Implementer substituted `luxon` for the originally-discussed `date-fns` as the calendar's localizer (reasoning above, repeated in Security section). Functionally equivalent; flagged for explicit confirmation or override before this is considered fully settled.

### Files Changed
- `backend/src/services/bookingService.ts`, `backend/src/routes/bookings.ts` — `start_at`/`end_at` added to admin list response
- `backend/test/integration/admin.bookingsList.test.ts` — 2 new assertions
- `frontend/src/api/types.ts` — `AdminBooking` extended
- `frontend/src/pages/AdminDashboard.tsx` — List/Calendar toggle (reindent only)
- `frontend/src/pages/AdminCalendar.tsx`, `frontend/src/pages/AdminCalendar.css` — new
- `frontend/test/AdminCalendar.test.tsx` — new (5 tests)
- `frontend/test/AdminDashboard.test.tsx` — 1 new toggle test
- `frontend/package.json`, `frontend/package-lock.json` — `react-big-calendar`, `luxon` (+ `@types/*`)

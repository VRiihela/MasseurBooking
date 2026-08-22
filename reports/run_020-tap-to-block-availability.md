# Run Report — 020: Tap-to-block ad-hoc unavailability on the schedule calendar

- Profile: React Frontend
- Timestamp: 2026-08-22T14:35:00.000Z
- DoD status: pass

## [ARCHITECT OUTPUT]

### 1) Scope & Assumptions

- Frontend-only, confirmed: `GET`/`POST /admin/availability-exceptions` and `DELETE /admin/availability-exceptions/:id` exist, validated (`date` YYYY-MM-DD, `type` "blocked"|"open", strict `HH:MM:SS`, `end_time > start_time`), gated by the same auth/rate-limit as everything else. No uniqueness constraint on `(provider_id, date)` — multiple exception rows per date are allowed at the DB level.
- Confirmed via `subtractIntervals` that a `00:00:00`-`23:59:59` blocked row safely clips any base interval regardless of that day's configured hours.
- Scope is `type: "blocked"` exceptions only -- `type: "open"` is a distinct, out-of-scope feature.

**Concrete technical finding that changed the approach**: checked which `react-big-calendar` components implement `backgroundEvents` -- only `Day.js`/`Week.js`/`DayColumn.js`/`TimeGrid.js`. `Month.js` has no `backgroundEvents` support at all, and Month view needs blocked days to be both visually distinct and tappable. Recommendation: render blocked exceptions as regular `events` (discriminated by a `kind` field), styled via `eventPropGetter`. This gets Month/Week/Day rendering and tap-to-unblock disambiguation (event click vs. empty-slot click) for free from `react-big-calendar`'s existing `selectable`+`events` behavior.

- Local-date/time extraction, never `.toISOString()` -- same bug class the backend's own `toIsoDateString()` helper exists to avoid.
- Cross-midnight day/week-view drags are rejected client-side, not silently clipped.
- Exceptions fetched lazily, only once Manage mode is entered -- View mode's network behavior stays identical to task 018.

### 2) Two Decisions Flagged for Approval

1. **"Block a week" via month-view drag only**, not a separate "block this week" button in week view -- one code path (`slotInfo.slots` from a month-view drag maps directly onto "one POST per date").
2. **Immediate tap-to-unblock, no confirm step** -- matches how "block" itself works (tap → immediate `POST`) and how `confirmBooking` already behaves elsewhere in this app; trivially reversible either direction.

User approved both, plus one addition: the batch-result summary must distinguish three outcomes per date (newly blocked / already blocked / failed), never folding "already blocked" into either the success or failure count.

### 3-7) File impact, implementation plan, test strategy, CIA, dependency decision

No new dependency. Full plan: extend `AdminCalendar.tsx` with a `mode: "view" | "manage"` toggle, a discriminated `CalendarEvent` union (`booking` | `exception`), lazy exception fetch, `selectable`/`onSelectSlot` gated to manage mode, sequential (not parallel) multi-date batch-create with the three-way outcome tracking, and immediate unblock-on-tap. See conversation for full detail; unchanged from what was approved.

---

## [IMPLEMENTER OUTPUT]

Extended `frontend/src/api/types.ts`/`client.ts` with `AvailabilityException` CRUD (mirroring the exact pattern from task 019's `AvailabilityRule` CRUD).

Refactored `AdminCalendar.tsx` significantly:
- **Discriminated `CalendarEvent` union** (`kind: "booking" | "exception"`), merged into one `events` array. `eventPropGetter` and `onSelectEvent` branch on `event.kind`; booking-kind behavior is byte-for-byte identical to task 018.
- **Extracted pure, exported functions** for direct unit-testability, since `react-big-calendar`'s drag-select relies on `getBoundingClientRect` pixel math jsdom can't simulate reliably (plain event clicks work fine in jsdom, as task 018 already proved -- only the slot-selection gesture itself needed this treatment):
  - `toLocalDateString`/`toLocalTimeString` -- local calendar-date/time extraction, never `.toISOString()`.
  - `planSlotBlock(slotInfo, view)` -- pure decision: month view → full-day block per date in `slots`; day/week view → one time-range block, or a cross-midnight rejection.
  - `runBatchBlock(dates, timeRange, knownExceptions)` -- sequential (not `Promise.all`) batch-create against the real API, classifying each date as newly-blocked / already-blocked (dedup only applies to full-day blocks, never to sub-day ranges, since overlapping sub-day blocks like a lunch break are legitimate) / failed; stops early and reports `unauthorized: true` on a 401.
  - `formatBatchResult(result)` -- exact phrasing per the user's explicit addition, e.g. `"Blocked 5 new days (2 were already blocked)"`, with failures appended separately, never folded into either count.
- Mode toggle clears transient manage-mode state (`batchResult`/`slotError`/`unblockError`) on switching back to View, but not the cached exceptions/load-error state (so a failed load retries automatically on re-entering Manage mode via a ref-guarded retry).
- CSS: proactively reapplied the `.rbc-event.rbc-selected` specificity fix from task 018's caught bug to the new `.admin-calendar-event-blocked` class, before it could bite the same way (verified during Release-stage manual testing).

No migration/compat notes -- additive only, zero backend changes (confirmed via empty `git diff --porcelain -- backend/`).

---

## [REVIEWER OUTPUT]

**Review summary**: Backend untouched. View-mode regression bar holds fully -- all 5 pre-existing tests pass unmodified. Three-way batch outcome tracking correctly never folds "already blocked" into either other count, matches the required phrasing exactly.

**Required fixes**: None.

**Suggested improvements (nice-to-have, not blocking)**:
1. No guard against a second slot-selection starting while a previous batch is still in flight -- two rapid overlapping drags could each independently decide to create a full-day block for the same date (stale `exceptions` snapshot). Impact is a harmless duplicate row (no uniqueness constraint), not data corruption -- not worth the added state for v1.
2. The actual tap/drag-to-**create** gesture isn't exercised end-to-end in jsdom (compensated by 18 pure-function tests + a planned manual/Playwright verification at Release, same pattern as tasks 018/019) -- flagged explicitly as a known test boundary, not silently assumed covered.

---

## [SECURITY OUTPUT]

CIA: Confidentiality None, Integrity Low-Medium (first bulk-mutation UI flow, but every write goes through the same already-reviewed endpoint; dedup verified to prevent redundant rows), Availability Low (rate-limit interaction handled gracefully, verified via the mid-batch-401 test). No new input surface, no new authz decision. Zero new dependencies, `npm audit` 0 vulnerabilities (frontend); backend's pre-existing accepted exception untouched.

**Merge Decision: Approved.**

---

## [RELEASE OUTPUT]

### DoD Checklist -- all items pass. Backend confirmed zero-diff and fully green (216/216 tests). Frontend fully green (69/69 tests: 5 original AdminCalendar tests unmodified + 18 new pure-function tests + 5 new component tests), typecheck/lint/build clean, 0 audit vulnerabilities.

### What the manual verification found
The mobile/tap-target check initially surfaced what looked like a real bug: dragging in month view appeared to drop the drag's origin cell, and a plain tap appeared to do nothing. Root-caused via a temporary debug patch to the `react-big-calendar` source (in `node_modules`, gitignored, fully reverted -- confirmed via `diff` against a backup before restarting the dev server): the test script was clicking `.rbc-button-link` (the date-*number* link, which drills into Day view and clears any pending selection) instead of `.rbc-day-bg` (the actual selectable background area). Once retargeted at the correct element, single-tap, multi-day drag with dedup-skip of an already-blocked date, and the exact required batch-result phrasing all worked correctly on the first try -- **no code changes were needed**; the implementation was correct, the initial test methodology wasn't. This is worth remembering if this UI ever gets an accessibility/UX pass -- a real masseur tapping near the visible date number rather than elsewhere in the cell would hit the same drill-down-instead-of-select behavior.

### Acceptance Criteria -- all 9 met, including real-browser verification (not just jsdom) of: single-tap full-day block, multi-day drag with correct dedup and per-date reporting, tap-to-unblock, and no horizontal overflow or tap-target issues at 375px.

### Files Changed
`frontend/src/api/types.ts`, `frontend/src/api/client.ts`, `frontend/src/pages/AdminCalendar.tsx`, `frontend/src/pages/AdminCalendar.css`, `frontend/test/AdminCalendar.test.tsx`. Backend: none.

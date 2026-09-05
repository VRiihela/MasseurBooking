# Run Report: 033-hide-past-bookings-by-default

**Title:** Hide past bookings by default in the admin List view, with a toggle to reveal them
**Profile:** React Frontend
**Timestamp:** 2026-09-05T20:35:00.000Z
**DoD status:** pass

---

## [ARCHITECT OUTPUT]

### Scope & assumptions

Purely client-side filtering over the array already returned by the existing authenticated `GET /admin/bookings` call in `AdminDashboard.tsx` — no backend/API change, no new fetch volume, no pagination or date-range query param (explicitly out of scope per the task spec).

**Pre-existing state found before starting:** the working tree already contained an uncommitted, apparently-complete implementation of this feature in `AdminDashboard.tsx` (a `showPast` state, an `isPast`/`visibleBookings`/`hasHiddenPastBookings` derivation, the toggle button, and the empty-state hint), plus new fixtures (`PAST_BOOKING`, `IN_PROGRESS_BOOKING`, a `NOW` constant) added to `AdminDashboard.test.tsx` — but no actual new test cases exercising them, and no fake-timer wiring (`vi.useFakeTimers`/`setSystemTime`) to make `NOW` meaningful. Two stale, unrelated leftovers from the same interrupted session were also found: a stray `.git/index.lock` / `.git/HEAD.lock` (no live git process was holding either — removed before commit) and two untracked scratch files (`scratch_delete_test.txt`, `backend/vitest.config.ts.timestamp-*.mjs`) that don't belong to this task and were left untouched. Rather than redo working code, this run reviewed the existing implementation against the task spec, found it correct, and completed the missing test coverage.

### File impact list
- `frontend/src/pages/AdminDashboard.tsx` (already modified — reviewed, no changes needed)
- `frontend/test/AdminDashboard.test.tsx` (fixtures present — added fake-timer setup and 4 new test cases)
- `agents/tasks/033-hide-past-bookings-by-default.json` (new, provided)

### Implementation plan (as found / verified)
- `showPast` boolean state, default `false`, independent of `statusFilter`.
- `isPast(booking)` compares raw `booking.end_at` (never `end_at_local`) against `Date.now()` — a booking is "past" only once **fully ended**, so an in-progress booking (started, not yet ended) is never hidden.
- `visibleBookings = bookings?.filter(b => showPast || !isPast(b))` — purely derived, no extra state to keep in sync.
- Toggle button follows the existing `aria-pressed` pattern (same as `viewMode`/`statusFilter` buttons), labelled "Näytä menneet varaukset" / "Piilota menneet varaukset".
- Empty-state hint: when `visibleBookings` is empty *and* past bookings exist under the current filter (`hasHiddenPastBookings`), show a distinct message pointing at the toggle, instead of (or in addition to) the generic "Ei varauksia tässä näkymässä." — verified the two messages are mutually exclusive (the generic one only fires when `bookings.length === 0`, which implies no past bookings exist to hint about either).
- `statusFilter` and `showPast` are independent React state — switching one never resets or reads the other, so they compose for free with no extra wiring.

### Validation strategy
N/A (no server-side input; display-only client filtering over data already fetched via the existing authenticated endpoint).

### Test strategy
Cover the 4 acceptance-criteria behaviors directly (default-hidden, toggle-reveals, compose-with-status-filter, in-progress-never-hidden), plus the empty-state hint. Reuse the `AdminCalendar.test.tsx` precedent of faking only `Date` (not `setTimeout`) via `vi.useFakeTimers({ toFake: ["Date"] })`, since faking timers wholesale deadlocks `findBy*`/`waitFor` (they poll via real timers). Run the full existing suite unchanged to catch regressions — verified beforehand that faking `Date` at `NOW = 2026-08-01` doesn't affect any pre-existing test, since all pre-existing fixtures (`PENDING_BOOKING`/`CONFIRMED_BOOKING`) end on 2026-08-10, after `NOW`.

### CIA impact
- Confidentiality: None — no new data exposure; past bookings are already sent to the client today, only rendering changes.
- Integrity: None — no mutation logic touched (Confirm/Decline/Cancel handlers untouched).
- Availability: None — no new network calls, no additional fetch volume.

### Dependency decision
No new dependency needed. Uses built-in `Date`/`Array.filter` and Vitest's existing fake-timer API.

*(No new discretionary decision surfaced beyond what the task spec already resolved — proceeded directly.)*

---

## [IMPLEMENTER OUTPUT]

- **`frontend/src/pages/AdminDashboard.tsx`** — reviewed the already-present implementation line-by-line against the task spec; matched exactly (raw `end_at` comparison, independent `showPast` state, `aria-pressed` toggle, composing empty-state hint). No code changes required here.
- **`frontend/test/AdminDashboard.test.tsx`**:
  - Added `beforeEach`/`afterEach` fake-timer wiring (`vi.useFakeTimers({ toFake: ["Date"] })` + `vi.setSystemTime(NOW)` / `vi.useRealTimers()`), matching the `AdminCalendar.test.tsx` precedent — needed since the pre-existing `NOW` constant and past/in-progress fixtures had no timer wiring to make "now" actually mean anything.
  - Imported `FILTER_LABELS_FI` from `../src/lib/statusLabels` to address the status-filter button by its real Finnish label rather than a hardcoded string.
  - Added 4 new test cases (see Tester section).

### Tricky parts
- The empty-state hint test needed care to assert both messages are mutually exclusive (the generic "no bookings at all" message vs. the "past bookings are hidden" hint), matching the Architect's documented reasoning.
- The compose-with-status-filter test relies on the existing `stubFetch` mock ignoring the `status` query param (it always returns the stubbed array regardless of filter) — the same pattern already used by the pre-existing "shows Cancel booking only for a confirmed booking" test, so no new mocking approach was introduced.

No migration/compat notes — purely additive, no existing behavior changed for callers.

---

## [REVIEWER OUTPUT]

Checked against the pre-existing implementation:
- `isPast` correctly uses `end_at` (raw ISO), never `end_at_local` — confirmed via the in-progress fixture (`start_at` in the past, `end_at` in the future) staying visible.
- `showPast` and `statusFilter` are fully independent `useState` calls with no cross-dependency in the `useEffect` fetch — switching `statusFilter` cannot silently reset `showPast`.
- The two empty-state messages (`bookings?.length === 0` vs. `visibleBookings?.length === 0 && hasHiddenPastBookings`) are mutually exclusive by construction, so no risk of both rendering at once or of a confusing generic message masking the hint.
- Toggle button follows the exact same `btn-primary`/`btn-secondary` + `aria-pressed` pattern as `viewMode`/`statusFilter` buttons — no new UI pattern introduced.
- No status/mutation comparison logic (`booking.status === "pending"`, etc.) touched — only the rendered list and an added derived array.
- No new `any`, no weakened types, explicit boolean/array types throughout.

**Required fixes (blockers):** none.
**Suggested improvements (nice-to-have):** none — the existing implementation and now-completed tests match the task spec cleanly.

---

## [TESTER OUTPUT]

### New test cases (added to `AdminDashboard.test.tsx`)
1. **"hides past bookings by default and reveals them via the toggle"** — renders with a pending (upcoming) + a past booking; asserts the past one is absent and the toggle reads "Näytä menneet varaukset" with `aria-pressed=false`; clicks it, asserts the past booking appears and the button now reads "Piilota menneet varaukset" with `aria-pressed=true`; clicks again, asserts it's hidden again.
2. **"never hides a booking that is in progress, even though it started in the past"** — renders a booking with `start_at` in the past and `end_at` in the future; asserts it's visible by default (showPast off).
3. **"shows a hint that past bookings are hidden when every matching booking is past"** — renders with only a past booking; asserts the specific hint text appears and the generic "no bookings" message does not; toggles past bookings on, asserts the hint disappears once the booking is shown.
4. **"keeps the past-bookings toggle on when the status filter changes"** — renders with a confirmed + a past booking, toggles `showPast` on, switches the status filter to "Vahvistettu" (confirmed), and asserts both bookings are still visible and the toggle is still pressed — i.e. `showPast` isn't reset by a `statusFilter` change.

### Full suite run
```
cd frontend && npx vitest run test/AdminDashboard.test.tsx
✓ test/AdminDashboard.test.tsx (19 tests) 407ms

npm test
✓ test/AdminLoginRequest.test.tsx (3 tests)
✓ test/AdminLoginCallback.test.tsx (3 tests)
✓ test/BookingWidget.test.tsx (8 tests)
✓ test/ManageBooking.test.tsx (11 tests)
✓ test/AdminAvailability.test.tsx (8 tests)
✓ test/AdminServices.test.tsx (14 tests)
✓ test/AdminDashboard.test.tsx (19 tests)
✓ test/AdminCalendar.test.tsx (37 tests)
Test Files  8 passed (8)
     Tests  103 passed (103)
```
No regressions to status filtering, Confirm/Decline/Cancel actions, or view-mode switching — all pre-existing `AdminDashboard` tests (15) pass unchanged alongside the 4 new ones.

### How to run tests
`cd frontend && npm test` (or `npx vitest run test/AdminDashboard.test.tsx` for just this file).

---

## [SECURITY OUTPUT]

### 1) CIA Impact
- Confidentiality: None — no new data exposure; past bookings were already returned by the authenticated `GET /admin/bookings` endpoint today, only rendering is now filtered client-side.
- Integrity: None — no mutation/status-comparison logic changed.
- Availability: None — no new network calls or fetch volume.

### 2) OWASP-style Checks
- Input validation & injection risks: N/A — no new external input; `end_at` is server-supplied data already trusted and rendered elsewhere in this same list.
- AuthN/AuthZ correctness: unaffected — same authenticated endpoint, same session-token flow, same 401 → `onSessionEnded()` handling.
- Sensitive data exposure: unaffected — this changes what's *hidden by default in the UI*, not what data is fetched or could be revealed by toggling; a masseur with access to the list already had access to all of it.
- Security misconfiguration: N/A.
- Logging & monitoring gaps: N/A — no logging added or removed.

### 3) Dependency & Supply Chain Review
No new dependencies added. `npm audit --audit-level=high` not re-run since no `package.json`/lockfile changes occurred; the last dependency state is unchanged from task 031/032.

### 4) Threat Mini-Model
- Assets: booking history (customer name/email/phone, service, timing) — already fetched, no change.
- Entry points: none new — same `GET /admin/bookings` call, same session auth.
- Threats: none introduced by this change.
- Mitigations: N/A.

### 5) Risk Summary
- Severity: Low (display-only change).
- Required mitigations before merge: none.
- Follow-ups (optional): none.

### 6) Secure SDLC Phase
- Phase affected: Implementation / Testing.
- Re-review required after mitigation: No.

### Merge Decision
- Approved for merge: **Yes**.

---

## [RELEASE OUTPUT]

### DoD Checklist

| Gate | Status |
|---|---|
| Acceptance criteria met (past-hidden-by-default, toggle reveals, composes with statusFilter, in-progress never hidden, Finnish UI text, new + full existing test coverage, npm test/build/lint/tsc all pass) | ✅ |
| Edge cases considered | ✅ empty upcoming with past-hidden hint, in-progress boundary (`start_at` past, `end_at` future), toggle state surviving a statusFilter change |
| No breaking changes | ✅ purely additive client-side filter, no API contract change |
| TS strict / no unnecessary `any` | ✅ |
| Follows conventions | ✅ |
| Lint & formatting | ✅ `npm run lint` clean |
| No dead code / debug logs | ✅ |
| New/changed behavior has tests | ✅ 4 new tests |
| Negative tests | N/A — no failure-path/validation logic added (pure client-side display filter) |
| Tests pass locally | ✅ 103/103 (`npm test`) |
| Input validation | N/A — no new external input |
| AuthN/AuthZ | N/A — unaffected |
| Secrets not committed | ✅ |
| No new dependency / audit | ✅ none added |
| README/docs updated if behavior changes | N/A — no README references this view's filtering behavior |

**DoD status: PASS**

### Deviations from the approved plan
None from the task spec itself. The one deviation from a typical run: the implementation code in `AdminDashboard.tsx` was found already written and uncommitted at the start of this run (from an apparently interrupted prior session), along with partial test fixtures and two stale `.git` lock files. This run verified the existing code against the task spec instead of re-implementing it, and completed the missing test cases and fake-timer wiring. The stale lock files were removed (no live git process was holding either); two unrelated stray files (`scratch_delete_test.txt`, `backend/vitest.config.ts.timestamp-*.mjs`) were left untouched as out of scope for this task.

### How to Verify
1. `cd frontend && npm test && npm run build && npm run lint && npx tsc --noEmit`
2. `npm run dev`, open `/admin`, log in, go to the List view:
   - Confirm only upcoming/in-progress bookings show by default.
   - Click "Näytä menneet varaukset" — past bookings appear, button switches to "Piilota menneet varaukset" (`aria-pressed=true`).
   - Switch the status filter while the toggle is on — past+upcoming bookings for the new filter show without needing to re-toggle.
   - If a masseur's history is entirely past under a given filter with the toggle off, confirm the "Ei tulevia varauksia. Menneet varaukset on piilotettu…" hint appears instead of the generic empty-state message.

### Release Checklist
- [x] All DoD gates pass
- [x] Committed (`8d226f4`) and pushed per task instructions

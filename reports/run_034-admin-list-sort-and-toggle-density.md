# Run Report: 034-admin-list-sort-and-toggle-density

**Title:** Admin List view: add newest/oldest sort control, and de-emphasize the past-bookings toggle to reduce button density
**Profile:** React Frontend
**Timestamp:** 2026-09-06T11:25:00.000Z
**DoD status:** pass

---

## [ARCHITECT OUTPUT]

### Scope & assumptions

Purely client-side, over the array already returned by the existing authenticated `GET /admin/bookings` call — no backend change, matching task 033's precedent exactly. Two independent changes to `AdminDashboard.tsx`'s List-view filter section:

1. **Sort** — a new boolean-flavored toggle (not a dropdown/select) that flips the already-filtered, already-composed list between ascending (`start_at`, current default/effective order) and descending.
2. **Density** — extract a new lightweight `.btn-text` CSS class and move task 033's `showPast` toggle onto it, then also use it for the new sort control so this doesn't reintroduce a second full-size pill button.

Assumption carried over from task 033 and re-confirmed by the task spec: `start_at`/`end_at` raw ISO fields are the only sortable/comparable fields on `AdminBooking`; `*_local` strings are formatted display text, never parsed.

### File impact list
- `frontend/src/pages/AdminDashboard.tsx` — new `sortNewestFirst` state, a derived sorted array, the new sort-control button, restyle the `showPast` button.
- `frontend/src/styles/base.css` — new `.btn-text` class (+ a pressed-state variant).
- `frontend/test/AdminDashboard.test.tsx` — new sort tests, composition tests; verified no existing test asserts on the `showPast` button's `className` (grepped — none do, only `aria-pressed` and accessible name), so no assertion updates are forced by the restyle itself.

### Implementation plan
1. Add `const [sortNewestFirst, setSortNewestFirst] = useState(false);` — a boolean, not a 3-way/enum, deliberately mirroring `showPast`'s exact shape: `false` is always "the current effective/default order," so nothing changes until the masseur touches it.
2. Derive the sort as the last step in the pipeline, after both existing filters: `statusFilter` (server-side) → `showPast`/`isPast` (client-side, → `visibleBookings`) → **new**: sort `visibleBookings` by `start_at`, direction per `sortNewestFirst`. This ordering is what makes "sort composes with both statusFilter and showPast" free — sort operates on whatever `visibleBookings` already resolved to.
3. `sortedBookings = visibleBookings ? [...visibleBookings].sort((a, b) => { const diff = new Date(a.start_at).getTime() - new Date(b.start_at).getTime(); return sortNewestFirst ? -diff : diff; }) : null;` — copies before sorting (no in-place mutation of state), compares raw `start_at`, never `*_local`.
4. Render `sortedBookings?.map(...)` in place of `visibleBookings?.map(...)`; leave both empty-state checks reading `bookings`/`visibleBookings` unchanged — sorting doesn't change which array is empty.
5. New sort-control button, placed directly after the `showPast` toggle: `aria-pressed={sortNewestFirst}`, `onClick` flips it, className `btn-text`. Label follows the same action-describes-the-flip convention already established by `showPast`: default/ascending reads **"Näytä uusimmat ensin"**; active/descending reads **"Näytä vanhimmat ensin"**.
6. New `.btn-text` class in `base.css`: no border, no background, `color: var(--color-text-muted)`, `font-size: var(--font-size-sm)`, underlined, small padding (deliberately no 44px min-height — these are secondary, low-emphasis controls). `.btn-text[aria-pressed="true"]` → `color: var(--color-text)` (darker text only) so an active toggle reads as "on" without approaching pill-button weight.
7. Change the `showPast` button's `className` from `` `btn ${showPast ? "btn-primary" : "btn-secondary"}` `` to plain `"btn-text"` — no other prop changes.
8. No change to `STATUS_FILTERS`/`FILTER_LABELS_FI` pill buttons — task explicitly scopes the density fix to `showPast` and the new sort control only.

### Validation strategy
N/A — no server-side input; display-order/display-style only over data already fetched via the existing authenticated endpoint.

### Test strategy
- Default order + toggle flip (proves "default = current effective order").
- Composes with `statusFilter` (sort direction survives a filter-triggered refetch).
- Composes with `showPast` (sort operates over the full past+upcoming composed set, not just one subset).
- Full regression run of the existing suite, notably task 033's tests (unaffected by a className-only restyle).

### CIA impact
None across Confidentiality/Integrity/Availability — no new data exposure, no mutation logic touched (sort is a pure derived render-order transform, never written back into `bookings` state), no new network calls.

### Dependency decision
No new dependency. Native `Array.prototype.sort` + a plain CSS class.

### Discretionary calls (surfaced, not blocking)
- Boolean `sortNewestFirst`, not a tri-state/enum — matches `showPast`'s shape.
- Sort control placed after `showPast` — matches the data-pipeline order (filter → past/upcoming → sort).
- Action-describing label convention, matching `showPast` exactly rather than a second labeling style in the same row.
- `.btn-text[aria-pressed="true"]` — color-only distinction, smallest delta that still reads as "on."

*(Ville reviewed and approved all four discretionary calls unchanged before Implementer proceeded.)*

---

## [IMPLEMENTER OUTPUT]

- **`frontend/src/pages/AdminDashboard.tsx`**:
  - Added `const [sortNewestFirst, setSortNewestFirst] = useState(false);` alongside `showPast`.
  - Added `sortedBookings`, derived from `visibleBookings` via a copy-then-`.sort()` on raw `start_at`, direction gated by `sortNewestFirst`.
  - Added the new compact sort-control button (`.btn-text`, `aria-pressed={sortNewestFirst}`) directly after the existing `showPast` toggle in `<section aria-label="Suodata varauksia">`.
  - Restyled the `showPast` button's `className` to plain `"btn-text"` (all other props — `aria-pressed`, `onClick`, both Finnish labels — unchanged).
  - Changed the list's `.map()` source from `visibleBookings` to `sortedBookings`; both empty-state checks (`bookings?.length === 0`, `visibleBookings?.length === 0 && hasHiddenPastBookings`) left untouched, still correct.
- **`frontend/src/styles/base.css`** — new `.btn-text` class and `.btn-text[aria-pressed="true"]` variant, inserted before the `.btn-block` rule, with an in-code comment explaining the color-only active-state choice.
- **`frontend/test/AdminDashboard.test.tsx`**:
  - Added an `EARLIER_BOOKING` fixture (upcoming, but earlier than all prior fixtures, which previously all shared one `start_at` — needed to give the sort tests two bookings with genuinely distinct dates).
  - Added a `visibleBookingOrder()` helper reading rendered `data-testid`s via `screen.getAllByTestId(/^booking-/)`, for order assertions.
  - Added 3 new test cases (see Tester section).

### Tricky parts
- All pre-existing booking fixtures shared a single `start_at`, which would have made a sort-order assertion trivially pass regardless of whether sorting actually worked (stable-sort no-op on equal keys). The new `EARLIER_BOOKING` fixture was added specifically so the default-order assertion is a genuine proof, not an accident of fixture reuse.
- Verified via grep that no existing test asserts on the `showPast` button's `className` (only `aria-pressed`/accessible name) before treating the restyle as test-safe — it was, no assertion updates were forced by it.

No migration/compat notes — purely additive/restyle, no existing behavior changed for callers.

---

## [REVIEWER OUTPUT]

- `sortedBookings` is derived purely from `visibleBookings` (already-filtered by `statusFilter`+`showPast`), copied via spread before `.sort()` — no in-place mutation of `bookings` state, no risk of the sort affecting `applyBookingUpdate`'s in-place status patches.
- `isPast`/`visibleBookings`/`hasHiddenPastBookings` untouched — both empty-state conditions still read the correct pre-sort arrays.
- `start_at` (raw ISO) compared via `new Date(...).getTime()`, never `start_at_local`/`end_at_local`.
- `showPast` button restyle is `className`-only; `aria-pressed`, `onClick`, and both Finnish labels byte-for-byte unchanged from task 033.
- `.btn-text` deliberately omits the 44px min-height (unlike `.btn`) — a correct, intentional choice for a secondary control; the primary action buttons (Vahvista/Hylkää/Peru/status filters) keep full tap targets.
- Grepped `frontend/src` for other consumers of the old `showPast` className pairing or the new `.btn-text` class — none found beyond the two intended usages; restyle fully contained.
- No new `any`, no weakened types, explicit boolean state throughout.

**Required fixes (blockers):** none.
**Suggested improvements (nice-to-have):** none.

---

## [TESTER OUTPUT]

### New test cases
1. **"sorts the list oldest-first by default and flips to newest-first via the sort toggle"** — asserts default DOM order is oldest-first via `visibleBookingOrder()`, toggling flips both the DOM order and the button's label/`aria-pressed`, toggling back restores the original order.
2. **"keeps the sort direction when the status filter changes"** — sets sort to newest-first, switches the status filter (triggering a refetch via the existing `useEffect` dependency), asserts sort direction and label/`aria-pressed` survive the change.
3. **"sorts across the full showPast-composed set, including a past booking"** — reveals past bookings, asserts default order is past-then-upcoming, flips to newest-first, asserts the past booking now sorts after the upcoming one — proving the sort operates over the full composed past+upcoming set.

### Full suite run
```
cd frontend && npx vitest run test/AdminDashboard.test.tsx
✓ test/AdminDashboard.test.tsx (22 tests) 446ms

npm test
✓ test/AdminLoginRequest.test.tsx (3 tests)
✓ test/AdminLoginCallback.test.tsx (3 tests)
✓ test/BookingWidget.test.tsx (8 tests)
✓ test/AdminAvailability.test.tsx (8 tests)
✓ test/ManageBooking.test.tsx (11 tests)
✓ test/AdminServices.test.tsx (14 tests)
✓ test/AdminDashboard.test.tsx (22 tests)
✓ test/AdminCalendar.test.tsx (37 tests)
Test Files  8 passed (8)
     Tests  106 passed (106)
```
No regressions: all of task 033's existing tests (past-hidden-by-default, toggle reveal, empty-state hint, toggle-survives-filter-change) pass unchanged, alongside all Confirm/Decline/Cancel and view-mode tests.

### How to run tests
`cd frontend && npm test` (or `npx vitest run test/AdminDashboard.test.tsx` for just this file).

---

## [SECURITY OUTPUT]

### 1) CIA Impact
- Confidentiality: None — no new data exposure.
- Integrity: None — no mutation logic touched; sort is a pure derived render-order transform, discarded and recomputed each render.
- Availability: None — no new network calls.

### 2) OWASP-style Checks
No new external input, AuthN/AuthZ unaffected (same authenticated endpoint, same session-token flow), no sensitive-data exposure change, no misconfiguration, no logging change.

### 3) Dependency & Supply Chain Review
No new dependencies added.

### 4) Threat Mini-Model
- Assets: booking list data — already fetched, no change.
- Entry points: none new.
- Threats: none introduced.
- Mitigations: N/A.

### 5) Risk Summary
- Severity: Low (display-only change).
- Required mitigations before merge: none.
- Follow-ups: none.

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
| Acceptance criteria met (sort control, default=unchanged order, composes with statusFilter + showPast, raw `start_at` only, showPast keeps exact behavior/labels/aria-pressed but restyled, sort control compact, new + updated tests, full suite green, build/lint/tsc pass) | ✅ |
| Edge cases considered | ✅ default order verified explicitly, sort persisting across a statusFilter refetch, sort operating over the full past+upcoming composed set |
| No breaking changes | ✅ purely additive/restyle, no API contract change |
| TS strict / no unnecessary `any` | ✅ |
| Follows conventions | ✅ |
| Lint & formatting | ✅ `npm run lint` clean |
| No dead code / debug logs | ✅ |
| New/changed behavior has tests | ✅ 3 new tests |
| Negative tests | N/A — no new external input/validation logic |
| Tests pass locally | ✅ 106/106 |
| Input validation | N/A |
| AuthN/AuthZ | N/A — unaffected |
| Secrets not committed | ✅ |
| No new dependency / audit | ✅ none added |
| README/docs updated if behavior changes | N/A |

**DoD status: PASS**

### Deviations from the approved plan
None. All four discretionary calls from the Architect stage were applied exactly as approved (boolean `sortNewestFirst`, sort control placed after `showPast`, action-describing label convention, color-only `.btn-text[aria-pressed="true"]`).

### How to Verify
1. `cd frontend && npm test && npm run build && npm run lint && npx tsc --noEmit`
2. `npm run dev`, open `/admin` → List view: confirm the past-bookings toggle and new sort toggle render as small underlined text (not pill buttons); confirm sort flips list order and its label; confirm both new controls compose with the status filter and each other.

### Release Checklist
- [x] All DoD gates pass
- [x] Committed and pushed per explicit user instruction (Architect plan reviewed and approved by Ville before Implementer proceeded; RELEASE report reviewed before push)

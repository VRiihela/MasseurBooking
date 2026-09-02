# Run Report: 028-calendar-week-number-jump

**Title:** Add clickable week numbers to the calendar's month view (jump to week view, matching existing date-to-day drill-down)
**Profile:** React Frontend
**Timestamp:** 2026-09-02T00:00:00.000Z
**DoD status:** pass

---

## [ARCHITECT OUTPUT]

### Investigation summary (confirms/corrects the task's assumptions)

Read `Month.js`, `DateContentRow.js`, `BackgroundCells.js`, `DateHeader.js`, and the `luxon` localizer source directly (not just the `.d.ts`).

- **`dateCellWrapper` is the wrong extension point, confirmed.** It's consumed only in `BackgroundCells.js` — the invisible, absolutely-positioned slot-selection layer used for drag-to-select. It never touches the visible date-number row.
- **The real per-cell extension point is `components.month.dateHeader`.** In `Month.js`, `renderWeek` builds each row's 7-date `range` and calls `readerDateHeading` once per date, which renders a wrapping `div` (carries `rbc-off-range`/`rbc-current` classes, `role="cell"`) containing `<DateHeaderComponent label date drilldownView isOffRange onDrillDown />`. Overriding `components.month.dateHeader` replaces only the inner component — the wrapper div, off-range styling, and surrounding row/grid layout are untouched, and `DateContentRow`'s event-positioning math never sees `dateHeader` at all.
- **No need to touch `onDrillDown`/`drilldownView` on `<Calendar>`.** `Month.js` already drives date→Day drilldown internally by calling the top-level `onDrillDown` prop (library default). A custom `dateHeader` component can close over `setView`/`setDate` (already in scope in `AdminCalendar`) to implement the week-jump directly, alongside a faithful reproduction of the default date-click behavior. Nothing about the existing gesture changes.
- **Row start-of-week is confirmed Sunday.** `luxonLocalizer(DateTime)` is called with no options, and the localizer's default `firstDayOfWeek` is `7` (Sunday) — verified in `localizers/luxon.js`. So `range[0]` (the first cell of every Month-view row) is always Sunday; `date.getDay() === 0` reliably identifies "first cell in this row."
- **Genuine bug the task didn't anticipate: Sunday-start rows vs. Monday-start ISO weeks don't align.** A row is `[Sun, Mon, Tue, Wed, Thu, Fri, Sat]`. ISO weeks run Monday→Sunday. The row's leading Sunday belongs to the **previous** ISO week while the other 6 days in the same row belong to the **next** ISO week (e.g. Sun Aug 30 2026 = ISO week 35; Mon Aug 31–Sat Sep 5, same row, = ISO week 36 — verified with Luxon directly).
  - **Resolution:** compute the label from `range[1]` (the row's Monday), not `range[0]`, since ISO week number is unambiguous when read from a Monday. Render the badge in the Sunday cell (`range[0]`) but *label* it with `range[1]`'s week number.
  - **Click target:** navigate to `range[0]` (the row's own Sunday). Since this app's Week view is also Sunday-start (same localizer config), Week view renders exactly the same 7 dates the user just saw in that row — no surprise date shift.

### Plan
1. `frontend/src/pages/AdminCalendar.tsx` — add a `dateHeader` component (via `components={{ month: { dateHeader } }}`) that reproduces the library's default rendering, plus a sibling week-number button on each row's Sunday cell.
2. `frontend/src/pages/AdminCalendar.css` — small, clearly distinct pill styling for the badge.
3. `frontend/test/AdminCalendar.test.tsx` — coverage for badge presence/labelling, click→Week-view navigation, existing date→Day-view drilldown unchanged, full suite must still pass.

### CIA impact
None. No new data, no new API/network calls, purely client-side view-state navigation.

### Dependency decision
No new dependency. Uses Luxon (already a direct dependency) and `react-big-calendar`'s existing, already-typed `components.month.dateHeader` extension point.

### Risks
- Off-range Sundays still get a badge (correct/desired, but worth a visual check).
- Two clickable elements now share the narrow Sunday cell at phone width — needs explicit narrow-viewport verification, not just desktop.
- Year-boundary ISO weeks (52/53/1) are the classic off-by-one trap for hand-rolled week logic — Luxon handles it correctly given a Monday anchor, but worth an explicit test case.

*(Approved by the user before proceeding to Implementer.)*

---

## [IMPLEMENTER OUTPUT]

**`frontend/src/pages/AdminCalendar.tsx`**
- Added `isoWeekNumberForRow(rowStartSunday: Date): number` — a pure, exported helper computing the ISO week number from the row's Monday (`rowStartSunday` + 1 day), not its Sunday, per the Architect's resolution of the Sunday/ISO-week mismatch.
- Added `makeDateHeaderComponent(onJumpToWeek)`, a factory returning a `dateHeader` component that reproduces `react-big-calendar`'s default `DateHeader.js` rendering exactly (preserving the existing date→Day-view drilldown untouched), then adds a sibling week-number `<button>` only on each row's leading Sunday cell (`date.getDay() === 0`).
- Wired in via `components={{ month: { dateHeader: dateHeaderComponent } }}` — confirmed from `Calendar.js` (`components[view] || {}`) that `dateHeader` must be nested under `month`, not top-level (`tsc` caught the first, top-level-only attempt immediately).
- `dateHeaderComponent` is `useMemo`'d off `[setDate, setView]` (stable React setters) so its identity — and the subtree it renders — isn't torn down and remounted every parent re-render.
- No changes to `onDrillDown`, `drilldownView`, `onNavigate`, `onView`, `selectable`, or `onSelectSlot` — purely additive.

**`frontend/src/pages/AdminCalendar.css`**
- Added `.admin-calendar-week-number`: a small pill (rounded, muted background/text) visually distinct from `rbc-button-link`'s plain-text date number.

**`frontend/test/AdminCalendar.test.tsx`**
- Added `describe("AdminCalendar Month-view week numbers", ...)`: row count/labelling (`31..36` for Aug 2026, confirming the Monday-anchored math rather than a naive `30..35`), distinctness from the date button, click→Week-view navigation landing on the exact clicked row, existing date→Day-view drilldown unchanged, and a standalone year-boundary unit test for `isoWeekNumberForRow` (Dec 27 2026 Sunday → ISO week 53, not 52).

**Manual browser verification** (Vite dev server + Playwright, backend stubbed via route interception, per this project's "verify UI changes in a real browser" convention): confirmed at a 390px viewport that badges render correctly and distinctly per row, clicking one jumps to the exact Week-view row clicked, and the existing date-click-to-Day-view gesture is untouched.

---

## [REVIEWER OUTPUT]

One real finding, fixed during review:

- **Inaccurate justification for `event.stopPropagation()` on the week-badge click.** The first draft called `stopPropagation()` on the button's click, with a comment claiming it was needed to stop the cell's Manage-mode drag-to-block gesture from also firing. Tracing `BackgroundCells.js`, that gesture is driven by RBC's own `Selection` class, which attaches its listeners directly to the DOM (mousedown-based drag geometry against the whole month container) — not through React's synthetic click-bubbling tree — and the date-header row sits outside `BackgroundCells`' DOM subtree entirely (siblings, not ancestor/descendant). `stopPropagation()` on a React `onClick` couldn't have affected it either way — inert code justified by an incorrect mechanism. **Fixed:** removed the call and comment; re-verified empirically in the running app (Manage mode, week-badge click) that no block-creation `POST` fires and the click still switches to Week view, confirming the removal changes nothing observable.

Other things checked, no issues found: `DateHeaderProps.drilldownView`'s falsy-at-runtime handling despite its non-optional type; no new `any`; explicit return type on the exported pure function; badge touch-target size is small but consistent with the existing `rbc-button-link` sizing already in this app, not a regression.

---

## [TESTER OUTPUT]

- Full suite: `npm test -- --run` → **99/99 pass** (8 files), no regressions in the 62 pre-existing tests unrelated to this change.
- New coverage (4 tests): correct per-row ISO week numbers for a real month, distinct/non-confusable control (role+name), click→Week-view navigation landing on the exact source row, pre-existing date→Day-view drilldown byte-for-byte unchanged, and the Dec 2026 year-boundary edge case.
- Edge cases considered: off-range Sundays still get exactly one badge per row (confirmed visually); ambiguous date-label queries (e.g. "27"/"31" appear twice in a 6-week grid) were caught during test-writing and avoided rather than masked.
- Manual/browser verification: real dev server + stubbed backend, 390px viewport — badge visibility/distinctness, click-to-Week-view, click-to-Day-view, and Manage-mode drag-to-block non-interference all exercised against the actual rendered app.

---

## [SECURITY OUTPUT]

### 1) CIA Impact
None — no new data, no new endpoints, no new dependency; purely client-side view/date-state navigation over data the component already had access to.

### 2) OWASP-style checks
No user input parsed/rendered from an untrusted source (week number is derived from `Date` objects the component already computes); no new `dangerouslySetInnerHTML`, URL construction, or `fetch` call.

### 3) Dependency & Supply Chain Review
No new dependency. `npm audit --audit-level=high` → **0 vulnerabilities**.

### 4) Threat Mini-Model
Not applicable — no trust boundary crossed, no new attack surface.

### 5) Risk Summary
None identified.

### 6) Secure SDLC Phase
Design/implementation reviewed against source of the third-party library being extended, not just its type declarations — mitigated the risk of building on an incorrect assumption about `dateCellWrapper`.

### Merge Decision
Cleared — no security concerns.

---

## [RELEASE OUTPUT]

### DoD Checklist

| Gate | Status |
|---|---|
| Acceptance criteria met | ✅ all 6 met |
| Edge cases considered | ✅ off-range Sundays, ambiguous date labels, year-boundary ISO week, Manage-mode gesture collision (empirically ruled out) |
| No breaking changes | ✅ purely additive; no backend touched |
| TS strict / no unnecessary `any` | ✅ |
| Follows project conventions | ✅ (one inaccurate-comment/no-op issue found and fixed in Reviewer stage) |
| Lint & formatting | ✅ `npm run lint` clean |
| No dead code / debug logs | ✅ |
| New behavior has tests | ✅ 4 new tests, all passing |
| Negative tests | ✅ (ambiguity/year-boundary cases) |
| Tests pass locally | ✅ 99/99 |
| Input validation (server-side) | N/A — no server involved |
| AuthN/AuthZ | N/A — unchanged |
| No stack traces / sensitive leaks | N/A — no new error paths |
| Secrets not committed | ✅ |
| No new dependency without justification | ✅ none added |
| `npm audit` no unresolved HIGH/CRITICAL | ✅ 0 vulnerabilities |
| README/docs updated if behavior changes | N/A |

**DoD status: PASS**

### How to Verify
1. `cd frontend && npm test -- --run && npm run lint && npx tsc --noEmit && npm run build`
2. `npm run dev`, open `/admin`, log in, go to Calendar → Month view: each row shows a small numbered pill next to its Sunday date; click one → jumps to Week view on that row; click any plain date number → still jumps to Day view as before.

### Release Checklist
- [x] All DoD gates pass
- [x] Manually verified in a running browser at phone width (390px)
- [ ] Not yet pushed — awaiting explicit approval per user instruction

---

## Addendum: Monday-start weeks, "Wk" prefix/color, badge-before-date (pre-finalization)

Requested by the user before finalizing the task, applied on top of the original implementation above.

### Changes
1. **`luxonLocalizer(DateTime)` → `luxonLocalizer(DateTime, { firstDayOfWeek: 1 })`** — Month view rows now start Monday.
2. **`isoWeekNumberForRow` simplified.** Monday-start rows no longer straddle two ISO weeks (every day in a row now shares one ISO week number — verified: e.g. Jul 27–Aug 2, 2026 is entirely ISO week 31), so the earlier "+1 day to reach the row's Monday" arithmetic was removed; the function now reads `DateTime.fromJSDate(rowStartMonday).weekNumber` directly. `isRowStart` changed from `date.getDay() === 0` to `=== 1`, and both the label and `onJumpToWeek` navigation target now use `date` (== `range[0]`, now the row's own Monday) directly, with no split between label-source and navigate-target.
3. **"Wk" prefix + distinct color.** Badge text changed from the bare number to `Wk {n}` (`aria-label` kept as the fuller `Week {n}` for screen readers — the visible/accessible text intentionally differ, same pattern as icon-plus-tooltip controls elsewhere). Color changed from the muted gray/border pill (blended too closely with the app's other muted-gray UI) to a dedicated blue-tinted pill (`#dbeafe` / `#1e40af`), unambiguously distinct from the plain-text `rbc-button-link` date number next to it.
4. **Badge moved before the date number** (reading left-to-right as "Wk 31  10"), per explicit follow-up instruction reversing the original right-side placement.
5. **Sunday-start assumption audit** (grep across `frontend/src` and `frontend/test`, not just running the suite and reacting to failures):
   - `frontend/test/AdminCalendar.test.tsx` — the three date-dependent assertions in the week-number test block needed updating: the row-header text arrays (previously `"26 Sun".."01 Sat"`, now `"27 Mon".."02 Sun"` for the same Aug 2026 grid, shifted one day since the grid start moved from Jul 26 to Jul 27), the accessible-name lookup for the row-leading date button (was `"09"` i.e. the old Sunday-leading cell, now `"10"`, the new Monday-leading cell for the same "Week 33" row), and the year-boundary unit test (was anchored on Sunday Dec 27, 2026 as the row-start; now anchored on Monday Dec 28, 2026, since that's the actual row-leading cell under Monday-start — still lands on the same genuine edge case, ISO week 53 spanning into January 2027, not a reset to week 1).
   - `frontend/src/pages/AdminAvailability.tsx` and `frontend/src/api/types.ts` reference `Date.getDay()`/weekday numbering, but for the unrelated concept of per-weekday business-hours configuration, not this calendar's Month-view rendering — confirmed unaffected, no change needed.
   - No other file in `frontend/src` or `frontend/test` referenced `luxonLocalizer`, `firstDayOfWeek`, or RBC header/date-cell ordering.

### A real layout bug caught during narrow-viewport verification (not assumed away)
The first "Wk N + date" layout attempt (badge with `margin-right`, relying on `.rbc-date-cell`'s default right-aligned inline flow) **did not fit on one line at 390px** — measured via Playwright (`boundingBox()`): the cell is ~50.8px wide, but the badge alone measured 40px plus the date number's ~14.8px, so the badge wrapped onto its own line above the date instead of sitting beside it, contradicting the "reading left-to-right" requirement. Screenshotting alone (without a real narrow-viewport render) would have missed this — the wrap only appears at phone width, not on a wider default viewport.

**Fix:** turned `.rbc-date-cell` itself into a flex row (`display: flex; justify-content: flex-end; gap: 2px`) instead of relying on inline-content wrapping, and tightened the badge's own sizing (`font-size: 0.6rem`, `padding: 0 3px`) until it measured within the cell's available width. Re-measured after the fix: cell height dropped from a wrapped 38.75px back to a single-line 15px, and badge (33.8px) + gap (2px) + date (14.8px) ≈ 50.6px fits the 50.8px cell. Re-verified visually via a fresh 390px screenshot: all five rows in September 2026 render "Wk NN  DD" on one line, clearly distinct blue pill next to a plain date number, no wrap, no overlap into neighboring cells.

### Re-verification after the addendum
- `npm test -- --run` → 99/99 pass (including the 3 updated Monday-start assertions and the repositioned year-boundary test).
- `npm run lint` → clean.
- `npx tsc --noEmit` → clean.
- `npm run build` → succeeds.
- `npm audit --audit-level=high` → 0 vulnerabilities.
- Real-browser re-verification (Vite dev server + Playwright, backend stubbed): Month view at 390px shows Monday-start columns and correctly one-line "Wk N + date" badges; clicking a badge navigates Week view to the exact Monday-start row clicked (also now Monday-start, e.g. "August 31 – September 06"); Manage-mode drag-to-block still doesn't fire from a badge click (0 `POST /availability-exceptions` calls); plain date-number click still drills into Day view unchanged.

**DoD status after addendum: PASS** (same gate table as above; no new dependency, no security-relevant change, no backend touched).

---

## Addendum 2: pin badge to the cell's left edge, date to the right edge

Follow-up refinement: the badge and date number were sitting adjacent with only a ~2px gap between them. Requested change: real visual separation, badge pinned to the cell's left edge and the date number at its own (right-edge) position.

### The naive fix would have broken the other 6 columns
Simply changing `.rbc-date-cell`'s `justify-content` from `flex-end` to `space-between` looked like the obvious change, but it's wrong for the 6 columns per row that have *only* a date number and no badge: flexbox resolves `space-between` with a single child to `flex-start`, which would have silently left-aligned every non-Monday date number — a regression from the app's (and the library's own) existing right-alignment for those cells, not something the user asked to change.

**Fix:** kept the base `.rbc-date-cell` rule at `justify-content: flex-end` (preserves the existing right-alignment for the 6 single-child columns, unchanged from before this feature touched cell layout at all), and added a second, more specific rule scoped with `:has(.admin-calendar-week-number)` that applies `justify-content: space-between` only to the one column per row that actually carries a badge. This pins the badge to that cell's left edge and pushes the date number to its right edge — while every other column's date number keeps the exact same right-aligned position it already had, so the date numbers stay visually consistent across the whole row.

### Re-verification
- `npm test -- --run` → 99/99 pass (no test assertions needed to change — this was a pure CSS layout adjustment, no DOM structure or text content changed).
- `npm run lint` → clean.
- `npx tsc --noEmit` → clean.
- `npm run build` → succeeds.
- Re-measured via Playwright `boundingBox()`: badge now flush at the cell's left edge (`x` matches the cell's own `x`), date number flush at the cell's right edge; row height still 15px (single line, no wrap).
- Re-verified visually via a fresh 390px screenshot: clear separation between "Wk NN" (left) and the date number (right) in each row's Monday cell; all other columns' date numbers remain right-aligned, consistent with before.
- Re-ran the Manage-mode click-safety check: still 0 `POST /availability-exceptions` calls from a badge click, still switches to Week view correctly.

**DoD status after addendum 2: PASS.**

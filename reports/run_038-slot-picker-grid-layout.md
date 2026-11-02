# Run report: 038-slot-picker-grid-layout

- **Title:** Customer slot picker: two-column time grid, time-only tiles, date + weekday in the card header
- **Profile:** React Frontend
- **Completed:** 2026-11-02T15:05:00.000Z
- **DoD status:** blocked — `npm audit --audit-level=high` fails on pre-existing dev-toolchain advisories (identical counts on clean `HEAD`; not introduced by this task). Everything else passes.

---

[ARCHITECT OUTPUT]

### 1. Scope & assumptions
In scope: two-column grid of time-only tiles shared by both pickers, a service + date header, the selected state with `✓ Valittu`, new tokens and CSS. Unchanged: date input, API, request calls, jump to the form after tapping a slot.

Assumptions: the screenshot isn't in the repo, so the header replaces the `<p>` at `BookingWidget.tsx:183`, above the date input, and tile text stays left-aligned. `formatSlotLocal` actually outputs `ma 2.11. klo 12.00` (the task text omits "klo"); morning times show as `9.00`.

Risks from removing the date from tiles:
- Wrong-day booking: old `slots` stay on screen while loading, after a failed fetch, and on out-of-order responses, under the new date's header.
- Page crash: formatting an empty date throws `RangeError: Invalid time value`, and `frontend/src` has no error boundary.
- Wrong day in the header: `new Date("2026-11-02")` parses as UTC midnight, so it shows 1.11. west of UTC.
- Low-contrast border: `#93c5fd` on white is 1.80:1; use `#2563eb` (5.17:1 on white, 4.75:1 on the tint).

Correction to the task: `✓ Valittu` also shows in the booking flow, because `Takaisin` from the form keeps `selectedSlot`.

### 2. File impact
- `frontend/src/components/SlotGrid.tsx` — new: `SlotGrid`, `SlotPickerHeader`
- `frontend/src/lib/formatSlotLocal.ts` — `formatSlotTime`, `formatSlotDate`, timezone
- `frontend/src/styles/base.css` — tokens, grid/tile/header rules, remove unused `.btn-block`
- `frontend/src/pages/BookingWidget.tsx`, `frontend/src/pages/ManageBooking.tsx` — shared components + stale-slot guard
- `frontend/test/formatSlotLocal.test.ts` — new
- `frontend/test/BookingWidget.test.tsx`, `frontend/test/ManageBooking.test.tsx` — new cases

### 3. Implementation plan
1. `formatSlotTime(isoUtc)` returns `12.00`.
2. `formatSlotDate("YYYY-MM-DD")` parses `${date}T00:00:00Z`, formats in UTC to `ma 2.11.2026`, returns `""` if invalid.
3. The header date comes from the page's `date` state.
4. `SlotGrid` renders real buttons with the existing testid and `aria-pressed`; selected adds `✓ Valittu` with an `aria-hidden` check mark.
5. The grid gets `role="group"` with `aria-label="Vapaat ajat"`.
6. `SlotPickerHeader` is a wrapping flex row, service left, muted date right.
7. Tokens `--color-selected-bg: #eff6ff`, `--color-selected-border: #2563eb`.
8. Grid `repeat(2, minmax(0, 1fr))`; tiles `btn btn-secondary slot-tile`; selected styling on `.slot-tile[aria-pressed="true"]`.
9. `BookingWidget`: swap in header and grid; `handleSelectSlot` unchanged.
10. `ManageBooking`: header inside the reschedule section, swap in the grid.
11. Stale-slot guard on both pages.

### 4. Validation strategy
No new inputs or endpoints. The backend's `availabilityQuerySchema` and booking validation remain the only authority; `start_at` is still sent back exactly as received.

### 5. Test strategy
Formatter exact strings and invalid dates; timezone agreement including the 25 Oct 2026 DST change; a run under `TZ=Asia/Tokyo`; time-only tiles and testids; selected state in both flows; clearing the date; stale tiles hidden while loading and after errors; late responses ignored; loading and empty messages unchanged; a real-browser check at 375px.

### 6. CIA impact
- Confidentiality: None — shows only data the page already fetches.
- Integrity: Low — data sent is unchanged; the guard reduces wrong-day risk, though a mistake in it could leave stale slots showing.
- Availability: Low — a formatter error could blank the page; covered by safe invalid-date handling and a test.

### 7. Dependency decision
New dependency needed? No.

### Decisions (resolved by Ville)
1. Timezone: option A — fixed `Europe/Helsinki` for tile times, header date and `formatSlotLocal`. Ville confirmed the production provider timezone is `Europe/Helsinki`.
2. Stale-slot guard: option A — hide the grid unless `!slotsLoading && !slotsError`, plus a latest-request ref in `fetchSlots`; API calls identical.
3. Reschedule header: option A — service and date, same as the booking flow.

Also accepted: `✓ Valittu` showing in the booking flow after `Takaisin`.

AGENT_PASS

---

[IMPLEMENTER OUTPUT]

Implemented as approved; see the working-tree diff for each file.

- **`frontend/src/lib/formatSlotLocal.ts`** — `PROVIDER_TIME_ZONE = "Europe/Helsinki"` used by `formatSlotLocal` and the new `formatSlotTime`. New `formatSlotDate` pins parse and format to UTC, because it formats a calendar date rather than an instant, and returns `""` when unparseable.
- **`frontend/src/components/SlotGrid.tsx`** — new `SlotPickerHeader` and `SlotGrid`.
- **`frontend/src/styles/base.css`** — two tokens; `.slot-picker-header`, `.slot-picker-date`, `.slot-grid`, `.slot-tile`, `.slot-tile-line`, `.slot-tile[aria-pressed="true"]`, `.slot-tile-selected-label`; removed `.btn-block`, whose only users were the two replaced lists.
- **`frontend/src/pages/BookingWidget.tsx`, `frontend/src/pages/ManageBooking.tsx`** — shared components; `latestSlotsRequest` ref so only the latest request updates `slots`, `slotsError` or `slotsLoading`; grid rendered only when `!slotsLoading && !slotsError && slots && slots.length > 0`.

Notes:
- **Behaviour change:** customers outside Finland now see Helsinki time on tiles, the form summary and reschedule messages, rather than browser-local time. Finnish browsers see no change. This matches the emails.
- **Maintenance:** the constant duplicates `providers.timezone`, which the API doesn't expose. If that setting ever changes, the constant must change too.
- **No migration needed.**

AGENT_PASS

---

[REVIEWER OUTPUT]

### Review summary
Matches the approved plan. The tile testid and button semantics are preserved, `handleSelectSlot` is untouched, and the API calls are identical.

### Required fixes
1. **Fixed — missing spacing under the grid.** Found in the real-browser screenshot: removing `.btn-block` also removed the bottom margin that separated tiles from the reschedule confirm text. Added `margin-bottom: var(--space-3)` to `.slot-grid`; re-measured at 12px.

### Suggested improvements (not done, out of plan)
- The guard is duplicated across the two pages, as `fetchSlots` and `todayLocalDateInput` already are. A shared hook could replace all of it in a later task.
- `todayLocalDateInput` (default date and `min`) is still browser-local while slots are now Helsinki-based, so a viewer far from Finland can start on a neighbouring day. The header still matches the tiles, and the backend remains the authority.

### Security checks (light)
No new validation, auth or data-exposure surface. Service names render as React text, not raw HTML.

AGENT_PASS

---

[TESTER OUTPUT]

### Test cases
29 new tests, and all 116 existing tests pass with no assertion changes.
- `formatSlotLocal.test.ts` (8): exact time and date formats; no zero-padding; DST change; DST-day weekday; `""` and malformed dates return `""`; header/tile agreement for a 23.30 Helsinki slot that is already the next day in Tokyo.
- `BookingWidget.test.tsx` (12): time-only tiles in a labelled group; header; straight to the form with no `Jatka`; selected after `Takaisin`; selection cleared on date change; cleared date doesn't crash; tiles hidden while loading and on error; empty state; out-of-order late response, early-finishing older request, and late failure.
- `ManageBooking.test.tsx` (9): tiles and header; selected state by `aria-pressed`, label and accessible name; moving the selection; `Valitse toinen aika` clears; cleared date doesn't crash; tiles hidden while loading and on error; empty state; out-of-order late response.

### Do the tests catch regressions?
Each guard was removed in a scratch copy to confirm the tests fail:

| Removed | Tests failing |
|---|---|
| `BookingWidget` latest-request check | 3 |
| `ManageBooking` latest-request check | 1 |
| `BookingWidget` grid hide | 2 |
| `ManageBooking` grid hide | 2 |
| Invalid-date guard | 4 |
| Fixed timezone, run under `TZ=Asia/Tokyo` | 6 |

### Results
- Default timezone: 145/145 pass.
- `TZ=Asia/Tokyo`: 141/145 pass. All new tests pass. The 4 failures are all in `test/AdminCalendar.test.tsx`, and the same 4 fail on a clean copy of `HEAD`, so they are pre-existing:
  - visually distinguishes pending from confirmed bookings and excludes cancelled ones
  - shows booking details on selection, with Confirm/Decline for a pending booking and Cancel booking for a confirmed one
  - cancels a confirmed booking with an optional reason: removes it from the grid and closes the dialog
  - selecting a different booking without closing the popup first does not carry over a stale error or reveal state

  Root cause not investigated (out of scope).

### Real-browser check
Chrome, 375px-wide iframes, real components and real `base.css`, with `fetch` stubbed in a scratch harness that has since been deleted.
- Two tiles per row, 151px wide; tiles 44px tall (54px in a row with `✓ Valittu`, its neighbour stretching as accepted); no horizontal overflow.
- Selected colours, muted header date and `ma 2.11.2026` format confirmed.
- Tapping a slot goes straight to the form; `Takaisin` shows the selection.

Not covered: Safari, a physical phone, and a run against the real backend. The browser's own accessibility tree didn't report names for these buttons through the tool used, so the accessible name is asserted in jsdom only.

### How to run
`cd frontend && npx vitest run` and `TZ=Asia/Tokyo npx vitest run`

AGENT_PASS

---

[SECURITY OUTPUT]

### 1) CIA Impact
- Confidentiality: None — no new data, requests or storage.
- Integrity: Low — request payloads are unchanged, and `start_at` still round-trips unmodified. The guard reduces the risk of a customer booking the wrong day.
- Availability: Low — the one crash path found (invalid date) is handled and tested.

### 2) OWASP-style Checks
- Input validation & injection: no new input. The date value goes to the formatter and renders as React text; no `dangerouslySetInnerHTML`.
- AuthN/AuthZ: untouched; the reschedule token flow is unchanged.
- Sensitive data exposure: none. `Europe/Helsinki` is not sensitive.
- Security misconfiguration: none.
- Logging & monitoring: no change.

### 3) Dependency & Supply Chain Review
- New dependencies: No. `package.json` and `package-lock.json` are unchanged.
- Audit: `npm audit --audit-level=high` exits 1 with 18 vulnerabilities (13 moderate, 3 high, 2 critical). The counts are identical on clean `HEAD`.
- `npm audit --omit=dev`: 1 moderate (`moment`), 0 high, 0 critical. The HIGH/CRITICAL advisories are in the dev toolchain.
- Recommendation: Accept this change. The audit needs Ville's decision, as with task 037.

### 4) Threat Mini-Model
- Assets: booking integrity (correct day and time).
- Entry points: date input, `/availability` responses.
- Threats: stale or out-of-order responses leading to a wrong-day booking; invalid date crashing the page.
- Mitigations: grid hiding, latest-request guard, safe formatter; the backend revalidates bookings.

### 5) Risk Summary
- Severity: Low.
- Required mitigations before merge: none from this change.
- Follow-ups: dependency audit task (see Release).

### 6) Secure SDLC Phase
- Phase affected: Implementation.
- Re-review required after mitigation: No.

### Merge Decision
- Approved for merge: Yes for this change, subject to Ville's decision on the pre-existing audit failure.

AGENT_PASS

---

[RELEASE OUTPUT]

### DoD checklist

**Functional**
- [x] All acceptance criteria met (375px checked in Chrome only)
- [x] Edge cases: cleared date, loading, fetch error, empty state, out-of-order responses
- [x] No breaking changes; no migration. Viewers outside Finland now see Helsinki time.

**Code Quality**
- [x] No unnecessary `any`; explicit return types on new exports
- [x] Follows conventions; lint passes (formatting is covered by lint only)
- [x] No dead code or debug logs; unused `.btn-block` removed; no hex colours in component code

**Tests**
- [x] 29 new tests, including negative cases
- [x] 145/145 pass locally
- [ ] CI: not run — the repo has no `.github/workflows`
- [x] `TZ=Asia/Tokyo`: all new tests pass; 4 pre-existing `AdminCalendar` failures, same on clean `HEAD`

**Security (SSDLC)**
- [x] Validation: no new input; backend unchanged
- [x] Auth unchanged; no error leakage; no secrets

**Dependency & Supply Chain**
- [x] No new dependency; lockfile unchanged
- [ ] **`npm audit` no unresolved HIGH/CRITICAL — FAILS** on pre-existing advisories (3 high, 2 critical, same on clean `HEAD`; 0 high/critical with `--omit=dev`)

**Documentation & Traceability**
- [x] No README exists at the repo root and no other docs needed changing
- [x] Run report and `run_log.json` updated

### How to verify
1. `cd frontend && npx vitest run && npm run lint && npx tsc --noEmit && npm run build`
2. `TZ=Asia/Tokyo npx vitest run` — expect only the 4 `AdminCalendar` failures.
3. `npm run dev` with the backend at ~375px: pick a service, check the header, two-column tiles and that tapping goes straight to the form; press `Takaisin` to see `✓ Valittu`.
4. Open a manage-booking link, press `Siirrä aikaa`, pick a time: the tile highlights and the confirm question appears below it.
5. Clear the date input: an error message appears and the page stays up.

### Release notes
No migration or configuration change. Rollback is a plain revert.

### Follow-ups (not in this task)
- Dependency audit task (`npm audit fix` + vitest upgrade), already noted in task 037.
- Investigate why 4 `AdminCalendar` tests depend on the machine timezone.
- Keep `PROVIDER_TIME_ZONE` in sync with `providers.timezone`, or expose it through the API.

AGENT_BLOCK: npm audit reports unresolved HIGH/CRITICAL advisories (pre-existing, dev toolchain only, not introduced by this task) — needs Ville's decision: accept for this task as with 037, or fix first.

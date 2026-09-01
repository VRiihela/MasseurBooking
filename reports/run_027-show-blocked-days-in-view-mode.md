# Run Report: 027-show-blocked-days-in-view-mode

**Title:** Show blocked availability on the calendar in View mode, not only Manage-availability mode
**Profile:** React Frontend
**Timestamp:** 2026-09-01T00:00:00.000Z
**DoD status:** pass

---

## [ARCHITECT OUTPUT]

### 1. Scope & Assumptions

- Confirmed by reading the current `AdminCalendar.tsx` in full: the exceptions fetch effect gates on `mode === "manage"` plus a one-shot `exceptionsRequestedRef`, and the `exceptionEvents` memo gates on `mode !== "manage"`. Both gates are being removed. `selectable`/`onSelectSlot`, which gate block-*creation* to Manage mode, are explicitly **not** touched.
- **Open design question resolved:** for a blocked-exception event tapped in **View mode**, proposing a small read-only detail popup — structurally the same pattern already used for booking events (`selectedBooking` → `.admin-calendar-detail[role=dialog]`), just without any mutation button, only "Close." Reasoning:
  - A silent no-op tap would be inconsistent with how every other tappable event in this component already behaves (booking events already show a detail popup in *both* modes).
  - It cannot accidentally enable any mutation from View mode, since the new popup has no unblock action.
  - It's a small, mechanical addition (mirrors existing code shape), not a new interaction pattern to design from scratch.
  - **Manage mode's tap behavior is completely unchanged** — tapping a blocked event there still calls `handleUnblock` immediately, exactly as today.
- Minimal-diff choice: keep the exceptions fetch as its own separate `useEffect` (not merged into the bookings effect) — preserves independent loading/error state and failure isolation.
- `exceptionsRequestedRef` becomes dead weight once the fetch runs unconditionally on mount — removing it, along with its error-path retry-reset (the bookings effect has no retry mechanism either, so this makes the two effects consistent).
- `exceptionsError`: proposing this becomes visible regardless of mode, since the fetch that can produce it now runs regardless of mode. `slotError`/`unblockError`/`batchResult` stay gated to Manage mode, since the actions that produce them genuinely still only happen there.

### 2. File Impact List

- `frontend/src/pages/AdminCalendar.tsx` — the actual behavior change (fetch effect, events memo, `handleSelectEvent`, new read-only exception-detail state/JSX, error-display gating).
- `frontend/test/AdminCalendar.test.tsx` — two existing tests consciously rewritten, not deleted.
- No backend files, no other frontend files.

### 3. Implementation Plan

1. Remove the mode/ref gate from the exceptions `useEffect`; dependency array becomes `[onSessionEnded]`, mirroring the bookings effect exactly.
2. Remove `exceptionsRequestedRef` entirely (and the now-unused `useRef` import if nothing else uses it).
3. Simplify `exceptionEvents` memo to `(exceptions ?? []).map(toExceptionEvent)`, dependency `[exceptions]`.
4. Move `exceptionsError` display out of the `{mode === "manage" && (...)}` block; leave `slotError`, `unblockError`, `batchResult` inside it, unchanged.
5. Add `selectedException` state.
6. In `handleSelectEvent`'s exception branch: Manage mode keeps calling `handleUnblock` immediately (unchanged); other modes set `selectedException` instead.
7. Add a small read-only detail block, parallel to the `selectedBooking` dialog, showing date/time range and a single "Close" button.
8. Leave `selectable`/`onSelectSlot` byte-for-byte unchanged.
9. Leave `eventPropGetter` unchanged.
10. Rewrite the two existing tests whose assumptions this change breaks (see Test Strategy).
11. Manual verification at phone-width viewport.

### 4. Validation Strategy (server-side)

Not applicable — no new input, no new API call shape, no validation logic changed.

### 5. Test Strategy

- Must be rewritten: the View-mode-defers-fetch test (→ fetch-on-mount + no-duplicate-on-mode-entry), and the slot-selection-does-nothing test (→ call-count-unchanged instead of zero-calls).
- New coverage needed: blocked-exception events render in View mode; tapping one in View mode shows the read-only detail and does not fire a DELETE call.
- Must keep passing unmodified: all existing Manage-mode tests.
- Manual/visual verification at a narrow viewport for the new read-only detail block.

### 6. CIA Impact

- **Confidentiality: None. Integrity: None. Availability: None.**

### 7. Dependency Decision

- **New dependency needed? No.**

---

**User approval, no changes to the plan.**

`AGENT_PASS`

---

## [IMPLEMENTER OUTPUT]

**`frontend/src/pages/AdminCalendar.tsx`:**

1. Removed the `mode !== "manage"` gate and `exceptionsRequestedRef` from the exceptions `useEffect` — fetches unconditionally on mount, dependency array `[onSessionEnded]`, mirroring the bookings effect's shape exactly. Removed the now-unused `useRef` import.
2. Simplified `exceptionEvents` to `(exceptions ?? []).map(toExceptionEvent)`, dropping `mode` from its dependency array.
3. Moved `exceptionsError` display out of the `{mode === "manage" && ...}` block so a load failure is visible in either mode; `slotError`/`unblockError`/`batchResult` stay Manage-mode-gated.
4. Added `selectedException` state and a `formatDateLong` helper.
5. `handleSelectEvent`'s exception branch now checks `mode === "manage"` explicitly: Manage mode still calls `handleUnblock` immediately (unchanged); any other mode sets `selectedException` instead.
6. Added a read-only detail block (`role="dialog" aria-label="Blocked time details"`), structurally parallel to the existing booking-detail dialog, showing the exception's title and a long-form date, with only a "Close" button.
7. Small correctness addition beyond the literal plan text: since the popup has no backdrop, selecting a booking now also clears `selectedException` and vice versa, so the two detail popups can't both be open at once.
8. `selectable`/`onSelectSlot` left byte-for-byte unchanged.

**`frontend/test/AdminCalendar.test.tsx`:**

- Rewrote "defaults to View mode: no availability-exceptions fetch happens until Manage mode is entered" → now asserts the fetch happens on mount and that entering Manage mode afterward does **not** trigger a second call.
- Rewrote "View mode's Calendar props are unaffected — selecting a slot does nothing outside Manage mode" → captures the exceptions-call count before the click and asserts it's unchanged after, instead of asserting zero calls.
- Added "renders an existing blocked exception in View mode... without needing to enter Manage mode."
- Added "tapping a blocked exception in View mode shows a read-only detail instead of unblocking it" — asserts the dialog appears, the event is still present (`getAllByText("Blocked")` → 2 matches), and no DELETE call fires.
- Left all existing Manage-mode tests untouched.

**Verification beyond the literal instructions:** used a temporary jsdom render to capture the real DOM the new dialog produces, then a temporary static-HTML + headless-Chrome (Playwright + system Chrome) screenshot at 375px width to confirm the mobile layout renders cleanly. Both temporary files were deleted after — `git status` showed only the two real source files changed.

`AGENT_PASS`

---

## [REVIEWER OUTPUT]

**Review summary:** Matches the approved Architect plan, plus one small, justified addition (clearing the other popup type on selection) that follows directly from introducing a second independent "selected" state alongside an existing comment about exactly this class of bug (no backdrop → stale/overlapping popup state).

**Correctness/edge cases:** Manage mode's tap-to-unblock path is untouched in logic, just relocated one level deeper in the same function — verified the existing Manage-mode tests for it still pass unmodified. `exceptionEvents`'s new dependency array is correct since `mode` is no longer read inside it.

**Architectural consistency:** the new dialog reuses `.admin-calendar-detail`/`role="dialog"` exactly as the booking dialog does — no new CSS, no new pattern.

**Test quality:** the rewritten tests target the actual behavioral claim (call-count-unchanged, not zero-calls) rather than working around the new fetch. The new "shows a read-only detail" test correctly anticipates the duplicate-text ambiguity (`getAllByText` → 2) rather than a fragile single `getByText`.

**Required fixes (blockers):** none.

**Suggested improvements (nice-to-have):** none beyond noting the date-line/title split is intentional, not duplicative.

`AGENT_PASS`

---

## [TESTER OUTPUT]

**Test strategy:** two existing tests rewritten to fix broken assumptions, two new tests added for previously-uncovered acceptance criteria.

**Regression verification performed:**
- `npm test -- --run`: **8 test files, 95 tests, all passing** (93 previous + 2 new).
- Existing Manage-mode tests (render-distinctly, tap-to-unblock, failed-unblock-error, batch-block, "confirming a booking works identically in Manage-availability mode") all pass unmodified.
- All other admin/customer test files unaffected.

**Manual/visual verification — actually performed:** rendered the real component tree via jsdom to capture the exact DOM the new dialog produces, then loaded that markup with the real `AdminCalendar.css`/`base.css` in a headless Chrome instance (Playwright driving the system-installed Chrome) at 375px width and took a screenshot. Confirmed: blocked event renders on the grid while the mode toggle shows View, and the new read-only detail card renders below it cleanly.

**How to run tests:** `cd frontend && npm test -- --run`

`AGENT_PASS`

---

## [SECURITY OUTPUT]

### 1) CIA Impact
- **Confidentiality: None.** Data was already fully readable by any authenticated masseur session via Manage mode — only *when* it's fetched and *where* it's rendered changed.
- **Integrity: None.** No new mutation path — the new View-mode tap path is strictly read-only; the only existing mutation (`handleUnblock`) remains gated to `mode === "manage"`.
- **Availability: None.** One additional GET request now fires on mount instead of on first Manage-mode entry.

### 2) OWASP-style Checks
No new input, no new API call shape, AuthN/AuthZ (401 handling) preserved unchanged in both fetch effects and `handleUnblock`, no new data exposure, no misconfiguration introduced.

### 3) Dependency & Supply Chain Review
- **New dependencies added? No.**
- No `package.json`/lockfile change — no new audit evidence needed since the dependency set is unchanged from the last audited state (task 026: 0 vulnerabilities).
- **Recommendation: Accept.**

### 4) Threat Mini-Model
- **Assets:** blocked-availability data — same asset, same authorized readers as before.
- **Entry points:** none added.
- **Threats:** none applicable — the change narrows (not widens) what a tap in View mode can trigger.
- **Mitigations:** the mode-gate (`if (mode === "manage")`) is the mitigation for accidental View-mode deletion, verified by the new "does not fire a DELETE call" test.

### 5) Risk Summary
- **Severity: Low.** No required mitigations. No follow-ups identified.

### 6) Secure SDLC Phase
- **Phase affected:** Implementation (client-side data-fetch timing and read/write UI gating only). Re-review after mitigation: No.

### Merge Decision
- **Approved for merge: Yes**

`AGENT_PASS`

---

## [RELEASE OUTPUT]

### DoD Checklist

| Item | Status |
|---|---|
| Acceptance criteria met | Pass — all 8 criteria: mount-time fetch, View-mode rendering, block-creation still Manage-only, View-mode tap no longer unblocks (justified alternative implemented), Manage-mode tap-to-unblock unchanged, tests consciously updated with reasoning, mobile layout verified, all checks pass |
| Edge cases considered | Pass — overlapping popup state (booking + exception) addressed proactively |
| No breaking changes | Pass — presentational/timing change only, no API contract change |
| TypeScript: no unnecessary `any` | Pass |
| Code follows project conventions | Pass |
| Lint & formatting pass | Pass |
| No dead code / debug logs | Pass — `exceptionsRequestedRef` removed; all temporary debug/repro files deleted |
| New behavior has tests | Pass — 2 new tests for the 2 new acceptance criteria |
| Negative tests included | Pass — "does not fire a DELETE call" is the negative-path test |
| Tests pass locally | Pass — 8 files, **95/95 passing** |
| Input validation server-side | N/A |
| AuthN/AuthZ checked | Pass — 401 handling preserved |
| Errors don't leak sensitive data | Pass |
| Secrets not committed | Pass |
| No new dependency without justification | Pass — none added |
| `npm audit` no unresolved HIGH/CRITICAL | Pass — no dependency change since last audit (task 026: 0 vulnerabilities) |
| PR dependency review | Pass — no dependency changes |
| README/docs updated if behaviour changes | N/A |

**Manual/visual verification: actually performed, not just flagged.** Temporary jsdom render + headless-Chrome (Playwright via system Chrome) screenshot at 375px confirmed blocked events render in View mode and the new read-only detail card displays cleanly with no overflow. Temporary files deleted afterward.

### How to Verify
```bash
cd frontend
npm test -- --run        # 95/95 pass
npm run lint               # clean
npx tsc --noEmit           # clean
npm run build                # clean
npm run dev                   # manually confirm in a real browser:
                               # - blocked days visible in View mode (default) without clicking Manage
                               # - tapping a blocked day in View mode shows a read-only "Blocked" detail, doesn't delete it
                               # - tapping a blocked day in Manage mode still deletes it immediately (unchanged)
```

### Release Checklist
- Versioning/changelog: N/A
- CI green: tests + lint + build + typecheck all pass locally
- Dependency audit: no new dependencies, prior audit (task 026) still valid
- Security findings: none blocking
- Docs: none required
- Rollback/migration notes: none — plain file revert, no data migration, no API contract change

**Overall: DoD passes.**

`AGENT_PASS`

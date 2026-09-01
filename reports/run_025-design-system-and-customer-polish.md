# Run Report: 025-design-system-and-customer-polish

**Title:** Shared design system + customer-facing UI polish (BookingWidget, ManageBooking)
**Profile:** React Frontend
**Timestamp:** 2026-09-01T00:00:00.000Z
**DoD status:** pass (one manual-verification caveat, see Release stage)

---

## [ARCHITECT OUTPUT]

### 1. Scope & Assumptions

- Purely presentational change: a new shared CSS foundation (custom properties + a handful of reusable classes) plus `className` additions to `BookingWidget.tsx` and `ManageBooking.tsx`. No JSX structural changes beyond adding wrapper elements/classNames where needed for layout (e.g., a card container), no text/copy changes, no logic changes.
- Assumption: "no new dependency" means no CSS framework/UI kit and no CSS-in-JS library — plain `.css` files imported normally, consistent with Vite's default CSS handling already used for `AdminCalendar.css`/`AdminServices.css`.
- Assumption: admin pages (`AdminDashboard`, `AdminAvailability`, `AdminLoginRequest`, `AdminLoginCallback`, `AdminCalendar`, `AdminServices`) are untouched — out of scope per task.
- Assumption: existing admin CSS files (`AdminCalendar.css`, `AdminServices.css`) are read-only references for spacing conventions (they use `0.5rem`/`0.75rem`/`1rem` and a `640px` breakpoint) — the new base stylesheet should reuse these values rather than inventing a new scale, so future admin polish can adopt the same tokens without friction.
- Confirmed via grep of both test files: no test queries by CSS class, and several `getByText` calls match exact strings (`"Status: pending"`, `"Status: cancelled"`, `"Booking not found"` via `getByRole("heading")`, etc.). Constraint for implementation: text must stay in a single element's text content — don't split a matched string like `"Status: pending"` across sibling elements/nested tags with the string broken across them, since that would break the exact-text match. Wrapping the whole string in one `<p>`/`<span>` with a className is safe.

### 2. File Impact List

- `frontend/src/styles/base.css` (new) — CSS custom properties (color palette, spacing scale, typography) + shared classes (`.btn`, `.btn-primary`, `.btn-secondary`, `.field`, `.field label`, `.alert`/`[role=alert]` styling, `.loading-text`, `.card`/`.page`).
- `frontend/src/main.tsx` — add `import "./styles/base.css";` (global import point, no component change).
- `frontend/src/pages/BookingWidget.tsx` — add `className` attributes only (buttons, form fields, containers, alert/loading text); no text/role/testid/structural-logic changes.
- `frontend/src/pages/ManageBooking.tsx` — add `className` attributes only, same constraint.
- No changes to: `frontend/test/BookingWidget.test.tsx`, `frontend/test/ManageBooking.test.tsx`, `AdminCalendar.css`, `AdminServices.css`, any backend file.

### 3. Implementation Plan

1. Create `frontend/src/styles/base.css` defining `:root` custom properties: a small neutral palette, a spacing scale (`--space-1` … `--space-5` mapped to the `0.25rem`–`1.5rem` range already used), and typography (base font-family/size/line-height, heading sizes).
2. Add a minimal CSS reset (box-sizing, margin reset on `h1`/`p`, `body` background/text color from the tokens).
3. Add reusable classes: `.btn` base + `.btn-primary`/`.btn-secondary` variants, `.field` for label+input grouping, `input`/`select` base styling (mobile-first full width), `[role="alert"]` styling for error/alert text, `.loading-text`, `.card`/`.page` for a bounded content block.
4. Import `base.css` once in `frontend/src/main.tsx`, before `<App />` renders.
5. In `BookingWidget.tsx`: style all four steps additively via `className` only.
6. In `ManageBooking.tsx`: same treatment across loading/not-found/loaded/rescheduled/reschedule-in-progress states.
7. Verify no className collides with or shadows any existing `data-testid`/`aria-label` value.
8. Run `npm run dev`/build and manually check both pages at a narrow (e.g. 375px) viewport and at the `640px+` breakpoint.
9. Run `npm test`, `npm run build`, `npm run lint`, `tsc --noEmit` in `frontend/` and confirm all pass unmodified.

### 4. Validation Strategy (server-side)

Not applicable — no input validation logic, API contracts, or data handling change in this task.

### 5. Test Strategy

- No new automated tests required — acceptance criteria require the existing suites to pass unmodified.
- Regression check after every className batch, since queries rely on exact text/role/label/testid values.
- Manual/visual verification: both pages at phone-width and desktop-width viewports, all steps/states.

### 6. CIA Impact

- **Confidentiality: None.** No new data exposure, storage, or transmission.
- **Integrity: None.** No business logic, validation, or state-transition changes.
- **Availability: None.** No new network calls, no dependency added.

### 7. Dependency Decision

- **New dependency needed? No.** Plain CSS via a new `frontend/src/styles/base.css`, imported through the existing Vite CSS pipeline.

`AGENT_PASS`

---

## [IMPLEMENTER OUTPUT]

**Files changed:**

**`frontend/src/styles/base.css` (new)** — CSS custom properties (color palette, spacing scale, typography, radius) + a minimal reset (`box-sizing`, `body`, `h1`, `p`, `label`, `input`/`select`) + reusable classes: `.page`, `.card`, `.btn`/`.btn-primary`/`.btn-secondary`, `.field`, `.loading-text`, and an `[role="alert"]` attribute-selector style (styled the existing attribute directly rather than adding a parallel class, so it can't drift out of sync with the alerts already in the markup). Mobile-first, with a `640px` breakpoint widening `.page`/`.card` padding — matches the scale already used in `AdminCalendar.css`/`AdminServices.css`.

**`frontend/src/main.tsx`** — added `import "./styles/base.css";`, one line, no other change.

**`frontend/src/pages/BookingWidget.tsx`** — added `className` only, across all four steps (select-service, select-slot, form, confirmation): `.page` on the root, `.card` on each `<section>`/confirmation block, `.btn-primary` on the primary submit action, `.btn-secondary` on service/slot/back buttons, `.field` wrapping each label+input, `.loading-text` on the loading strings. No JSX element types, text, `aria-label`, or `data-testid` values changed. The `Date` input stays nested inside its `<label>` (just inside an added wrapper `<div className="field">`), preserving the label association the tests rely on (`getByLabelText("Date")`, checked for the `min` attribute).

**`frontend/src/pages/ManageBooking.tsx`** — same treatment across loading/not-found/loaded/reschedule/rescheduled states: `.page`, `.card` around the loaded-booking content, `.btn-primary`/`.btn-secondary` on action buttons, `.field` around the Date input, `.loading-text`, alert paragraphs left as plain `role="alert"` `<p>` tags (styled via the attribute selector). Critically, `"Status: {view.status}"` stays as one untouched text node inside its own `<p>` — not split across elements — since tests match it with exact-string `getByText`.

**Tricky part:** none structurally risky — the only constraint requiring care was keeping every RTL-matched string (`"Status: pending"`, `"Status: cancelled"`, `"Booking not found"` heading, etc.) inside a single element's text content while adding wrapper `<div>`s/classNames around it, not through it. Verified by re-running both test suites after the edits rather than just reasoning about it.

No behavior/migration notes — purely presentational, no API/data-shape changes.

`AGENT_PASS`

---

## [REVIEWER OUTPUT]

**Review summary:** Diff matches the approved Architect plan exactly — one new stylesheet, one import line, and additive `className`s on the two target pages. No JSX restructuring beyond wrapper `<div>`s for `.field`/`.card` grouping, all pre-existing element types, `aria-label`s, `data-testid`s, and copy are untouched. Naming (`.btn-primary`/`.btn-secondary`, `.card`, `.field`, `.page`) is conventional and readable. Tokens are centralized in `:root`, not hardcoded per-component, so a future admin polish pass can reuse them.

**Correctness/edge cases:** `[role="alert"]` styling means any future alert element that reuses that attribute anywhere in the app auto-inherits the styling — the intended shared behavior. `.btn` sets `min-height: 44px` for a reasonable mobile tap target on every button including small "Back"/"Never mind" actions, which is appropriate given the task's mobile-first requirement.

**Architectural consistency:** matches `AdminCalendar.css`/`AdminServices.css` conventions (mobile-first ordering, `640px` breakpoint, same spacing magnitudes) as directed.

**Error handling / performance:** no change to error-handling logic; no performance concern (one small additional CSS file, no new render cost).

**Required fixes (blockers):** none.

**Suggested improvements (nice-to-have, not blocking this task):**
- The global `input`/`select`/`button` base styles in `base.css` will also lightly affect the currently-unstyled admin pages since the import is global. Expected per the acceptance criteria ("imported globally, available to every page"), net-neutral-to-positive, worth flagging for the follow-up admin polish task.
- Consider extracting the repeated `<div className="field"><label>...` pattern into a small `FormField` component in the follow-up if more forms are added later — not warranted for two pages today.

`AGENT_PASS`

---

## [TESTER OUTPUT]

**Test strategy:** no new automated tests were added, per the Architect plan — pure styling change, existing suites must keep passing unmodified.

**Regression verification performed:**
- `npm test -- --run` in `frontend/`: **8 test files, 93 tests, all passing**, including `BookingWidget.test.tsx` (8 tests) and `ManageBooking.test.tsx` (11 tests).
- No test file was modified.

**Cases specifically exercised by the existing suites that validate the styling change didn't break structure:**
- Service/slot selection via `data-testid` (`service-option-*`, `slot-option-*`).
- `getByLabelText("Name"/"Email"/"Phone"/"Date")` — confirms the added `.field` wrapper `<div>` didn't break label→input association.
- `getByRole("alert")` for the 409-conflict "just taken" message and the invalid-email message.
- Exact-text assertions (`"Status: pending"`, `"Status: cancelled"`, `getByRole("heading")` → `"Booking not found"`).
- Button-by-accessible-name queries (`getByRole("button", { name: "Cancel booking" })`, `"Reschedule"`, `"Confirm reschedule"`, etc.).

**Manual/visual verification — limitation:** this environment has no browser or screenshot tooling available, so visual confirmation of the phone-width and desktop-width layouts was not performed. Verified the CSS logically instead (full-width mobile-first defaults, `640px` breakpoint, 44px button tap targets, `width:100%` inputs) — code-level assurance, not a rendered check.

**How to run tests:** `cd frontend && npm test -- --run`

`AGENT_PASS`

---

## [SECURITY OUTPUT]

### 1) CIA Impact
- **Confidentiality: None** — no new data exposure, no new fields rendered, no new network calls.
- **Integrity: None** — no business logic, validation, or state-transition code touched.
- **Availability: None** — no new dependency, no new async work, no change to error-handling flow.

### 2) OWASP-style Checks
- **Input validation & injection risks:** unaffected. All rendered dynamic text goes through React's default JSX text-node escaping exactly as before; no `dangerouslySetInnerHTML` introduced.
- **AuthN/AuthZ correctness:** unaffected — `token`/`bookingId` handling in `ManageBooking.tsx` untouched.
- **Sensitive data exposure:** unaffected.
- **Security misconfiguration:** none introduced; new CSS file has no external asset/font loading, no remote imports.
- **Logging & monitoring gaps:** N/A.

### 3) Dependency & Supply Chain Review
- **New dependencies added? No.**
- **Audit evidence:** `npm audit --audit-level=high` in `frontend/` → **0 vulnerabilities found.**
- **Recommendation: Accept.**

### 4) Threat Mini-Model
- **Assets:** customer PII already displayed on these pages — unchanged exposure surface.
- **Entry points:** none added.
- **Threats:** none applicable to a CSS/className-only change.
- **Mitigations:** N/A.

### 5) Risk Summary
- **Severity: Low.**
- **Required mitigations before merge:** none.
- **Follow-ups (optional):** admin-page polish (already tracked as a separate future task).

### 6) Secure SDLC Phase
- **Phase affected:** Implementation (UI/presentation layer only).
- **Is re-review required after mitigation?** No.

### Merge Decision
- **Approved for merge: Yes**

`AGENT_PASS`

---

## [RELEASE OUTPUT]

### DoD Checklist

| Item | Status |
|---|---|
| Acceptance criteria met | Pass — shared stylesheet + reusable classes exist, imported globally; both pages fully restyled across all steps/states; no dependency added |
| Edge cases considered | Pass — all loading/error/empty/confirmation states covered in both pages |
| No breaking changes without migration notes | Pass — no behavior change, N/A |
| TypeScript: no unnecessary `any` | Pass — no type changes at all |
| Code follows project conventions | Pass |
| Lint & formatting pass | Pass — `npm run lint` clean |
| No dead code / debug logs | Pass |
| New behavior has tests | N/A — no new behavior, presentational only |
| Negative tests included | Pass (pre-existing, unmodified, still passing) |
| Tests pass locally | Pass — `npm test -- --run`: 8 files, 93/93 passing |
| Input validation server-side | N/A — no input/validation code touched |
| AuthN/AuthZ checked | N/A — untouched |
| Errors don't leak sensitive data | Pass — unchanged |
| Secrets not committed | Pass — no secrets in diff |
| No new dependency without justification | Pass — none added |
| `npm audit` no unresolved HIGH/CRITICAL | Pass — 0 vulnerabilities |
| PR dependency review | Pass — no dependency changes at all |
| README/docs updated if behavior changes | N/A — no user-facing behavior/API change |

**Remaining / not fully verified:**
- Visual/mobile verification was not performed in a real browser — this environment has no browser or screenshot tooling available. Code-level reasoning (mobile-first CSS, `640px` breakpoint, 44px tap targets, `width:100%` inputs) supports the mobile-first requirement, but the task's acceptance criterion "verified usable and visually coherent at a narrow viewport" is not independently confirmed. Recommend running `npm run dev` and manually checking both pages at ~375px and desktop widths before considering this criterion fully closed.

### How to Verify
```bash
cd frontend
npm test -- --run        # 93/93 pass
npm run lint              # clean
npx tsc --noEmit          # clean
npm run build              # clean, dist/assets includes new CSS bundle
npm audit --audit-level=high   # 0 vulnerabilities
npm run dev                # then manually check BookingWidget + ManageBooking
                            # at phone width (~375px) and desktop width
```

### Release Checklist
- Versioning/changelog: N/A (no changelog convention in this repo)
- CI green: tests + lint + build + typecheck all pass locally
- Dependency audit: attached, 0 vulnerabilities, no new dependencies
- Security findings: none blocking — Security stage approved
- Docs: none required — no behavior/API change
- Rollback/migration notes: none — revert is a plain file revert, no data migration involved

**Overall: DoD passes**, with one caveat: manual browser verification not performed in this environment — recommend before merge/deploy.

`AGENT_PASS`

---

## [RELEASE OUTPUT — addendum after visual-testing fixes]

Following manual visual testing, two follow-up styling fixes were requested and applied before final release:

1. **Slot-option buttons made explicitly full-width/block-level.** Added a `.btn-block` utility (`display: block; width: 100%; text-align: left;`) in `frontend/src/styles/base.css` and applied it (alongside the existing `.btn-secondary`) to every `data-testid="slot-option-*"` button in both `BookingWidget.tsx` and `ManageBooking.tsx`, so each option reliably takes its own row regardless of label text length instead of relying on incidental wrapping.
2. **"Back" buttons given a distinct, lighter style.** Added a `.btn-back` class (transparent background/border, muted text color, regular font weight) in `base.css`, applied to all three "Back" buttons (two in `BookingWidget.tsx`, one in `ManageBooking.tsx`'s reschedule section) in place of `.btn-secondary`, with a leading `‹` (`&lsaquo;`) glyph added to the button text. Confirmed via grep that "Back" is not queried by text in either test suite before relabeling it, per the request.

**Files touched in this pass:** `frontend/src/styles/base.css`, `frontend/src/pages/BookingWidget.tsx`, `frontend/src/pages/ManageBooking.tsx` (same files as the original implementation — no new files).

**Re-verification:**
```bash
cd frontend
npm test -- --run   # 8 files, 93/93 passing (unchanged)
npm run build        # clean
npm run lint          # clean
npx tsc --noEmit      # clean
```

No `data-testid`, `aria-label`, or tested text string changed. DoD remains **pass**, with the same standing caveat as before: manual browser/mobile-viewport verification isn't performable in this environment, though the two specific issues raised from your own visual testing are now addressed in code.

`AGENT_PASS`

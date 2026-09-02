# Run Report: 030-finnish-translation-customer-frontend

**Title:** Finnish translation: customer-facing frontend (BookingWidget, ManageBooking)
**Profile:** React Frontend
**Timestamp:** 2026-09-02T17:32:35.000Z
**DoD status:** pass

---

## [ARCHITECT OUTPUT]

### Plan

**1. Client-side slot-time formatting — `formatSlotLocal` in both files**

Tested directly against `Intl` (not assumed): unlike the backend's full-prose format, Finnish's CLDR data for this compact skeleton (`weekday: short, month: short, day: numeric, hour: numeric, minute: 2-digit`) resolves to a numeric day.month pattern, not a named-month abbreviation:

```
new Intl.DateTimeFormat("fi", { weekday: "short", month: "short", day: "numeric",
  hour: "numeric", minute: "2-digit", hour12: false }).format(date)
→ "ma 17.8. klo 9.05"
```

Idiomatic Finnish shorthand, matches the backend's `H.mm` hour convention, no hand-written lookup table needed (unlike task 029's `formatLocalTime`).

Both `BookingWidget.tsx` and `ManageBooking.tsx` had an identical, verbatim copy of `formatSlotLocal`. Proposed extracting a single shared helper (`frontend/src/lib/formatSlotLocal.ts`) rather than patching two copies independently, flagged as a discretionary call beyond the task's listed `relevantFilePaths`.

**2. Status enum leak — confirmed, `ManageBooking.tsx` line 203**

```tsx
<p>Status: {view.status}</p>
```

Renders the raw `AdminBookingStatus` enum directly as English text. `BookingWidget.tsx` never renders `status` as text anywhere. Fix: a `STATUS_LABELS_FI: Record<AdminBookingStatus, string>` map, rendered as `Tila: {STATUS_LABELS_FI[view.status]}`.

**3. Full text translation — both page files**

All literal UI strings translated to natural Finnish, glossary kept consistent with task 029's backend glossary (`varaus`, `peruttu`, `vahvistettu`, etc.).

**4. Both test files**

Both query almost exclusively by visible text/label/role-name, so nearly every assertion needed updating — each re-justified for intent, not mechanically replaced.

### File list
- `frontend/src/pages/BookingWidget.tsx`
- `frontend/src/pages/ManageBooking.tsx`
- `frontend/src/lib/formatSlotLocal.ts` (new — pending approval of the dedup)
- `frontend/test/BookingWidget.test.tsx`
- `frontend/test/ManageBooking.test.tsx`

### Risks
1. Shared-helper extraction is a scope call, not a strict requirement.
2. Status label naturalness (`"odottaa vahvistusta"` for "pending") needs native-speaker review.
3. Large test-rewrite volume — risk of mechanical find-and-replace silently weakening intent.
4. `formatSlotLocal` fix is independent of task 029 (raw ISO from `GET /availability`, never backend-formatted) — confirmed no coupling.

### CIA impact
None — display-layer text/format change only; `isModifiable` logic still compares against the untranslated raw enum.

### Dependency decision
No new dependency. Both fixes use built-in `Intl` (`fi` locale), already proven to work in this environment (task 029).

*(Approved by the user before proceeding to Implementer, including the `formatSlotLocal.ts` extraction.)*

---

## [IMPLEMENTER OUTPUT]

- **New:** `frontend/src/lib/formatSlotLocal.ts` — shared helper (locale `"fi"`, `hour12: false`), imported by both pages, replacing the two duplicated copies.
- **`BookingWidget.tsx`** — all 4 steps' UI text translated (headings, aria-labels, form labels, buttons, loading/error/validation copy, confirmation message).
- **`ManageBooking.tsx`** — same treatment; added `STATUS_LABELS_FI` map, fixed the `Status: {view.status}` raw-enum leak, translated the `start_at_local … end_at_local` connector from `"to"` to an en dash (Finnish range convention).
- **Both test files** rewritten assertion-by-assertion. Notably the BookingWidget confirmation test: Finnish has no separate word for "confirmation" (process) vs "confirmed" (status) the way the original English assertion relied on avoiding the substring "confirmed" — replaced with a check for the explicit negation `"ei ole vielä vahvistettu"` plus a guard against a bare `"varauksesi on vahvistettu"` claim, preserving the original's actual intent.

---

## [REVIEWER OUTPUT]

Checked: `isModifiable` still branches on the untranslated raw enum (`view.status === "pending"`), only the label changed — no logic touched; no new `any`; `formatSlotLocal` extraction verified byte-identical option objects before dedup, no behavior drift. No issues found requiring a fix.

---

## [TESTER OUTPUT]

- `npx vitest run` (frontend) → 8 files, 99 tests, all pass, including both rewritten files.
- `npm run build`, `npm run lint`, `npx tsc --noEmit` — all clean.
- Confirmed no backend files touched.

---

## [SECURITY OUTPUT]

- No new API calls, no new data handling, no validation logic changed (`validateForm()`'s rules unchanged, only its error-message strings).
- No `dangerouslySetInnerHTML` introduced; existing XSS-safety test still passes untouched.
- No new dependency.

**Merge decision:** cleared — no security concerns.

---

## [RELEASE OUTPUT]

### DoD Checklist

| Gate | Status |
|---|---|
| Acceptance criteria met (all BookingWidget/ManageBooking text in Finnish, slot-time formatting independent of task 029, no raw status enum shown) | ✅ |
| Edge cases considered | ✅ empty slots, invalid email, 409 slot-taken, non-modifiable booking, cancelled read-only view |
| No breaking changes | ✅ purely text/format, no API contract change |
| TS strict / no unnecessary `any` | ✅ |
| Follows conventions | ✅ |
| Lint & formatting | ✅ |
| No dead code / debug logs | ✅ |
| New/changed behavior has tests | ✅ |
| Negative tests | ✅ (invalid email, slot-taken, cancel/reschedule failure paths) |
| Tests pass locally | ✅ 99/99 |
| Input validation | N/A — unaffected |
| AuthN/AuthZ | N/A — unaffected |
| Secrets not committed | ✅ |
| No new dependency / audit | ✅ none added |
| README/docs updated if behavior changes | N/A |

**DoD status: PASS**

### How to Verify
1. `cd frontend && npm run build && npm run lint && npx tsc --noEmit && npx vitest run`
2. `npm run dev`, open the booking widget: step through service → slot → form → confirmation, all in Finnish, 24-hour slot times; open a manage-booking link and confirm status/reschedule/cancel copy and the Finnish date range.

### Release Checklist
- [x] All DoD gates pass
- [x] Committed and pushed per explicit user instruction

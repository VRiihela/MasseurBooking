# Run Report: 031-finnish-translation-admin-frontend

**Title:** Finnish translation: admin-facing frontend (Dashboard, Calendar, Availability, Services, Login)
**Profile:** React Frontend
**Timestamp:** 2026-09-04T17:42:36.000Z
**DoD status:** pass

---

## [ARCHITECT OUTPUT]

### Plan

**1. `AdminCalendar.tsx` — react-big-calendar's own text (toolbar + grid)**

Confirmed via `node_modules/react-big-calendar/lib/localizers/luxon.js`: header/grid formatting goes through `local.format(date, pattern, culture)`, and `culture` is a `<Calendar culture="...">` prop, separate from the localizer's own locale (unset, defaulting to en-US). Fix: `culture="fi"` plus a full `messages={{...}}` prop covering the entire `Messages` interface (not just the toolbar entries `CALENDAR_VIEWS` currently exposes), to avoid an English straggler if Agenda/Work-week are ever enabled.

**Non-obvious grammar finding, tested empirically:** a single combined `Intl.DateTimeFormat('fi', {...})` call resolves Finnish weekday/month inflection differently depending on which fields are requested together. `formatDateLong()` (blocked-time detail popup) naively ported to `'fi'` with `{weekday, month, day, year}` together produces essive weekday (`"keskiviikkona"`), not matching task 029's nominative-weekday house style. Tested the fix: requesting `{weekday, month, day}` **without** `year` gives `"keskiviikko 12. elokuuta"` (nominative weekday + correctly-inflected partitive month, no lookup table needed), then appending the year separately reproduces the house style exactly.

**2. `AdminCalendar.tsx` and `AdminDashboard.tsx` — this app's own text**

- `'Wk'` week-number badge prefix (task 028) → `'Vk'` (Finnish abbreviation for *viikko*).
- Confirmed raw-enum leaks in **two** places (`AdminDashboard.tsx:202`, `AdminCalendar.tsx:574`): `<p>Status: {status}</p>`.
- **Found beyond the task description:** `AdminDashboard.tsx`'s status-filter buttons render `{filter}` directly (line 182), leaking `AdminBookingStatusFilter` values (`"pending"`/`"confirmed"`/`"cancelled"`/`"all"`) as button labels — a third instance of the leak pattern.
- `formatBatchResult()`'s pluralization (`"day"`/`"days"`, `"was"`/`"were"`) needs real Finnish grammar: partitive plural after any quantifier ≠ 1 (`"1 uusi päivä"` vs `"3 uutta päivää"`, note the adjective inflects too), and no was/were distinction.

**3. Status-label duplication across 3 files**

`ManageBooking.tsx` (task 030) already had a local `STATUS_LABELS_FI`. This task needed the same map again in both `AdminDashboard.tsx` and `AdminCalendar.tsx`. Proposed extracting `frontend/src/lib/statusLabels.ts` (matching the `formatSlotLocal.ts` precedent), plus a `FILTER_LABELS_FI` for the dashboard's filter tabs. Flagged migrating `ManageBooking.tsx` onto it too as a discretionary call.

**4. `AdminAvailability.tsx`**

The 7 `WEEKDAYS` labels translate directly in place (`Monday → Maanantai` … `Sunday → Sunnuntai`), order untouched (Monday-first, 1–7, matching the wire format).

**5. `AdminServices.tsx`**

Field labels including Massage duration / Buffer before / Buffer after (task 021), helper text, validation messages, create/edit/list UI.

**6. `AdminLoginRequest.tsx` / `AdminLoginCallback.tsx`**

Found while reading both files: two backend-sourced English strings that would remain in English after this task ships — `AdminLoginRequest.tsx`'s `resultMessage` (`GENERIC_LOGIN_REQUEST_MESSAGE` in `backend/src/routes/auth.ts`) and `AdminLoginCallback.tsx`'s `UnauthorizedError`-derived `"Unauthorized"` fallback (`backend/src/errors.ts`). Flagged as a scope-boundary decision rather than silently fixed or silently left broken.

### File list
6 page files + `frontend/src/lib/statusLabels.ts` (new, pending approval) + 6 test files. Two backend files flagged as a scope decision, not in the file list.

### Risks
1. `formatBatchResult`'s Finnish pluralization needed real grammar care, not a mechanical port.
2. `AdminCalendar.test.tsx` (881 lines) was the largest single-file risk of a rushed rewrite.
3. Three raw-enum leaks (not just the one named), all routed through the shared label map.
4. Backend-sourced English strings are a scope boundary this task's file list doesn't cover.
5. `formatDateLong`'s year-triggers-essive-weekday behavior is a genuine Intl/CLDR quirk, documented in-code to prevent a future "simplification" regression.

### CIA impact
None — display-layer text/formatting/localization only; all mutation/status-comparison logic continues to branch on untranslated raw enum values.

### Dependency decision
No new dependency. `culture`/`messages` are existing, already-typed `react-big-calendar` props; `formatDateLong` uses built-in `Intl`; label maps are plain TS objects.

*(Approved by the user before proceeding to Implementer, with both discretionary calls resolved: extract `statusLabels.ts` AND migrate `ManageBooking.tsx` onto it; leave the two backend-sourced strings out of scope for this task.)*

---

## [IMPLEMENTER OUTPUT]

- **New:** `frontend/src/lib/statusLabels.ts` — `STATUS_LABELS_FI` (full-sentence status labels, shared by `ManageBooking.tsx`, `AdminDashboard.tsx`, `AdminCalendar.tsx`) and `FILTER_LABELS_FI` (short filter-tab labels, `AdminDashboard.tsx` only).
- **`ManageBooking.tsx`** migrated to import `STATUS_LABELS_FI` from the shared file, local duplicate removed.
- **`AdminDashboard.tsx`** — all UI text translated; both raw-enum leaks (status line, filter buttons) fixed via the shared maps.
- **`AdminAvailability.tsx`** — weekday labels, form labels, validation/error/empty/loading text translated.
- **`AdminServices.tsx`** — field labels (including the duration/buffer distinction), validation messages, create/edit/list UI translated.
- **`AdminLoginRequest.tsx` / `AdminLoginCallback.tsx`** — all of this app's own text translated; the two backend-sourced strings left untouched per the agreed scope exclusion.
- **`AdminCalendar.tsx`** — `culture="fi"` + full `CALENDAR_MESSAGES` added to `<Calendar>`; `formatDateLong` rewritten per the researched year-appended-separately technique (documented in-code); `'Wk'` → `'Vk'`; status leak fixed; `formatBatchResult` rewritten with correct Finnish partitive-plural grammar; all own text translated.
- **All 6 test files** rewritten assertion-by-assertion — notably `AdminCalendar.test.tsx`'s Month-view row-header assertions, which now expect `"27 ma"`/`"28 ti"`/etc. (react-big-calendar's own `dayFormat` via `culture="fi"`, confirmed empirically against Luxon), and `formatBatchResult`'s test rewritten to assert the correct Finnish singular/partitive-plural behavior (explicitly including the 0-count case, which takes partitive like any non-1 count).

---

## [REVIEWER OUTPUT]

Checked: all raw-enum leaks fixed and routed through the shared maps (no drift risk); status/mutation comparison logic (`booking.status === "pending"`, etc.) untouched — only rendered labels changed; `culture`/`messages` addition to `<Calendar>` is purely additive; `formatDateLong`'s year-appended-separately approach documented in-code; no new `any`, no new dependency, explicit return types retained; confirmed via grep no duplicate `STATUS_LABELS_FI`/`FILTER_LABELS_FI` definitions remain anywhere in `frontend/src`. No issues found requiring further changes.

---

## [TESTER OUTPUT]

- `npx vitest run` (frontend) → 8 files, **99 tests, all pass**, including all 6 rewritten admin test files.
- `npm run build`, `npm run lint`, `npx tsc --noEmit` — all clean.
- Confirmed no backend files touched (`git status` on `backend/` empty).

---

## [SECURITY OUTPUT]

- No new API calls, no new data handling, no validation logic changed — all mutation/status-comparison logic still branches on raw untranslated enum values.
- `culture`/`messages` are display-only `react-big-calendar` props; no new dependency, no new attack surface.
- No `dangerouslySetInnerHTML` introduced.

**Merge decision:** cleared — no security concerns.

---

## [RELEASE OUTPUT]

### DoD Checklist

| Gate | Status |
|---|---|
| Acceptance criteria met (all 5 non-calendar pages fully Finnish; AdminCalendar's own text Finnish; react-big-calendar's toolbar/grid Finnish via culture+messages; 7 weekday labels correct order; no raw status enum shown) | ✅ |
| Edge cases considered | ✅ zero/singular/plural batch-block counts, backend-sourced vs. own error messages kept distinct, year-boundary ISO week (pre-existing, re-verified) |
| No breaking changes | ✅ purely text/format/localization, no API contract change |
| TS strict / no unnecessary `any` | ✅ |
| Follows conventions | ✅ |
| Lint & formatting | ✅ |
| No dead code / debug logs | ✅ |
| New/changed behavior has tests | ✅ |
| Negative tests | ✅ (validation errors, 401s, backend rejections all preserved) |
| Tests pass locally | ✅ 99/99 |
| Input validation | N/A — unaffected |
| AuthN/AuthZ | N/A — unaffected |
| Secrets not committed | ✅ |
| No new dependency / audit | ✅ none added |
| README/docs updated if behavior changes | N/A |

**DoD status: PASS**

### Deviations from the approved plan
Both pre-approved discretionary calls applied: `frontend/src/lib/statusLabels.ts` extracted and `ManageBooking.tsx` migrated onto it. The two backend-sourced English strings (login-request generic message, `UnauthorizedError`'s `"Unauthorized"`) were left untouched as agreed — a small backend follow-up task, not covered here.

### How to Verify
1. `cd frontend && npm run build && npm run lint && npx tsc --noEmit && npx vitest run`
2. `npm run dev`, open `/admin`: log in, check Bookings list/filters, Calendar (toolbar, grid weekday/month names, week badges, both detail popups, batch-block message), Availability (weekday labels), Services (field labels/helper text), and the login request/callback pages — all in Finnish except the two flagged backend-sourced strings.

### Release Checklist
- [x] All DoD gates pass
- [x] Committed and pushed per explicit user instruction

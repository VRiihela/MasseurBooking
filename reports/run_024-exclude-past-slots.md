# Run Report: 024-exclude-past-slots

**Title:** Exclude past/expired time slots from the availability list
**Profile:** Node/TypeScript Backend
**Timestamp:** 2026-08-31T19:12:30.000Z
**DoD Status:** pass

---

## [ARCHITECT OUTPUT]

### 1) Scope & assumptions

- In scope: `computeAvailableSlots` in `backend/src/services/availabilityService.ts` never returns a slot whose start is `<= now`; `BookingWidget.tsx`'s date `<input>` gets a `min` attribute as defense-in-depth UX hardening only.
- Out of scope, explicitly not fixing here: the residual race where a slot is valid when listed but tips into the past while the customer fills in name/email/phone — `BookingWidget.tsx`'s `slotTakenMessage` copy ("someone else took it") would then be shown for the wrong reason on the resulting 400. Real gap, separate concern from "don't list already-past slots" — flagged as a follow-up, not fixed now.
- **Blocking pre-existing bug this change surfaces, confirmed by reading the file directly:** `backend/test/integration/availability.test.ts:23` hardcoded `const TEST_DATE = "2026-08-17";` with a comment calling it an "arbitrary future date" — but relative to today (2026-08-31), that date was already in the past. Harmless before this fix (no notion of "now" existed), but the moment the past-slot filter ships, every assertion of a non-empty slot array against `TEST_DATE` would fail. Fixed in the same change per explicit instruction — not deferred.
- Confirmed by reading `backend/src/routes/availability.ts`: it builds the call to `computeAvailableSlots` as a literal `{ serviceId, date }` object — never spreads `req.query`/`parsed.data` wholesale. This is what keeps the new `nowMs` field client-unreachable.

### 2) File impact list

- `backend/src/services/availabilityService.ts` — add optional `nowMs` to `ComputeAvailableSlotsInput`; filter the final slot list against it.
- `backend/src/routes/availability.ts` — no changes (confirmed literal 2-field call site).
- `backend/test/integration/availability.test.ts` — fix stale `TEST_DATE` (blocking); add two new tests.
- `frontend/src/pages/BookingWidget.tsx` — add `min={todayLocalDateInput()}` to the date input; helper already in scope.
- `frontend/test/BookingWidget.test.tsx` — add one RTL test asserting the `min` attribute.

### 3) Implementation plan

1. Add `nowMs?: number` to `ComputeAvailableSlotsInput`.
2. Compute `const cutoffMs = input.nowMs ?? Date.now();` once near the top of `computeAvailableSlots`.
3. Insert `.filter((ms) => ms > cutoffMs)` between `sliceIntoSlots(...)` and `.map(...)` in the return pipeline.
4. **Filter placement decision:** post-slice filtering of the final slot-start `ms` array, not pre-slice interval truncation. Truncating `free` intervals before `sliceIntoSlots` would shift the slot-start grid off its `:00/:15/:30/:45` alignment for a partially-elapsed interval; filtering after slicing only removes already-computed entries, leaving surviving slots exactly where they were.
5. **Cutoff semantics decision:** exact `Date.now()`, strict `>`, no forward buffer — mirrors `bookingSchema.ts`'s `strictUtcTimestamp` predicate (`new Date(value).getTime() > Date.now()`) exactly, which is what guarantees GET never offers something POST would reject. A buffer would solve a different (real but unscoped) problem and any chosen N would be an unreviewed guess at product policy.
6. **"Now" injection decision:** optional `nowMs?: number` parameter (default `Date.now()`), not a bare inline call — needed because `availability.test.ts` has zero time-mocking infrastructure and is a DB-backed integration-test file where introducing fake timers for the first time carries real risk (interference with the pg driver's own timers/sockets).
7. Fix `TEST_DATE` in `availability.test.ts` to `DateTime.now().plus({ months: 1 }).toISODate()!` — required, blocking.
8. Add a "fully past date" HTTP-level test (permanently-past literal `2020-01-01`) asserting `[]`.
9. Add a direct-import `nowMs`-boundary test proving strict `>` exclusion at the cutoff.
10. Add `min={todayLocalDateInput()}` to the date input in `BookingWidget.tsx`.
11. Add one RTL test asserting the `min` attribute value.

### 4) Validation strategy (server-side)

- `nowMs` never accepted from client input — verified by reading `routes/availability.ts`'s literal object construction. No new validation surface.
- Frontend `min` attribute is UX-only, not an enforcement boundary — the backend filter is the actual guarantee (API is public and callable directly).

### 5) Test strategy

- Backend: HTTP-level "fully past date" empty-array test; direct-import `nowMs`-boundary test proving strict `>`; mandatory `TEST_DATE` destaling fix so the existing 17-test suite keeps passing.
- Frontend: one RTL test for the `min` attribute, fitting existing `fireEvent`/`stubFetch`/`screen.getByLabelText` conventions.
- Deliberately no fake timers, no `MockDate` — consistent with this codebase's existing real-time-relative test convention and avoided entirely by the `nowMs` seam.

### 6) CIA impact

- **Confidentiality: None.** No new data exposed; marginal reduction in disclosure (no longer reveals past-dated, non-actionable "availability").
- **Integrity: Low.** Correctness fix aligning a read endpoint with an already-independently-enforced write-side rule. No auth boundary crossed, no data mutated.
- **Availability: None.** One `.filter()` over an already-small array; no new I/O, no dependency, no route/rate-limit change.

### 7) Dependency decision

- New dependency needed: **No.** Backend reuses `Date.now()`, native array methods, and already-imported Luxon `DateTime`. Frontend reuses the existing `todayLocalDateInput()` helper via a plain HTML attribute. Explicitly rejected: a timer-mocking library — the `nowMs` seam makes it unnecessary.

---

## [IMPLEMENTER OUTPUT]

### `backend/src/services/availabilityService.ts`

```diff
 export interface ComputeAvailableSlotsInput {
   serviceId: string;
   date: string; // "YYYY-MM-DD", interpreted in the provider's timezone
+  // Not accepted from client input (see routes/availability.ts) -- lets
+  // tests pin "now" without a fake-timers dependency.
+  nowMs?: number;
 }
 
 export async function computeAvailableSlots(input: ComputeAvailableSlotsInput): Promise<string[]> {
+  const cutoffMs = input.nowMs ?? Date.now();
   const service = await loadServiceWithProvider(input.serviceId);
   const zone = service.timezone;
@@
-  return sliceIntoSlots(free, slotDurationMs, granularityMs).map((ms) =>
-    new Date(ms).toISOString(),
-  );
+  // Never offer a slot bookingSchema.ts's own "must be in the future" rule
+  // (strict >, same Date.now() comparison) would then reject.
+  return sliceIntoSlots(free, slotDurationMs, granularityMs)
+    .filter((ms) => ms > cutoffMs)
+    .map((ms) => new Date(ms).toISOString());
 }
```

### `backend/test/integration/availability.test.ts`

```diff
 import { closePool, getPool } from "../../src/db/pool.js";
+import { computeAvailableSlots } from "../../src/services/availabilityService.js";
 import {
@@
-const TEST_DATE = "2026-08-17"; // arbitrary future date; weekday computed dynamically below
+// Computed relative to "now" rather than a fixed literal -- a hardcoded
+// future date silently goes stale (this one already had, see task 024);
+// weekday is computed dynamically below either way.
+const TEST_DATE = DateTime.now().plus({ months: 1 }).toISODate()!;
 const weekday = DateTime.fromISO(TEST_DATE, { zone: "UTC" }).weekday;
@@
   it("returns 404 for a service that exists but is inactive", async () => {
     ...
   });
+
+  it("returns an empty list, not an error, for a fully past date", async () => {
+    const pastDate = "2020-01-01"; // permanently in the past
+    const pastWeekday = DateTime.fromISO(pastDate, { zone: "UTC" }).weekday;
+    await createAvailabilityRule(pool, providerId, pastWeekday, "09:00:00", "12:00:00");
+
+    const response = await request(app)
+      .get("/availability")
+      .query({ service_id: serviceId, date: pastDate });
+
+    expect(response.status).toBe(200);
+    expect(response.body).toEqual([]);
+  });
+
+  it("excludes slots at or before the cutoff, keeps the rest -- strict > boundary", async () => {
+    await createAvailabilityRule(pool, providerId, weekday, "09:00:00", "12:00:00");
+    const cutoffMs = new Date(`${TEST_DATE}T10:00:00.000Z`).getTime();
+
+    const slots = await computeAvailableSlots({ serviceId, date: TEST_DATE, nowMs: cutoffMs });
+
+    expect(slots).not.toContain(`${TEST_DATE}T09:00:00.000Z`);
+    expect(slots).not.toContain(`${TEST_DATE}T10:00:00.000Z`); // == cutoff, strict > excludes it
+    expect(slots[0]).toBe(`${TEST_DATE}T10:15:00.000Z`); // first slot strictly after cutoff
+  });
 });
```

### `frontend/src/pages/BookingWidget.tsx`

```diff
             <input
               type="date"
               value={date}
+              min={todayLocalDateInput()}
               onChange={(event) => handleDateChange(event.target.value)}
             />
```

### `frontend/test/BookingWidget.test.tsx`

```diff
   it("blocks submit on an invalid email without calling the API", async () => {
     ...
   });
+
+  it("sets min on the date input to today, as defense-in-depth against past dates", async () => {
+    stubFetch();
+    render(<BookingWidget />);
+
+    fireEvent.click(await screen.findByTestId(`service-option-${SERVICE.id}`));
+    await screen.findByTestId(`slot-option-${SLOT}`);
+
+    const today = new Date();
+    const expected = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
+      today.getDate(),
+    ).padStart(2, "0")}`;
+    expect(screen.getByLabelText("Date")).toHaveAttribute("min", expected);
+  });
 });
```

### Notes on tricky parts
- Initial draft of the frontend `min`-attribute test only awaited the service option's appearance without clicking it, so the date-input step never rendered (`getByLabelText("Date")` failed with "Unable to find a label"). Fixed by clicking the service option first, matching the pattern used by every other test in the file that needs the date/slot step.
- `SLOT`/`SLOT_2` test constants in `BookingWidget.test.tsx` (`2026-08-10T...`) are now technically in the past relative to "today," but this is harmless — that test file stubs `fetch` entirely and never exercises real slot-filtering logic.

---

## [REVIEWER OUTPUT]

**Review summary:** Matches the approved Architect plan precisely — filter placement (post-slice), cutoff semantics (exact `Date.now()`, strict `>`, no buffer), and the `nowMs` injection seam (optional, unreachable from `routes/availability.ts`) are all implemented exactly as designed. The `TEST_DATE` staleness fix is folded in as instructed, not deferred. Types explicit throughout, no `any`. Comments explain non-obvious rationale rather than restating code. `min={todayLocalDateInput()}` reuses the existing in-scope helper with no new import.

**Required fixes (blockers):** None.

**Suggested improvements (nice-to-have):** None.

---

## [TESTER OUTPUT]

### Test cases covered
1. Backend — "fully past date" (HTTP-level, `2020-01-01`): rule created that would otherwise produce slots; asserts `response.body === []`, not an error.
2. Backend — cutoff boundary (direct `computeAvailableSlots` call via the `nowMs` seam): proves strict `>` — a slot exactly at cutoff is excluded, the next 15-min slot is kept.
3. Backend — `TEST_DATE` destaling: full existing 17-test suite for this file re-verified passing against a dynamically future-computed date.
4. Frontend — `min` attribute: asserts the rendered value equals today's local date string. Caught and fixed a bug in the test itself (missing the service-selection click) during this stage.

### How to run
```
docker start masseur-pg   # if not already running (localhost:5433)
cd backend && npm test -- --run && npm run lint && npx tsc --noEmit && npm run build
cd frontend && npm test -- --run && npm run lint && npm run typecheck && npm run build
```

### Results
- Backend: `npm test -- --run` — **219/219 passed** (28 files, was 217/28 before this task — +2 new in `availability.test.ts`, 17→19). `npm run lint` clean. `npx tsc --noEmit` clean. `npm run build` clean.
- Frontend: `npm test -- --run` — **93/93 passed** (8 files, was 92/8 before — +1 new in `BookingWidget.test.tsx`, 7→8). `npm run lint` clean. `npm run typecheck` clean. `npm run build` clean (Vite production build succeeded, 433.38 kB / 134.49 kB gzip).

---

## [SECURITY OUTPUT]

### 1) CIA Impact
- **Confidentiality: None.** No new data exposed; marginal reduction in incidental disclosure (no more full-day slot lists for past dates).
- **Integrity: Low.** Correctness fix aligning a read endpoint with an already-independently-enforced write-side rule (`bookingSchema.ts`). No auth boundary crossed, no data mutated.
- **Availability: None.** One `.filter()` over an already-small in-memory array; no new I/O, no route/rate-limit change.

### 2) OWASP-style Checks
- **Input validation & injection risk:** No new input accepted. Verified `routes/availability.ts` unchanged, still builds a literal `{ serviceId, date }` object — `nowMs` is not client-reachable. Frontend `min` is a native HTML hint only, not an enforcement boundary.
- **AuthN/AuthZ correctness:** Unchanged — `GET /availability` remains public/read-only.
- **Sensitive data exposure:** None introduced; slightly reduced.
- **Security misconfiguration:** N/A.
- **Logging & monitoring gaps:** N/A.

### 3) Dependency & Supply Chain Review
- New dependencies: **No**, either project.
- Audit evidence: not re-run (no dependency change); prior accepted `npm audit` exception for backend dev-toolchain stands unchanged.

### 4) Threat Mini-Model
- **Assets:** Scheduling availability data, already public.
- **Entry points:** `GET /availability` (public, rate-limited, unchanged).
- **Threats:** None newly introduced.
- **Mitigations:** N/A; `nowMs` confirmed unreachable from any client input path.

### 5) Risk Summary
- **Severity: Low.**
- **Required mitigations before merge:** None.
- **Follow-ups (optional, out of scope):** (a) listing-to-submit staleness race and `slotTakenMessage` copy accuracy; (b) `winterDate = "2027-01-15"` in the DST test block will eventually go stale the same way `TEST_DATE` just did.

### 6) Secure SDLC Phase
- Phase affected: Implementation.
- Re-review required after mitigation: No.

### Merge Decision
- **Approved for merge: Yes**
- Blocking reason: N/A

---

## [RELEASE OUTPUT]

### DoD Checklist

**Functional**
- ✅ Acceptance criteria met — all 6 verified (see below)
- ✅ Edge cases: exact-cutoff boundary (strict `>`), fully-past date, today-with-future-slots all covered
- ✅ No breaking changes — `nowMs` additive/optional; route signature and response shape unchanged

**Code Quality**
- ✅ No unnecessary `any`
- ✅ Follows conventions.md; minimal diff at each touched file
- ✅ `npm run lint` clean, both projects
- ✅ No dead code/debug logs

**Tests**
- ✅ New behavior has tests — 2 new backend, 1 new frontend
- ✅ Boundary case included (strict-`>` cutoff assertion)
- ✅ Backend 219/219 passed; frontend 93/93 passed

**Security (SSDLC)**
- ✅ Input validation: `nowMs` confirmed client-unreachable
- ✅ AuthZ: N/A, unchanged public endpoint
- ✅ No sensitive-data leakage introduced
- ✅ No secrets committed

**Dependency & Supply Chain**
- ✅ No new dependency, either project
- N/A audit (no dependency change); existing accepted exception stands

**Documentation & Traceability**
- N/A — no README/behavior-contract doc change; the `TEST_DATE`-staleness class of bug is now self-documented via inline comment

### Acceptance criteria verification
1. ✅ `GET /availability` never returns a slot `<= now`, consistent with `bookingSchema.ts`'s identical `> Date.now()` predicate — verified by the cutoff-boundary test.
2. ✅ Fully past date → `[]`, not an error — verified by the new HTTP-level test.
3. ✅ Today's already-passed slots excluded — same mechanism, verified via the `nowMs` seam.
4. ✅ `min` attribute added to `BookingWidget.tsx`'s date input — verified by the new RTL test.
5. ✅ Existing `availability.test.ts` suite passes (19/19, up from 17, after the required `TEST_DATE` fix); new tests cover both required cases.
6. ✅ `npm test`, `npm run build`, `npm run lint`, `tsc --noEmit` all pass in both `backend/` and `frontend/`.

### How to verify
```
docker start masseur-pg  # localhost:5433, if not already running
cd backend && npm test -- --run && npm run lint && npx tsc --noEmit && npm run build
cd frontend && npm test -- --run && npm run lint && npm run typecheck && npm run build
```
Manual: `GET /availability?service_id=<id>&date=<today>` before and after a known rule-hour slot's start time — confirm the earlier slot drops out of the second response. Load `BookingWidget.tsx` in a browser and confirm the native date picker refuses a past date.

### Rollback / migration notes
None needed — no schema change, no data migration. `nowMs` is optional and additive; reverting the 4-file diff fully reverts behavior.

### Final Result
**DoD Status: PASS.** No blockers from Reviewer or Security.

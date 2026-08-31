# Run Report: 023-fix-customer-view-shows-buffer-time

**Title:** Fix: customer's manage-booking page shows the full buffered block instead of the actual massage window
**Profile:** Node/TypeScript Backend
**Timestamp:** 2026-08-31T16:12:00.000Z
**DoD Status:** pass

---

## [ARCHITECT OUTPUT]

### 1) Scope & assumptions

- Scope: `getBookingForCustomer` in `backend/src/services/bookingService.ts` (lines 522–549) only. Redefine `CustomerBookingView.startAtLocal`/`endAtLocal` to be the massage window (`start_at + buffer_before_minutes` → `+ duration_minutes`), not the raw stored `start_at`/`end_at` (the full buffered block, per `createBookingCore` lines 277–279).
- Assumption confirmed by reading the frontend: `frontend/src/pages/ManageBooking.tsx:198` is the only consumer of `start_at_local`/`end_at_local`; no other frontend code or backend consumer depends on these two fields carrying the full buffered block. Redefining their meaning is safe with no field rename and no frontend change.
- Assumption confirmed by reading fixtures: `resetAndSeed`'s default seeded service already has `buffer_after_minutes = 15`, `buffer_before_minutes = 0` — so the existing test suite already exercises a nonzero-buffer service but the current assertion (`typeof === 'string'`) never checks the value, which is exactly the coverage gap to close.
- No DB schema change, no migration, no new endpoint.

### 2) File impact list

- `backend/src/services/bookingService.ts` — modify `getBookingForCustomer`'s SQL (add `s.duration_minutes`, `s.buffer_before_minutes`), its row type `CustomerBookingViewRow`, and the return mapping.
- `backend/test/integration/bookings.customerManagement.test.ts` — strengthen/replace the weak `typeof` assertion in the `GET /bookings/:id` "returns status, service name, and local start/end time" test.
- `backend/test/helpers/fixtures.ts` — no signature change planned; the new test will insert its own service row (via a raw `pool.query`, following the existing `createInactiveService` pattern) with nonzero `buffer_before_minutes`, and use `createBookingAt` (not `createPendingBooking`, which computes `end_at` as duration-only and would misrepresent the buffered-block invariant `createBookingCore` actually enforces) with correctly buffer-inclusive `start_at`/`end_at`.

### 3) Implementation plan

1. In `CustomerBookingViewRow`, add `duration_minutes: number` and `buffer_before_minutes: number`.
2. In the SQL query, add `s.duration_minutes, s.buffer_before_minutes` to the `SELECT` list (both already exist on `services` per `createBookingCore`'s usage).
3. Before building the return object, compute `const massageStart = new Date(row.start_at.getTime() + row.buffer_before_minutes * 60_000);` and `const massageEnd = new Date(massageStart.getTime() + row.duration_minutes * 60_000);`.
4. Replace `formatLocalTime(row.start_at, ...)` / `formatLocalTime(row.end_at, ...)` with `formatLocalTime(massageStart, ...)` / `formatLocalTime(massageEnd, ...)`.
5. Leave `row.start_at`/`row.end_at` (the buffered block) untouched everywhere else — they're only read here for the derivation, never re-stored.
6. In the test file, add a dedicated service fixture with e.g. `duration_minutes = 50, buffer_before_minutes = 10, buffer_after_minutes = 30` (inserted directly via `pool.query`, mirroring `createInactiveService`), and a booking created via `createBookingAt` with `start_at`/`end_at` matching the true buffered-block formula (`duration + buffer_before + buffer_after` total span), so the test fixture doesn't silently drift from what `createBookingCore` actually writes.
7. Assert the returned `start_at_local`/`end_at_local` strings correspond to `booking_start_at + buffer_before` and `+ duration_minutes` respectively — not the raw `start_at`/`end_at` — using the seeded `UTC` provider timezone (`resetAndSeed`'s default) so the expected formatted string is a fixed, computable value rather than a loose "contains" check.
8. Keep (or fold into the same `it`) a case with `buffer_before_minutes = 0` — e.g. the default seeded service from `resetAndSeed` (buffer_after=15, buffer_before=0) via `createBookingAt` — asserting `start_at_local` equals the formatted raw `start_at`, to lock in the zero-buffer-before non-regression criterion explicitly.
9. Run `npm run lint`, `npx tsc --noEmit`, `npm test -- --run`, `npm run build` in `backend/`.

### 4) Validation strategy (server-side)

- No new external input is accepted; `bookingId`/`rawToken` validation and the token-hash lookup are unchanged. `duration_minutes`/`buffer_before_minutes` come from the trusted `services` table (server-controlled, admin-authored), not client input — no new validation surface.

### 5) Test strategy

- What: strengthen the existing integration test to assert exact formatted `start_at_local`/`end_at_local` values for (a) a service with nonzero `buffer_before_minutes` (proves buffer is excluded from both ends) and (b) the zero-`buffer_before` case (proves no regression when there's no leading buffer).
- Why: the current test only checks `typeof ... === 'string'`, which passes identically whether the bug is present or fixed — it gives zero regression protection for this exact defect. Asserting on computed exact values (not substring/pattern matching) ties the test directly to the buffer-exclusion invariant.
- No unit test needed beyond this — the function is thin enough that the integration test through the real route + real DB is the more valuable and already-established test shape in this file.

### 6) CIA impact

- **Confidentiality: None.** No new data is exposed; the same booking's fields are shown to the same already-token-authorized caller — only the meaning of two already-visible timestamps is corrected.
- **Integrity: Low.** Corrects a display-layer defect (customer previously saw an inflated appointment window) without touching how bookings are stored, scheduled, or conflict-checked. Slight risk if the buffer math is implemented backwards — mitigated by the explicit exact-value test.
- **Availability: None.** No change to booking creation, availability computation, or the write path.

### 7) Dependency decision

- New dependency needed: **No.** `luxon`/`formatLocalTime` already in use; only arithmetic on existing `Date` values and two additional already-existing DB columns are needed.

---

## [IMPLEMENTER OUTPUT]

### `backend/src/services/bookingService.ts`

```diff
 interface CustomerBookingViewRow {
   id: string;
   status: BookingStatus;
   start_at: Date;
   end_at: Date;
   service_id: string;
   service_name: string;
   provider_timezone: string;
+  duration_minutes: number;
+  buffer_before_minutes: number;
 }

 export async function getBookingForCustomer(
   bookingId: string,
   rawToken: string,
 ): Promise<CustomerBookingView> {
   const result = await getPool().query<CustomerBookingViewRow>(
-    `SELECT b.id, b.status, b.start_at, b.end_at, s.id AS service_id, s.name AS service_name, p.timezone AS provider_timezone
+    `SELECT b.id, b.status, b.start_at, b.end_at, s.id AS service_id, s.name AS service_name,
+            p.timezone AS provider_timezone, s.duration_minutes, s.buffer_before_minutes
      FROM customer_booking_tokens t
      JOIN bookings b ON b.id = t.booking_id
      JOIN services s ON s.id = b.service_id
@@ -538,13 +541,19 @@ export async function getBookingForCustomer(
     throw new BookingNotFoundError();
   }

+  // row.start_at/end_at span the full reserved block (buffer_before +
+  // duration + buffer_after, see createBookingCore) -- the customer should
+  // only see the massage window itself.
+  const massageStart = new Date(row.start_at.getTime() + row.buffer_before_minutes * 60_000);
+  const massageEnd = new Date(massageStart.getTime() + row.duration_minutes * 60_000);
+
   return {
     id: row.id,
     status: row.status,
     serviceId: row.service_id,
     serviceName: row.service_name,
-    startAtLocal: formatLocalTime(row.start_at, row.provider_timezone),
-    endAtLocal: formatLocalTime(row.end_at, row.provider_timezone),
+    startAtLocal: formatLocalTime(massageStart, row.provider_timezone),
+    endAtLocal: formatLocalTime(massageEnd, row.provider_timezone),
   };
 }
```

### `backend/test/integration/bookings.customerManagement.test.ts`

```diff
 import { afterAll, beforeEach, describe, expect, it } from "vitest";
 import request from "supertest";
 import { createApp } from "../../src/app.js";
 import { closePool, getPool } from "../../src/db/pool.js";
+import { formatLocalTime } from "../../src/services/timeFormat.js";
 import {
   createBookingAt,
   createPendingBooking,
   mintCustomerBookingToken,
   resetAndSeed,
 } from "../helpers/fixtures.js";
@@
   it("returns status, service name, and local start/end time when the token matches", async () => {
     const bookingId = await createPendingBooking(pool, providerId, serviceId);
     const token = await mintCustomerBookingToken(pool, bookingId);
+    const stored = await pool.query<{ start_at: Date }>(`SELECT start_at FROM bookings WHERE id = $1`, [
+      bookingId,
+    ]);

     const response = await request(app).get(`/bookings/${bookingId}`).query({ token });

     expect(response.status).toBe(200);
     expect(response.body).toMatchObject({
       id: bookingId,
       status: "pending",
       service_id: serviceId,
       service_name: expect.any(String),
     });
-    expect(typeof response.body.start_at_local).toBe("string");
-    expect(typeof response.body.end_at_local).toBe("string");
+    // The seeded service has buffer_before_minutes = 0, so the displayed
+    // start must equal the raw stored start_at unchanged -- no regression
+    // for the common zero-buffer-before case.
+    expect(response.body.start_at_local).toBe(formatLocalTime(stored.rows[0].start_at, "UTC"));
+  });
+
+  it("excludes buffer time from the displayed window for a service with buffer_before and buffer_after", async () => {
+    const bufferedService = await pool.query<{ id: string }>(
+      `INSERT INTO services (provider_id, name, price, duration_minutes, buffer_before_minutes, buffer_after_minutes, active)
+       VALUES ($1, 'Hot Stone Massage', 80.00, 50, 10, 30, true) RETURNING id`,
+      [providerId],
+    );
+    const bufferedServiceId = bufferedService.rows[0].id;
+
+    // start_at/end_at as createBookingCore actually stores them: the full
+    // reserved block (buffer_before + duration + buffer_after).
+    const rawStart = new Date(Date.now() + 24 * 60 * 60 * 1000);
+    const rawEnd = new Date(rawStart.getTime() + (10 + 50 + 30) * 60_000);
+    const bookingId = await createBookingAt(
+      pool,
+      providerId,
+      bufferedServiceId,
+      rawStart.toISOString(),
+      rawEnd.toISOString(),
+    );
+    const token = await mintCustomerBookingToken(pool, bookingId);
+
+    const response = await request(app).get(`/bookings/${bookingId}`).query({ token });
+
+    expect(response.status).toBe(200);
+
+    const expectedMassageStart = new Date(rawStart.getTime() + 10 * 60_000);
+    const expectedMassageEnd = new Date(expectedMassageStart.getTime() + 50 * 60_000);
+    expect(response.body.start_at_local).toBe(formatLocalTime(expectedMassageStart, "UTC"));
+    expect(response.body.end_at_local).toBe(formatLocalTime(expectedMassageEnd, "UTC"));
+    expect(response.body.start_at_local).not.toBe(formatLocalTime(rawStart, "UTC"));
+    expect(response.body.end_at_local).not.toBe(formatLocalTime(rawEnd, "UTC"));
   });
```

### Notes on tricky parts
- `row.end_at` is still selected in SQL (unused by the new mapping — harmless extra already-indexed column) since `massageEnd` is now derived from `massageStart + duration_minutes` rather than reading `row.end_at`, because `buffer_after_minutes` must not affect the displayed end time.
- No migration/compat notes: pure response-shaping change. `CustomerBookingView.startAtLocal`/`endAtLocal` keep their type and JSON key names — only their computed value changes.

---

## [REVIEWER OUTPUT]

**Review summary:** Change matches the approved Architect plan precisely — a display-only shaping change scoped to `getBookingForCustomer`, with no touch to `start_at`/`end_at` storage, availability, or double-booking logic. Types are explicit (`duration_minutes: number`, `buffer_before_minutes: number`), no `any` introduced, naming (`massageStart`/`massageEnd`) is self-documenting, and the one added comment explains the non-obvious buffered-block invariant rather than restating the code. Error handling is untouched (`BookingNotFoundError` path unaffected). No new external input, no new AuthZ surface, no sensitive-data exposure — `duration_minutes`/`buffer_before_minutes` are server-trusted service config, not client input.

**Required fixes (blockers):** None.

**Suggested improvements (nice-to-have, not blocking):**
- `row.end_at` is now selected but unused in the mapping — harmless (one extra already-indexed column), not worth a follow-up.
- The two integration tests slightly overlap in querying the DB directly for expected values vs. reusing `formatLocalTime`; acceptable since `formatLocalTime` itself isn't under test, only the offset arithmetic is.

---

## [TESTER OUTPUT]

### Test cases covered
1. Zero-`buffer_before` regression: `start_at_local` equals `formatLocalTime(raw start_at)` exactly — proves the common case (default seeded service, `buffer_before=0`) is unchanged.
2. Nonzero-buffer case: a dedicated service (`duration=50, buffer_before=10, buffer_after=30`) with a booking whose `start_at`/`end_at` reflect the true buffered-block formula (matching `createBookingCore`'s semantics) — asserts the displayed window is exactly `[start+10, start+60]`, and explicitly asserts it does **not** equal the raw stored `start_at`/`end_at` (the negative assertion is what actually catches the original bug if it regressed).
3. All pre-existing auth/rate-limit/404/cancel paths for this router re-verified unchanged (12/12 in this file, 217/217 overall).

No new failure-path/invalid-input cases were needed — no new external input is accepted by this change.

### Test implementation notes
- Environment note: the local `masseur-pg` Docker container (Postgres for both `masseur_booking` dev and `masseur_booking_test`, mapped to `localhost:5433`) was stopped at the start of this run and had to be started (`docker start masseur-pg`) before the suite could connect. Both databases were already present and migrated on that container.

### How to run
```
cd backend
npm test -- --run
```
Requires the `masseur-pg` Docker container running (`localhost:5433`, `masseur_booking_test` migrated — see `agents/context_template.md`).

### Results
- `npm test -- --run`: **217/217 tests passed**, 28/28 files, 6.61s.
- `npm run lint`: clean.
- `npx tsc --noEmit`: clean.
- `npm run build`: clean.

---

## [SECURITY OUTPUT]

### 1) CIA Impact
- **Confidentiality: None.** Same authorized caller (valid `customer_booking_tokens` hash match, unchanged) sees the same booking; only the *meaning* of two already-returned timestamps is corrected. `duration_minutes`/`buffer_before_minutes` are read from `services` (already-public catalog data, exposed via the public services endpoint) and never returned directly — only used as arithmetic inputs.
- **Integrity: Low.** Fixes a data-correctness/display defect. No write path touched — `bookings.start_at`/`end_at` (the actual scheduling record) are untouched.
- **Availability: None.** No change to booking creation, locking, or availability computation; single indexed-join SELECT unchanged in shape, two extra scalar columns.

### 2) OWASP-style Checks
- **Input validation & injection risk:** No new input. SQL is a static parameterized query (`$1`/`$2` unchanged); the two new selected columns are plain identifiers, not interpolated.
- **AuthN/AuthZ correctness:** Unchanged — token-hash match against `customer_booking_tokens` gates access exactly as before.
- **Sensitive data exposure:** None introduced. Arguably improved: the previous behavior over-disclosed operational buffer time as if it were the massage window (a minor correctness leak of internal scheduling logic into customer-facing display), now corrected.
- **Security misconfiguration:** N/A.
- **Logging & monitoring gaps:** N/A — no logging changed.

### 3) Dependency & Supply Chain Review
- New dependencies: **No.** Only `Date` arithmetic and existing `luxon`-backed `formatLocalTime`.
- Audit evidence: not re-run (no dependency change); prior accepted `npm audit` exception for backend dev-toolchain (vite/vitest) documented in `agents/context_template.md` stands unchanged.

### 4) Threat Mini-Model
- **Assets:** Booking timestamps, service configuration (buffer/duration minutes).
- **Entry points:** `GET /bookings/:id` (token-gated, rate-limited — unchanged).
- **Threats:** None newly introduced by this diff.
- **Mitigations:** N/A — no new threat surface.

### 5) Risk Summary
- **Severity: Low** (display-correctness fix, no security-relevant surface change).
- **Required mitigations before merge:** None.
- **Follow-ups:** None from Security.

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
- ✅ Acceptance criteria met — all 7 verified (see below)
- ✅ Edge cases considered: zero-buffer regression case explicitly tested
- ✅ No breaking changes — `CustomerBookingView` shape/field names unchanged, no migration needed

**Code Quality**
- ✅ No unnecessary `any` — two new fields typed `number`
- ✅ Follows conventions.md (clarity, explicit types, minimal diff)
- ✅ `npm run lint` clean
- ✅ No dead code/debug logs

**Tests**
- ✅ New behavior has tests — 1 strengthened + 1 new integration test
- ✅ Negative-style assertion included (`.not.toBe(...)` against raw buffered-block values)
- ✅ `npm test -- --run`: 217/217 passed, 28/28 files

**Security (SSDLC)**
- ✅ Input validation N/A (no new input)
- ✅ AuthZ unchanged/verified (token-hash gate untouched)
- ✅ No sensitive-data leakage introduced
- ✅ No secrets committed

**Dependency & Supply Chain**
- ✅ No new dependency
- N/A audit (no dependency change); existing accepted exception in `agents/context_template.md` stands

**Documentation & Traceability**
- N/A — no README/behavior-contract change (field semantics documented only in this task's own file/report, not a public API doc)

### Acceptance criteria verification
1. ✅ `startAtLocal` = `start_at + buffer_before_minutes` — implemented, test-verified against a `buffer_before=10` fixture.
2. ✅ `endAtLocal` = `massageStart + duration_minutes` — implemented, test-verified.
3. ✅ Zero-`buffer_before` case unchanged — dedicated regression test against the default seeded service.
4. ✅ Strengthened test replaces the weak `typeof` assertion; new test covers nonzero buffer.
5. ✅ No change to stored `start_at`/`end_at`, availability, or conflict prevention — confirmed by diff (only the response-mapping function touched).
6. ✅ No frontend changes — confirmed (no files under `frontend/` touched).
7. ✅ `npm test`, `npm run build`, `npm run lint`, `tsc --noEmit` all pass in `backend/`.

### How to verify
```
cd backend
npm test -- --run      # 217/217
npm run lint            # clean
npx tsc --noEmit        # clean
npm run build            # clean
```
Manual: create a booking against a service with nonzero `buffer_before_minutes`/`buffer_after_minutes`, then `GET /bookings/:id?token=...` — confirm `start_at_local`/`end_at_local` span only the massage duration, not the full reserved block.

### Rollback / migration notes
None needed — no schema change, no data migration, purely a response-computation fix. Reverting the two-file diff fully reverts behavior.

### Environment note (informational, not part of the DoD)
The `masseur-pg` Docker container (test/dev Postgres on `localhost:5433`) was stopped at the start of this session and was started to run the test suite — it is left running now.

### Final Result
**DoD Status: PASS.** No blockers from Reviewer or Security.

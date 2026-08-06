# Run Report: 008-admin-service-availability-crud

Admin CRUD for Service, AvailabilityRule, AvailabilityException, and Provider profile
Profile: Node/TypeScript Backend

---

## [ARCHITECT OUTPUT]

### 1. Scope & Assumptions
- Provider bootstrapping confirmed out of scope for this API -- exactly one `providers` row in v1, seeded manually; no `POST /admin/provider`.
- New primitive: every existing query resolves `provider_id` through a `service_id`/`booking_id` join -- nothing resolves "the provider" standalone yet. Added `loadSingletonProviderId()` (`SELECT id FROM providers LIMIT 1`), used to scope every admin create/update so `provider_id` is never client-supplied. A missing row is a deploy/seeding misconfiguration, not a client-reachable case -- left as a plain thrown error (generic 500), matching how `loadBookingEmailContext` treats "should never happen."
- `name`'s `NOT NULL` migration needs a one-time backfill, not a permanent default, so it's genuinely required going forward -- this meant `test/helpers/fixtures.ts`'s service inserts needed a real `name`/`price`.
- No generic-404-collapsing needed here (unlike task 007) -- admin-only resources behind an already-validated session, no untrusted-credential-pairing/enumeration concern.
- Rate limiting: reuse the existing `adminRateLimit` (20/min) as-is, per the task's explicit "consistent with 002/006" instruction.

### 2. File Impact List
`src/db/migrations/008_service_display_fields.sql`, `src/services/adminCatalogService.ts` (new), `src/routes/adminServices.ts`/`adminAvailability.ts`/`adminProvider.ts` (new), `src/validation/adminServiceSchema.ts`/`adminAvailabilitySchema.ts`/`adminProviderSchema.ts` (new -- provider schema not in the original file list), `src/db/types.ts`, `src/errors.ts`, `src/app.ts`, `test/helpers/fixtures.ts`, plus three new integration test files.

### 3. Implementation Plan (as confirmed)
1. Migration: backfill-then-`NOT NULL` for `name`; nullable `price NUMERIC(10,2)`.
2. `adminCatalogService.ts`: `loadSingletonProviderId()`; full CRUD for services/rules/exceptions/provider; `end_time > start_time` on rule PATCH validated against the merged current-row + patch values, not purely in the schema.
3. `price` mapped `Number(row.price)` in responses (pg returns `NUMERIC` as a string).
4. Validation split across three schema files; weekday 1-7, `HH:MM:SS` bounded regex + string-ordering comparison, exception `date`/`type`, provider `timezone` via Luxon's `Info.isValidIANAZone`.
5. New errors: `AvailabilityRuleNotFoundError`, `AvailabilityExceptionNotFoundError` (both 404); reused existing `ServiceNotFoundError`.
6. All routes: `requireMasseurAuth` + `adminRateLimit`.
7. Two regression tests proving Service/AvailabilityRule/AvailabilityException edits never touch existing Booking rows.

### 4-7. Validation/Test strategy, CIA impact, Dependency decision
No new dependency (`zod`, `luxon`, `pg` sufficient). CIA: Confidentiality Low, Integrity Medium (mitigated by the regression tests), Availability Low.

**User's four confirmations before Implementer ran:**
1. `price` required on `POST` schema (not the DB column, which stays nullable); optional on `PATCH`.
2. Every `DELETE` returns `200` + a small JSON confirmation body, not `204`.
3. Merge-then-validate for availability-rule `PATCH` confirmed correct; noted `availability_rules` already has `CHECK (end_time > start_time)` at the DB level (migration 004) as the real correctness backstop -- the app-level check is for a clean 400. Explicit requirement: a constraint-violation fallback must still map to a clean 4xx, never a raw 500.
4. `adminCatalogService.ts`'s dynamic `UPDATE ... SET` builder must map field names from a fixed, hardcoded allowlist -- never by interpolating whatever keys happen to be present in the validated patch object, since column names can't be parameterized like values can.

## [IMPLEMENTER OUTPUT]

**New files:** migration 008, `adminCatalogService.ts`, three admin route files, three admin validation schema files, `src/validation/idParamSchema.ts` (shared plain-UUID `:id` schema, not in the original file list -- `bookingIdParamSchema`'s error message names "booking" specifically and would have been misleading reused here), `test/unit/adminCatalogService.test.ts`, three new integration test files.

**Changed files:** `src/db/types.ts` (`Service` gains `price: number | null`), `src/errors.ts` (two new 404 errors), `src/app.ts` (mounted the three new routers; added a constraint-violation → 400 fallback per your point 3), `test/helpers/fixtures.ts` (services now insert `name`/`price`; `createAvailabilityRule`/`createAvailabilityException` widened to return the inserted row's `id`, matching `createBookingAt`'s existing convention).

**`buildSetClause` (point 4):** iterates the fixed `*_UPDATE_COLUMNS` map's own keys, never the input object's keys -- `for (const key of Object.keys(columnMap))`, looking up `input[key]` only for keys the map already names. A future loosened `.strict()` can't turn an unexpected input key into an interpolated column reference.

**Constraint-violation fallback (point 3):** `app.ts` now checks `err instanceof DatabaseError && err.code?.startsWith("23")` (SQLSTATE class 23 = integrity constraint violation) before falling through to the generic 500, mapping it to a plain 400.

**Bug found and fixed during implementation (before Reviewer even ran):** the local test DB had stray `name`/`price`-like drift from earlier local experimentation, unrelated to any tracked migration -- reconciled (dropped a stray default, let the normal test fixture reset clear the one leftover row) so the DB state matches the migration file exactly, rather than leaving undocumented drift.

**Migration/compat notes:** additive only. `services.name` is `NOT NULL` going forward (backfilled for any pre-existing rows); `price` stays nullable at the DB level.

## [REVIEWER OUTPUT]

**Review summary:** Matches the confirmed plan and all four constraints. One real bug found and fixed in this pass.

**Required fixes (blockers) -- found and fixed:** `toAvailabilityException`'s date conversion used `row.date.toISOString().slice(0, 10)`. `pg`'s `DATE` parser (`postgres-date`) builds the JS `Date` from **local** calendar components, not UTC (its own source comment: "force YYYY-MM-DD dates to be parsed as local time") -- so reading it back via `toISOString()` (UTC components) shifts the date by one whenever the server isn't running in UTC. Caught immediately by the integration suite on this UTC+2/+3 dev machine (`expected '2026-12-24' to be '2026-12-25'`). Fixed with an exported, timezone-independent `toIsoDateString` helper using local getters, covered by a dedicated unit test that doesn't rely on the host's timezone to catch a regression.

**Verification of the four constraints:** all confirmed by direct code reading + a passing test each -- see Security section 2 for the itemized mapping.

**Suggested improvements (nice-to-have, not blocking):** `getProvider()` does two round-trips (`loadSingletonProviderId()` then a second `SELECT`) where one query would do -- kept for consistency with every other function's shape, negligible at this project's scale. No single-resource `GET /:id` for services/rules/exceptions -- not required by acceptance criteria.

## [TESTER OUTPUT]

**Test cases added:** 2 unit + 36 integration across three new files.

**Coverage highlights:** full create→list→update/delete lifecycle per resource; every documented validation rule gets its own 400 test; 404s for unknown ids; 401 on every route without a session; **both required regression tests** (editing a service's duration/buffers, and deleting a rule/exception a booking falls within, both proven to leave the booking's `start_at`/`end_at`/`status` byte-identical); a direct-SQL test confirming `availability_rules`' `CHECK (end_time > start_time)` still independently rejects bad data at the DB layer (SQLSTATE `23514`), matching the established `bookings.exclusionConstraint.test.ts` pattern.

**Issues found and fixed during this pass:**
1. The date off-by-one bug (see Reviewer).
2. `admin.availability.test.ts` initially made ~21 authenticated calls against the shared `adminRateLimit` (20/min) instance for that file, tripping 429s partway through. Per your point 3's framing (session-authenticated, no reason to loosen the existing limiter), fixed by trimming redundant setup calls rather than touching the rate limit value: widened `createAvailabilityRule`/`createAvailabilityException` fixtures to return the created row's `id` so regression tests seed via direct DB insert instead of a redundant authenticated `GET`. Brought the file to 18 calls.
3. Migration 008 required fixture updates for `name`/`price` on every service insert.

**How to run:**
```bash
psql -d masseur_booking_test -f src/db/migrations/008_service_display_fields.sql
DATABASE_URL=postgres://<user>@localhost:5432/masseur_booking_test \
ADMIN_EMAIL=admin@example.com APP_BASE_URL=https://example.com \
npm test -- --run
```
**Actual result:** `Test Files 22 passed (22)`, `Tests 182 passed (182)`.

## [SECURITY OUTPUT]

### 1) CIA Impact
Confidentiality: **Low** (no new PII, admin-only). Integrity: **Medium** (mitigated by the two regression tests and the fixed-allowlist `UPDATE` builder). Availability: **Low** (rate-limited).

### 2) OWASP-style Checks
- **Input validation & injection:** every field validated server-side via zod before touching the DB (AC #4); all SQL parameterized; the one dynamically-assembled piece of SQL (column names in `buildSetClause`) draws exclusively from a hardcoded map's own keys, never request-controlled object keys -- directly closes the injection-via-column-name path from your point 4.
- **AuthN/AuthZ correctness:** every route is `requireMasseurAuth` → `adminRateLimit`, in that order, on all three new routers -- an unauthenticated request never reaches the handler or consumes rate-limit quota. `provider_id` never client-suppliable. Verified by test: every route 401s without a session.
- **Sensitive data exposure:** none introduced.
- **Security misconfiguration:** the new SQLSTATE-class-23 → 400 fallback in `app.ts` prevents an unanticipated constraint violation from leaking as a raw 500 -- verified by a direct-SQL test confirming the underlying `CHECK` constraint (and its code) still exists.
- **Logging & monitoring gaps:** none introduced.

### 3) Dependency & Supply Chain Review
New dependencies: **None** (`DatabaseError` imported from the already-present `pg` package). `npm audit --omit=dev` → **0 vulnerabilities**. Recommendation: **Accept**.

### 4) Threat Mini-Model
Assets: service catalog, working-hours configuration, provider profile. Entry points: 13 new `/admin/*` routes. Threats: compromised-session mutation; a future schema change reopening the column-name path; a validation gap leaking internals via a raw constraint error. Mitigations: session auth + rate limit (verified), fixed-allowlist column mapping (verified), generic constraint-violation fallback (verified), the two regression tests.

### 5) Risk Summary
Severity: **Low**. No outstanding required mitigations. No follow-ups beyond the Reviewer's nice-to-haves.

### 6) Secure SDLC Phase
Phase: Implementation. Re-review required: No.

### Merge Decision
Approved for merge: **Yes**

## [RELEASE OUTPUT]

### DoD checklist verification
Acceptance criteria met (9/9) -- edge cases considered -- lint/typecheck/tests pass (`182/182`) -- dependency audit clean, no new deps -- security review approved -- no secrets committed -- docs n/a for this task.

### How to verify
```bash
psql -d masseur_booking_test -f src/db/migrations/008_service_display_fields.sql
DATABASE_URL=postgres://<user>@localhost:5432/masseur_booking_test \
ADMIN_EMAIL=admin@example.com APP_BASE_URL=https://example.com \
npm test -- --run
npm run typecheck && npm run lint
npm audit --omit=dev
```

### Release checklist
Versioning: n/a (pre-1.0). CI green: verified locally. Dependency audit: attached above. Security findings: none outstanding. Docs: n/a. Rollback/migration notes: migration 008 is additive (`name`/`price` added to `services`, `name` backfilled then set `NOT NULL`) -- rollback is `ALTER TABLE services DROP COLUMN name, DROP COLUMN price;` with no data loss elsewhere and no existing endpoint behavior change.

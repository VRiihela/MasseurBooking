# Run Report: 009-public-services-admin-bookings-list

Public service listing and admin booking list/pending-queue view
Profile: Node/TypeScript Backend

---

## [ARCHITECT OUTPUT]

### 1. Scope & Assumptions
- `GET /admin/bookings` stays in the existing `routes/bookings.ts` (already mixes customer- and masseur-facing routes for the `bookings` resource, unlike services/availability/provider which got dedicated `adminX.ts` files in 008 because those were genuinely new resource surfaces), not a new file.
- `GET /services`'s read logic lives in the existing `adminCatalogService.ts` as a new `listActiveServices()`, per the task's file list; the route layer narrows the response to the four public-safe fields, matching how every other route in this codebase decides wire shape at the route layer, not the service layer.

### 2. File Impact List
`src/routes/services.ts` (new), `src/routes/bookings.ts`, `src/services/adminCatalogService.ts` (+`listActiveServices`), `src/services/bookingService.ts` (+`listBookingsForAdmin`), `src/validation/adminBookingsQuerySchema.ts` (new), `src/middleware/rateLimit.ts` (+`publicServicesRateLimit`), `src/app.ts`, two new integration test files.

### 3-7. Plan / Validation / Test strategy / CIA / Dependencies
No schema changes, no new dependency. Confidentiality Medium overall (Low for the public route, Medium for the PII-bearing admin route); Integrity None (pure reads); Availability Low (rate-limited).

**User's two confirmations before Implementer ran:**
1. **Status filter enum excludes `completed`.** The task listed `completed` as a fourth valid value four times, but `BookingStatus` has only ever been `pending | confirmed | cancelled` — the same phantom status that showed up in task 008's own non-goals text. User confirmed option (a): reject `completed` like any other unrecognized value, no speculative support for a status nothing can ever set. User also noted `documents/masseur-booking-system-design.md`'s Booking data model has since been corrected to state this explicitly (`completed`/`no_show` were an earlier draft's aspiration, never implemented — migration 002's CHECK constraint only ever allowed three values) as the source of truth for any future task.
2. **`publicServicesRateLimit` minted as its own dedicated limiter** (same 30/min values as `availabilityRateLimit` for now, independent bucket) rather than sharing `availabilityRateLimit`'s bucket directly -- consistent with how every task-007 customer route got its own named limiter even at matching values.

## [IMPLEMENTER OUTPUT]

**New files:** `src/routes/services.ts`, `src/validation/adminBookingsQuerySchema.ts`, `test/integration/services.public.test.ts`, `test/integration/admin.bookingsList.test.ts`.

**Changed files:** `src/services/adminCatalogService.ts` (+`listActiveServices`; `loadSingletonProviderId` widened from private to exported), `src/services/bookingService.ts` (+`listBookingsForAdmin`, importing the now-exported `loadSingletonProviderId`), `src/routes/bookings.ts` (+`GET /admin/bookings`), `src/middleware/rateLimit.ts` (+`publicServicesRateLimit`), `src/app.ts` (mounted `servicesRouter`).

**Design decision made during implementation (not pre-specified):** `listBookingsForAdmin` needed to resolve "the" provider id the same way `adminCatalogService.ts`'s admin routes already do, but that logic (`loadSingletonProviderId`) was private to that file. Rather than duplicate the same `SELECT id FROM providers LIMIT 1` query in `bookingService.ts`, exported it from `adminCatalogService.ts` and imported it -- two call sites in two files needing the exact same "resolve the one true provider" lookup is reason enough to share it, not a premature abstraction.

**Migration/compat notes:** none -- no schema changes, purely additive routes/functions over existing tables.

## [REVIEWER OUTPUT]

**Review summary:** Matches the confirmed plan and both resolved open questions. No blockers found.

- `listActiveServices()`/`publicServiceResponse()` correctly whitelist fields rather than spreading the domain object -- a future `Service` field addition can't leak by accident.
- `listBookingsForAdmin` correctly scopes by `provider_id` via the newly-shared `loadSingletonProviderId()`.
- Route ordering (`/admin/bookings` vs `/bookings/:id`) has no collision risk -- different first path segment.
- `adminBookingsQuerySchema` excludes `completed` per the confirmed decision, verified by a dedicated test.
- `GET /admin/bookings` sits behind `requireMasseurAuth` in the same middleware order as every other admin route, verified by a real 401 test rather than route-wiring inspection, per the task's explicit security consideration.

**Suggested improvements:** none identified -- narrow scope, reused already-hardened patterns from 007/008.

## [TESTER OUTPUT]

**Test cases added:** 12 integration tests, no new unit tests needed (no new pure logic beyond what's already covered elsewhere).

**Coverage highlights:**
- `services.public.test.ts`: no-auth access; only `active = true` returned; exact response shape via `toEqual` (fails immediately on an accidental leak, not just `toMatchObject`); explicit `not.toHaveProperty` checks for the four forbidden fields; empty-catalog case; rate limit.
- `admin.bookingsList.test.ts`: 401-without-session as its own test; ordering verified by exact id sequence, not just count; `?status=pending` filtering; both a nonsense value and the specifically-excluded `completed` asserted 400; a real cross-timezone test (`America/New_York`, January, UTC-5) asserting the local string contains `9:00 AM` and explicitly does not contain the raw UTC hour -- proves actual conversion, not just presence of a string; rate limit.

**No issues found this pass** -- everything passed on the first run.

**How to run:**
```bash
DATABASE_URL=postgres://<user>@localhost:5432/masseur_booking_test \
ADMIN_EMAIL=admin@example.com APP_BASE_URL=https://example.com \
npm test -- --run
```
**Actual result:** `Test Files 24 passed (24)`, `Tests 194 passed (194)`.

## [SECURITY OUTPUT]

### 1) CIA Impact
Confidentiality: Medium overall (Low for `GET /services`, Medium for `GET /admin/bookings`'s customer PII, appropriate for the masseur's own bookings). Integrity: None. Availability: Low.

### 2) OWASP-style Checks
Input validation via a fixed zod enum before any query runs; all SQL parameterized including the conditional status clause. AuthN/AuthZ: `requireMasseurAuth` → `adminRateLimit` on `GET /admin/bookings`, verified failing without a session via a real test. Sensitive data exposure: `GET /services` is a hand-built whitelist, tested for absence of internal fields; `GET /admin/bookings`'s PII exposure is the task's own explicit, reviewed design, contrasted directly against task 007's intentionally-minimal customer view. No security misconfiguration or logging gaps introduced.

### 3) Dependency & Supply Chain Review
No new dependencies. `npm audit --omit=dev` → 0 vulnerabilities. Recommendation: **Accept**.

### 4) Threat Mini-Model
Assets: public-safe service catalog, customer PII on the admin list. Entry points: the two new routes. Threats: catalog scraping, an unvalidated `?status=` reaching the DB, the admin list becoming reachable without a session. Mitigations: independent rate-limit buckets, zod validation before any query, a real 401 test.

### 5) Risk Summary
Severity: **Low**. No outstanding mitigations, no follow-ups identified.

### 6) Secure SDLC Phase
Phase: Implementation. Re-review required: No.

### Merge Decision
**Approved for merge: Yes**

## [RELEASE OUTPUT]

### DoD checklist verification
Acceptance criteria met (9/9) — edge cases considered — lint/typecheck clean — 194/194 tests passing — `npm audit --omit=dev` 0 vulnerabilities, no new dependencies — security review approved — no secrets committed — docs: design doc's Booking status model already corrected by the user directly.

### How to verify
```bash
DATABASE_URL=postgres://<user>@localhost:5432/masseur_booking_test \
ADMIN_EMAIL=admin@example.com APP_BASE_URL=https://example.com \
npm test -- --run
npm run typecheck && npm run lint
npm audit --omit=dev
```

### Release checklist
Versioning: n/a (pre-1.0). CI green: verified locally. Dependency audit: attached above. Security findings: none outstanding. Docs: n/a. Rollback/migration notes: no migration in this task -- purely additive routes/functions, trivially revertable.

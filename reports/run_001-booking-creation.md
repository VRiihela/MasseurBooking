# Run Report: 001-booking-creation

Booking creation with double-booking prevention and manual confirmation
Profile: Node/TypeScript Backend

---

## [ARCHITECT OUTPUT]

### 1. Scope & assumptions

**In scope:** `POST /bookings` — validate input, serialize concurrent requests for the same provider/time-range, insert a `pending` Booking, add the DB-level exclusion constraint as a backstop, enqueue a "request received" email job. Nothing else.

**Assumptions:**

1. **Greenfield DB.** No `src/` or DB schema existed before this task. `Booking` has FKs to `Provider`, `Service`, `Customer`, so minimal versions of those three tables are created in migration 001 (only the columns this feature needs) — full CRUD/management of those entities is a separate task.
2. **Availability-rule enforcement (working hours) is out of scope for this task.** "Slot is free" here means *no overlapping non-cancelled Booking exists* — it does not check `AvailabilityRule`/`AvailabilityException`. Flagged explicitly in the Release notes below as a pre-launch gate.
3. **Magic-link token generation is out of scope.** The email job carries booking id + customer email only; token minting belongs to the email-worker or a follow-up task.
4. **Provider is a singleton row** per the v1 design — no multi-provider selection logic needed.
5. **DB access: `pg` (node-postgres), not Prisma** — correctness here hinges on `FOR UPDATE`, a Postgres advisory lock, and a raw exclusion constraint, all of which `pg` expresses directly.

**Revisions from review (applied before implementation):**

- **UUID primary keys, not serial**, on all new tables (`providers`, `services`, `customers`, `bookings`, `email_jobs`) via `gen_random_uuid()` — sequential ids become enumerable once confirm/decline and magic-link endpoints reference bookings by id in later tasks. `pgcrypto` is enabled alongside `btree_gist` so `gen_random_uuid()` works on Postgres <13 as well as built-in on 13+.
- **201 response body is specified**: `{ id, status, start_at, end_at }` (ISO 8601 UTC strings for the timestamps).
- **Integration tests get their Provider/Service via fixture rows inserted in `beforeEach`** (see `test/helpers/fixtures.ts`), not a seed migration. Migrations only ever create schema, never rows.
- **`src/db/schema.ts` renamed to `src/db/types.ts`** to avoid confusion with the actual schema, which lives in `src/db/migrations/*.sql`.
- **Hard constraint carried into Implementer: all DB access uses parameterized queries (`$1`/`$2`, ...), never string-interpolated SQL.** Verified in every file below — no template-literal SQL anywhere in `bookingService.ts`, `emailQueueService.ts`, or test fixtures.
- **Release-stage note added** (see Release section): this endpoint is not safe to expose publicly or wire to the real frontend until the availability-check task (working hours / `AvailabilityRule`) ships.

### 2. File impact list

```
package.json, tsconfig.json, vitest.config.ts, eslint.config.js, .env.example   # new app scaffolding (greenfield)
src/config/db.ts
src/db/pool.ts
src/db/types.ts                                            # renamed from schema.ts
src/db/migrations/001_init_core_tables.sql
src/db/migrations/002_bookings_and_exclusion_constraint.sql
src/errors.ts
src/validation/bookingSchema.ts
src/services/bookingService.ts
src/services/emailQueueService.ts
src/middleware/rateLimit.ts
src/routes/bookings.ts
src/app.ts
src/server.ts
test/helpers/fixtures.ts
test/unit/bookingSchema.test.ts
test/unit/bookingService.test.ts
test/integration/bookings.concurrency.test.ts
test/integration/bookings.exclusionConstraint.test.ts
agents/context_template.md                                # +1 note on start_at semantics
```

### 3. Implementation plan

1. Migration 001: enable `pgcrypto` + `btree_gist`; create minimal UUID-keyed `providers`, `services`, `customers` tables.
2. Migration 002: create `bookings` (UUID pk, `status` check, `end_at > start_at` check, the exclusion constraint) and `email_jobs` (transactional outbox).
3. **Concurrency design — deviation from the literal task text, called out explicitly:** `SELECT ... FOR UPDATE` only locks *existing* rows, so it never serializes two concurrent requests for a genuinely empty slot. Fix: take a **Postgres advisory transaction lock keyed on `provider_id`** (`pg_advisory_xact_lock(hashtext(provider_id))`) first inside the transaction. This serializes concurrent attempts for the same provider; the exclusion constraint remains the true backstop for anything that bypasses the app layer (bugs, a second instance, direct SQL).
4. `bookingService.createBooking()`: open transaction → load active service (must belong to provider, `active = true`) → advisory lock on `provider_id` → compute `end_at` server-side from `duration_minutes + buffer_before + buffer_after` (client-supplied `end_at` is rejected by the schema, never read) → overlap check with `FOR UPDATE` → insert `Booking` (`status='pending'`) → insert `email_jobs` row in the same transaction → commit.
5. Route handler maps `SlotUnavailableError`→409, `ServiceNotFoundError`→404, validation failure→400, unexpected→500 via shared error middleware (no stack traces to client).
6. `bookingSchema.ts`: `start_at` must match a strict UTC ISO-8601 pattern (`Z` or `+00:00`), must parse, and must be in the future. `service_id` must be a UUID. Customer fields required/trimmed. `.strict()` on both objects rejects unknown fields (e.g. a client-supplied `end_at`).
7. Rate-limit `POST /bookings` per IP (5/min) via `express-rate-limit`.
8. Shared Express error middleware: generic `{ error }` shape, logs internally, never leaks stack traces.
9. No calendar API call anywhere in this path (confirmed absent by design).

### 4. Validation strategy (server-side)

- Zod is the single source of truth for shape; `.strict()` rejects unknown fields.
- `start_at`: regex-gated for explicit UTC offset before parsing; rejects past timestamps.
- `service_id`: existence + `provider_id` + `active` checked via a DB round trip in the service layer, not just shape-checked.
- `end_at` is **never** accepted from the client — always derived server-side from the service definition.
- 409 message is generic ("slot no longer available") regardless of cause — never reveals another customer's booking.

### 5. Test strategy

- **Unit (`bookingSchema`):** UTC-format enforcement, past-date rejection, missing/malformed fields, unknown-field rejection.
- **Unit (`bookingService`):** mocked `pg` client — overlap → `SlotUnavailableError`; missing/inactive service → `ServiceNotFoundError`; `end_at` computed from service duration + buffers.
- **Integration (concurrency, AC #2):** two concurrent `POST /bookings` for the same overlapping slot against a real Postgres instance — exactly one 201, one 409, exactly one row persisted.
- **Integration (exclusion constraint, AC #3):** raw SQL inserts bypassing the app layer — second overlapping insert violates the exclusion constraint; a `cancelled` booking does not block a new one (AC #5).
- Fixtures: a fresh `Provider`/`Service` row pair is inserted in `beforeEach` via `test/helpers/fixtures.ts` — no seed migration.

### 6. CIA impact

- **Confidentiality — Low/Med:** endpoint writes customer PII (name/email/phone); no read path returns other customers' data; 409 message is deliberately generic.
- **Integrity — High:** double-booking prevention is the point of this task; three layers (advisory lock → row-lock overlap check → exclusion constraint) are load-bearing.
- **Availability — Low:** single masseur, low volume; per-provider advisory lock can't become a global bottleneck; rate limiting mitigates slot-lockout scripting.

### 7. Dependency decision

New dependencies: **Yes**, justified — `pg` (raw SQL control for locks/transactions/exclusion constraint), `zod` (strict server-side validation incl. custom UTC refinement), `express-rate-limit` (explicit security requirement). Dev-only: `typescript`, `tsx`, `vitest`, `supertest`, `eslint` + `typescript-eslint` (profile-mandated tooling). Not added: an ORM, a job-queue library (the `email_jobs` outbox table inside the same transaction satisfies "enqueue a job" without new infra).

---

## [IMPLEMENTER OUTPUT]

All files listed above were created and verified to compile/lint/test cleanly (see Release section for command output). Highlights:

**`src/db/migrations/002_bookings_and_exclusion_constraint.sql`** — UUID pk via `gen_random_uuid()`, `CHECK (end_at > start_at)`, and:
```sql
EXCLUDE USING gist (
  provider_id WITH =,
  tstzrange(start_at, end_at) WITH &&
) WHERE (status IN ('pending', 'confirmed'))
```

**`src/services/bookingService.ts`** — the concurrency-critical path:
```ts
async function lockProvider(client: PoolClient, providerId: string): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [providerId]);
}
...
export async function createBooking(input: CreateBookingInput): Promise<Booking> {
  return withTransaction(async (client) => {
    const service = await loadActiveService(client, input.service_id);
    await lockProvider(client, service.provider_id);

    const startAt = new Date(input.start_at);
    const totalMinutes =
      service.duration_minutes + service.buffer_before_minutes + service.buffer_after_minutes;
    const endAt = new Date(startAt.getTime() + totalMinutes * 60_000);

    if (await hasOverlappingBooking(client, service.provider_id, startAt, endAt)) {
      throw new SlotUnavailableError();
    }
    const customerId = await insertCustomer(client, input.customer);
    const insertResult = await client.query<BookingRow>(
      `INSERT INTO bookings (provider_id, service_id, customer_id, start_at, end_at, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')
       RETURNING id, provider_id, service_id, customer_id, start_at, end_at, status, created_at`,
      [service.provider_id, service.id, customerId, startAt.toISOString(), endAt.toISOString()],
    );
    const booking = toBooking(insertResult.rows[0]);
    await enqueueBookingRequestReceived(client, booking, input.customer.email);
    return booking;
  });
}
```
All queries are parameterized (`$1`, `$2`, ...) — confirmed, no string-interpolated SQL anywhere in the codebase.

**`src/routes/bookings.ts`** — 201 response shape exactly as specified in the revised Architect plan:
```ts
res.status(201).json({
  id: booking.id,
  status: booking.status,
  start_at: booking.startAt.toISOString(),
  end_at: booking.endAt.toISOString(),
});
```

**Tricky parts:**
- The advisory-lock-before-overlap-check ordering is the single most important correctness detail — get it backwards (overlap check before lock) and the concurrency acceptance criterion fails intermittently under real concurrency, even though it would look correct in a non-concurrent test.
- `service` lookup happens *before* the advisory lock (read-only, provider_id needed to know what to lock) — this is safe because `services` rows aren't mutated by this code path.
- Vitest runs test files in parallel by default; since the integration tests share one real Postgres DB and reset fixtures via `DELETE`/`INSERT` in `beforeEach`, this caused a real FK-violation race between test files until `fileParallelism: false` was set in `vitest.config.ts`. Noting this because it's a common trap for anyone adding more integration test files later.

**Migration/compat notes:** purely additive (new tables), no existing data to migrate.

---

## [REVIEWER OUTPUT]

**Review summary:** Implementation matches the revised Architect plan. Core concurrency guarantee (advisory lock → row-lock overlap check → exclusion-constraint backstop) was verified against a real Postgres instance, not just unit-mocked — this is the part most likely to be wrong in a naive implementation and it held up.

**Required fixes (blockers):** None.

**Suggested improvements (nice-to-have, not blocking):**
- `insertCustomer` always inserts a new `customers` row per booking, even for a repeat email — acceptable for v1 guest checkout (no accounts), but worth a dedupe-by-email pass once repeat customers matter.
- `hashtext(providerId)` for the advisory lock key: negligible collision risk across UUIDs is fine at single-provider scale; would want a composite/namespaced key if this app ever supports many providers concurrently issuing advisory locks for unrelated reasons.
- No structured request logging yet (e.g. request id / correlation id) — fine for this task's scope, but worth adding before this endpoint sees real traffic, to make the 409/429 paths debuggable in production.
- `error.issues[0]` in the route handler surfaces only the first Zod validation error to the client; acceptable per "clear message" requirement, but multi-error responses could be a future UX improvement.

**Architectural consistency:** Matches conventions.md (strict TS, explicit return types on exports, consistent error shapes, no stack traces to client) and the transactional-outbox pattern is a reasonable, dependency-free way to satisfy "enqueue an email job" per the DoD's "minimize new dependencies" guidance.

---

## [TESTER OUTPUT]

### Test cases
- **Schema (unit):** valid UTC payload accepted; non-UTC-offset and naive timestamps rejected (400); past `start_at` rejected; invalid `service_id` (non-UUID) rejected; missing/empty customer fields rejected; unknown top-level field (e.g. client-supplied `end_at`) rejected.
- **Service (unit, mocked `pg` client):** `end_at` computed correctly from duration + both buffers; `SlotUnavailableError` thrown on overlap; `ServiceNotFoundError` thrown when service missing/inactive.
- **Concurrency (integration, real Postgres):** two concurrent `POST /bookings` for the same overlapping slot → exactly one 201 + one 409 with the "slot no longer available" message; exactly one row persists. Also: 201 response body matches the documented `{ id, status, start_at, end_at }` shape.
- **Exclusion constraint (integration, real Postgres, bypassing the app):** direct overlapping SQL insert rejected by the DB; a `cancelled` booking does not block a new overlapping insert (AC #5).

### Test implementation notes
- Integration tests need `DATABASE_URL` pointed at a disposable Postgres database with migrations 001 and 002 already applied — **fixture Provider/Service rows are inserted fresh in `beforeEach` via `test/helpers/fixtures.ts`, there is no seed migration.**
- `vitest.config.ts` sets `fileParallelism: false` because integration test files share one real DB.

### How to run
```bash
createdb masseur_booking_test
psql -d masseur_booking_test -f src/db/migrations/001_init_core_tables.sql
psql -d masseur_booking_test -f src/db/migrations/002_bookings_and_exclusion_constraint.sql
DATABASE_URL=postgres://<user>@localhost:5432/masseur_booking_test npm test -- --run
```

### Actual result (run in this session, real local Postgres)
```
Test Files  4 passed (4)
     Tests  15 passed (15)
```

---

## [SECURITY OUTPUT]

### 1) CIA Impact
- Confidentiality: Low/Med — customer PII written (name/email/phone), never read back to other customers; 409 message is deliberately generic.
- Integrity: High — this task's entire purpose is preventing double-booking; three independent layers protect it.
- Availability: Low — single-provider advisory lock scoped by provider_id; rate limiting mitigates slot-lockout scripting.

### 2) OWASP-style Checks
- **Input validation & injection:** all queries parameterized (`$1`/`$2`), confirmed no string-interpolated SQL anywhere. Zod `.strict()` schema rejects unknown fields, closing the "client supplies its own `end_at`" trust gap explicitly called out in the task's security considerations.
- **AuthN/AuthZ:** no auth on this endpoint by design (guest checkout, matches context_template.md) — correct for this endpoint's threat model since it only creates a booking scoped to input the customer themselves provides.
- **Sensitive data exposure:** error responses never include stack traces (shared `AppError`/Express error middleware); 409 never reveals whose booking caused the conflict.
- **Security misconfiguration:** DB credentials read from `DATABASE_URL` env var (`src/config/db.ts`), never hardcoded; `.env.example` documents required vars without real secrets.
- **Logging & monitoring gaps:** current `console.error` on unexpected 500s is minimal — acceptable for this task's scope, flagged in Reviewer notes as a pre-production improvement (structured/correlated logging).

### 3) Dependency & Supply Chain Review
- New dependencies: Yes — `pg`, `zod`, `express-rate-limit` (runtime); `typescript`, `tsx`, `vitest`, `supertest`, `eslint`, `@eslint/js`, `typescript-eslint` (dev-only).
- Risk notes: all are widely used, actively maintained packages with no unusual transitive footprint. Caret ranges used throughout (no overly broad wildcards).
- Audit evidence:
  - `npm audit --omit=dev --audit-level=high` → **found 0 vulnerabilities** (production dependency tree is clean).
  - `npm audit --audit-level=high` (full tree, incl. dev) → 5 vulnerabilities (3 moderate, 1 high, 1 critical), all in `vitest`'s transitive `esbuild`/`vite` dev-server chain (GHSA-67mh-4wv8-2f99 — a dev-server-only request-forwarding issue, not present in the shipped app; fix requires a breaking `vitest@4` upgrade, deferred as a follow-up, not a merge blocker since it never reaches production).
- Recommendation: **Accept** — production surface is clean; dev-only finding is non-exploitable in deployed code and tracked as a follow-up.

### 4) Threat Mini-Model
- Assets: customer PII (name/email/phone), booking availability integrity, DB credentials.
- Entry points: `POST /bookings` (public, unauthenticated by design).
- Threats: (a) double-booking via race condition, (b) slot-lockout via scripted repeated requests, (c) client attempting to control `end_at`/`status` directly, (d) malformed/ambiguous timestamps silently misinterpreted across timezones.
- Mitigations: (a) advisory lock + row-lock overlap check + exclusion-constraint backstop; (b) per-IP rate limiting; (c) `.strict()` zod schema, `end_at` always server-computed; (d) strict UTC-offset regex gate before parsing.

### 5) Risk Summary
- Severity: **Low** (for this task's scope).
- Required mitigations before merge: none outstanding.
- Follow-ups: structured/correlated request logging; customer dedupe-by-email; `vitest` major-version bump to clear the dev-only audit findings.

### 6) Secure SDLC Phase
- Phase affected: Implementation / Testing.
- Re-review required after mitigation: No (no blocking mitigations pending).

### Merge Decision
- Approved for merge: **Yes**
- Blocking reason (if No): n/a

---

## [RELEASE OUTPUT]

### DoD checklist verification
- Acceptance criteria met, edge cases covered — ✅ (all 7 acceptance criteria in the task spec map to a passing test; see Tester section)
- Lint, typecheck, tests pass — ✅ `npm run lint` (0 problems), `npx tsc --noEmit` (clean), `npm test -- --run` (15/15 passed, incl. real-Postgres concurrency + exclusion-constraint tests)
- `npm audit` — no unresolved HIGH/CRITICAL in production deps — ✅ `npm audit --omit=dev --audit-level=high` → 0 vulnerabilities. (Dev-only `vitest` transitive findings accepted per Security section, tracked as follow-up.)
- Security review performed; no unresolved CRITICAL/HIGH — ✅ see Security section, Approved for merge.
- No secrets committed; no debug logs in production paths — ✅ `.env.example` has placeholder values only; no `console.log` in request-handling paths (only a startup log in `server.ts`).
- Documentation updated if behaviour changed — ✅ `agents/context_template.md` updated with the `start_at`-marks-the-whole-block note.

### ⚠️ Pre-launch gate (explicit release note)
**This endpoint is NOT safe to wire up to the real frontend or expose publicly until the availability-check task (working hours / `AvailabilityRule` / `AvailabilityException`) ships.** As built, it only checks for overlap against existing non-cancelled `Booking` rows — it has no concept of business hours, so it would currently accept a booking at 3am or on a day the masseur has blocked off. This is an intentional scope boundary (see Architect assumption #2), not an oversight, but it must be closed before this endpoint is reachable by real customers.

### How to verify
```bash
npm ci
npm run lint
npm run typecheck
createdb masseur_booking_test   # one-time
psql -d masseur_booking_test -f src/db/migrations/001_init_core_tables.sql
psql -d masseur_booking_test -f src/db/migrations/002_bookings_and_exclusion_constraint.sql
DATABASE_URL=postgres://<user>@localhost:5432/masseur_booking_test npm test -- --run
npm audit --omit=dev --audit-level=high
```

### Release checklist
- Versioning/changelog: n/a (pre-1.0, no release process yet).
- CI green: tests + lint + build verified locally in this session (no CI pipeline wired up yet — follow-up).
- Dependency audit evidence: attached above.
- Security findings: addressed / accepted with rationale (see Security section).
- Docs updated: `.env.example` added, `context_template.md` updated.
- Rollback/migration notes: both migrations are purely additive (`CREATE TABLE`/`CREATE EXTENSION`); rollback is `DROP TABLE bookings, email_jobs, services, customers, providers` in reverse dependency order — safe since no other code depends on these tables yet.

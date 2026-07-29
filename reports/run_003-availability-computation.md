# Run Report: 003-availability-computation

Availability computation endpoint (GET /availability)
Profile: Node/TypeScript Backend

---

## [ARCHITECT OUTPUT]

See chat transcript for the full Architect stage output. Key decisions:

- Migration renumbered `003` → `004_availability_rules_and_exceptions.sql` (003 was already taken by the confirm/decline task); `agents/tasks/003-availability-computation.json`'s `relevantFilePaths` updated to match.
- Added `providers.timezone` (`TEXT NOT NULL DEFAULT 'UTC'`, additive/safe over existing rows).
- **New dependency: `luxon`** (+ `@types/luxon` dev) — justified because converting a local wall-clock time-of-day on a specific date, in an arbitrary IANA zone, to a correct UTC instant across DST transitions is exactly the bug class the design doc calls out as the #1 scheduling-system failure mode; not something to hand-roll.
- Slot granularity hardcoded to 15 minutes (no config field exists for it yet — flagged as a future candidate for a `Service`/`Provider` column).
- Exception combination order: `open` exceptions unioned into rule hours first, then `blocked` exceptions subtracted from the result — blocked always wins.
- `AvailabilityException.start_time`/`end_time` required (not nullable); a whole-day block is expressed as an explicit wide window rather than a null-means-whole-day special case.
- Response is a bare JSON array of ISO-8601 UTC strings, matching the AC literally.

## [IMPLEMENTER OUTPUT]

Files created/changed:
```
src/db/migrations/004_availability_rules_and_exceptions.sql
src/db/types.ts                        # + AvailabilityRule, AvailabilityException; Provider.timezone
src/services/availabilityIntervals.ts  # pure interval math: unionIntervals, subtractIntervals, sliceIntoSlots
src/services/availabilityService.ts    # DB reads (rules/exceptions/bookings) -> intervals -> slots, Luxon tz conversion
src/validation/availabilityQuerySchema.ts
src/middleware/rateLimit.ts            # + availabilityRateLimit (30/min)
src/routes/availability.ts             # GET /availability
src/app.ts                             # mount availabilityRouter
package.json                           # + luxon, @types/luxon
agents/tasks/003-availability-computation.json  # migration path corrected to 004
```

Core orchestration (`src/services/availabilityService.ts`):
```ts
const withOpens = unionIntervals([...ruleIntervals, ...open]);
const afterBlocked = subtractIntervals(withOpens, blocked);
const free = subtractIntervals(afterBlocked, bookingIntervals);

const totalMinutes = service.duration_minutes + service.buffer_before_minutes + service.buffer_after_minutes;
return sliceIntoSlots(free, totalMinutes * 60_000, SLOT_GRANULARITY_MINUTES * 60_000)
  .map((ms) => new Date(ms).toISOString());
```

Local-time-to-UTC conversion uses Luxon zone-aware parsing, not a fixed offset:
```ts
function toUtcMillis(date: string, timeOfDay: string, zone: string): number {
  return DateTime.fromISO(`${date}T${timeOfDay}`, { zone }).toUTC().toMillis();
}
```

All queries remain parameterized; no string-interpolated SQL introduced.

## [REVIEWER OUTPUT]

**Review summary:** Matches the Architect plan. The pure interval math (`availabilityIntervals.ts`) is cleanly separable from the DB/timezone orchestration and is the part with the most edge cases — verified independently with 16 unit tests before ever touching Postgres.

**Required fixes (blockers):** None.

**Suggested improvements (nice-to-have):**
- Slot granularity (15 min) and combination-order-of-exceptions (open-then-blocked) are both defensible defaults but undocumented product decisions — worth confirming with whoever owns the actual booking widget UX once it's built.
- `availability_rules` allows multiple rows per `(provider_id, weekday)` with no uniqueness constraint — currently harmless (they're unioned), but the eventual admin CRUD task should decide whether that's intentional (e.g. split-shift days) or should be constrained.
- No caching — every request recomputes from three queries plus interval math. Fine at v1 scale (explicitly required by the AC: "no slots table or cache"); would need revisiting only if traffic ever justified it.

## [TESTER OUTPUT]

### Test cases
- **Unit (`availabilityIntervals`, 16 tests):** union of disjoint/overlapping/adjacent/out-of-order intervals; subtraction that fully covers, splits, trims either edge, misses entirely, applies multiple removals in sequence, drops zero-length remainders; slot slicing respects granularity/duration and never overruns an interval, across single and multiple free intervals.
- **Unit (`availabilityQuerySchema`, 6 tests):** valid input; non-UUID `service_id`; malformed date shape; calendar-invalid date (`2026-02-30`); missing date; rejected unknown extra query params.
- **Integration (real Postgres, 10 tests):** rule-only day slot count/shape; no rule + no exception → empty; `open` exception adds hours outside the rule; `blocked` exception removes hours inside the rule (down to zero slots when what's left is too short); an existing pending booking removes its exact window; a *cancelled* booking does not reduce availability; unknown `service_id` → 404; malformed `date`/`service_id` → 400.
- **Integration (DST correctness, 1 test):** same local rule (`09:00–12:00`) in `America/New_York` on a winter date vs. the same weekday 26 weeks later (summer) produces UTC instants exactly one hour apart (`14:00Z` vs `13:00Z`) — proves the conversion is real IANA/DST arithmetic, not a fixed UTC offset.

### How to run
```bash
psql -d masseur_booking_test -f src/db/migrations/004_availability_rules_and_exceptions.sql
DATABASE_URL=postgres://<user>@localhost:5432/masseur_booking_test \
MASSEUR_ADMIN_TOKEN=test-admin-token \
npm test -- --run
```

### Actual result (run in this session, real local Postgres)
```
Test Files  10 passed (10)
     Tests  67 passed (67)
```
(34 from 001+002, 33 new for 003.)

## [SECURITY OUTPUT]

### 1) CIA Impact
- Confidentiality: Low — the AC itself requires the response to contain only slot start times, never booking ids/customer data; verified this holds by construction (the service layer never selects `customer_id` or booking ids into its output path).
- Integrity: Low — read-only; a bug here shows wrong *displayed* availability but can't create a double-booking (001's exclusion constraint is the real backstop).
- Availability: Low — public unauthenticated read endpoint, rate-limited (30/min) against date-scraping loops.

### 2) OWASP-style Checks
- **Input validation & injection:** `service_id` UUID-checked, `date` shape- and calendar-validity-checked before any query; all SQL parameterized.
- **AuthN/AuthZ:** intentionally none — matches `POST /bookings`'s trust level (public, read-only, no PII in or out).
- **Sensitive data exposure:** confirmed no booking/customer identifiers ever enter the response.
- **Security misconfiguration:** no new secrets/config beyond what already exists.
- **Logging & monitoring gaps:** unchanged from prior tasks.

### 3) Dependency & Supply Chain Review
- New dependency: **Yes** — `luxon` (runtime) + `@types/luxon` (dev-only, since luxon doesn't bundle its own TS types).
- Risk notes: `luxon` is a long-established, actively maintained, zero-transitive-runtime-dependency library; caret range used.
- `npm audit --omit=dev --audit-level=high` → **0 vulnerabilities**.
- Recommendation: **Accept**.

### 4) Threat Mini-Model
- Assets: none new (no PII, no write path).
- Entry points: `GET /availability`.
- Threats: (a) scraping every future date to build a shadow copy of the booking calendar, (b) malformed input causing an unhandled DB error that leaks internals.
- Mitigations: (a) `availabilityRateLimit`; (b) zod validation before any query runs.

### 5) Risk Summary
- Severity: **Low**.
- Required mitigations before merge: none outstanding.
- Follow-ups: none security-specific: this task actually *closes* a previously-flagged gap (booking creation had no working-hours concept) rather than opening a new one.

### 6) Secure SDLC Phase
- Phase affected: Implementation / Testing.
- Re-review required after mitigation: No.

### Merge Decision
- Approved for merge: **Yes**
- Blocking reason (if No): n/a

## [RELEASE OUTPUT]

### DoD checklist verification
- Acceptance criteria met, edge cases covered — ✅ all 11 acceptance criteria map to a passing test (see Tester section).
- Lint, typecheck, tests pass — ✅ `npm run lint` (0 problems), `npx tsc --noEmit` (clean), `npm test -- --run` (67/67, incl. real-Postgres DST test).
- `npm audit` — no unresolved HIGH/CRITICAL in production deps — ✅ 0 vulnerabilities.
- Security review performed — ✅ Approved for merge.
- No secrets committed — ✅ nothing new introduced.
- Documentation updated if behaviour changed — n/a beyond the task-spec path correction; no user-facing docs exist yet to update.

### Status update on the pre-launch gates from prior tasks
**This task closes the working-hours gap flagged in 001 and restated in 002's release notes** — `POST /bookings` still doesn't itself enforce business hours (that was intentionally out of its scope), but the frontend now has a real `GET /availability` endpoint to query correct, timezone-aware, rule/exception/booking-aware slots and only ever offer bookable times to the customer. **The remaining gate is still open:** the confirm/decline endpoints' bearer-token auth is still a placeholder for real masseur login — unchanged by this task.

### How to verify
```bash
psql -d masseur_booking_test -f src/db/migrations/004_availability_rules_and_exceptions.sql
DATABASE_URL=postgres://<user>@localhost:5432/masseur_booking_test \
MASSEUR_ADMIN_TOKEN=test-admin-token \
npm test -- --run
npm run lint && npm run typecheck
npm audit --omit=dev --audit-level=high
```

### Release checklist
- Versioning/changelog: n/a (pre-1.0).
- CI green: verified locally this session; no CI pipeline wired up yet.
- Dependency audit evidence: attached above.
- Security findings: none outstanding.
- Docs updated: task-spec path correction only.
- Rollback/migration notes: migration 004 is additive (`ADD COLUMN` with a default, two new tables); rollback is `DROP TABLE availability_exceptions, availability_rules; ALTER TABLE providers DROP COLUMN timezone;`.

# Run Report: 017 — Isolate integration tests from the dev database (dedicated test DB + safety guard)

**Profile:** Node/TypeScript Backend
**Timestamp:** 2026-08-12T14:50:00.000Z
**DoD status:** pass

---

## [ARCHITECT OUTPUT]

### 1) Scope & assumptions
Two-part, test-tooling-only fix — no `src/` production code changes. Root cause independently verified live: the real dev database (`masseur_booking`, per `backend/.env`) held exactly 1 row per core table -- leftover fixture data from this session's own test runs, not real data. A `masseur_booking_test` database already existed in the same local Postgres container, already fully migrated (schema, indexes, `btree_gist`/`pgcrypto` extensions all matching `masseur_booking` exactly) and empty.

Confirmed via Vitest's own source (`setup-common.*.js`): `test.env` unconditionally does `process.env[key] = env[key]`, so the config-level fix alone satisfies "ambient DATABASE_URL doesn't leak through" -- the `resetAndSeed()` guard is genuine defense-in-depth, not the sole mechanism.

Scope note: `test/integration/emailJobs.concurrency.test.ts` runs its own direct `DELETE FROM email_jobs`, bypassing `resetAndSeed()`. Protected by Part 1 (shared `DATABASE_URL` resolution) but not Part 2's explicit guard -- the acceptance criteria scope that guard to `resetAndSeed()` specifically, so this is a deliberate boundary, not an oversight.

### 2) File impact list
- `backend/.env.test.example` (new)
- `backend/vitest.config.ts`
- `backend/test/helpers/fixtures.ts`
- `.gitignore` (repo root)
- `agents/context_template.md`
- `backend/test/unit/fixtures.assertTestDatabase.test.ts` (new, added for guard coverage)

### 3) Implementation plan
1. `.env.test.example`: mirrors `.env.example` style; `DATABASE_URL=postgres://postgres:postgres@localhost:5433/masseur_booking_test`, `DATABASE_SSL=false`.
2. `.gitignore`: add `.env.test`.
3. `vitest.config.ts`: read `.env.test` via `readFileSync` + `node:util`'s `parseEnv` at config-load time (path resolved from the config file's own location); throw immediately if missing/malformed.
4. Inject parsed `DATABASE_URL`/`DATABASE_SSL` into the existing `test.env` block alongside `CORS_ORIGIN`.
5. `fixtures.ts`: add `assertTestDatabase(pool)` -- parses `pool.options.connectionString`, throws if the resolved database name doesn't contain `"test"`.
6. Call it as the first line of `resetAndSeed()`.
7. `context_template.md`: one-time manual setup note (createdb, apply migrations in order, copy `.env.test.example`).

### 4-7) Validation / test / CIA / dependency
Config-level fail-fast + runtime guard, both independent. Integrity impact: High -> fixed (real, currently-live data-integrity bug). No new dependency (`node:fs`/`node:util` built-in).

---

## User amendments (pre-Implementer)

1. Fix `backend/src/db/migrations/008_service_display_fields.sql`: remove the redundant `ALTER TABLE services ADD COLUMN name TEXT` / backfill `UPDATE` / `SET NOT NULL` lines -- migration 005 already adds that column, making these redundant and an outright error ("column already exists") on a truly fresh database. Leave only the new `price` column addition.
2. Proceed straight through Implementer -> Reviewer -> Tester -> Security -> Release.

---

## [IMPLEMENTER OUTPUT]

All plan steps implemented, plus:
- The migration 008 fix specified above.
- **Discovered and fixed a real gap**: five integration test files (`bookings.confirmDecline.test.ts`, `bookings.cancelByAdmin.test.ts`, `bookings.concurrency.test.ts`, `bookings.customerManagement.test.ts`, `bookings.reschedule.concurrency.test.ts`) were silently relying on the ambient dev `.env` (via the `--env-file=.env` flag used all session) for `ADMIN_EMAIL`/`APP_BASE_URL` -- invisible until that ambient leak was actually closed by this task's own fix. Added `process.env.ADMIN_EMAIL`/`process.env.APP_BASE_URL` self-sets at the top of each, matching the pattern already established in `auth.test.ts`/`adminAuthService.test.ts`.

No changes to `src/db/pool.ts`, `src/config/db.ts`, or any other production code path.

---

## [REVIEWER OUTPUT]

Verified live rather than trusting green tests alone:
- Ambient `DATABASE_URL` exported pointing at dev DB, `npm test` run -> dev DB row counts unchanged (config override wins).
- `.env.test` itself pointed at the dev database name -> every test failed loudly via `assertTestDatabase`; dev DB still untouched (independent second layer confirmed real, not just theoretical).
- `.env.test` removed entirely -> Vitest fails at config-load, before any test runs, with the documented message.

No blockers. Nice-to-have: `emailJobs.concurrency.test.ts`'s direct `DELETE` remains outside the explicit guard's scope (protected only by Part 1) -- flagged as a possible follow-up if that pattern spreads.

---

## [TESTER OUTPUT]

| Case | Result |
|---|---|
| Guard passes for a test-named DB / throws (naming the DB) otherwise / throws on missing connection string | ✅ unit tests |
| Full suite passes against fresh `masseur_booking_test` | ✅ 216/216 |
| Ambient `DATABASE_URL` (dev) does not leak through | ✅ verified via row counts before/after (unchanged) |
| Misconfigured `.env.test` (pointed at dev) blocked by the guard | ✅ 9/9 tests failed loudly, dev DB unchanged |
| Missing `.env.test` fails fast with documented message | ✅ fails at config-load |
| Lint / typecheck / build | ✅ clean (also ran `eslint` manually against `vitest.config.ts` and changed test files, outside the `lint` script's normal `src`-only scope) |

**How to run:** `cd backend && npm test` -- no `--env-file` needed or wanted anymore.

---

## [SECURITY OUTPUT]

**CIA**: Integrity was High-risk (confirmed live, ongoing silent data loss), now Low. Confidentiality/Availability unaffected.
**Dependency review**: No new dependencies; audit unchanged (5 pre-existing accepted dev-only findings).
**Threat model**: ambient shell `DATABASE_URL` silently overwriting real data -- mitigated by two independent fail-fast layers, both verified.
**Merge decision**: Approved. No blockers.

---

## [RELEASE OUTPUT]

### DoD checklist
All items pass -- see acceptance criteria verification above. Migration note: `008_service_display_fields.sql` edited; already-migrated databases (`masseur_booking`, `masseur_booking_test` in this environment) unaffected, since those statements already ran -- the fix only prevents the error on a future fresh-database migration.

### How to verify
```bash
cd backend
cp .env.test.example .env.test   # first time only
npm test
```
Manual data-safety check: export `DATABASE_URL` pointing at the dev DB in a shell, run `npm test`, confirm dev DB row counts unchanged.

**DoD status: PASS**

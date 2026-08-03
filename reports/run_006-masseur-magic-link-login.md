# Run Report: 006-masseur-magic-link-login

Real masseur login (magic link) replacing the placeholder bearer token
Profile: Node/TypeScript Backend

---

## [ARCHITECT OUTPUT]

### 1. Scope & assumptions
- Admin identity is a config value (`ADMIN_EMAIL`), not a DB row — there is no `admins` table, consistent with "v1 singleton provider."
- This fully replaces `MASSEUR_ADMIN_TOKEN` — no dual-running fallback, no compatibility shim.
- Reuses the existing `email_jobs` outbox/worker — one new `EmailJobType`, no new infrastructure.
- Magic-link emails need a clickable absolute URL, and no base-URL env var existed yet — added `APP_BASE_URL` as the smallest possible scope addition beyond the task's own env-var list.
- `requireMasseurAuth` currently does zero I/O (pure in-memory comparison); after this change it must hit the DB per request — a structural change to what "unit test" means for that file.
- Single-use token consumption reuses the atomic-claim shape already established in this codebase (`transitionPendingBooking`'s conditional `UPDATE ... WHERE status = 'pending' RETURNING`, and `claimQueuedJobs`'s `UPDATE ... WHERE ... RETURNING`) rather than a new locking primitive.

### 2. File impact list
`src/db/migrations/006_admin_auth.sql`, `src/config/auth.ts`, `src/services/adminAuthService.ts`, `src/services/emailQueueService.ts`, `src/db/types.ts`, `src/middleware/requireMasseurAuth.ts`, `src/middleware/rateLimit.ts`, `src/routes/auth.ts`, `src/app.ts`, `.env.example`, plus new/updated tests in `test/unit/adminAuthService.test.ts`, `test/unit/requireMasseurAuth.test.ts`, `test/integration/auth.test.ts`, `test/integration/bookings.confirmDecline.test.ts`.

### 3. Implementation plan
1. Migration 006: `admin_login_tokens(id, token_hash UNIQUE, expires_at, used_at, created_at)`, `admin_sessions(id, token_hash UNIQUE, expires_at, revoked_at, created_at)`.
2. `config/auth.ts`: `loadAdminEmail()`/`loadAppBaseUrl()` via the existing `requireEnv` helper; delete `loadMasseurAdminToken`.
3. `adminAuthService.ts`: `requestLoginLink` (constant-time email match, no-op on mismatch, transactional insert+enqueue on match), `consumeLoginTokenAndCreateSession` (atomic claim + session mint in one transaction), `validateSession`, `revokeSession`.
4. `emailQueueService.ts`/`emailTemplates.ts`: new `masseur_login_link` job type end to end.
5. `requireMasseurAuth.ts`: validate the bearer value against `admin_sessions` via hash lookup; stash the raw token on `res.locals` for logout.
6. `rateLimit.ts`: new `loginRequestRateLimit`.
7. `routes/auth.ts`: `POST /auth/login-request`, `GET /auth/login`, `POST /auth/logout`.
8. `app.ts`/`.env.example` wiring; remove every reference to `MASSEUR_ADMIN_TOKEN`.
9. Update `bookings.confirmDecline.test.ts` to authenticate via the new flow.

### 4. Validation strategy
Zod schemas for both new endpoints (email shape, non-empty token); all expiry/used/revoked checks are DB-side (`now()` against `TIMESTAMPTZ`), never trusting a client-sent value.

### 5. Test strategy
Unit tests for `adminAuthService` (mocked pool, matching the codebase's established unit-test convention of mocking one layer below rather than hitting a real DB); `requireMasseurAuth` converted to mock `adminAuthService` rather than becoming a DB-backed test; integration tests for the full request→email-job→consume→session→logout flow plus a concurrent-reuse race test mirroring `bookings.concurrency.test.ts`.

### 6. CIA impact
Confidentiality: High (sole gate on all admin/PII operations). Integrity: High (forged/replayed credentials could confirm/decline arbitrary bookings). Availability: Low (rate-limited, single-user blast radius).

### 7. Dependency decision
No new dependency — `node:crypto` and `express-rate-limit` already cover everything needed.

**Learning-checkpoint pause:** flagged before Implementer ran, per `context_template.md`'s pause rule — the atomic single-use-token claim and DB-backed revocable-session model are patterns this codebase hadn't used before. Two open items were called out explicitly for review: the timing-safety honesty gap in `requestLoginLink` (DB write vs. no-op is a real if minor timing signal; rate limiting is the mitigation, not elimination), and converting `requireMasseurAuth.test.ts` from a pure unit test. User reviewed and gave go-ahead to continue.

## [IMPLEMENTER OUTPUT]

**New files:** `src/db/migrations/006_admin_auth.sql`, `src/services/adminAuthService.ts`, `src/routes/auth.ts`, `src/validation/loginRequestSchema.ts`, `src/validation/loginTokenQuerySchema.ts`, `test/unit/adminAuthService.test.ts`, `test/integration/auth.test.ts`.

**Changed files:** `src/config/auth.ts` (token loader → email/base-url loaders), `src/middleware/requireMasseurAuth.ts` (DB-backed session validation), `src/middleware/rateLimit.ts` (new login-request limiter, refreshed stale comment), `src/db/types.ts` (`EmailJobPayload` union), `src/services/emailQueueService.ts`/`emailTemplates.ts`/`emailWorker.ts` (new email type wired through the existing outbox), `src/app.ts` (mounted `authRouter`), `.env.example` (dropped `MASSEUR_ADMIN_TOKEN`, added `ADMIN_EMAIL`/`APP_BASE_URL`), `test/helpers/fixtures.ts` (`mintAdminSession` for test setup bypassing the full login flow), `test/unit/requireMasseurAuth.test.ts` (mocks `adminAuthService` instead of a static env token), `test/integration/bookings.confirmDecline.test.ts` (auth via `mintAdminSession`).

**Tricky parts:**
- `renderEmail`'s payload type widened from `BookingEmailPayload` to an `EmailJobPayload` union; since the discriminant (`type`) lives in a sibling parameter rather than on the payload itself, each case needed a narrowing cast — TS can't infer it automatically here.
- `consumeLoginTokenAndCreateSession` wraps the token-consume `UPDATE` and the session `INSERT` in one transaction so a token is never burned without a resulting session. The atomic single-use claim is the `UPDATE ... WHERE used_at IS NULL AND expires_at > now() RETURNING id` itself — same shape as `transitionPendingBooking`/`claimQueuedJobs`, not a new locking mechanism.
- Hit `loginRequestRateLimit` mid-implementation: the integration test's helper for minting login tokens was going through the real HTTP endpoint repeatedly across tests, and the in-memory rate-limit store doesn't reset between tests in the same file. Fixed by having the helper call `requestLoginLink` directly, mirroring how `mintAdminSession` already bypasses the full flow for setup.

**Migration/compat notes:** No fallback — `MASSEUR_ADMIN_TOKEN`/`loadMasseurAdminToken` fully removed. Deploying requires `ADMIN_EMAIL`/`APP_BASE_URL` set and migration 006 applied before the old token stops working.

## [REVIEWER OUTPUT]

**Review summary:** Matches the Architect plan; core auth logic (atomic claim, hashing, generic login-request response) holds up. One real correctness bug found and fixed during this pass.

**Required fixes (blockers) — fixed:** `requireMasseurAuth` became async (it now hits the DB via `validateSession`), but the original implementation had no `try/catch` around that call. Express 4 doesn't catch rejections thrown out of an async middleware — a DB error there would have been an unhandled rejection, hanging the request instead of returning 500. Fixed by wrapping the call and forwarding to `next(error)`; added a unit test for the rejection path.

**Suggested improvements (nice-to-have, not blocking):**
- `enqueueMasseurLoginLink` takes a params object while the three existing `enqueue*` functions use positional args — minor style inconsistency.
- Neither `admin_login_tokens` nor `admin_sessions` rows are ever pruned — matches the existing (also-unpruned) `email_jobs` pattern, so consistent with current practice, but worth a periodic cleanup job eventually.
- `GET /auth/login` has no rate limit (unlike `login-request`). Not a real risk given 256-bit token entropy and not required by the acceptance criteria, but cheap defense-in-depth if wanted later.

## [TESTER OUTPUT]

**Gaps found and closed:**
- An *expired* login token wasn't exercised as its own case (only "unknown garbage string" was tested — a different branch of the same `WHERE` clause than `expires_at > now()`). Added `mintExpiredLoginToken` fixture + dedicated test.
- Missing required-field validation tests (`POST /auth/login-request` with no `email`, `GET /auth/login` with no `token`) — both now asserted as 400.
- The `requireMasseurAuth` DB-rejection path from the Reviewer fix above.

**Full test list (new/changed):**
- `test/unit/adminAuthService.test.ts` (8): hashing on write for both token types, generic no-op on email mismatch, case/whitespace-insensitive match, atomic reject-on-no-match-row, session creation, `validateSession`/`revokeSession` query shape.
- `test/unit/requireMasseurAuth.test.ts` (6): valid session → next()+stash, missing header, non-Bearer, empty bearer, invalid session → 401, DB rejection → `next(error)`.
- `test/integration/auth.test.ts` (12): login-request enqueues for matching email / identical response+no enqueue for non-matching / 400 on malformed or missing email; login issues a session / 401 unknown / 401 expired / 400 missing token / reuse rejected / concurrent-reuse race (exactly one of two wins); logout revokes / second use of revoked session 401 / logout without session 401.
- `test/integration/bookings.confirmDecline.test.ts`: auth setup switched to `mintAdminSession`, all 9 existing cases unchanged and passing.

**How to run:**
```bash
psql -d masseur_booking_test -f src/db/migrations/006_admin_auth.sql
DATABASE_URL=postgres://<user>@localhost:5432/masseur_booking_test \
ADMIN_EMAIL=admin@example.com APP_BASE_URL=https://admin.example.com \
npm test -- --run
```
**Actual result:** `Test Files 15 passed (15)`, `Tests 113 passed (113)` (109 from tasks 001–005 + 4 net new from Tester's gap-filling on top of Implementer's own suite for this task).

## [SECURITY OUTPUT]

### 1) CIA Impact
- Confidentiality: **High** — sole gate protecting all booking PII and admin actions.
- Integrity: **High** — a broken single-use guarantee or forgeable session would let an attacker confirm/decline arbitrary bookings.
- Availability: **Low** — rate-limited login-request bounds abuse; worst case is one admin temporarily locked out.

### 2) OWASP-style Checks
- **Input validation & injection:** all new queries parameterized; the one string-interpolated SQL (`mintAdminSession`'s interval literal) is test-only, driven by an internal boolean flag, not attacker-reachable.
- **AuthN/AuthZ correctness:** login token and session token are distinct, separately-hashed, separately-expiring credentials (15 min / 7 days). Single-use enforced atomically via conditional `UPDATE ... RETURNING`, verified under real Postgres concurrency. Revocation re-verified: reusing a revoked session token 401s.
- **Sensitive data exposure:** neither token type stored raw, only SHA-256 hashes. Raw session token returned exactly once, in the `GET /auth/login` response body. `login-request` returns byte-identical responses regardless of match (verified by test).
- **Security misconfiguration:** `ADMIN_EMAIL`/`APP_BASE_URL` fail-fast via `requireEnv`; `.env.example` updated with placeholders only.
- **Logging & monitoring gaps:** no token, hash, or admin email is logged anywhere in this code.

### 3) Dependency & Supply Chain Review
- New dependencies: **None**.
- `npm audit --production` → **0 vulnerabilities**. `npm audit --audit-level=high` (includes devDependencies) shows 5 pre-existing findings (1 critical, 1 high, 3 moderate) entirely in the `vitest`/`vite`/`esbuild` dev-tooling chain — unrelated to this task, none shipping to production. Flagged as a pre-existing follow-up, not a blocker.
- Recommendation: **Accept**.

### 4) Threat Mini-Model
- Assets: the admin session, login/session token hashes at rest, the admin's email address.
- Entry points: `POST /auth/login-request`, `GET /auth/login`, `POST /auth/logout`, every existing `requireMasseurAuth`-gated route.
- Threats: email-match oracle via response differences; login-token replay/race; session forgery or use-after-revoke; inbox-bombing/brute-forcing `login-request`; an unhandled DB error hanging or leaking internals.
- Mitigations: byte-identical generic response (verified); atomic single-statement claim (verified concurrently); hash-only storage + server-side `revoked_at`/`expires_at` checks; `loginRequestRateLimit` (5/min); DB errors in `requireMasseurAuth` now forwarded to the app's existing error handler, never leaking a stack trace.

### 5) Risk Summary
- Severity: **Low** (post-fix — the one real finding was caught and fixed in this same review pass).
- Required mitigations before merge: none outstanding.
- Follow-ups: periodic cleanup of expired/used rows in the two new tables; eventual vitest/vite devDependency bump (pre-existing, unrelated).

### 6) Secure SDLC Phase
- Phase affected: Implementation / Testing.
- Re-review required after mitigation: No (fix applied and covered by a new test in this same pass).

### Merge Decision
- Approved for merge: **Yes**

## [RELEASE OUTPUT]

### DoD checklist verification
- Acceptance criteria met — ✅ all 10 ACs from the task spec covered by a passing test.
- Edge cases considered — ✅ expired/unknown/reused/concurrent-reuse tokens, revoked sessions, missing/malformed input, DB-error path.
- Lint/typecheck/tests pass — ✅ `npm run lint` clean, `npx tsc --noEmit` clean, `npm test -- --run` 113/113.
- Dependency audit — ✅ `npm audit --production` 0 vulnerabilities; no new dependencies.
- Security review — ✅ Approved for merge.
- No secrets committed — ✅ `.env.example` placeholders only.
- Documentation updated — ✅ `.env.example` reflects `ADMIN_EMAIL`/`APP_BASE_URL`, drops `MASSEUR_ADMIN_TOKEN` entirely.

### How to verify
```bash
psql -d masseur_booking_test -f src/db/migrations/006_admin_auth.sql
DATABASE_URL=postgres://<user>@localhost:5432/masseur_booking_test \
ADMIN_EMAIL=admin@example.com APP_BASE_URL=https://admin.example.com \
npm test -- --run
npm run lint && npx tsc --noEmit
npm audit --production
```

### Release checklist
- Versioning/changelog: n/a (pre-1.0).
- CI green: verified locally this session; no CI pipeline wired up yet.
- Dependency audit evidence: attached above.
- Security findings: none outstanding.
- Docs updated: `.env.example`.
- Rollback/migration notes: migration 006 is purely additive (two new tables) — rollback is `DROP TABLE admin_login_tokens, admin_sessions;` with no data loss elsewhere. **Deployment note:** this is a breaking behavioral change at the app level — `MASSEUR_ADMIN_TOKEN` no longer works once this deploys; `ADMIN_EMAIL`/`APP_BASE_URL` must be set and migration 006 applied before cutover, or every admin-authenticated route becomes unreachable.

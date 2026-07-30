# Run Report: 005-email-worker

Email worker: send queued booking notification emails
Profile: Node/TypeScript Backend

---

## [ARCHITECT OUTPUT]

See chat transcript for the full stage output. Key decisions:

- `services.name` added (migration 005) — didn't exist since 001, but the email payload needs it.
- Job state machine extended: `queued` → `sending` (new transient claim state) → `sent` | back to `queued` (retry) | `failed`. `email_jobs_status_check` dropped and recreated to allow `'sending'`.
- Provider: Postmark via plain HTTP `fetch` — no SDK dependency.
- Crash-safety via a stale-claim window (5 min): a job stuck in `'sending'` with an old `claimed_at` is reclaimed by the next poll, rather than adding queue infrastructure.
- Claim is a single implicit-transaction `UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED LIMIT n)` statement run directly through the pool (no checked-out client, no explicit `BEGIN`) — this alone satisfies "commit before the external call."
- Backoff: `min(60s * 2^(attempts-1), 30min)`; permanently `'failed'` at 5 attempts.
- Emails are plain text, not HTML — sidesteps HTML injection entirely; only control-character stripping applied to free-text fields before they reach the subject line.
- The poll loop (`startEmailWorker`) lives only in `server.ts`, never `app.ts`, so no test that imports `createApp()` ever starts a background timer.

## [IMPLEMENTER OUTPUT]

Files created/changed:
```
src/db/migrations/005_add_email_job_retry_columns.sql   # services.name; email_jobs: attempts, last_error, sent_at, next_attempt_at, claimed_at, 'sending' status
src/db/types.ts                                          # Service.name; EmailJobStatus; EmailJob retry fields; BookingEmailPayload
src/config/email.ts                                       # POSTMARK_API_TOKEN, EMAIL_FROM_ADDRESS loader
src/services/emailSender.ts                                # EmailSender interface + PostmarkEmailSender (fetch-based)
src/services/emailTemplates.ts                             # renderEmail(type, payload); control-char sanitization
src/services/emailWorker.ts                                # claimQueuedJobs, markJobSent, markJobFailedAttempt, processJobsOnce, startEmailWorker
src/services/emailQueueService.ts                          # payloads extended: customerName, serviceName, startAtLocal (Luxon-formatted, provider-local)
src/services/bookingService.ts                             # loadActiveService joins providers (name+timezone); confirm/decline gain loadBookingEmailContext
src/server.ts                                              # starts the poll loop after createApp().listen()
.env.example                                                # + POSTMARK_API_TOKEN, EMAIL_FROM_ADDRESS
```

Claim query (`src/services/emailWorker.ts`) — the core correctness mechanism:
```sql
UPDATE email_jobs
SET status = 'sending', claimed_at = now()
WHERE id IN (
  SELECT id FROM email_jobs
  WHERE (status = 'queued' AND next_attempt_at <= now())
     OR (status = 'sending' AND claimed_at < now() - ($2 || ' milliseconds')::interval)
  ORDER BY created_at
  LIMIT $1
  FOR UPDATE SKIP LOCKED
)
RETURNING id, type, payload, attempts
```
One statement, atomic on its own, no explicit transaction held across the external send. All parameters (including the stale-window constant) are passed positionally, not string-interpolated, keeping to the project's parameterized-queries-only rule even for internal constants.

**Notable fix during implementation:** the first draft of this query string-interpolated the stale-claim constant (`interval '${CLAIM_STALE_MS} milliseconds'`) directly into the SQL text. Even though `CLAIM_STALE_MS` is an internal constant with no injection risk, this violated the hard "parameterized queries only, never string-interpolated SQL" rule established in tasks 001/002 — caught and fixed before testing, now passed as `$2`.

All queries elsewhere remain parameterized; no other string-interpolated SQL introduced.

## [REVIEWER OUTPUT]

**Review summary:** Matches the Architect plan. The claim mechanism's core correctness property — no job ever processed by two workers at once, and no job stuck forever after a crash — was verified against real concurrent Postgres queries, not just asserted from the SQL shape.

**Required fixes (blockers):** None.

**Suggested improvements (nice-to-have):**
- `startEmailWorker`'s poll errors are logged via `console.error` only — fine for now, but a production deployment would want this surfaced to whatever monitoring/alerting exists once that's built.
- The stale-claim window (5 min) and backoff schedule (60s base, 30min cap, 5 max attempts) are all hardcoded constants — reasonable defaults, but worth promoting to config if they ever need tuning per environment without a code change.
- `loadBookingEmailContext` re-fetches customer/service/provider data already available piecemeal elsewhere in the same request — acceptable given confirm/decline are low-frequency admin actions, not worth optimizing away.

## [TESTER OUTPUT]

### Test cases
- **Unit (`emailTemplates`):** each of the 3 job types renders correct subject/body from payload-only fields; a `customerName`/`cancellationReason` containing `\r\n` is neutralized in both subject and body.
- **Unit (`emailWorker`, mocked pool):** claim query shape/params; `markJobSent` sets `sent`/`sent_at`; `markJobFailedAttempt` backoff grows correctly (60s → 120s → capped at 30min) and flips to permanent `'failed'` exactly at the 5th attempt; `processJobsOnce` calls the right mark-function based on whether the fake sender resolves or rejects.
- **Integration (real Postgres):** 10 real queued jobs claimed via two concurrent racing `claimQueuedJobs()` calls — no duplicates, all 10 covered, all left in `'sending'`; a stale `'sending'` job (claimed 10 min ago) is reclaimed; a fresh `'sending'` job (claimed 1 min ago) is not; and — the test most directly proving AC #6 — a fake sender reads `pool.totalCount - pool.idleCount` at the moment it's called and asserts it's `0`, proving no DB connection is checked out during the simulated network call.

### How to run
```bash
psql -d masseur_booking_test -f src/db/migrations/005_add_email_job_retry_columns.sql
DATABASE_URL=postgres://<user>@localhost:5432/masseur_booking_test \
MASSEUR_ADMIN_TOKEN=test-admin-token \
npm test -- --run
```

### Actual result (run in this session, real local Postgres)
```
Test Files  13 passed (13)
     Tests  92 passed (92)
```
(74 from 001-004 + 18 new for 005.)

## [SECURITY OUTPUT]

### 1) CIA Impact
- Confidentiality: Med — payloads and rendered emails carry customer PII; failure logging is restricted to `job.id` + error message only, never the full rendered body (verified: `processJobsOnce`'s catch block logs `job.id` and the caught error, nothing from `job.payload`).
- Integrity: Low — a bug here risks a missed or duplicate email, not a corrupted booking; the claim mechanism's whole purpose is preventing the "duplicate" half, verified under real concurrency.
- Availability: Low — bounded batch size, backoff prevents a permanently-failing job from being retried in a tight loop, stale-claim reclaim prevents a crashed worker from wedging the queue.

### 2) OWASP-style Checks
- **Input validation & injection:** all worker SQL parameterized (including the one interpolation bug found and fixed during implementation — see Implementer notes); free-text fields (`customerName`, `cancellationReason`) control-character-stripped before reaching the email subject.
- **AuthN/AuthZ:** n/a — worker has no HTTP-facing surface; it only reads its own previously-validated, previously-stored payload rows.
- **Sensitive data exposure:** Postmark API token never appears in thrown errors (`PostmarkEmailSender` only surfaces HTTP status + provider response body) or in worker logs.
- **Security misconfiguration:** `POSTMARK_API_TOKEN`/`EMAIL_FROM_ADDRESS` env-sourced, documented in `.env.example` with placeholder values only.
- **Logging & monitoring gaps:** poll-loop errors and per-job failures both logged with just id/error, matching the task's own security note.

### 3) Dependency & Supply Chain Review
- New dependencies: **None** — Node's built-in `fetch` covers the Postmark HTTP call.
- `npm audit --omit=dev --audit-level=high` → **0 vulnerabilities** (unchanged).
- Recommendation: **Accept**.

### 4) Threat Mini-Model
- Assets: customer PII in email payloads/logs, the Postmark API token.
- Entry points: none new and externally reachable — this is a background worker, not an HTTP endpoint.
- Threats: (a) a crafted `customerName`/`cancellationReason` distorting the email subject, (b) a job processed twice (duplicate customer email), (c) a job silently stuck forever after a worker crash, (d) the API token leaking via logs/errors.
- Mitigations: (a) control-character stripping; (b) atomic single-statement claim, verified concurrently; (c) stale-claim reclaim window; (d) token never included in any thrown error or log line.

### 5) Risk Summary
- Severity: **Low**.
- Required mitigations before merge: none outstanding (the one SQL-interpolation issue was caught and fixed during implementation, before this review).
- Follow-ups: surface poll-loop errors to real monitoring once it exists; consider making backoff/stale-window constants configurable.

### 6) Secure SDLC Phase
- Phase affected: Implementation / Testing.
- Re-review required after mitigation: No.

### Merge Decision
- Approved for merge: **Yes**
- Blocking reason (if No): n/a

## [RELEASE OUTPUT]

### DoD checklist verification
- Acceptance criteria met — ✅ all 11 ACs covered by a passing test (see Tester section); no bug required fixing at the AC level (the one issue found — string-interpolated SQL — was self-caught during implementation and fixed before it ever reached a test run).
- Lint, typecheck, tests pass — ✅ `npm run lint` (0 problems), `npx tsc --noEmit` (clean), `npm test -- --run` (92/92).
- `npm audit` — ✅ 0 vulnerabilities, no new dependencies.
- Security review — ✅ Approved for merge.
- No secrets committed — ✅ `.env.example` placeholders only.
- Documentation updated — ✅ `.env.example` documents the two new env vars.

### Status update on prior pre-launch gates
Unrelated to this task: the confirm/decline bearer-token placeholder (002) and the still-missing real masseur login are unchanged. This task **activates communication that was previously silent** — before this, `email_jobs` rows sat in `'queued'` forever with zero customer-facing effect; now booking-request/confirmation/decline emails actually go out once `POSTMARK_API_TOKEN`/`EMAIL_FROM_ADDRESS` are configured in a real environment. Until those env vars are set, `server.ts` will throw on startup (`loadEmailConfig`'s `requireEnv` — fail-fast by design, matching the existing `DATABASE_URL`/`MASSEUR_ADMIN_TOKEN` pattern).

### How to verify
```bash
psql -d masseur_booking_test -f src/db/migrations/005_add_email_job_retry_columns.sql
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
- Docs updated: `.env.example`.
- Rollback/migration notes: migration 005 is additive (`ADD COLUMN`s, a dropped-and-recreated CHECK constraint widening the allowed `status` values, one new index) — no data loss on rollback (`ALTER TABLE email_jobs DROP COLUMN attempts, last_error, sent_at, next_attempt_at, claimed_at; ALTER TABLE services DROP COLUMN name;` plus restoring the original narrower CHECK constraint).

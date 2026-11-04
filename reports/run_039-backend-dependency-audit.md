# Run report: 039-backend-dependency-audit

- **Title:** Backend: fix production-relevant npm audit advisories (body-parser, proxy-addr, qs, zod)
- **Profile:** Node/TypeScript Backend
- **Completed:** 2026-11-04T07:54:28.000Z
- **DoD status:** blocked: 6 integration tests in `backend/test/integration/availability.test.ts` fail. They fail identically on clean `master` before this task, caused by commit `8726df7` (slot granularity 15 -> 30 minutes without updating the tests). All audit gates pass.

---

[ARCHITECT OUTPUT]

Approved by Ville. Summary of the approved plan and resolved decisions:

- **Scope:** production advisories, a written `trust proxy` finding, and an optional vitest upgrade. No frontend change and no rate-limiting behaviour change.
- **Spec correction:** `npm audit fix` alone leaves a qs advisory, because express 4.22.2 pins `qs ~6.15.1`, and it churns the dev tree. `npm update express body-parser proxy-addr qs` was used instead.
- **Spec correction:** the proxy-addr advisory only affects IPv6-style trust subnets, which this app does not configure. `trust proxy=true` is the real spoofing risk, and it stays unsafe after patching.
- **Zod exposure before the upgrade:** none. `backend/src` has no `z.array`, `record`, `map`, `set` or `tuple`, repeated query parameters are rejected by `z.string()`, and `express.json()` caps bodies at 100 KB. No 3.x release is patched; the first fixed version is 4.6.6.
- **CIA:** Confidentiality None; Integrity Low; Availability positive, with low regression risk.
- **New dependency:** No.

Decisions:

1. Upgrade zod to 4.6.7 and swap `.uuid()` for `.guid()`.
2. Accept zod 4's default error wording and list every changed message in this report.
3. Attempt vitest 2 -> 5 as a separate, revertible final commit. Unit and integration tests must pass unedited; if an existing test needs editing, revert and document as a task 040 follow-up.
4. No rate-limiting behaviour change here. Ville created `agents/tasks/041-rate-limit-client-ip.json` and added it to `PRE_LAUNCH_CHECKLIST.md`.

Commit directly on `master`. Never use `npm audit fix --force`. Stop before pushing.

---

[IMPLEMENTER OUTPUT]

| Commit | Change |
|---|---|
| `c38fdbc` | Lockfile only: express 4.22.2 -> 4.22.3, body-parser 1.20.6 -> 1.20.9, proxy-addr 2.0.7 -> 2.0.8, qs 6.15.3 -> 6.16.2 |
| `2605be3` | zod ^3.23.8 -> ^4.6.7 (3.25.76 -> 4.6.7), `.uuid()` -> `.guid()` in `bookingSchema.ts`, `availabilityQuerySchema.ts`, `bookingIdParam.ts`, `idParamSchema.ts`, new `backend/test/unit/zodBehaviour.test.ts` |
| `34d2cb1` | Lockfile only: brace-expansion 5.0.9 -> 5.0.12 |
| `e5b28c8` | vitest ^2.0.5 -> ^5.1.0 (resolves vite 8.3.5), @types/node ^20.14.15 -> ^22.20.5 |

**Additions to the approved plan, both dev-only:**

- **`34d2cb1` brace-expansion:** the plan's lockfile list did not include it, but the task spec names it among the non-breaking dev fixes, and it was the last HIGH in the full audit. It is committed separately, so it survives a vitest revert.
- **@types/node ^22:** vitest 5 requires it as a peer. No `--force` or `--legacy-peer-deps` was used. Installing needed `npm uninstall vitest` first because the old locked tree blocked peer resolution. `vite` is not a direct dependency.

**Tricky parts:**

- Zod 4's `.uuid()` enforces RFC 9562 version and variant bits. `.guid()` keeps the permissive 8-4-4-4-12 check, so existing fixtures such as `11111111-...` keep passing unedited. Production IDs come from `gen_random_uuid()` and pass either check.
- `package-lock.json` has a large diff (about 1,800 changed lines, almost all vitest 5 and vite 8). The production dependency tree changed only by the four Express-chain packages and zod; commit `e5b28c8` left it identical.

**Compatibility notes:**

- API consumers see new default validation text (tables below). Status codes and the `{ error }` response shape are unchanged.
- Admin service create and update now return 400 for `Infinity` and for integers above `Number.MAX_SAFE_INTEGER`.

---

[REVIEWER OUTPUT]

**Summary:** approved. Application code changes are limited to four one-word swaps, and no route, service, middleware or test config changed.

**Checked:**

- All `.uuid(` calls are gone from `backend/src`, and the message strings are unchanged.
- `parsed.error.issues[0]?.message` compiles and works on zod 4, and the `?? "..."` fallbacks remain.
- Zod 4 deprecates some forms in use here (`z.string().email()`, `.strict()`, the `message` key). The migration notes say these still work, so they were left alone for a minimal diff.
- `.default()` now short-circuits on `undefined`. All defaults here already match the output type, and a test pins this.
- The test config has no edits, and no existing test was changed (`git diff` on `backend/test` shows only the new file).

**Required fixes (blockers):** none in this diff.

**Suggested improvements (not done, out of scope):**

- An unsafe integer `weekday` now gets `Too big: expected int to be <=9007199254740991` rather than the custom range message. It is still a 400, and it is the only custom message that changed.
- Migrating off the deprecated zod forms could be a later cleanup.

---

[TESTER OUTPUT]

**Results on final code (`e5b28c8`, vitest 5.1.0, zod 4.6.7), real test database:**

| Suite | Total | Pass | Fail |
|---|---:|---:|---:|
| Unit | 114 | 114 | 0 |
| Integration | 137 | 131 | 6 |
| **All** | **251** | **245** | **6** |

**Baseline on clean `master`:** 229 total, 223 pass, the same 6 fail.

**The 6 failures, all in `backend/test/integration/availability.test.ts`:**

1. returns slots only within the matching weekday's rule hours
2. an 'open' exception adds availability outside normal hours
3. a cancelled booking does not reduce availability
4. excludes slots at or before the cutoff, keeps the rest -- strict > boundary
5. excludes a booking that ends exactly at the requested date's local midnight (large positive offset, Pacific/Kiritimati)
6. excludes a booking that ends exactly at the requested date's local midnight (large negative offset, Pacific/Midway)

**Root cause:** commit `8726df7` changed `SLOT_GRANULARITY_MINUTES` from 15 to 30 and did not update these tests, so they expect twice as many slots. They were not edited, per instruction.

**Proof they are unrelated:** with the constant temporarily set back to 15 (reverted, never committed), all 251 tests passed on both zod 4 with vitest 2 and zod 4 with vitest 5.

**New tests (22, in `zodBehaviour.test.ts`):** UUID accept and reject, preserved custom messages, service defaults, trimming, unknown keys at both levels, repeated query parameters, non-object bodies, and the numeric boundaries including `Number.MAX_SAFE_INTEGER`.

**How to run** (needs the `masseur-pg` container):

```
docker start masseur-pg
cd backend && npx vitest --run
```

---

[SECURITY OUTPUT]

### 1) CIA Impact
- **Confidentiality: None.** No change to data access or auth logic.
- **Integrity: Low.** The validation library changed on every route, and behaviour only tightens.
- **Availability: Low, positive.** Removes known DoS advisories, with the regression risk covered by tests.

### 2) OWASP-style Checks
- **Input validation:** every schema still validates server-side, and the new tests pin this. Zod 4 no longer echoes the received value in enum errors, a small improvement.
- **AuthN/AuthZ:** untouched. Token parameters use the same regex and `min` checks, and `requireMasseurAuth` is unchanged.
- **Sensitive data:** responses still contain only `{ error }`, with no stack traces.
- **Misconfiguration (pre-existing, not changed):** an oversized body and a body-parser failure both return 500 rather than 413 or 400. No internals leak, but a client-caused error is logged as a server error. This is a possible small follow-up.
- **Logging:** unchanged.

### 3) Dependency & Supply Chain Review
- **New dependencies added? No** new direct dependencies. Vitest 5 brings new dev-only transitive packages (including vite 8 and rolldown).
- **Versioning:** caret ranges with a floor above the patched version for zod. The Express chain is fixed in the lockfile; the `^4.19.2` range was not raised.

**Audit evidence on the final commit:**

| Command | Result |
|---|---|
| `npm audit --omit=dev` | `found 0 vulnerabilities` |
| `npm audit --audit-level=high` | exit 0 |
| `npm audit` | 11 moderate, 0 high, 0 critical (baseline: 23 total, 3 critical, 5 high) |

The 11 moderates are all in the eslint and typescript-eslint chain, which is dev-only. npm's only offered fixes are downgrades such as eslint 4.0.0, so they were left.

**Recommendation: Accept.**

**Limitation on the body-parser fix:** I sent a gzip body with trailing bytes to the app on both body-parser 1.20.6 and 1.20.9. Both returned 500 and the server stayed up, so my probe did not reproduce the advisory's failure. The evidence that it is fixed is the patched version and the clean audit, not a before-and-after demonstration.

### 4) Threat Mini-Model
- **Assets:** bookings, customer contact data, admin sessions, service availability.
- **Entry points:** all public and admin JSON routes and query strings.
- **Threats:** request-body DoS, validation regression after the library change, IP-based rate-limit evasion or shared-bucket denial.
- **Mitigations:** patched dependencies, pinned validation tests, the 100 KB body limit. Rate-limit identification is deferred to task 041.

### 5) Risk Summary
- **Severity: Low** for this diff. **Medium** for the separate rate-limit finding below, which is unchanged by this task.
- **Required mitigations before merge:** none in this diff.
- **Follow-ups:** task 041 (rate limiting); update the 6 availability tests or restore 15-minute granularity.

### 6) Secure SDLC Phase
- **Phase affected:** Implementation.
- **Re-review required after mitigation?** No.

### Merge Decision
- **Approved for merge: Yes** on security grounds. The failing-test gate is a separate DoD item (see RELEASE).

---

## Finding: `trust proxy` and rate-limit client identification behind Railway

No behaviour was changed. The follow-up is `agents/tasks/041-rate-limit-client-ip.json`.

**Likely result: limits are shared between customers, not per client.** The code and a local test support this, but it has not been observed in production.

- **Current setup:** `backend/src/app.ts` never sets `trust proxy`. All limiters in `backend/src/middleware/rateLimit.ts` use the default key, `req.ip`.
- **What `req.ip` is in production:** with the default setting it is the socket peer, so behind Railway it should be Railway's proxy address, not the customer's. There may be one bucket or a few, one per proxy address.
- **Customer impact:** 5 booking requests per minute across everyone would block further bookings. One anonymous client could also repeatedly block bookings or admin login-link requests.
- **Spoofing today:** forging `X-Forwarded-For` did not get around the limits, so they currently err on the strict side.

| Setting tested locally | Result |
|---|---|
| Default (not set) | Shared bucket, spoofing has no effect |
| `trust proxy=true` | **Unsafe:** each forged value got its own bucket |
| `trust proxy=1` | Per client, forged prefixes ignored, but only if there is exactly one proxy hop |

**Unknown:** Railway's docs list `X-Real-IP` as the client IP and do not mention `X-Forwarded-For`, so they do not confirm the hop count.

**How to confirm in production:**

1. Search the Railway logs for `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR`.
2. Call `GET /services` from two networks. If `RateLimit-Remaining` counts down across both, the bucket is shared.

**Recommendation:** change it in task 041 before real customers use the app, after verifying the hop count on a temporary diagnostic route.

---

## Changed validation messages (zod 3.25.76 -> 4.6.7)

Generated by running 701 inputs through the real schemas on both versions, covering every field of every schema. Results: 151 identical, 542 changed text only, 8 changed from accepted to rejected. Custom messages not listed here did not change on any input tried.

The list covers messages reachable by those inputs. The "Inputs" column counts probe inputs, not production traffic.

### Text changes

| Zod 3 message | Zod 4 message | Inputs | Example input |
|---|---|---:|---|
| `Expected 'blocked' \| 'open', received array` | `Invalid option: expected one of "blocked"\|"open"` | 1 | `createException.type = []` |
| `Expected 'blocked' \| 'open', received boolean` | `Invalid option: expected one of "blocked"\|"open"` | 1 | `createException.type = true` |
| `Expected 'blocked' \| 'open', received null` | `Invalid option: expected one of "blocked"\|"open"` | 1 | `createException.type = null` |
| `Expected 'blocked' \| 'open', received number` | `Invalid option: expected one of "blocked"\|"open"` | 6 | `createException.type = 1` |
| `Expected 'blocked' \| 'open', received object` | `Invalid option: expected one of "blocked"\|"open"` | 1 | `createException.type = {}` |
| `Expected 'pending' \| 'confirmed' \| 'cancelled', received array` | `Invalid option: expected one of "pending"\|"confirmed"\|"cancelled"` | 1 | `adminBookingsQuery.status = []` |
| `Expected 'pending' \| 'confirmed' \| 'cancelled', received boolean` | `Invalid option: expected one of "pending"\|"confirmed"\|"cancelled"` | 1 | `adminBookingsQuery.status = true` |
| `Expected 'pending' \| 'confirmed' \| 'cancelled', received null` | `Invalid option: expected one of "pending"\|"confirmed"\|"cancelled"` | 1 | `adminBookingsQuery.status = null` |
| `Expected 'pending' \| 'confirmed' \| 'cancelled', received number` | `Invalid option: expected one of "pending"\|"confirmed"\|"cancelled"` | 6 | `adminBookingsQuery.status = 1` |
| `Expected 'pending' \| 'confirmed' \| 'cancelled', received object` | `Invalid option: expected one of "pending"\|"confirmed"\|"cancelled"` | 1 | `adminBookingsQuery.status = {}` |
| `Expected boolean, received array` | `Invalid input: expected boolean, received array` | 2 | `createService.active = []` |
| `Expected boolean, received null` | `Invalid input: expected boolean, received null` | 2 | `createService.active = null` |
| `Expected boolean, received number` | `Invalid input: expected boolean, received Infinity` | 2 | `createService.active = Infinity` |
| `Expected boolean, received number` | `Invalid input: expected boolean, received number` | 10 | `createService.active = 1` |
| `Expected boolean, received object` | `Invalid input: expected boolean, received object` | 2 | `createService.active = {}` |
| `Expected boolean, received string` | `Invalid input: expected boolean, received string` | 8 | `createService.active = "str"` |
| `Expected integer, received float` | `Invalid input: expected int, received number` | 8 | `createService.duration_minutes = 1.5` |
| `Expected integer, received float` | `Invalid input: expected number, received Infinity` | 8 | `createService.duration_minutes = Infinity` |
| `Expected number, received array` | `Invalid input: expected number, received array` | 10 | `createService.price = []` |
| `Expected number, received boolean` | `Invalid input: expected number, received boolean` | 10 | `createService.price = true` |
| `Expected number, received null` | `Invalid input: expected number, received null` | 10 | `createService.price = null` |
| `Expected number, received object` | `Invalid input: expected number, received object` | 10 | `createService.price = {}` |
| `Expected number, received string` | `Invalid input: expected number, received string` | 40 | `createService.price = "str"` |
| `Expected object, received array` | `Invalid input: expected object, received array` | 17 | `createBooking \| body array` |
| `Expected object, received boolean` | `Invalid input: expected object, received boolean` | 1 | `createBooking.customer = true` |
| `Expected object, received null` | `Invalid input: expected object, received null` | 17 | `createBooking \| body null` |
| `Expected object, received number` | `Invalid input: expected object, received Infinity` | 1 | `createBooking.customer = Infinity` |
| `Expected object, received number` | `Invalid input: expected object, received number` | 5 | `createBooking.customer = 1` |
| `Expected object, received string` | `Invalid input: expected object, received string` | 20 | `createBooking \| body string` |
| `Expected string, received array` | `Invalid input: expected string, received array` | 22 | `createBooking.service_id = []` |
| `Expected string, received boolean` | `Invalid input: expected string, received boolean` | 22 | `createBooking.service_id = true` |
| `Expected string, received null` | `Invalid input: expected string, received null` | 22 | `createBooking.service_id = null` |
| `Expected string, received number` | `Invalid input: expected string, received Infinity` | 22 | `createBooking.service_id = Infinity` |
| `Expected string, received number` | `Invalid input: expected string, received number` | 113 | `createBooking.service_id = 1` |
| `Expected string, received object` | `Invalid input: expected string, received object` | 22 | `createBooking.service_id = {}` |
| `Invalid enum value. Expected 'blocked' \| 'open', received ' '` | `Invalid option: expected one of "blocked"\|"open"` | 1 | `createException.type = " "` |
| `Invalid enum value. Expected 'blocked' \| 'open', received ''` | `Invalid option: expected one of "blocked"\|"open"` | 1 | `createException.type = ""` |
| `Invalid enum value. Expected 'blocked' \| 'open', received '<501 chars>'` | `Invalid option: expected one of "blocked"\|"open"` | 1 | `createException.type = <501 chars>` |
| `Invalid enum value. Expected 'blocked' \| 'open', received 'str'` | `Invalid option: expected one of "blocked"\|"open"` | 1 | `createException.type = "str"` |
| `Invalid enum value. Expected 'pending' \| 'confirmed' \| 'cancelled', received ' '` | `Invalid option: expected one of "pending"\|"confirmed"\|"cancelled"` | 1 | `adminBookingsQuery.status = " "` |
| `Invalid enum value. Expected 'pending' \| 'confirmed' \| 'cancelled', received ''` | `Invalid option: expected one of "pending"\|"confirmed"\|"cancelled"` | 1 | `adminBookingsQuery.status = ""` |
| `Invalid enum value. Expected 'pending' \| 'confirmed' \| 'cancelled', received '<501 chars>'` | `Invalid option: expected one of "pending"\|"confirmed"\|"cancelled"` | 1 | `adminBookingsQuery.status = <501 chars>` |
| `Invalid enum value. Expected 'pending' \| 'confirmed' \| 'cancelled', received 'str'` | `Invalid option: expected one of "pending"\|"confirmed"\|"cancelled"` | 1 | `adminBookingsQuery.status = "str"` |
| `Required` | `Invalid input: expected number, received undefined` | 7 | `createService.price \| missing + unknown key` |
| `Required` | `Invalid input: expected object, received undefined` | 18 | `createBooking \| body undefined` |
| `Required` | `Invalid input: expected string, received undefined` | 46 | `createBooking \| empty object` |
| `Required` | `Invalid option: expected one of "blocked"\|"open"` | 2 | `createException.type \| missing + unknown key` |
| `String must contain at least 1 character(s)` | `Too small: expected string to have >=1 characters` | 2 | `decline.reason = ""` |
| `String must contain at most 500 character(s)` | `Too big: expected string to have <=500 characters` | 1 | `decline.reason = <501 chars>` |
| `Unrecognized key(s) in object: 'zz'` | `Unrecognized key: "zz"` | 30 | `createBooking \| unknown key` |
| `weekday must be between 1 and 7` | `Too big: expected int to be <=9007199254740991` | 2 | `createRule.weekday = 100000000000000000000` |

The `weekday must be between 1 and 7` row is the only custom message affected, and only for integers above the safe range.

### Accepted before, rejected now

| Input | Zod 3 | Zod 4 |
|---|---|---|
| `createService.price = Infinity` | accepted | `Invalid input: expected number, received Infinity` |
| `createService.duration_minutes = 100000000000000000000` | accepted | `Too big: expected int to be <=9007199254740991` |
| `createService.buffer_before_minutes = 100000000000000000000` | accepted | `Too big: expected int to be <=9007199254740991` |
| `createService.buffer_after_minutes = 100000000000000000000` | accepted | `Too big: expected int to be <=9007199254740991` |
| `updateService.price = Infinity` | accepted | `Invalid input: expected number, received Infinity` |
| `updateService.duration_minutes = 100000000000000000000` | accepted | `Too big: expected int to be <=9007199254740991` |
| `updateService.buffer_before_minutes = 100000000000000000000` | accepted | `Too big: expected int to be <=9007199254740991` |
| `updateService.buffer_after_minutes = 100000000000000000000` | accepted | `Too big: expected int to be <=9007199254740991` |

The frontend reads `body.error` (`frontend/src/api/client.ts:47`), so users can see this text when a request gets past client-side validation.

---

[RELEASE OUTPUT]

### DoD checklist

| Item | Status | Evidence |
|---|---|---|
| Acceptance criteria met | **Partly** | All met except "full backend suite passes", see Tests |
| Edge cases considered | Pass | 701-input comparison and new tests |
| No breaking changes without migration notes | Pass | Message and numeric changes documented above |
| No unnecessary `any` | Pass | None added |
| Conventions followed | Pass | Minimal change |
| Lint and formatting | Pass (lint) | `npm run lint` clean; no format script is configured |
| No dead code or debug logs | Pass | |
| New behaviour has tests, including negative cases | Pass | `zodBehaviour.test.ts` |
| **Tests pass locally** | **FAIL** | 245/251; the 6 failures are pre-existing and unrelated |
| Tests pass in CI | N/A | No CI workflow in the repo |
| Build and `tsc --noEmit` | Pass | |
| Server-side validation | Pass | |
| Auth checked | Pass | Unchanged |
| Errors do not leak sensitive data | Pass | |
| Secrets not committed | Pass | Only lockfile, schemas, tests, report, log and task spec |
| No new dependency | Pass | No new direct dependencies; @types/node bumped as a vitest peer |
| `npm audit`: no unresolved HIGH/CRITICAL | Pass | Production 0; full audit 0 high, 0 critical |
| PR dependency review | Pass with note | Large dev-only transitive change from vitest; production tree limited to intended packages |
| Docs updated | Pass | This report; no README behaviour to update |
| Frontend untouched | Pass | |

**Result: blocked** only by the 6 pre-existing test failures.

### How to verify

```
docker start masseur-pg
cd backend
npm ci
npx vitest --run            # expect 245 pass, the 6 availability failures
npm audit --omit=dev        # expect 0 vulnerabilities
npm audit --audit-level=high; echo $?   # expect 0
npx tsc --noEmit && npm run lint && npm run build
```

### Release and rollback notes

- No migrations and no environment changes.
- **Rollback vitest only:** `git revert e5b28c8`.
- **Rollback zod:** `git revert 2605be3`. The `.guid()` swap and the upgrade must go together, and on its own this conflicts with nothing in the Express commit.
- **After deploy:** confirm the Railway build still succeeds, since `npm ci` now installs vitest 5 and vite 8, and the repo does not pin a Node version. Both accept Node 22.12+ (vite also accepts 20.19+).

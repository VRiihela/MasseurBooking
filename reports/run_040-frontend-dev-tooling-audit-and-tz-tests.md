# Run report: 040-frontend-dev-tooling-audit-and-tz-tests

- **Title:** Frontend: clear dev-toolchain audit advisories and make AdminCalendar tests timezone-independent
- **Profile:** React Frontend
- **Completed:** 2026-11-10T15:17:27.000Z
- **DoD status:** pass

---

[ARCHITECT OUTPUT]

Approved by Ville. Summary of the approved plan and resolved decisions:

- **Starting audit:** 17 advisories (12 moderate, 3 high, 2 critical). `npm audit --omit=dev` showed only `moment` (moderate).
- **Timezone failures:** 4 AdminCalendar tests failed under `TZ=Asia/Tokyo` and passed under Helsinki, UTC and Los Angeles. The cause is the test fixtures, not production code (see below).
- **Toolchain:** a targeted update plus vitest 5.1.0 clears every HIGH and CRITICAL item, with vite staying on major version 7 and no config or test edits for vitest.
- **CIA:** None for all three. **New dependency:** No.

Decisions:

1. Use vitest 5.1.0, matching the backend, not 4.1.12.
2. Use the targeted `npm update vite brace-expansion source-map-js moment`, not plain `npm audit fix` and not `--force`.
3. Do not downgrade eslint or typescript-eslint; document the remaining moderates.

### Root cause of the timezone failures

The calendar opens in Day view on the browser's local "today" (`frontend/src/pages/AdminCalendar.tsx:308-309`). The test fixtures were fixed UTC instants: "now" at 12:00 UTC and bookings between 13:00 and 16:00 UTC. In Tokyo (UTC+9), "now" is 21:00 on 10 August, but the John Smith booking (15:00-16:00 UTC) falls at 00:00-01:00 on 11 August. The calendar correctly leaves it off the 10 August Day view, so the 4 tests that look for that booking fail. The same happens in any timezone where local midnight falls between "now" and a booking.

Production behaviour is correct: the masseur's Day view shows their own local day. No production bug was found, so production code was not changed.

---

[IMPLEMENTER OUTPUT]

| File | Change |
|---|---|
| `frontend/package.json` | `vitest` `^3.2.4` -> `^5.1.0`, nothing else |
| `frontend/package-lock.json` | Targeted update plus the vitest 5 tree (below) |
| `frontend/test/AdminCalendar.test.tsx` | The 4 fixture constants built from local clock times, with a corrected comment. No assertion changed (0 changed lines containing `expect`). |

**Fixture change:**

```ts
const NOW = new Date(2026, 7, 10, 12, 0, 0);
const inAnHour = new Date(2026, 7, 10, 13, 0, 0);
const inThreeHours = new Date(2026, 7, 10, 15, 0, 0);
const inFourHours = new Date(2026, 7, 10, 16, 0, 0);
```

Same clock times and durations as before, now on the same local day in every timezone.

### Lockfile changes

**Step 1, `npm update vite brace-expansion source-map-js moment`** (`package.json` unchanged):

| Package | Old | New | Type |
|---|---|---|---|
| vite | 7.3.6 | 7.3.8 | dev |
| brace-expansion | 5.0.9 | 5.0.12 | dev |
| source-map-js | 1.2.1 | 1.2.2 | dev |
| moment | 2.30.1 | 2.31.0 | production dependency (via react-big-calendar), not in the bundle |

**Step 2, `npm i -D vitest@5.1.0`** (all dev):

| Change | Packages |
|---|---|
| Upgraded | vitest 3.2.7 -> 5.1.0; @vitest/mocker 3.2.7 -> 5.1.0; @vitest/spy 3.2.7 -> 5.1.0; chai 5.3.3 -> 6.3.0; es-module-lexer 1.7.0 -> 2.3.2; magic-string 0.30.21 -> 1.4.5; picomatch 4.0.5 -> 4.0.7; std-env 3.10.0 -> 4.3.0; tinybench 2.9.0 -> 6.2.3; tinyexec 0.3.2 -> 1.3.1; why-is-node-running 2.3.0 -> 3.2.1; @jridgewell/sourcemap-codec 1.5.5 -> 1.6.0 |
| Added | obug 3.0.0 |
| Removed | tinypool 1.1.1; vite-node 3.2.4; @vitest/expect, @vitest/pretty-format, @vitest/runner, @vitest/snapshot, @vitest/utils (all 3.2.7); cac 6.7.14; check-error 2.1.3; deep-eql 5.0.2; loupe 3.2.1; pathe 2.0.3; pathval 2.0.1; siginfo 2.0.0; stackback 0.0.2; strip-literal 3.1.0 (and its nested js-tokens 9.0.1); tinyrainbow 2.0.0; tinyspy 4.0.4 |

No eslint-chain package changed version. Plain `npm audit fix` would have updated eslint, typescript-eslint and their dependencies without clearing any advisory, so it was not used.

**Vitest 5 compatibility:** no change was needed to `vite.config.ts`, the jsdom environment, `@testing-library/jest-dom/vitest` or the localStorage stub in `test/setup.ts`. No deprecation warnings appeared in the test run.

---

[REVIEWER OUTPUT]

**Summary:** approved.

- The test diff is limited to the fixture block and its comment, and no assertion changed.
- The new fixtures keep the original intent: bookings an hour after "now", on "today", with the same durations.
- The new comment explains why local times are needed, so a later change back to UTC instants is less likely.
- `package.json` changes only the vitest range; the lockfile changes match the approved plan exactly.

**Required fixes (blockers):** none.

**Suggested improvements:** none.

---

[TESTER OUTPUT]

**Before the fixture fix, `TZ=Asia/Tokyo`:**

| Toolchain | Result | Failing tests |
|---|---|---|
| Clean `HEAD`, vitest 3.2.7 | 141/145 | The same 4 below |
| After both dependency steps, vitest 5.1.0 | 141/145 | The same 4 below |

The failing tests were:

1. visually distinguishes pending from confirmed bookings and excludes cancelled ones
2. shows booking details on selection, with Confirm/Decline for a pending booking and Cancel booking for a confirmed one
3. cancels a confirmed booking with an optional reason: removes it from the grid and closes the dialog
4. selecting a different booking without closing the popup first does not carry over a stale error or reveal state

This shows the failures don't depend on the toolchain.

**After the fixture fix (vitest 5.1.0), full suite:**

| Timezone | Result |
|---|---|
| Europe/Helsinki | 145/145 |
| UTC | 145/145 |
| Asia/Tokyo | 145/145 |
| Australia/Sydney | 145/145 |
| Pacific/Kiritimati (UTC+14) | 145/145 |
| Pacific/Midway (UTC-11) | 145/145 |

**How to run:**

```
cd frontend
TZ=Asia/Tokyo npx vitest --run
```

---

[SECURITY OUTPUT]

### 1) CIA Impact
- **Confidentiality: None.** No production code change, and nothing new reaches the bundle.
- **Integrity: None.** Dev tooling and one test file only.
- **Availability: None.** The production build tool stays on vite 7.

### 2) OWASP-style Checks
Not applicable to this diff: no input handling, auth, data exposure or runtime configuration changed. The removed advisories were in developer tooling: a prototype-pollution RCE gadget in tinypool, vite dev-server and launch-editor issues, and DoS issues in brace-expansion and source-map-js.

### 3) Dependency & Supply Chain Review
- **New dependencies added? No.** vitest moves from 3 to 5 as an existing dev dependency.
- **Production bundle:** the built JavaScript contains no `moment` code, so the `moment` update does not change what ships.

**Audit evidence:**

| Command | Before | After |
|---|---|---|
| `npm audit --omit=dev` | 1 moderate (`moment`) | `found 0 vulnerabilities` |
| `npm audit --audit-level=high` | fails | exit 0 |
| `npm audit` | 17 (12 moderate, 3 high, 2 critical) | 10 moderate, 0 high, 0 critical |

**Remaining advisories (all moderate, all from one root cause):**

All 10 trace to a single advisory, [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249): minimatch denial of service through glob-pattern amplification, patched only in minimatch 11.0.1.

| Package | How it's affected |
|---|---|
| minimatch 10.2.6 | The vulnerable package itself |
| @eslint/config-array | Depends on minimatch `^10.2.4` |
| eslint (direct) | Through config-array and minimatch |
| @eslint/js (direct) | Through eslint |
| @typescript-eslint/typescript-estree | Depends on minimatch `^10.2.2` |
| @typescript-eslint/parser, utils, type-utils, eslint-plugin | Through typescript-estree |
| typescript-eslint (direct) | Through all of the above |

- **Why dev-only and lint-only:** eslint and typescript-eslint run only in `npm run lint` on developer machines. Nothing from them reaches the production bundle. The DoS needs an attacker-controlled glob pattern, while the lint config's patterns are fixed in the repo.
- **Why not fixable now:** eslint 10 and typescript-eslint pin minimatch to 10.x, so no non-breaking update reaches 11.0.1. npm's only offered fixes are downgrades (eslint 9.39.5, typescript-eslint 8.36.0), which decision 3 rules out. The backend carries the same items for the same reason.
- **When to revisit:** once an eslint or typescript-eslint release moves to minimatch 11.0.1 or later.

**Recommendation: Accept.**

### 4) Threat Mini-Model
- **Assets:** developer machines and the build pipeline.
- **Entry points:** the dev server, the test runner, the lint run.
- **Threats:** the removed tooling advisories above; the remaining minimatch DoS needs attacker-controlled patterns.
- **Mitigations:** patched tooling; the lint patterns are fixed in the repo.

### 5) Risk Summary
- **Severity: Low.**
- **Required mitigations before merge:** none.
- **Follow-ups:** revisit the eslint-chain moderates when a minimatch 11 compatible release exists.

### 6) Secure SDLC Phase
- **Phase affected:** Implementation (dependencies) and Testing.
- **Re-review required after mitigation?** No.

### Merge Decision
- **Approved for merge: Yes.**

---

[RELEASE OUTPUT]

### DoD checklist

| Item | Status | Evidence |
|---|---|---|
| Acceptance criteria met | Pass | All 7 met |
| `npm audit`: no HIGH or CRITICAL | Pass | 10 moderate, each documented above |
| `npm audit --omit=dev`: nothing HIGH or CRITICAL | Pass | 0 vulnerabilities; `moment` resolved |
| Vitest major upgrade with no weakened assertions | Pass | 145/145, no test or config edits for vitest |
| 4 timezone tests pass in Helsinki, UTC, Tokyo | Pass | Plus Sydney, Kiritimati and Midway; root cause documented |
| No production source change | Pass | `git diff -- frontend/src` empty |
| No unnecessary `any` | Pass | None |
| Lint and formatting | Pass (lint) | `npm run lint` clean; no format script is configured |
| No dead code or debug logs | Pass | |
| Tests pass locally | Pass | 145/145 |
| Tests pass in CI | N/A | No CI workflow in the repo |
| Build and `tsc --noEmit` | Pass | |
| Secrets not committed | Pass | Dependency files and one test file only |
| No new dependency; lockfile limited to intended packages | Pass | Full list above |
| Docs updated | Pass | This report |
| Backend untouched | Pass | `git diff -- backend` empty |

**Result: pass.**

### How to verify

```
cd frontend
npm ci
TZ=Europe/Helsinki npx vitest --run    # expect 145 passed
TZ=Asia/Tokyo npx vitest --run         # expect 145 passed
npx tsc --noEmit && npm run lint && npm run build
npm audit --omit=dev                   # expect 0 vulnerabilities
npm audit --audit-level=high; echo $?  # expect 0
```

### Release notes

- No production change; the built bundle is unaffected.
- Running the frontend tests now needs Node 22.12 or later (vitest 5). The production build still needs only Node 20.19 or later (vite 7).
- **Rollback:** revert the commit.

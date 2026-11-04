# Run report: 042-update-availability-tests-for-30min-slots

- **Title:** Update availability integration tests for 30-minute slot granularity
- **Profile:** Node/TypeScript Backend
- **Completed:** 2026-11-04T08:10:55.000Z
- **DoD status:** pass

---

[ARCHITECT OUTPUT]

Approved by Ville. Summary of the approved plan and resolved decisions:

- **Scope:** the 6 failing tests in `backend/test/integration/availability.test.ts`, plus a report of other tests assuming 15 minutes. No production code, other tests or frontend.
- **Spec correction:** `SLOT_GRANULARITY_MINUTES` is not exported (`backend/src/services/availabilityService.ts:11`), and exporting it would change a production file.
- **Derivation:** a slot fits when its start plus 75 minutes (60 plus a 15-minute buffer) is within the window. Expected lists were confirmed by running the real `sliceIntoSlots` at 30 minutes.
- **CIA:** None for all three. **New dependency:** No.

Decisions:

1. Use explicit literal slot lists with `toEqual`. Do not export the constant or change anything under `backend/src` or `frontend/`.
2. Keep the current slot behaviour, leave the test at line 117 alone, and record the off-grid behaviour as an observation only.
3. Commit directly on `master`, with spec 042 in this commit and specs 040 and 041 in a separate commit.

---

[IMPLEMENTER OUTPUT]

Only `backend/test/integration/availability.test.ts` changed among code files.

| Test | Old assertion | New assertion |
|---|---|---|
| Rule hours, 09:00-12:00 | length 8, first 09:00 | exactly 09:00, 09:30, 10:00, 10:30 |
| `open` exception, 10:00-12:00 | length 4, first 10:00 | exactly 10:00, 10:30 |
| Cancelled booking, 09:00-12:00 | contains 09:00, length 8 | exactly 09:00, 09:30, 10:00, 10:30 |
| Cutoff at 10:00 | first slot 10:15 | exactly 10:30 |
| Previous-day booking, 00:00-02:00 local (2 zones) | length 4, first midnight | exactly midnight and 00:30 local, in UTC |

Comments that described 15-minute steps now show the 30-minute working. The cutoff test's existing `not.toContain` checks stay.

---

[REVIEWER OUTPUT]

**Summary:** approved.

- Every changed assertion is stricter: exact lists replace length and first-element checks.
- Each test still covers its original behaviour. In the cutoff test, 10:00 is still a real slot equal to the cutoff, so the strict `>` boundary remains meaningful.
- The diff contains no production file and no helper that recalculates slots.

**Required fixes (blockers):** none.

**Suggested improvements:** none in this diff. See the observation below.

---

[TESTER OUTPUT]

**Results, real test database:**

| Suite | Total | Pass | Fail |
|---|---:|---:|---:|
| Unit | 114 | 114 | 0 |
| Integration | 137 | 137 | 0 |
| **All** | **251** | **251** | **0** |

**Mutation checks.** Each was a temporary one-line change to `backend/src/services/availabilityService.ts`, restored with `git checkout` and confirmed clean afterwards. The full suite ran each time.

| Mutation | Result | Tests that failed |
|---|---|---|
| `SLOT_GRANULARITY_MINUTES` 30 -> 15 | 6 failed, 245 passed | All 6 updated tests |
| Cutoff filter `>` -> `>=` | 1 failed, 250 passed | excludes slots at or before the cutoff, keeps the rest -- strict > boundary |
| Booking query also counts `cancelled` | 1 failed, 250 passed | a cancelled booking does not reduce availability |

**Other tests embedding a 15-minute assumption:** none depend on the constant.

- `backend/test/unit/availabilityIntervals.test.ts` has `FIFTEEN_MIN`, but passes it to `sliceIntoSlots` as a parameter, so it is unaffected.
- A search of `backend/test` and `frontend/test` found no other `:15` or `:45` times outside `availability.test.ts`.
- Passing tests in `availability.test.ts` still use 10:15 at line 117, which reflects the off-grid behaviour below rather than a 15-minute step.

**How to run:**

```
docker start masseur-pg
cd backend && npx vitest --run
```

---

[SECURITY OUTPUT]

### 1) CIA Impact
- **Confidentiality: None.** Test-only change.
- **Integrity: None.** No production change, and assertions are stricter.
- **Availability: None.** No production change.

### 2) OWASP-style Checks
Not applicable to this diff: no input handling, auth, data exposure, configuration or logging changed.

### 3) Dependency & Supply Chain Review
- **New dependencies added? No.** `package.json` and the lockfile are untouched.
- **Audit evidence:** `npm audit --omit=dev` found 0 vulnerabilities, and `npm audit --audit-level=high` exits 0.
- **Recommendation: Accept.**

### 4) Threat Mini-Model
- **Assets, entry points, threats:** no change.
- **Mitigation:** the mutation checks show the tests still detect a cutoff or booking-status regression.

### 5) Risk Summary
- **Severity: Low.**
- **Required mitigations before merge:** none.
- **Follow-ups:** task 041 (rate limiting) remains open and is unaffected.

### 6) Secure SDLC Phase
- **Phase affected:** Testing.
- **Re-review required after mitigation?** No.

### Merge Decision
- **Approved for merge: Yes.**

---

## Observation: slots are not aligned to the clock

Recorded only; no change was made, per decision 2.

`sliceIntoSlots` counts from the start of each free interval. After a 09:00-10:15 booking, customers are offered 10:15 and 10:45, not 10:30. The test at line 117 pins this behaviour. With a 30-minute step, customers can therefore see times on :15 and :45. Slots only on :00 and :30 would be a production change and its own task.

---

[RELEASE OUTPUT]

### DoD checklist

| Item | Status | Evidence |
|---|---|---|
| Acceptance criteria met | Pass | All 5 met |
| Edge cases considered | Pass | Window edges, cutoff boundary, midnight in two zones |
| No breaking changes | Pass | Test-only |
| No unnecessary `any` | Pass | None added |
| Conventions followed | Pass | |
| Lint and formatting | Pass (lint) | `npm run lint` clean; no format script is configured |
| No dead code or debug logs | Pass | |
| Tests cover the behaviour, including failure paths | Pass | Mutation checks |
| Tests pass locally | Pass | 251/251 |
| Tests pass in CI | N/A | No CI workflow in the repo |
| Build and `tsc --noEmit` | Pass | |
| Validation, auth, error handling | N/A | Unchanged |
| Secrets not committed | Pass | Test file, specs, report and log only |
| Dependency and audit gates | Pass | No dependency change; 0 production vulnerabilities, 0 high or critical overall |
| Docs updated | Pass | This report |
| No file under `backend/src` or `frontend/` changed | Pass | Confirmed with `git diff` |

**Result: pass.** This also clears the test-failure gate that blocked task 039.

### How to verify

```
docker start masseur-pg
cd backend
npm ci
npx vitest --run            # expect 251 passed
npx tsc --noEmit && npm run lint && npm run build
npm audit --omit=dev        # expect 0 vulnerabilities
```

### Release and rollback notes

No migrations, environment or production changes. To roll back, revert this commit.

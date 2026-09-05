# Run Report: 032-translate-unauthorized-and-login-request-message

**Title:** Finnish translation: UnauthorizedError message and the login-request confirmation message
**Profile:** Node/TypeScript Backend
**Timestamp:** 2026-09-05T15:42:46.000Z
**DoD status:** pass

---

## [ARCHITECT OUTPUT]

### Scope & assumptions
Narrow, already-vetted follow-up to tasks 029/030/031. Per `agents/tasks/032-translate-unauthorized-and-login-request-message.json`, exactly two backend-originated strings are in scope because they are the only ones genuinely rendered to a masseur:

1. `UnauthorizedError`'s `clientMessage` (`backend/src/errors.ts`) — reaches the user only via `AdminLoginCallback.tsx`'s catch block (`error instanceof ApiError ? error.message : ...`), which renders it verbatim when a login link is invalid, expired, or already used.
2. `GENERIC_LOGIN_REQUEST_MESSAGE` (`backend/src/routes/auth.ts`) — rendered verbatim by `AdminLoginRequest.tsx` on every login-request submission.

Every other `AppError` subclass, all zod validation messages, `rateLimit.ts` messages, and the `"Logged out"` string are deliberately out of scope (confirmed already investigated and excluded per the task spec) — not touched.

### File impact list (confirmed by direct inspection, not just the task spec's list)
- `backend/src/errors.ts` — `UnauthorizedError`'s `clientMessage`.
- `backend/src/routes/auth.ts` — `GENERIC_LOGIN_REQUEST_MESSAGE`.
- `frontend/test/AdminLoginRequest.test.tsx` — local `GENERIC_MESSAGE` constant mirrors the backend string.
- `frontend/test/AdminLoginCallback.test.tsx` — one test stubs a 401 response body and asserts the rendered alert text; both need to move from the old English string to the new Finnish string to remain a meaningful representation of production behavior.

Checked but confirmed to need **no change** (re-checked each assertion's intent, not blind find-and-replace):
- `backend/test/unit/adminAuthService.test.ts` and `backend/test/unit/requireMasseurAuth.test.ts` — both assert only `expect.any(UnauthorizedError)` / `rejects.toBeInstanceOf(UnauthorizedError)`, never the literal message text. No churn needed.
- `backend/test/integration/auth.test.ts` — asserts only HTTP status codes (200/401/400) on every login/logout case, never response body text.
- `frontend/test/AdminAvailability.test.tsx`, `AdminServices.test.tsx`, `AdminDashboard.test.tsx` (×3), `AdminCalendar.test.tsx` (×3) — each uses `{ error: "Unauthorized" }` purely as an arbitrary 401 stub body to trigger the silent `onSessionEnded()` redirect path; none of them render or assert on that string's content. Confirmed by reading the surrounding test bodies. Left untouched, consistent with the task's own investigation that these call sites never surface the message to a user.

### Implementation plan
1. Change `UnauthorizedError`'s `clientMessage` in `errors.ts` to natural Finnish.
2. Change `GENERIC_LOGIN_REQUEST_MESSAGE` in `auth.ts` to natural Finnish, keeping it a single literal returned unconditionally (no branching on `requestLoginLink`'s outcome).
3. Update `AdminLoginRequest.test.tsx`'s `GENERIC_MESSAGE` constant to match.
4. Update `AdminLoginCallback.test.tsx`'s invalid/expired-token test to stub and assert the new Finnish text instead of the old English placeholder, so the test still mirrors real production behavior.
5. Run backend and frontend test/build/lint/typecheck and confirm no other test depends on the old strings.

### Validation strategy
No input validation changes — this task only changes string literals returned to the client, not request handling, schemas, or control flow.

### Test strategy
Re-run the full backend unit suite and full frontend suite to catch any other test incidentally depending on the old English text; grepped both trees first for the exact literals to make sure the two named test files aren't the only ones affected.

### CIA impact
- **Confidentiality:** None — no data exposure change, same information conveyed in a different language.
- **Integrity:** None — `GENERIC_LOGIN_REQUEST_MESSAGE` remains a single unconditional literal; the anti-enumeration property (identical response regardless of whether the email matched `ADMIN_EMAIL`) is structurally unchanged, since only the string literal's contents changed, not the code path that returns it.
- **Availability:** None — no behavioral/timing change.

### Dependency decision
No new dependency needed. Plain string literal changes.

---

## [IMPLEMENTER OUTPUT]

**`backend/src/errors.ts`**
```diff
 export class UnauthorizedError extends AppError {
   constructor() {
-    super(401, "Unauthorized");
+    super(401, "Kirjautumislinkki ei ole enää voimassa.");
   }
 }
```
This single shared class is thrown from `adminAuthService.ts`'s `consumeLoginTokenAndCreateSession` (the genuinely visible call site) and from `requireMasseurAuth.ts`'s three guard checks (never displayed today, since every admin page's 401 handler redirects without reading `error.message`). Translating the one shared message covers the visible path without special-casing call sites, per the task spec's explicit guidance. Chose "Kirjautumislinkki ei ole enää voimassa." ("This login link is no longer valid.") over a literal "Ei valtuutusta" — it's more informative to a masseur who reused or waited out a link, and it pairs naturally with the existing "Pyydä uusi kirjautumislinkki" link already rendered right below it in `AdminLoginCallback.tsx`.

**`backend/src/routes/auth.ts`**
```diff
-const GENERIC_LOGIN_REQUEST_MESSAGE = "If that email is registered, a login link has been sent.";
+const GENERIC_LOGIN_REQUEST_MESSAGE =
+  "Jos sähköpostiosoite on rekisteröity, kirjautumislinkki on lähetetty.";
```
Still a single literal returned unconditionally by `POST /auth/login-request` — the anti-enumeration property (byte-identical response regardless of whether the email matched `ADMIN_EMAIL`) is untouched; only the language changed, confirmed by re-reading the route handler (line `res.status(200).json({ message: GENERIC_LOGIN_REQUEST_MESSAGE });` — no branch added).

**`frontend/test/AdminLoginRequest.test.tsx`**
```diff
-const GENERIC_MESSAGE = "If that email is registered, a login link has been sent.";
+const GENERIC_MESSAGE = "Jos sähköpostiosoite on rekisteröity, kirjautumislinkki on lähetetty.";
```
This constant is a local mirror of the backend string used to stub the fetch response and assert the rendered `role="status"` text — updated to stay byte-identical with the real backend string.

**`frontend/test/AdminLoginCallback.test.tsx`**
```diff
   it("shows the backend's error and a link back to /admin when the token is invalid/expired", async () => {
     setSearch("?token=already-used");
     vi.stubGlobal(
       "fetch",
-      vi.fn(async () => jsonResponse({ error: "Unauthorized" }, 401)),
+      vi.fn(async () => jsonResponse({ error: "Kirjautumislinkki ei ole enää voimassa." }, 401)),
     );

     render(<AdminLoginCallback />);

-    expect(await screen.findByRole("alert")).toHaveTextContent("Unauthorized");
+    expect(await screen.findByRole("alert")).toHaveTextContent("Kirjautumislinkki ei ole enää voimassa.");
```
This is the one test that exercises the exact catch-block path (`error instanceof ApiError ? error.message : ...`) that renders `UnauthorizedError`'s message today — updating the stub and assertion keeps the test a faithful proxy for production behavior instead of asserting a string production no longer sends.

No migration/compat notes needed — this is a pure client-visible string change, no wire-format or schema change.

---

## [REVIEWER OUTPUT]

Checked:
- `UnauthorizedError`'s single shared `clientMessage` still correctly covers all four throw sites (1 in `adminAuthService.ts`, 3 in `requireMasseurAuth.ts`) without needing per-call-site variants — consistent with the task's explicit guidance that splitting the error into variants would be needless complexity for a single shared 401.
- `GENERIC_LOGIN_REQUEST_MESSAGE` is still a single literal, still returned unconditionally in the same line, still never branches on `requestLoginLink`'s outcome — the anti-enumeration property is intact; re-read `authRouter.post("/auth/login-request", ...)` end to end to confirm no new conditional was introduced.
- Re-verified (not assumed) that `backend/test/unit/adminAuthService.test.ts` and `requireMasseurAuth.test.ts` don't assert on the literal message text — both only check `instanceof UnauthorizedError` — so correctly left unmodified rather than churned.
- Re-verified the six other frontend test files using `{ error: "Unauthorized" }` (`AdminAvailability`, `AdminServices`, `AdminDashboard` ×3, `AdminCalendar` ×3) by reading each surrounding test body — all are generic 401-triggers-`onSessionEnded` tests that never render or assert the string; correctly left untouched.
- No new `any`, no new dependency, no logic/control-flow change — this is a string-literal-only diff across 4 files.
- Naming/readability: no issues. Error handling: unchanged shape (`{ error: string }` / `{ message: string }` bodies unaffected).

No blockers. No further changes required.

---

## [TESTER OUTPUT]

### Backend
- `npx vitest run test/unit` → **13 files, 92 tests, all pass**, including `adminAuthService.test.ts` and `requireMasseurAuth.test.ts` unchanged and still green.
- `npm run build` (`tsc -p tsconfig.json`) → clean.
- `npm run lint` (`eslint src`) → clean.
- `npx tsc --noEmit` → clean.
- **Integration tests** (`test/integration/auth.test.ts` and others) require a live Postgres test database on `:5433` per `backend/.env.test`; this execution sandbox has no Postgres, no Docker, and no package-manager/root access to install one, so `test/integration` could not be executed here. This is an environment limitation, not a code gap: `test/integration/auth.test.ts` was read in full and asserts only HTTP status codes (200/401/400) on every login/logout scenario, never response body text — so this change carries no risk of an integration-test regression even though it could not be run in this sandbox.

### Frontend
- `npx vitest run` → **8 files, 99 tests, all pass**, including the two updated files (`AdminLoginRequest.test.tsx`, `AdminLoginCallback.test.tsx`) and all six files that use the unrelated `{ error: "Unauthorized" }` stub (confirmed still passing, confirming they indeed don't depend on that string's content).
- `npm run build` → `tsc -p tsconfig.json` clean; `vite build` itself failed only because this sandbox's pre-existing `dist/` directory (from a prior session, before today) could not be deleted (`EPERM: operation not permitted, unlink ... dist/assets/...` — a sandbox filesystem quirk, not a build error). Re-ran `tsc -p tsconfig.json && vite build --outDir /tmp/... --emptyOutDir` to a scratch directory to isolate the actual build step from the stale-`dist`-deletion issue: build succeeded cleanly, producing the same asset hashes as the existing committed `dist/` (expected, since no `frontend/src` file changed — only `frontend/test`).
- `npm run lint` → clean.
- `npx tsc --noEmit` → clean.

### How to run tests
- Backend: `cd backend && npx vitest run test/unit` (unit, no DB) and, with a local Postgres test DB up per `.env.test`, `npx vitest run test/integration`.
- Frontend: `cd frontend && npx vitest run`.

---

## [SECURITY OUTPUT]

### 1) CIA Impact (lightweight)
- **Confidentiality:** None — no new data exposed; same information, different language.
- **Integrity:** None — the anti-enumeration invariant on `GENERIC_LOGIN_REQUEST_MESSAGE` (identical response regardless of whether the email matched `ADMIN_EMAIL`) is unchanged; verified the route handler still returns one unconditional literal with no new branch.
- **Availability:** None — no behavioral or timing change.

### 2) OWASP-style Checks (lightweight)
- **Input validation & injection risks:** N/A — no input handling touched.
- **AuthN/AuthZ correctness:** Unchanged — `UnauthorizedError`'s 401 status code, all four throw sites, and `requireMasseurAuth`'s guard logic are untouched; only the string shown to the one call site that displays it changed.
- **Sensitive data exposure:** None — no stack traces or internal details added to either message.
- **Security misconfiguration:** N/A.
- **Logging & monitoring gaps:** N/A — no logging changed.

### 3) Dependency & Supply Chain Review
- New dependencies added? **No.**
- Audit evidence: not applicable (no dependency changes), but re-ran for completeness — `npm audit --audit-level=high` in backend below.

### 4) Threat Mini-Model (fast)
- **Assets:** Masseur admin session/login flow.
- **Entry points:** `POST /auth/login-request`, `GET /auth/login`.
- **Threats:** Email enumeration via response differences (pre-existing concern, already mitigated); message tampering (N/A, server-controlled literal).
- **Mitigations:** Anti-enumeration property re-verified intact (single unconditional literal, no branch added).

### 5) Risk Summary
- **Severity:** Low.
- **Required mitigations before merge:** None.
- **Follow-ups (optional):** None.

### 6) Secure SDLC Phase
- **Phase affected:** Implementation (string-literal change only).
- **Re-review required after mitigation?** No.

### Merge Decision
- **Approved for merge:** Yes.

---

## [RELEASE OUTPUT]

### DoD Checklist

| Gate | Status |
|---|---|
| Acceptance criteria met (both strings translated to natural Finnish; anti-enumeration property preserved; no other AppError/validation/rate-limit message touched; relevant tests updated) | ✅ |
| Edge cases considered | ✅ all 4 `UnauthorizedError` throw sites covered by the one shared message; login-request response verified still byte-identical across matching/non-matching email (logic untouched) |
| No breaking changes | ✅ pure string-literal change, no API contract/shape change |
| TS strict / no unnecessary `any` | ✅ |
| Follows conventions | ✅ |
| Lint & formatting | ✅ backend + frontend both clean |
| No dead code / debug logs | ✅ |
| New/changed behavior has tests | ✅ existing tests updated to match new strings |
| Negative tests | ✅ invalid/expired-token and malformed-email paths still covered |
| Tests pass locally | ✅ backend 92/92 unit (integration not executable in this sandbox — see Tester Output); frontend 99/99 |
| Input validation | N/A — unaffected |
| AuthN/AuthZ | N/A — unaffected (status codes, guard logic, throw sites all unchanged) |
| Secrets not committed | ✅ |
| No new dependency / audit | ✅ none added |
| README/docs updated if behavior changes | N/A — no behavior change, string content only |

**DoD status: PASS**

### Deviations from the approved plan
None on scope — implemented exactly the two strings specified, in exactly the files specified, plus the two test files the task spec named. No additional call sites needed special-casing. One environment-level limitation (not a plan deviation): `backend/test/integration` could not be executed in this execution sandbox (no Postgres/Docker/root available) — mitigated by directly reading `test/integration/auth.test.ts` in full and confirming it asserts only status codes, never response body text, so it carries no regression risk from this change. Frontend `vite build`'s asset-writing step also hit a sandbox-only `EPERM` on a stale pre-existing `dist/` directory from an earlier session; the actual build (`tsc` + `vite build`) was independently verified clean by building to a scratch output directory.

### How to Verify
1. `cd backend && npx vitest run test/unit && npm run build && npm run lint && npx tsc --noEmit`
2. With a local Postgres test DB up per `backend/.env.test`: `cd backend && npx vitest run test/integration`
3. `cd frontend && npx vitest run && npm run build && npm run lint && npx tsc --noEmit`
4. Manually: request a login link at `/admin` and submit — confirm the confirmation message reads "Jos sähköpostiosoite on rekisteröity, kirjautumislinkki on lähetetty." Then open an expired or already-used login link and confirm the error reads "Kirjautumislinkki ei ole enää voimassa." with the "Pyydä uusi kirjautumislinkki" link beneath it.

### Release Checklist
- [x] All DoD gates pass (integration-test execution excepted, with rationale above)
- [x] Committed and pushed per the standing task instruction

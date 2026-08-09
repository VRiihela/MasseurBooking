# Run Report: 010-customer-booking-widget

Customer booking widget (service pick -> slot pick -> book -> confirmation)
Profile: React Frontend

---

## [ARCHITECT OUTPUT]

### 1) Scope & assumptions
- New-booking flow only: browse services -> pick date -> pick slot -> submit form -> confirmation screen. The magic-link manage/cancel/reschedule page (task 007's API) is explicitly out of scope.
- Confirmed the task's flagged assumption: no frontend scaffold exists in this repo. Added `web/` as a new top-level sibling folder with its own `package.json`/`vite.config.ts`, rather than moving the backend into a subfolder.
- Guest checkout only -- no login/signup/account concept anywhere in this flow.
- Confirmed from `availabilityService.ts`: `GET /availability` returns a bare `string[]` of UTC ISO slot-start timestamps -- treated as an opaque token, displayed via local-time formatting but passed back to `POST /bookings` byte-for-byte unmodified.
- Confirmed from `bookingsRouter`: `POST /bookings` returns `201 { id, status: "pending", start_at, end_at }` on success, `409 { error: "slot no longer available" }` on conflict. Error shape is uniform (`{ error: string }`).
- One backend touch only: CORS in `src/app.ts`.

### 2) File impact list
New (`web/`): `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `.env.example`, `src/main.tsx`, `src/App.tsx`, `src/api/client.ts`, `src/api/types.ts`, `src/pages/BookingWidget.tsx`, `test/BookingWidget.test.tsx`.
Modified (backend, one file): `src/app.ts` (+`cors` middleware, env-driven single-origin allowlist).

### 3-7) Plan / Validation / Test strategy / CIA / Dependencies
Full plan, CIA breakdown (Confidentiality Low, Integrity Low-Med -- the raw-UTC-passthrough risk, Availability Low), and dependency decision (React/Vite/Testing-Library scaffold unavoidable as the repo's first frontend; `cors` for the backend touch; no date library, no router) are in the Architect turn of this session's transcript.

**User's confirmation before Implementer ran:** mirror the backend's actual phone rule (non-empty only, `bookingSchema.ts`) exactly -- do not add a stricter client-only format check, since a client rejecting backend-valid input is a false rejection, not a safety improvement. User separately filed (not this task, not a blocker): the backend's phone validation is weaker than task 001's original "basic format checks" spec and deserves a small future task to tighten it, with the frontend updated to match at the same time.

## [IMPLEMENTER OUTPUT]

**New files:** all `web/` files listed above, plus `web/eslint.config.js`, `web/src/vite-env.d.ts`, `web/test/setup.ts` (needed for a working scaffold, not in the original file list); `src/config/cors.ts`; `test/integration/cors.test.ts`.

**Changed files:** `src/app.ts` (+`cors` middleware wired via a `(origin, callback)` allowlist function rather than a static string, so disallowed origins get no `Access-Control-Allow-Origin` header at all rather than relying solely on the browser to enforce a reflected header); `package.json`/`package-lock.json` (+`cors`, `+@types/cors`); `.env.example` (+`CORS_ORIGIN`); `vitest.config.ts` (+`env.CORS_ORIGIN` for the ~13 existing test files that construct `createApp()`, +`exclude: ["web/**"]`, see below).

**Design decisions made during implementation (not pre-specified):**
1. `loadCorsOrigin()` is read once and the origin-check happens via a callback function, not `cors({ origin: <string> })` -- an allowlist function is more directly correct/testable than relying on the "browser discards a mismatched static header" mechanism.
2. Since `createApp()` now calls `loadCorsOrigin()` (which throws if `CORS_ORIGIN` is unset) at construction time, every existing integration test that does `const app = createApp()` at module scope needed the env var present *before* that line runs. Rather than edit all ~13 test files, set `CORS_ORIGIN` once in root `vitest.config.ts`'s `test.env`.
3. Data-testid attributes added to service/slot/submit buttons in `BookingWidget.tsx` purely for deterministic test targeting -- avoids asserting on `Intl.DateTimeFormat` output, which is locale/timezone-dependent and would make tests flaky across machines.

**Two real bugs caught and fixed during implementation (not just written correctly the first time):**
1. **Native HTML5 validation silently swallowed the invalid-email test.** With `type="email"` + `required` and no `noValidate`, jsdom (matching real browsers) blocks the `submit` event entirely when the input fails the browser's own constraint validation -- our `handleSubmit`, and therefore our own "Enter a valid email address" message, never ran. Fixed by adding `noValidate` to the `<form>` so the app's own validation (which mirrors the backend, not the browser's HTML5 email regex) is authoritative, consistent with the acceptance criterion that client validation is a UX nicety layered on top of what the backend actually enforces.
2. **Root `npm test` silently started running `web/`'s tests under the wrong environment.** Vitest's default include glob isn't scoped to `test/` -- it picked up `web/test/BookingWidget.test.tsx` from the root config too, executing it under `environment: "node"` (no `document`), causing 6 failures. Fixed by adding `exclude: ["web/**"]` to root `vitest.config.ts`; `web/` has its own independent Vitest config and test run.

**Also fixed:** `web/`'s initially-pinned `vite@^5.4.2`/`vitest@^2.0.5` carried a moderate/high/critical vulnerability chain (esbuild dev-server request/response exposure, Vitest UI arbitrary file read) per `npm audit`. Bumped to `vite@^7.1.12`/`vitest@^3.2.4` -- `npm audit --audit-level=high` now reports 0 vulnerabilities, all tests/build still pass unchanged.

**Migration/compat notes:** `CORS_ORIGIN` is now a required env var for the backend (`.env.example` updated); deploying without it will make `createApp()` throw at startup, same fail-fast pattern as every other `requireEnv`-backed config in this repo.

## [REVIEWER OUTPUT]

**Review summary:** No blockers. Matches the confirmed plan; both bugs above were caught and fixed during this same implementation pass (see Implementer notes) rather than left for a separate review round.

- CORS allowlist correctly rejects by omission (no header) rather than ever emitting a wildcard or an unconditionally-reflected origin -- verified by a real cross-origin test, not just code inspection.
- The raw UTC slot string is threaded through component state untouched (`selectedSlot`) and only ever passed through `formatSlotLocal()` for display, never reassigned from a formatted value -- verified by a test asserting exact string equality on the outgoing `POST /bookings` body, not just "a plausible-looking timestamp."
- 409 handling clears `selectedSlot` and re-triggers `fetchSlots` for the same service/date rather than leaving a stale, now-invalid slot selected.
- Phone validation matches the user's explicit instruction: non-empty only, no added format regex.

**Suggested improvements (nice-to-have, not blockers):**
- `fetchSlots` has no request-cancellation/staleness guard -- if a user changes the date twice in quick succession, a slower first response could in principle resolve after a faster second one and overwrite it with stale data. Low likelihood given this is a single click-driven UI, not worth an `AbortController` for v1's scope, but worth a comment or follow-up if the widget grows more interactive.
- `service.price` renders as a raw number with no currency formatting -- cosmetic, not in the acceptance criteria.

## [TESTER OUTPUT]

**Test cases added (`web/test/BookingWidget.test.tsx`, 7 tests):**
- Services render from `GET /services`.
- Selecting a service fetches and renders slots for the current date.
- `POST /bookings`'s `start_at` is asserted **string-equal** to the value originally returned by `/availability` -- the test most likely to catch a lossy reformat/reconstruction.
- Success (`201`) renders pending-confirmation copy; asserted to *not* contain "confirmed" or "you're booked" wording.
- Submit button is disabled synchronously once the request is in flight (tested with a controlled, manually-resolved fetch promise).
- `409` response renders the specific "just taken" alert and triggers a second `GET /availability` call (call count asserted to increase).
- Invalid email blocks submit with no network call to `/bookings` at all.

**Backend test added (`test/integration/cors.test.ts`, 2 tests):** allowed origin gets `Access-Control-Allow-Origin` echoed back on a preflight `OPTIONS`; a different origin gets no such header and never a wildcard. Runs without a real DB (the cors middleware short-circuits before any route/DB access).

**How to run:**
```bash
# Backend (needs DATABASE_URL pointing at a disposable Postgres DB, migrations applied)
DATABASE_URL=postgres://<user>@localhost:5432/masseur_booking_test \
ADMIN_EMAIL=admin@example.com APP_BASE_URL=https://example.com \
npm test -- --run

# Frontend
cd web && npm test -- --run
```
**Actual results:** backend `Test Files 25 passed (25)`, `Tests 196 passed (196)` (194 pre-existing + 2 new CORS tests). Frontend `Test Files 1 passed (1)`, `Tests 7 passed (7)`.

## [SECURITY OUTPUT]

### 1) CIA Impact
- **Confidentiality: Low.** CORS moves the API from zero cross-origin browser access (no headers previously) to exactly one configured origin -- a strict narrowing versus a wildcard, and admin routes remain behind `requireMasseurAuth` regardless. No client-side persistence of name/email/phone (no localStorage/sessionStorage anywhere in `BookingWidget.tsx`).
- **Integrity: Low.** No server-side booking logic changed. The client-side risk (reformatting the UTC slot before submission) is mitigated by design and verified by test (string-equality assertion on the outgoing payload).
- **Availability: Low.** No new backend endpoints; existing rate limits (`bookingCreationRateLimit`, `availabilityRateLimit`, `publicServicesRateLimit`) are untouched. CORS middleware overhead is negligible.

### 2) OWASP-style Checks
- **Input validation & injection:** unchanged server-side (`createBookingSchema` remains sole authority); client validation is UX-only and deliberately no stricter than the backend (phone: non-empty only, matching `bookingSchema.ts` exactly, per explicit user instruction).
- **AuthN/AuthZ:** no change -- this flow is intentionally unauthenticated guest checkout; admin routes' `requireMasseurAuth` is untouched and unaffected by the CORS change (verified: CORS applies uniformly, auth middleware still runs per-route as before).
- **Sensitive data exposure:** no new PII exposure; the widget only ever holds customer PII in in-flight form state, never persisted.
- **Security misconfiguration:** CORS explicitly rejects (no header) any origin other than the single configured one -- verified by test, not just code reading. Never a wildcard.
- **Logging & monitoring:** no new logging added or needed; unchanged.

### 3) Dependency & Supply Chain Review
**New dependencies: Yes.**
- Backend: `cors` (+`@types/cors` dev). Smallest reputable option for a security-relevant surface; avoids hand-rolled origin-check middleware bugs (wildcard reflection, preflight mishandling).
- Frontend (`web/`, entirely new package): `react`, `react-dom`, `vite`, `@vitejs/plugin-react`, `typescript`, `typescript-eslint`, `eslint`, `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom` -- unavoidable as the repo's first frontend.

**Audit evidence:**
```
$ npm audit --audit-level=high            (root)          -> found 0 vulnerabilities
$ npm audit --omit=dev                    (root)          -> found 0 vulnerabilities
$ cd web && npm audit --audit-level=high                  -> found 0 vulnerabilities
$ cd web && npm audit --omit=dev                          -> found 0 vulnerabilities
```
Note: `web/`'s initial `vite@^5.4.2`/`vitest@^2.0.5` pins failed `--audit-level=high` (moderate/high/critical chain via esbuild/vite-node) before being bumped to `vite@^7.1.12`/`vitest@^3.2.4` -- resolved, not accepted-with-risk.

**Versioning strategy:** `^` ranges, consistent with the rest of the repo. **Recommendation: Accept.**

### 4) Threat Mini-Model
- **Assets:** customer PII submitted through the booking form (in-flight only); the API's admin routes (indirectly, via the CORS surface change).
- **Entry points:** the new `web/` origin calling the existing public API; the CORS preflight/response path in `src/app.ts`.
- **Threats:** a non-configured origin attempting cross-origin reads of API responses (including, in the worst case, admin data if a session were somehow available to it); a stale/reformatted slot timestamp silently shifting a booking's time.
- **Mitigations:** single-origin CORS allowlist with no wildcard, verified by test; raw-UTC-string passthrough verified by test; admin routes still gated by `requireMasseurAuth` independent of CORS.

### 5) Risk Summary
**Severity: Low.** No outstanding mitigations. Follow-up (optional, already filed as a project note, not a blocker): tighten backend phone validation to a real format check in a future task, updating the frontend's mirror at the same time.

### 6) Secure SDLC Phase
Phase: Implementation. Re-review required: No.

### Merge Decision
**Approved for merge: Yes**

## [RELEASE OUTPUT]

### DoD checklist verification
- **Functional:** all 10 acceptance criteria met (service list, local-time slot display, exact UTC passthrough, pending-not-confirmed messaging, specific 409 handling with re-fetch, phone/email client validation mirroring the backend, submit disabled while in flight, env-driven API base URL, env-driven single-origin CORS allowlist, no login/account concept anywhere). Edge cases considered: empty services list, empty slots for a date, invalid email, 409 race, double-submit guard, disallowed CORS origin.
- **Code Quality:** `tsc --noEmit` clean in both packages; `eslint` clean in both packages; no `any` introduced; no dead code/debug logs.
- **Tests:** backend 196/196 passing (194 pre-existing + 2 new), frontend 7/7 passing; negative paths covered (409, invalid email, disallowed CORS origin).
- **Security:** input validation unchanged/server-side-authoritative; CORS is the only authz-adjacent surface touched and is verified restrictive; no stack traces or secrets in any client-facing output; no secrets committed (`.env.example` only, real `.env` gitignored).
- **Dependency & Supply Chain:** both new dependency sets justified above; `npm audit --audit-level=high` and `--omit=dev` both clean (0 vulnerabilities) in both packages; no overly broad version ranges.
- **Documentation & Traceability:** root `.env.example` and new `web/.env.example` both updated to document the new env vars (`CORS_ORIGIN`, `VITE_API_BASE_URL`).

### How to verify
```bash
# Backend
DATABASE_URL=postgres://<user>@localhost:5432/masseur_booking_test \
ADMIN_EMAIL=admin@example.com APP_BASE_URL=https://example.com CORS_ORIGIN=http://localhost:5173 \
npm test -- --run
npm run typecheck && npm run lint
npm audit --audit-level=high

# Frontend
cd web && npm install
npm run typecheck && npm run lint && npm test -- --run && npm run build
npm audit --audit-level=high
```
**Manual browser check (not yet done this pass):** run the backend (`npm run dev` with `CORS_ORIGIN` pointed at the Vite dev server's origin) alongside `cd web && npm run dev`, and click through service -> slot -> form -> confirmation, plus a manually-forced 409 (submit the same slot twice in two tabs) -- recommended before this ships, since automated tests mock `fetch` and don't exercise the real Express+CORS+Vite-dev-server wiring end-to-end.

### Release checklist
Versioning: n/a (pre-1.0). CI green: verified locally (see above). Dependency audit: attached above, 0 vulnerabilities. Security findings: none outstanding. Docs: both `.env.example` files updated. Rollback/migration notes: `CORS_ORIGIN` becomes a required backend env var -- any existing deployment must set it before this deploys, or `createApp()` throws at startup (fail-fast, matches every other required env var in this repo).

# Task 012 — Masseur admin dashboard: login, pending-bookings queue, confirm/decline

Profile: React Frontend
Status: DoD PASS

## [ARCHITECT OUTPUT]

### 1) Scope & assumptions

- Building the masseur-facing admin UI only: login-request, login-token exchange, dashboard with confirm/decline, logout. No backend changes.
- **Routing decision**: no router library. `App.tsx` switches on `window.location.pathname`:
  - `/` → existing `BookingWidget` (untouched)
  - `/auth/login` → `AdminLoginCallback` (mandated by backend's magic-link URL)
  - everything else under `/admin` → a small stateful `AdminRoute` (defined inline in `App.tsx`) that toggles between `AdminLoginRequest` and `AdminDashboard` based on whether a session token exists in `localStorage` — this mirrors `BookingWidget`'s own local step-state-machine rather than adding a second routing mechanism.
- **Navigation between top-level paths** (e.g. after the token exchange) uses a real `window.location.assign("/admin")`, not client-side state — since that's a different top-level path match, and it lets `App` re-read `localStorage` fresh on remount. Logout, by contrast, happens *within* the already-mounted `/admin` tree, so it flips local React state instead of reloading.
- Assumption: `/admin` is the single admin entry path (login-request and dashboard share it, distinguished by session presence, not sub-routes).
- `status=all` in the dashboard filter UI maps to *omitting* the `status` query param entirely (backend schema only accepts `pending|confirmed|cancelled` on the wire, per `adminBookingsQuerySchema.ts`).

### 2) File impact list

- `frontend/src/api/client.ts` — token storage helpers, `authRequest<T>` wrapper, and `requestLoginLink`, `exchangeLoginToken`, `logout`, `getAdminBookings`, `confirmBooking`, `declineBooking`.
- `frontend/src/api/types.ts` — `AdminBooking`, `AdminBookingStatus(Filter)`, and login/confirm/decline response types.
- `frontend/src/pages/AdminLoginRequest.tsx` (new) — email form → `requestLoginLink`.
- `frontend/src/pages/AdminLoginCallback.tsx` (new) — reads `?token=`, calls `exchangeLoginToken`, stores token, navigates to `/admin`.
- `frontend/src/pages/AdminDashboard.tsx` (new) — list + filter + confirm/decline + logout; owns the 401→logout-callback wiring.
- `frontend/src/App.tsx` — path switch + `AdminRoute` session-state toggle.
- No changes to `frontend/src/pages/BookingWidget.tsx` or its test.

### 3) Implementation plan

1. `client.ts`: token storage helpers (`localStorage` key `masseurSessionToken`) and `authRequest<T>`, clearing the token on any caught 401 before rethrowing.
2. `client.ts`: five new endpoint functions typed against `types.ts` additions.
3. `types.ts`: `AdminBooking` mirroring the exact `GET /admin/bookings` response shape, plus small response types.
4. `AdminLoginRequest.tsx`: lenient client-side email check (duplicated, not imported, to avoid touching `BookingWidget.tsx`); shows the backend's generic message verbatim.
5. `AdminLoginCallback.tsx`: missing token → inline error + link back to `/admin`; otherwise exchange, store, and `window.location.assign("/admin")`; failure → show the server's error message + link back to `/admin`.
6. `AdminDashboard.tsx`: local state for `status` filter (default `pending`), fetch via `authRequest`-backed `getAdminBookings`.
7. Confirm/Decline splice the returned `status` into the matching local list item in place — no refetch.
8. Decline sends `{}` when the trimmed reason is empty, `{ reason }` otherwise — never `{ reason: "" }`.
9. Centralized 401 reaction: `authRequest` clears the token; each `AdminDashboard` call site catches `ApiError` and on `status === 401` calls `onSessionEnded`.
10. Logout clears the token and calls `onSessionEnded` in a `finally` block regardless of whether the network call succeeded.
11. `App.tsx`: pathname switch + `AdminRoute` session-presence check on mount.

### 4) Validation strategy (server-side)

Backend remains sole source of truth; every client check is a lenient mirror, never stricter — email format, decline-reason length, status-filter enum, no `dangerouslySetInnerHTML` anywhere, 401 treated as unconditionally authoritative.

### 5) Test strategy

Covers: generic-message-on-any-outcome for login-request; malformed email rejected client-side with zero network calls; missing/invalid/expired token callback branches; Authorization header presence; confirm/decline update in place with no extra `GET /admin/bookings`; blank vs. provided decline reason; 401 mid-session; logout-clears-token-even-on-failure; `BookingWidget` regression untouched.

### 6) CIA impact

- Confidentiality: Medium (localStorage token + XSS surface, mitigated by plain-text-only rendering discipline).
- Integrity: Low (no new mutation surface, existing validated endpoints).
- Availability: Low (additive calls, existing rate limits apply).

### 7) Dependency decision

No new dependency — no router, no state-management library, no new HTTP client.

**User decision (mid-Architect review):** approved the plan; requested adding a link back to `/admin` ("request a new login link") on both `AdminLoginCallback` failure branches (missing token, API error) before proceeding to Implementer.

---

## [IMPLEMENTER OUTPUT]

Implemented per the plan above, plus the requested `RequestNewLinkLink` (`<a href="/admin">Request a new login link</a>`) rendered on both the `missing-token` and `error` branches of `AdminLoginCallback`.

Files changed:
- `frontend/src/api/client.ts` — added `getStoredSessionToken`/`setStoredSessionToken`/`clearStoredSessionToken`, `authRequest<T>`, `requestLoginLink`, `exchangeLoginToken`, `logout`, `getAdminBookings`, `confirmBooking`, `declineBooking`.
- `frontend/src/api/types.ts` — added `AdminBookingStatus`, `AdminBookingStatusFilter`, `AdminBooking`, `LoginRequestResponse`, `ExchangeLoginTokenResponse`, `LogoutResponse`, `ConfirmBookingResponse`, `DeclineBookingResponse`.
- `frontend/src/pages/AdminLoginRequest.tsx` (new)
- `frontend/src/pages/AdminLoginCallback.tsx` (new)
- `frontend/src/pages/AdminDashboard.tsx` (new)
- `frontend/src/App.tsx` — pathname switch + `AdminRoute`.

Verified clean: `npm run typecheck`, `npm run lint`, `npm run build`, and the pre-existing `BookingWidget` test suite (7/7) all passed before handoff to Reviewer.

---

## [REVIEWER OUTPUT]

**Required fixes (found and applied during review):**
1. `AdminDashboard.tsx` was re-parsing `start_at_local`/`end_at_local` with `new Date(...)`, but `backend/src/services/timeFormat.ts` returns those fields as already-formatted human-readable strings (e.g. `"Monday, August 10, 2026 at 9:00 AM GMT+3"`), not ISO. Fixed to render the strings verbatim instead of reformatting.
2. Opening the decline form for a second booking while a reason was already typed for a previous one left the stale text visible. Fixed by clearing `declineReason` whenever a new row's decline form opens.

**Suggested improvements (not blocking):** `cancellation_reason` from the decline response isn't surfaced in the list after declining — acceptable per acceptance criteria, noted as a possible future enhancement.

Re-verified `typecheck`/`lint`/`build` clean after fixes.

---

## [TESTER OUTPUT]

**New test files:** `AdminLoginRequest.test.tsx` (3 cases), `AdminLoginCallback.test.tsx` (3 cases), `AdminDashboard.test.tsx` (6 cases) — 12 new tests, all passing, plus the 7 pre-existing `BookingWidget` tests unaffected (19/19 total).

**Coverage:** valid/invalid email on login-request with no network call on client-rejected input; generic-message-on-any-outcome contract; missing-token and invalid/expired-token callback branches (each asserting the back-to-`/admin` link); Authorization header presence on `GET /admin/bookings`; confirm updates in place with no extra list refetch; decline omits `reason` when blank vs. sends a trimmed value when provided; 401 on the bookings list clears the token and calls `onSessionEnded`; logout clears the token and ends the session even when the logout call itself fails.

**Environment note (not a code bug):** Node 25's built-in `localStorage` global is an unconfigured stub in this Vitest+jsdom setup (`getItem`/`setItem`/etc. all `undefined`) and shadows jsdom's working implementation. Added a minimal in-memory `Storage` polyfill in `test/setup.ts`, scoped to tests only — production code is unaffected since real browsers provide a working `localStorage`.

**How to run:** `cd frontend && npm run test:run` (or `npm test` for watch mode).

---

## [SECURITY OUTPUT]

### 1) CIA Impact
- **Confidentiality: Medium.** Session bearer token persists in `localStorage`, readable by any script on the page — mitigated by plain-JSX-only rendering of all booking-derived strings (verified: no `dangerouslySetInnerHTML`, no token logging anywhere in the diff).
- **Integrity: Low.** No new backend mutation logic; confirm/decline/logout call existing, already-reviewed, server-validated endpoints behind `requireMasseurAuth`.
- **Availability: Low.** Additive calls against endpoints that already carry `adminRateLimit`/`loginRequestRateLimit` server-side.

### 2) OWASP-style Checks
- Input validation & injection risks: client checks are lenient mirrors only; real enforcement is server-side (`declineBookingSchema`, `loginRequestSchema`, `loginTokenQuerySchema`, `adminBookingsQuerySchema`); all query params via `URLSearchParams`.
- AuthN/AuthZ correctness: every authenticated call routes through `authRequest`, the single place the bearer header is attached; `requireMasseurAuth` remains the actual authority.
- Sensitive data exposure: no token in logs/URLs/errors; `AdminLoginCallback` surfaces only the backend's already-generic error message (confirmed against `adminAuthService.ts`'s generic `UnauthorizedError`).
- Security misconfiguration: `CORS_ORIGIN=http://localhost:5173` already matches the frontend dev origin — confirmed, no change needed.
- Logging & monitoring gaps: none introduced.

### 3) Dependency & Supply Chain Review
- New dependencies: No (`frontend/package.json` unchanged).
- Audit evidence: `npm audit --audit-level=high` → 0 vulnerabilities.
- Recommendation: Accept.

### 4) Threat Mini-Model
- Assets: masseur session token (localStorage), booking PII rendered in the dashboard.
- Entry points: `/admin`, `/auth/login?token=...`, the four authenticated fetch calls.
- Threats: XSS reading the token; stale-token silent retry; unsafe rendering of booking-derived strings; reason sent as `""` instead of omitted.
- Mitigations: plain-text-only rendering (verified); centralized 401 handling (tested); JSX-only rendering (tested); blank-vs-provided reason assertion (tested).

### 5) Risk Summary
- Severity: Low. Required mitigations before merge: none. Follow-ups: none security-relevant.

### 6) Secure SDLC Phase
- Phase affected: Implementation/Testing (frontend only). Re-review required: No.

### Merge Decision
- Approved for merge: **Yes**.

---

## [RELEASE OUTPUT]

### DoD Checklist

- **Functional:** ✅ acceptance criteria met (including the mid-review back-to-`/admin` link addition); ✅ edge cases considered; ✅ no breaking changes (`BookingWidget` untouched, its tests still green).
- **Code Quality:** ✅ no unnecessary `any`; ✅ follows conventions.md; ✅ lint clean; ✅ no dead code/debug logs.
- **Tests:** ✅ 19/19 passing (12 new + 7 pre-existing); ✅ negative paths covered; ✅ deterministic.
- **Security (SSDLC):** ✅ server-side validation relied upon (no backend change); ✅ AuthN/AuthZ via `requireMasseurAuth`; ✅ no sensitive-data leakage; ✅ no secrets committed.
- **Dependency & Supply Chain:** ✅ no new dependency; ✅ `npm audit --audit-level=high` clean.
- **Documentation & Traceability:** no README/env changes needed (no new env vars, no existing-endpoint behavior change).

**DoD status: PASS.**

### How to Verify

```
cd frontend
npm run typecheck
npm run lint
npm run test:run    # 19 passed
npm run build
```

Manual end-to-end: start `backend` with `ADMIN_EMAIL`/Postmark configured, start `frontend` (`npm run dev`), visit `/admin`, request a login link, click the emailed link (`/auth/login?token=...` → redirects to `/admin`), confirm/decline a pending booking (updates in place, no reload), log out (returns to login-request). To exercise the 401 path manually, corrupt the stored `masseurSessionToken` in devtools and reload `/admin`.

### Files Changed
- `frontend/src/App.tsx`, `frontend/src/api/client.ts`, `frontend/src/api/types.ts` (extended)
- `frontend/src/pages/AdminLoginRequest.tsx`, `AdminLoginCallback.tsx`, `AdminDashboard.tsx` (new)
- `frontend/test/AdminLoginRequest.test.tsx`, `AdminLoginCallback.test.tsx`, `AdminDashboard.test.tsx` (new)
- `frontend/test/setup.ts` (test-only localStorage polyfill)

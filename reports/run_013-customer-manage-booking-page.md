# Run Report: 013 — Customer manage-booking page (view, cancel, reschedule)

Profile: React Frontend
Date: 2026-08-10 / 2026-08-11

---

## [ARCHITECT OUTPUT]

### 1. Scope & assumptions

- Build `frontend/src/pages/ManageBooking.tsx`, wired into `App.tsx`'s existing hand-rolled pathname switch as a new dynamic-segment branch for `/bookings/:id`.
- One additive backend change: expose `service_id` on `GET /bookings/:id`'s response and `CustomerBookingView`. `POST /bookings/:id/reschedule` needs no backend change — confirmed by reading `rescheduleBookingForCustomer`, which resolves `oldBooking.serviceId` server-side and ignores any client-supplied service.
- Assumption: `BookingStatus` is `"pending" | "confirmed" | "cancelled"` (`backend/src/db/types.ts:1`) and `transitionModifiableBooking` only allows mutation `WHERE status IN ('pending', 'confirmed')` (`bookingService.ts:104-106`). So "no longer modifiable" on the frontend is simply `status === "cancelled"` — this covers both customer-initiated cancellation and masseur decline (decline also sets `status = 'cancelled'`, per `AdminBookingStatus`). No separate "declined" status exists anywhere in the stack.
- Assumption: reschedule's success response is `{ id, status, start_at, end_at }` in raw UTC ISO (not `_local` strings, unlike cancel's `cancelled_at` and unlike the GET view) — confirmed at `backend/src/routes/bookings.ts` reschedule handler. The page re-derives local display strings from a fresh `GET /bookings/:id` after a successful reschedule rather than formatting the raw reschedule response, keeping exactly one place (`getBookingForCustomer`) responsible for local-time formatting.
- Assumption: token is validated client-side only as "present" (non-empty) before firing the GET — the 64-char-hex format check already lives server-side (`bookingTokenQuerySchema`) and re-implementing it client-side would risk drifting out of sync (same reasoning as the phone-validation precedent already in project memory).

### 2. File impact list

**Backend (additive, one field):**
- `backend/src/services/bookingService.ts` — add `s.id AS service_id` to the SELECT in `getBookingForCustomer`, add `service_id` to `CustomerBookingViewRow` and `CustomerBookingView`, map it through.
- `backend/src/routes/bookings.ts` — include `service_id: view.serviceId` in the `GET /bookings/:id` JSON response.
- `backend/test/integration/bookings.customerManagement.test.ts` — extend the existing "returns status, service name..." test to assert `service_id` equals the seeded `serviceId`.

**Frontend (new page + wiring):**
- `frontend/src/App.tsx` — add a dynamic-segment match for `/bookings/:id` above the `BookingWidget` fallback.
- `frontend/src/pages/ManageBooking.tsx` (new) — the whole view: fetch, cancel-with-confirm, reschedule-with-picker, and the three special states (not-found, read-only/non-modifiable, slot-taken).
- `frontend/src/api/client.ts` — add `getBookingForCustomer(id, token)`, `cancelBooking(id, token)`, `rescheduleBooking(id, token, newStartAt)`. Reuse existing `getAvailability`.
- `frontend/src/api/types.ts` — add `CustomerBookingView`, `CancelBookingResponse`, `RescheduleBookingResponse`.
- `frontend/test/ManageBooking.test.tsx` (new) — covers the acceptance criteria.

No new dependencies; no changes to `BookingWidget.tsx` or `AdminDashboard.tsx`.

### 3. Implementation plan

1. **Backend**: add `s.id AS service_id` to `getBookingForCustomer`'s query, extend `CustomerBookingViewRow`/`CustomerBookingView` with `serviceId: string`, map `row.service_id → serviceId`. Add `service_id: view.serviceId` to the route's JSON. This is the only backend diff.
2. **Types**: add `CustomerBookingView { id, status, service_id, service_name, start_at_local, end_at_local }`, `CancelBookingResponse { id, status, cancelled_at }`, `RescheduleBookingResponse { id, status, start_at, end_at }`.
3. **API client**: `getBookingForCustomer(id, token)` → `GET /bookings/:id?token=`; `cancelBooking(id, token)` → `POST /bookings/:id/cancel?token=`; `rescheduleBooking(id, token, newStartAt)` → `POST /bookings/:id/reschedule?token=` with body `{ newStartAt }`. Token travels as a query param on every call, never as an `Authorization` bearer.
4. **App.tsx routing**: `path.match(/^\/bookings\/([^/]+)$/)`; on match render `<ManageBooking bookingId={match[1]} />`, above the `BookingWidget` fallback. No new routing abstraction, no `react-router-dom`.
5. **ManageBooking.tsx — load**: read `token` from `new URLSearchParams(window.location.search)` into local state only — never `localStorage`. Missing token is treated identically to a 404. Any GET failure (404, malformed token 400, network) collapses into the same generic not-found state.
6. **Read-only branch**: `view.status === "cancelled"` renders service/status/time with no Cancel/Reschedule controls.
7. **Cancel flow**: explicit confirm step (not `window.confirm()`), same two-step shape as `AdminDashboard`'s decline confirm. On success, update view state in place from the cancel response — no reload, no re-fetch.
8. **Reschedule flow — picker**: self-contained, locally duplicated (not shared with `BookingWidget`) date input + `getAvailability` call + slot buttons + `formatSlotLocal`. Selected slot's exact ISO string is stored verbatim and shown behind its own confirm step.
9. **Reschedule submit**: `POST /bookings/:id/reschedule` with the stored raw ISO string. On success, re-fetch `getBookingForCustomer` to get correctly-formatted new local times, then collapse back to the read view.
10. **Reschedule 409 disambiguation (resolved by user directive)**: on any 409 from `POST /bookings/:id/reschedule`, re-fetch the booking via `getBookingForCustomer` and branch on its *actual current status* — `"cancelled"` → non-modifiable/read-only state; still `"pending"`/`"confirmed"` → slot-taken state (refresh the slot list). Never distinguish by matching `error.message` text.
11. No `dangerouslySetInnerHTML` anywhere.

### 4. Validation strategy (server-side)

- `customerHasAccess` combines the id+token check into one query (`bookingService.ts:411-426`) — frontend never layers more specific messaging on top of this.
- `bookingTokenQuerySchema` (64-hex) and `bookingIdParamSchema` (UUID) already reject malformed input server-side — frontend only does a presence check.
- `rescheduleBookingSchema` (`strictUtcTimestamp`) already validates `newStartAt` server-side; frontend never constructs this string, only forwards `GET /availability`'s output.
- The one backend change reads a column from a table already joined in the same query, under the same access-control clause — no new query, no new privilege surface.

### 5. Test strategy

**Backend**: extend the existing customer-view happy-path test with a `service_id` assertion — no new test file, one-field addition to an already-covered route.

**Frontend** (`ManageBooking.test.tsx`, mirrors `AdminDashboard.test.tsx`/`BookingWidget.test.tsx` conventions):
- Happy-path render; missing-token and backend-404 both generic and token-silent; read-only branch for cancelled bookings; cancel requires explicit confirm and updates in place; reschedule forwards the exact ISO string; no service picker; 409 slot-taken refreshes slots with inline message; 409 non-modifiable collapses to read-only (the specific case resolved this session); no `dangerouslySetInnerHTML`.

Existing suites (`BookingWidget.test.tsx`, `AdminDashboard.test.tsx`) untouched, no shared file modified.

### 6. CIA impact

- **Confidentiality — Low.** Only new data exposed is `service_id`, already reachable indirectly via `service_name` on the same already-token-gated endpoint.
- **Integrity — Low.** Reschedule/cancel already exist server-side with their own transactional, race-safe logic; frontend is a thin, non-authoritative client. `newStartAt` forwarded verbatim, never reconstructed.
- **Availability — None.** No new endpoints, no new rate-limit surface.

### 7. Dependency decision

**No new dependency.** Extends the existing hand-rolled pathname switch with one more branch, consistent with task 012's precedent.

### Open question — resolved: duplicate the slot picker, don't extract a shared component

**Recommendation: duplicate a small, self-contained slot-picker in `ManageBooking.tsx`.**

Reasoning: the duplicated surface is small and purely presentational (one `getAvailability` call, one date input, one map-to-buttons loop, one pure date formatter) — all real complexity (double-booking, DST, buffers) lives server-side and is shared by both pages already via the same endpoint. `BookingWidget.tsx` is already shipped and tested (task 010); extracting a shared component would require touching it, which is exactly the regression risk task 012 chose to avoid for something far smaller (a two-line email regex) — the risk scales with shared-surface size, an argument for avoiding the touch here, not against it. `formatSlotLocal` isn't currently exported from anywhere shared, so "reuse" isn't zero-cost today either. Two consumers is not three — rule of three says revisit extraction if a third caller of this exact pattern appears.

### Learning-workflow check

No `documents/concepts-learned.md` entry triggered — the new surface area (dynamic-segment path matching, a query-param-scoped token kept in component state) is presentation plumbing, not a new category of hard problem like task 001's exclusion-constraint reasoning or task 003's interval/DST math.

---

## User directive on the reschedule-409 disambiguation

> Resolve the reschedule-409 disambiguation by re-fetching the booking via `getBookingForCustomer` on any 409 from `POST /bookings/:id/reschedule`, and branch on its actual current status: `"cancelled"` -> non-modifiable/read-only state, still `"pending"`/`"confirmed"` -> slot-taken state (refresh the slot list). Do not distinguish by matching `error.message` text.

Implemented exactly as directed in `handleConfirmReschedule` (see Implementer section).

---

## [IMPLEMENTER OUTPUT]

### Backend

**`backend/src/services/bookingService.ts`** — added `service_id`/`serviceId` to the SELECT, row type, and view type in `getBookingForCustomer`:

```ts
export interface CustomerBookingView {
  id: string;
  status: BookingStatus;
  serviceId: string;
  serviceName: string;
  startAtLocal: string;
  endAtLocal: string;
}

interface CustomerBookingViewRow {
  id: string;
  status: BookingStatus;
  start_at: Date;
  end_at: Date;
  service_id: string;
  service_name: string;
  provider_timezone: string;
}

export async function getBookingForCustomer(
  bookingId: string,
  rawToken: string,
): Promise<CustomerBookingView> {
  const result = await getPool().query<CustomerBookingViewRow>(
    `SELECT b.id, b.status, b.start_at, b.end_at, s.id AS service_id, s.name AS service_name, p.timezone AS provider_timezone
     FROM customer_booking_tokens t
     JOIN bookings b ON b.id = t.booking_id
     JOIN services s ON s.id = b.service_id
     JOIN providers p ON p.id = b.provider_id
     WHERE t.booking_id = $1 AND t.token_hash = $2`,
    [bookingId, hashToken(rawToken)],
  );
  const row = result.rows[0];
  if (!row) throw new BookingNotFoundError();
  return {
    id: row.id,
    status: row.status,
    serviceId: row.service_id,
    serviceName: row.service_name,
    startAtLocal: formatLocalTime(row.start_at, row.provider_timezone),
    endAtLocal: formatLocalTime(row.end_at, row.provider_timezone),
  };
}
```

**`backend/src/routes/bookings.ts`** — added `service_id` to the JSON response:

```ts
res.status(200).json({
  id: view.id,
  status: view.status,
  service_id: view.serviceId,
  service_name: view.serviceName,
  start_at_local: view.startAtLocal,
  end_at_local: view.endAtLocal,
});
```

**`backend/test/integration/bookings.customerManagement.test.ts`** — extended the happy-path assertion to `service_id: serviceId`.

### Frontend

**`frontend/src/api/types.ts`** — added `CustomerBookingView`, `CancelBookingResponse`, `RescheduleBookingResponse` (wire shapes, snake_case, matching `AdminBooking`'s convention).

**`frontend/src/api/client.ts`** — added `getBookingForCustomer`, `cancelBooking`, `rescheduleBooking`, all sending the raw token as a `?token=` query param via `request()` (not `authRequest()` — this is not a bearer session).

**`frontend/src/App.tsx`** — added:
```ts
const manageBookingMatch = path.match(/^\/bookings\/([^/]+)$/);
if (manageBookingMatch) {
  return <ManageBooking bookingId={manageBookingMatch[1]} />;
}
```
above the `BookingWidget` fallback.

**`frontend/src/pages/ManageBooking.tsx`** (new) — full view: load state (`loading`/`not-found`/`loaded`), action mode (`view`/`cancel-confirm`/`reschedule`), a self-contained slot picker, and the reschedule-409 disambiguation exactly as directed:

```ts
async function handleConfirmReschedule(serviceId: string) {
  if (!token || !selectedSlot || submitting) return;
  setSubmitting(true);
  setActionError(null);
  try {
    await rescheduleBooking(bookingId, token, selectedSlot);
    loadBooking();
    setMode("view");
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      // A 409 here means either the slot was just taken, or the booking
      // itself became non-modifiable (e.g. declined) since page load.
      // Re-fetch the booking and branch on its actual current status --
      // never on the error message text -- to tell the two apart.
      try {
        const freshView = await getBookingForCustomer(bookingId, token);
        setLoadState({ kind: "loaded", view: freshView });
        if (freshView.status === "cancelled") {
          setMode("view");
        } else {
          setSlotTakenMessage("Sorry, that slot was just taken. Please pick another time.");
          setSelectedSlot(null);
          void fetchSlots(serviceId, date);
        }
      } catch {
        setLoadState({ kind: "not-found" });
      }
    } else {
      setActionError("Could not reschedule this booking. Please try again.");
    }
  } finally {
    setSubmitting(false);
  }
}
```

**Tricky part / notes:** the initial cancel implementation called `loadBooking()` (a re-fetch) after a successful cancel, mirroring reschedule's approach. This was wrong on two counts: it contradicted the Architect plan (step 7: update in place, no re-fetch) and it was an unnecessary extra network call, since the cancel response already carries the new status. Caught during self-testing (a test asserting the in-place status update failed against the always-`pending` mock) and fixed to merge `result.status` into the existing view directly:

```ts
async function handleCancel() {
  if (!token || submitting || loadState.kind !== "loaded") return;
  const currentView = loadState.view;
  setSubmitting(true);
  setActionError(null);
  try {
    const result = await cancelBooking(bookingId, token);
    setLoadState({ kind: "loaded", view: { ...currentView, status: result.status } });
    setMode("view");
  } catch {
    setActionError("Could not cancel this booking. Please try again.");
  } finally {
    setSubmitting(false);
  }
}
```

Reschedule intentionally keeps its re-fetch, since it's the simplest way to get correctly-formatted new local times without duplicating the backend's timezone-formatting logic.

**`frontend/test/ManageBooking.test.tsx`** (new) — 10 test cases, listed in the Tester section below.

**Migration/compat notes:** none. `service_id` is additive; every existing consumer of `GET /bookings/:id` is unaffected.

---

## [REVIEWER OUTPUT]

**Review summary:** Implementation matches the Architect plan closely, including the reschedule-409-disambiguation approach specified by the user (re-fetch and branch on actual `status`, never on error-message text). No `dangerouslySetInnerHTML` anywhere; token is state-only, never persisted. Architectural style (hand-rolled routing, explicit two-step confirms, `ApiError`/status-code branching) matches `BookingWidget.tsx`/`AdminDashboard.tsx` precedent throughout.

One real bug found and fixed during implementation (see Implementer notes): `handleCancel` originally re-fetched instead of updating in place, contradicting the plan and adding an unneeded network call. Fixed and covered by a test.

**Required fixes (blockers):** none.

**Suggested improvements (nice-to-have, not blocking):**
1. `loadBooking`'s `useEffect` has no in-flight-cancellation guard (unlike `AdminDashboard`'s `cancelled` flag). Low risk in practice — `bookingId`/`token` are derived once from the URL and effectively static for this component's lifetime; there's no client-side navigation between different booking IDs that would trigger overlapping fetches, unlike `AdminDashboard`'s filter-switching scenario.
2. The reschedule date-picker has no request-ordering guard against out-of-order `getAvailability` responses on rapid date changes — pre-existing behavior in `BookingWidget.tsx` too, so this is consistency with, not a regression from, already-shipped code.

Neither blocks merge.

---

## [TESTER OUTPUT]

**Test cases (all implemented and passing):**

Backend (`bookings.customerManagement.test.ts`, extended, 11 tests total):
- `GET /bookings/:id` happy-path test now also asserts `service_id` equals the seeded service id.

Frontend (`ManageBooking.test.tsx`, new, 10 tests):
1. Happy path: service/status/local times render correctly.
2. Missing `?token=` → generic not-found, no API call made, message never mentions "token".
3. Backend 404 → same generic not-found copy.
4. `status: "cancelled"` → read-only, no Cancel/Reschedule controls.
5. Cancel: button click alone does not call the API; only the explicit confirm step does; view updates in place afterward.
6. Reschedule: selected slot's ISO string forwarded byte-identical as `newStartAt`.
7. Reschedule: no service picker rendered.
8. Reschedule 409 (slot taken): slots re-fetched, inline alert shown, exactly one reschedule POST attempted.
9. Reschedule 409 (booking became non-modifiable mid-flow, e.g. declined): re-fetch shows the read-only state, not a slot-taken message — dedicated test for the case resolved by user directive this session.
10. XSS guard: a booking with `<img onerror=...>` as its service name renders as literal text, never as a DOM element.

**How to run:**
```bash
cd frontend && npm run test:run   # 29/29 passing
cd backend && set -a && source .env && set +a && npm run test:run   # 196/196 passing
```

**Coverage gaps considered and deliberately not filled:** no dedicated frontend rate-limit test — rate limiting is backend behavior, already covered by the existing `customer booking endpoints -- rate limiting` describe block, unaffected by this change.

---

## [SECURITY OUTPUT]

### 1) CIA Impact
- **Confidentiality: Low.** `service_id` newly exposed on an already-token-gated endpoint; already reachable indirectly via `service_name` on the same row. No new access path.
- **Integrity: Low.** All state-changing logic unchanged, pre-existing, server-authoritative. `newStartAt` forwarded verbatim (test-verified), preventing client-side timestamp reconstruction.
- **Availability: None.** No new endpoints; existing rate limiters apply unchanged.

### 2) OWASP-style Checks
- **Input validation & injection:** unchanged server-side validation covers every new call site; the one query change is an additive column from an already-joined table with parameterized inputs.
- **AuthN/AuthZ:** `customerHasAccess`'s combined id+token check untouched. Frontend never distinguishes "wrong token" from "wrong id" in user-facing copy (test-verified). Token travels only as a query param, never `Authorization`, never `localStorage`.
- **Sensitive data exposure:** no new PII; `service_id` is not PII. Generic error copy avoids leaking which check failed.
- **Security misconfiguration:** none introduced — no new env vars, no new CORS surface, no new dependency.
- **Logging & monitoring:** unaffected.

### 3) Dependency & Supply Chain Review
- New dependencies: **No.**
- `npm audit --audit-level=high`: frontend 0 vulnerabilities; backend same 5 pre-existing dev-dependency findings already accepted in `context_template.md`, unaffected by this change.

### 4) Threat Mini-Model
- **Assets:** customer booking record, possession-based access token.
- **Entry points:** `GET/POST /bookings/:id...` — pre-existing, unchanged except the additive field.
- **Threats:** token leakage via XSS (mitigated: no `dangerouslySetInnerHTML`, React default escaping); token persistence widening blast radius (mitigated: state-only); id/token enumeration via differential errors (mitigated: identical generic copy, test-verified).
- **Mitigations:** all pre-existing server-side controls remain intact and are exercised unchanged.

### 5) Risk Summary
- **Severity: Low.**
- **Required mitigations before merge:** none.
- **Follow-ups:** none security-relevant.

### 6) Secure SDLC Phase
- **Phase affected:** Implementation.
- **Re-review required after mitigation?** No.

### Merge Decision
- **Approved for merge: Yes**
- **Blocking reason:** none

---

## [RELEASE OUTPUT]

### DoD checklist

| Gate | Status |
|---|---|
| Acceptance criteria met | Pass — all 9 verified |
| Edge cases considered | Pass — missing token, wrong id/token, slot-taken 409, non-modifiable 409 (cancel + reschedule paths), empty slot list |
| No breaking changes without migration notes | Pass — additive only |
| TS strict, no unnecessary `any` | Pass |
| Lint & formatting pass | Pass — both projects |
| No dead code / debug logs | Pass |
| New behavior has tests | Pass — 1 extended backend test + 10 new frontend tests |
| Negative tests included | Pass |
| Tests pass locally | Pass — frontend 29/29, backend 196/196 |
| Input validation server-side | Pass — unchanged |
| AuthN/AuthZ checked | Pass |
| Errors don't leak sensitive data | Pass |
| Secrets not committed | Pass |
| No new dependency without justification | Pass — none added |
| `npm audit` no unresolved HIGH/CRITICAL | Pass — frontend clean; backend's pre-existing accepted exception unchanged |
| Docs updated if behavior changes | N/A |

### How to verify
```bash
cd backend && npm run lint && npm run typecheck && npm run build
set -a && source .env && set +a && npm run test:run   # 196 passed

cd ../frontend && npm run lint && npm run typecheck && npm run build && npm run test:run   # 29 passed
```
Manual check: with both dev servers running, visit `/bookings/:id?token=...` (from a real `email_jobs.payload.manageUrl` or a token minted via `mintCustomerBookingToken`) and exercise view → reschedule → cancel.

### Migration / rollback notes
None — additive field only, no schema migration, fully backward compatible.

### Risk notes
Low risk overall. Security-approved with no blocking items. One implementation bug (cancel needlessly re-fetching instead of updating in place) caught and fixed during this run, covered by test.

**DoD status: PASS**

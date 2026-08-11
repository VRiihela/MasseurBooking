# Run Report: 014 — Fix: manage-booking page shows the wrong (cancelled) booking after a successful reschedule

Profile: React Frontend
Date: 2026-08-11

Small, well-scoped bug fix — run through Implementer → Reviewer → Tester → Security → Release without an Architect stage, per explicit instruction.

---

## Bug

`rescheduleBookingForCustomer` (backend, unchanged) cancels the OLD booking and inserts a BRAND-NEW booking row with its own new id, minting a fresh `customer_booking_tokens` row and emailing that new manage link — the new token is never returned in the `POST /bookings/:id/reschedule` response. `ManageBooking.tsx`'s `handleConfirmReschedule`, on success, called `loadBooking()`, which re-fetched `getBookingForCustomer` using the SAME bookingId/token from the URL — the OLD, now genuinely-cancelled booking. Result: the page showed "Status: cancelled" immediately after a successful reschedule, with no indication anything good happened and no way to reach the new booking's manage page from that session.

## [IMPLEMENTER OUTPUT]

**`frontend/src/pages/ManageBooking.tsx`:**
- Extended `LoadState` with `{ kind: "rescheduled"; newStartAt: string }`.
- `handleConfirmReschedule`'s success branch no longer calls `loadBooking()`. It sets state directly from the reschedule response:
  ```ts
  const result = await rescheduleBooking(bookingId, token, selectedSlot);
  setLoadState({ kind: "rescheduled", newStartAt: result.start_at });
  ```
- Added a new terminal render branch (same shape as the existing `loading`/`not-found` early returns):
  ```tsx
  if (loadState.kind === "rescheduled") {
    return (
      <div>
        <h1>Booking rescheduled</h1>
        <p data-testid="reschedule-success">
          Your booking has been moved to {formatSlotLocal(loadState.newStartAt)}. We&rsquo;ve sent
          a new confirmation email with an updated link to manage this booking.
        </p>
      </div>
    );
  }
  ```
- The 409 disambiguation branch (slot-taken vs. non-modifiable, from task 013) is untouched — it lives in the `catch` block, entirely separate from the success path.
- The Cancel flow is untouched.

**`frontend/test/ManageBooking.test.tsx`:**
- Added a test: successful reschedule renders the success state (mentions "confirmation email"), neither `"Status: cancelled"` nor `"Status: pending"` appears, and no additional `GET /bookings/:id` call happens beyond the initial page load.
- Tweaked the existing ISO-string-forwarding test's mocked response to return a distinct new id (`"booking-2"`) for realism — assertion (request body) unchanged.

No backend changes — `RescheduleBookingResponse` already carried `start_at`.

## [REVIEWER OUTPUT]

**Summary:** Minimal, targeted fix. `loadBooking()` no longer called post-reschedule; new state built entirely from data already in the reschedule response, per the task's key constraint. No backend touched. Matches `BookingWidget.tsx`'s existing terminal-success-state precedent (`confirmation-pending`) in shape and tone.

**Blockers:** none.
**Nice-to-haves:** none — `loadBooking` remains used by the initial mount effect, nothing orphaned.

## [TESTER OUTPUT]

- New: successful reschedule → success state renders, mentions new confirmation email, neither stale status string appears, no extra `GET /bookings/:id` call.
- Regression: all 8 pre-existing `ManageBooking` tests still pass (load, missing-token, 404, read-only, cancel-confirm, ISO-forwarding, no-service-picker, both 409 branches, XSS guard).
- `BookingWidget.test.tsx`/`AdminDashboard.test.tsx` untouched and green.
- Full suite: 30/30 passing (`ManageBooking.test.tsx` now 11 tests, was 10).

```bash
cd frontend && npm run test:run   # 30/30 passing
```

## [SECURITY OUTPUT]

### 1) CIA Impact
- Confidentiality: None — no new data exposed, `start_at` was already in the response.
- Integrity: None — client-side display fix only, after an already-completed server-side mutation.
- Availability: None (slight improvement — removes one extra `GET /bookings/:id` call per reschedule).

### 2) OWASP-style Checks
No new input/endpoint/validation surface. AuthZ unaffected — the old bookingId/token pair is queried one fewer time post-reschedule. `start_at` is not PII and is an echo of the client's own submitted value.

### 3) Dependency & Supply Chain Review
No new dependencies. `npm audit --audit-level=high`: unaffected, 0 vulnerabilities (frontend).

### 4) Threat Mini-Model
No new assets, entry points, or threats introduced.

### 5) Risk Summary
- Severity: None/N/A.
- Required mitigations: none.

### 6) Secure SDLC Phase
- Phase: Implementation (bug fix).
- Re-review required: No.

### Merge Decision
- Approved for merge: **Yes**

## [RELEASE OUTPUT]

### DoD checklist

| Gate | Status |
|---|---|
| Acceptance criteria met | Pass |
| Edge cases considered | Pass — success path fully separate from 409 catch branch |
| No breaking changes | Pass — frontend-only |
| TS strict / lint | Pass |
| Tests | Pass — 30/30 |
| Security | Pass — no security-relevant change |
| No new dependency | Pass |
| `npm audit` | Pass — unchanged |
| Docs | N/A |

### How to verify
```bash
cd frontend && npm run lint && npm run typecheck && npm run build && npm run test:run   # 30 passed
```
Manual: reschedule a real booking via `/bookings/:id?token=...`, confirm landing on "Booking rescheduled" with the new time, not "Status: cancelled".

### Migration notes
None.

**DoD status: PASS**

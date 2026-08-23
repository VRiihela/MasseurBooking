# Run Report — 021: Admin service management (massage duration + before/after preparation buffers)

- Profile: React Frontend
- Timestamp: 2026-08-23T10:20:00.000Z
- DoD status: pass

## [ARCHITECT OUTPUT]

### 1) Scope & Assumptions

- Frontend-only, confirmed: `GET`/`POST /admin/services` and `PATCH /admin/services/:id` exist, validated (`name` non-empty, `price` positive, `duration_minutes` positive integer, both buffers zero-or-greater integers, `active` boolean), gated by the same auth/rate-limit as everything else. No `DELETE` route exists or is being added -- `active: false` is the sole "removal" mechanism (referential integrity against `bookings.service_id`).
- `listServices()` returns every service, active and inactive -- the admin list must show both, distinguished visually, not filtered.
- No name-uniqueness constraint anywhere -- the UI must not invent one.
- **Type-shape finding**: the frontend already has a `Service` interface, but that's the *public* subset (`{id, name, price, duration_minutes}`) used by `getServices()`/`BookingWidget`. It doesn't include both buffers or `active`. This task needs a distinct `AdminService` type matching `adminServices.ts`'s `serviceResponse()` exactly -- reusing/extending the public type would conflate two different trust boundaries.
- Price displayed as a plain number elsewhere (`BookingWidget.tsx`), no currency formatting -- matching that existing convention.
- Not a new interaction pattern: reveal-a-form-then-Save/Cancel already exists (Decline/Cancel booking flows); activate/deactivate is a single-tap immediate `PATCH`, matching the `confirmBooking`/block-unblock (task 020) precedent.

### 2-7) File impact, implementation plan, test strategy, CIA, dependency decision

No new dependency -- plain form inputs and list rendering, same shape as task 019. Full plan: extend `AdminDashboard.tsx` with a fourth `viewMode`; new `AdminServices.tsx` with its own independent fetch; list all services with inactive visually distinguished; per-row Edit (reveal-form → Save sends all 5 fields via one `PATCH` → Cancel discards) and Activate/Deactivate (immediate single-field `PATCH`); a separate add-service form (`active` not exposed at creation, backend defaults it to `true`); client-side validation mirroring the backend exactly; backend errors surfaced verbatim. See conversation for full detail; unchanged from what was approved, plus the user's one addition: all numeric fields must be coerced to real numbers (`Number()`) before being included in any request body, since `z.number()`/`.int()` on the backend rejects a raw string outright.

---

## [IMPLEMENTER OUTPUT]

Added `AdminService`/`CreateAdminServiceRequest`/`UpdateAdminServiceRequest` to `api/types.ts` (kept deliberately distinct from the public `Service` type, per the Architect-stage finding) and three `client.ts` functions (`getAdminServices`, `createAdminService`, `updateAdminService`), `authRequest`-wrapped like every other admin call.

**`AdminServices.tsx`** (new): a single `validateServiceForm()` function is the shared source of truth for both create and edit, mirroring `createServiceSchema`/`updateServiceSchema` exactly (name non-empty after trim, price positive, duration a positive integer, both buffers zero-or-greater integers) -- and, per the user's explicit addition, this is also where every numeric field gets coerced via `Number()` from the input's string value into the `ParsedServiceForm` object that actually gets sent, never the raw string. A shared `ServiceFormFields` component renders the five labeled inputs (with explanatory copy distinguishing duration from the two buffers, per acceptance criterion 8) and is reused by both the create form and the per-row edit form. Edit-save and activate/deactivate are two disjoint `PATCH` payloads -- Save never touches `active`, the toggle never touches the other fields. Inactive services get both a CSS class (`admin-service-inactive`, reduced opacity + grey background) and an explicit "(inactive)" text label -- not text alone, per acceptance criterion 2's "e.g. greyed out."

**`AdminDashboard.tsx`**: fourth `"services"` `ViewMode` value, one new toggle button, one new conditional render line. Zero changes to the other three branches.

No migration/compat notes -- additive only, zero backend changes (confirmed via empty `git diff --porcelain -- backend/`).

---

## [REVIEWER OUTPUT]

**Review summary**: Backend untouched. `AdminDashboard.tsx` diff purely additive. `AdminService` correctly kept distinct from the public `Service` type -- the one type-shape trap flagged at Architect stage was avoided. Number coercion centralized in one function, verified via a test asserting `typeof` on every numeric field in the actual captured request body.

**Required fixes**: None.

**Suggested improvements (nice-to-have, not blocking)**:
1. Reactivate direction (tapping "Activate" on an inactive service) wasn't directly tested -- only deactivate was. Same code path (`{active: !service.active}`), low risk, but worth closing for completeness. **Addressed in Tester stage below.**
2. No "no services yet" empty-state message (sibling screens have an equivalent) -- not required by any acceptance criterion, skipped for v1.

---

## [TESTER OUTPUT]

Added a reactivate-direction test mirroring the deactivate test exactly (tap "Activate" on an inactive service → `PATCH {active: true}` → row loses its inactive styling and label, gains a "Deactivate" button). Full frontend suite: 8 files, 84 tests, all green. `tsc --noEmit` and `eslint src` clean.

---

## [SECURITY OUTPUT]

CIA: Confidentiality None. Integrity Low (standard CRUD against an already-reviewed endpoint; verified edit-save and toggle stay as two disjoint payloads; no delete exists or was added, so the referential-integrity hazard the task called out never becomes reachable from this UI). Availability None (zero new dependencies). No new input surface, no new authz decision, no new PII exposure. `npm audit` 0 vulnerabilities (frontend); backend's pre-existing accepted exception untouched.

**Merge Decision: Approved.**

---

## [RELEASE OUTPUT]

### DoD Checklist -- all items pass. Backend confirmed zero-diff and fully green (216/216 tests). Frontend fully green (84/84 tests: 14 new `AdminServices` tests + 1 new toggle test, on top of all pre-existing tests passing unmodified), typecheck/lint/build clean, 0 audit vulnerabilities.

### Manual verification (real browser, 375px)
Started the dev server, drove it headlessly with Playwright at 375px: confirmed active vs. inactive services are visually distinguished (not text alone -- greyed background + label), edited a service's price and saved it (reflected immediately, correct request body), deactivated a service (immediate visual change), and added a new service (appeared with default zero buffers, form reset). No horizontal overflow. No bugs found this run.

### Acceptance Criteria -- all 10 met, including real-browser verification of the full create/edit/toggle workflow at narrow viewport width, not just jsdom coverage or a static screenshot.

### Files Changed
`frontend/src/api/types.ts`, `frontend/src/api/client.ts`, `frontend/src/pages/AdminServices.tsx` (new), `frontend/src/pages/AdminServices.css` (new), `frontend/src/pages/AdminDashboard.tsx`, `frontend/test/AdminServices.test.tsx` (new), `frontend/test/AdminDashboard.test.tsx`. Backend: none.

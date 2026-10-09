# Run report: 037-privacy-notice-page

- **Title:** Add a privacy notice (tietosuojaseloste) page, linked from the booking form
- **Profile:** React Frontend
- **Completed:** 2026-10-09T09:06:06.000Z
- **DoD status:** blocked — `npm audit --audit-level=high` fails on pre-existing dev-toolchain advisories (not introduced by this task; see RELEASE)

---

[ARCHITECT OUTPUT]

### 1. Scope & assumptions
- Frontend only: one new static page, one new route in `App.tsx`, one link in the booking form. No backend change, no API calls, no new dependency.
- Legal text hand-transcribed into JSX preserving structure (`#`→`<h1>`, `##`→`<h2>`, `-` lists→`<ul><li>`, paragraphs→`<p>`; the four controller lines in one `<p>` separated by `<br />`). No markdown library (task forbids new deps; an in-house parser is more code than the page).
- All bracketed placeholders and the `[VILLE: vahvista Resendin…]` note rendered literally.
- ManageBooking needs no link — confirmed against the code: customers reach `/bookings/:id` only via the emailed link from `backend/src/services/emailQueueService.ts:30`, which exists only after submitting through BookingWidget (where the notice is linked). Cancel/reschedule collect no new personal data.
- Direct URL access depends on host SPA fallback. `frontend/vercel.json` rewrites all paths to `index.html`; no Railway frontend config exists in the repo yet. Not a new risk (`/bookings/:id`, `/admin` depend on the same fallback), but belongs on the Railway migration checklist.

### 2. File impact list
- `frontend/src/pages/PrivacyNotice.tsx` — new
- `frontend/src/App.tsx` — exact-match `/tietosuoja` route before BookingWidget fallback
- `frontend/src/pages/BookingWidget.tsx` — privacy link in the `"form"` step
- `frontend/test/PrivacyNotice.test.tsx` — new
- `frontend/test/BookingWidget.test.tsx` — link test
- `frontend/src/styles/base.css` — no change

### 3. Implementation plan
1. `PrivacyNotice.tsx`: `.page` > `h1` + `.card`, following `AdminLoginRequest.tsx`.
2. `Päivitetty` line and sections 1–7 with `<h2>` headings exactly as in spec.
3. Render text character-for-character (straight quotes via `&quot;`).
4. Section 6 email/URL handling per call D.
5. Route in `App.tsx` after the `/bookings/:id` regex, before the fallback.
6. Link paragraph between the phone field and submit button in the form step.
7. No other BookingWidget changes.

### 4. Validation strategy
N/A — no input, no API calls, backend untouched.

### 5. Test strategy
- PrivacyNotice: render `<App />` at `/tietosuoja` via `pushState`; h1 present, "Varaa aika" absent; verbatim guard against a fixture of the spec content; explicit placeholder checks.
- BookingWidget: link present at form step with `href="/tietosuoja"` (+ target/rel per call A); negative: absent on the service step.
- Full suite + build, lint, `tsc --noEmit`.

### 6. CIA impact
- Confidentiality: None — static text.
- Integrity: Low — risk is legal-text drift; guarded by verbatim test.
- Availability: None — one exact-match route added before fallback.

### 7. Dependency decision
No new dependency.

### Discretionary calls raised
A. Same tab vs new tab (recommended new tab — same-tab full reload discards form state). B. Link styling (recommended no new CSS). C. Back link (recommended none if new tab). D. Section 6 email/URL as plain text vs links (recommended plain text). E. ASCII `--` (recommended keep verbatim).

AGENT_PASS

**Ville's resolution:** A = new tab (`target="_blank" rel="noopener noreferrer"`); B = no new CSS; C = no back link; D = plain text; E = replace every ASCII `--` with an en dash `–` (the only deviation), fixture updated to match. Content lists only Resend and Railway as sub-processors (current task file).

---

[IMPLEMENTER OUTPUT]

**`frontend/src/pages/PrivacyNotice.tsx` (new)** — static component, `.page` > `<h1>Tietosuojaseloste</h1>` + `.card` holding the full approved text. Sections 3 and 5 use `–` in place of `--` per call E. Quotes around `Poistettu GDPR-syistä` written as `&quot;`. `tietosuoja@om.fi` and `https://tietosuoja.fi` rendered as plain text. Sub-processors: Resend (with the `[VILLE: …]` note) and Railway only. One-line header comment pointing to the guarding test.

**`frontend/src/App.tsx`** — import `PrivacyNotice`; `if (path === "/tietosuoja") return <PrivacyNotice />;` after the `/bookings/:id` match, before the `BookingWidget` fallback.

**`frontend/src/pages/BookingWidget.tsx`** — between the Puhelin field and the submit button:
```tsx
{/* New tab: a same-tab navigation would full-reload the app and
    discard the selected slot and typed details. */}
<p>
  <a href="/tietosuoja" target="_blank" rel="noopener noreferrer">
    Lue tietosuojaseloste
  </a>
</p>
```

AGENT_PASS

---

[REVIEWER OUTPUT]

- Matches the approved plan file-for-file; `base.css` untouched; no ManageBooking change.
- Route ordering correct: exact match, cannot shadow `/auth/login`, `/admin*` or `/bookings/:id`; unknown paths still fall through to BookingWidget.
- Link placement is before submit, so the notice is presented at the point of data collection (GDPR Art. 13 "at the time when personal data are obtained").
- `rel="noopener noreferrer"` present alongside `target="_blank"`.
- Content checked against the task JSON programmatically (test fixture generated from the JSON's `content` field with only `--`→`–` applied), not by eye.
- **Finding (fixed in TESTER):** the initial verbatim guard used per-line `toContain`, which catches removals and edits but not *additions* inside a line (a mutation appending a word to a list item passed). Strengthened below.
- No `any`, no debug logs, no dead code.

AGENT_PASS

---

[TESTER OUTPUT]

**`frontend/test/PrivacyNotice.test.tsx` (new, 6 tests)** — all render the real `<App />` at `/tietosuoja` via `window.history.pushState`, reset to `/` in `afterEach`:
1. Routed at `/tietosuoja`: h1 "Tietosuojaseloste" present, "Varaa aika" absent.
2. Every line of the approved content appears in the page (per-line).
3. Nothing beyond the approved content: whole-page text with whitespace stripped equals the fixture with whitespace stripped (catches additions, removals, edits).
4. All placeholders unfilled: `[YRITYKSEN NIMI]`, `[Y-TUNNUS]`, `[OSOITE]`, `[SÄHKÖPOSTIOSOITE]`, `[PÄIVÄMÄÄRÄ]`, `[VILLE: vahvista Resendin kanssa`.
5. No ASCII `--` anywhere and zero links on the page (calls D and E).
6. Uses `.page .card` layout.

**`frontend/test/BookingWidget.test.tsx` (+2 tests)**
- Form step: link "Lue tietosuojaseloste" has `href="/tietosuoja"`, `target="_blank"`, `rel="noopener noreferrer"`.
- Negative: link absent on the service-selection step.

**Mutation checks (manual, reverted):**
- Appended a word to a list item → test 3 fails (test 2 alone did not — reason for adding test 3).
- Reverted an en dash to `--` → tests 2/3/5 fail.

**Results:** `vitest --run` 9 files, 116/116 pass. `npm run lint` clean (tests also linted clean), `tsc --noEmit` clean, `npm run build` succeeds.

AGENT_PASS

---

[SECURITY OUTPUT]

**OWASP-lite**
- Injection/XSS: static JSX text only; no `dangerouslySetInnerHTML`, no user or API data rendered.
- Reverse tabnabbing: `target="_blank"` paired with `rel="noopener noreferrer"`; target is same-origin anyway.
- AuthZ: public page by design; exposes no data. No new API surface.
- Information disclosure: page will go live showing placeholders and the internal `[VILLE: …]` Resend note until filled in. Not a code vulnerability, but a pre-launch content item — should be on `PRE_LAUNCH_CHECKLIST.md`.

**Dependency / supply chain**
- No new dependency; `package.json` / `package-lock.json` unchanged.
- `npm audit --audit-level=high` **fails (exit 1)** on pre-existing advisories: 2 critical (`tinypool` via `vitest@3.2.7`), 2 high (`brace-expansion` via eslint→minimatch; `source-map-js` via vite→postcss), 2 moderate (`@vitest/mocker`, `moment` via react-big-calendar).
- `npm audit --omit=dev`: only `moment` (moderate) — none of the HIGH/CRITICAL items ship in the production bundle; they affect the dev/test/build toolchain.
- Fix paths: `npm audit fix` (non-breaking) covers brace-expansion, source-map-js, moment; tinypool/@vitest/mocker need vitest 5 (breaking). Out of scope for this task — recommend a dedicated follow-up task.

AGENT_PASS (for this change) — audit gate escalated to RELEASE.

---

[RELEASE OUTPUT]

### DoD checklist
**Functional**
- [x] Acceptance criteria met (page at `/tietosuoja`, verbatim content with approved en-dash deviation, link in form step, direct URL via App routing, placeholders preserved)
- [x] Edge cases: unknown paths still fall through; link absent outside form step; no-state static page
- [x] No breaking changes

**Code Quality**
- [x] No `any` · [x] conventions followed · [x] lint passes · [x] no dead code / debug logs

**Tests**
- [x] New behavior tested (8 new tests) · [x] negative tests · [x] 116/116 pass locally (CI not run — not pushed)

**Security (SSDLC)**
- [x] Input validation — N/A (no input) · [x] Auth — N/A (public static page) · [x] no error leakage · [x] no secrets committed

**Dependency & Supply Chain**
- [x] No new dependency
- [ ] **`npm audit` no unresolved HIGH/CRITICAL — FAILS** on pre-existing dev-toolchain advisories (tinypool ×2 critical, brace-expansion + source-map-js high). Not introduced by this task; lockfile unchanged; production-only audit has none.
- [x] No transitive spikes (no dependency change)

**Documentation & Traceability**
- [x] No README change needed · [x] PR notes below

### How to verify
1. `cd frontend && npm run dev`, open `/tietosuoja` directly — notice renders in the `.page`/`.card` layout.
2. Open `/`, pick a service and slot — "Lue tietosuojaseloste" appears above the submit button, opens in a new tab; the booking form keeps its state.
3. `npx vitest --run`, `npm run lint`, `npx tsc --noEmit`, `npm run build`.

### Pre-launch follow-ups (not in this task)
- Fill in placeholders and the Resend SCC verification note.
- Railway frontend hosting must have SPA fallback to `index.html` (as `vercel.json` provides today), or `/tietosuoja` (and `/bookings/:id`, `/admin`) 404 on direct load.
- Complete Vercel → Railway frontend migration before real customers, or add Vercel back to section 5.
- Dependency audit follow-up task (`npm audit fix` + vitest 5 upgrade).

AGENT_BLOCK: npm audit reports unresolved HIGH/CRITICAL advisories (pre-existing, dev toolchain only, not introduced by this task) — needs Ville's decision: accept as known for this push with a follow-up task, or fix dependencies first.

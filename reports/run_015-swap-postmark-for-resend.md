# Run Report: 015 — Swap email provider: Postmark -> Resend

Profile: Node/TypeScript Backend
Date: 2026-08-12

Small, well-scoped provider swap behind an already-reviewed interface boundary — run through Implementer → Reviewer → Tester → Security → Release without an Architect stage, per explicit instruction.

---

## Why

Postmark's signup form rejects gmail/yahoo/other public-domain email addresses ("please use your work email on a private domain"), blocking local development entirely — confirmed live during setup, not hypothetical. Resend's free tier requires no custom domain to test and has no such signup restriction. `EmailSender` (`backend/src/services/emailSender.ts`) is a clean interface with exactly one implementation, so this is a like-for-like swap behind an already-reviewed boundary (task 005).

## [IMPLEMENTER OUTPUT]

**`backend/src/services/emailSender.ts`** — `PostmarkEmailSender` removed entirely; `ResendEmailSender` added, same interface, same constructor/error-handling shape:

```ts
const RESEND_SEND_URL = "https://api.resend.com/emails";

export class ResendEmailSender implements EmailSender {
  constructor(
    private readonly apiKey: string,
    private readonly fromAddress: string,
  ) {}

  async send(message: EmailMessage): Promise<void> {
    const response = await fetch(RESEND_SEND_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: this.fromAddress,
        to: message.to,
        subject: message.subject,
        text: message.body,
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Resend send failed with status ${response.status}: ${detail}`);
    }
  }
}
```

**`backend/src/config/email.ts`** — `EmailConfig.postmarkApiToken` renamed to `resendApiKey`, reads `RESEND_API_KEY` via the same `requireEnv` fail-fast pattern as before.

**`backend/src/server.ts`** — constructs `ResendEmailSender(emailConfig.resendApiKey, emailConfig.fromAddress)`. Confirmed via `grep -rln "Postmark|POSTMARK"` that only `server.ts`, `config/email.ts`, `services/emailSender.ts`, and `.env.example` referenced Postmark — `emailQueueService.ts`, `emailWorker.ts`, `emailTemplates.ts` needed zero changes, as predicted by the `EmailSender` interface boundary.

**`backend/.env.example`** — `POSTMARK_API_TOKEN` → `RESEND_API_KEY`, comment updated; `EMAIL_FROM_ADDRESS`'s comment now references Resend.

**`agents/context_template.md`** — "External APIs: none currently" corrected to name Resend as the one external API in use (outbound email), crediting task 015 for the Postmark swap.

**`backend/test/unit/emailSender.test.ts`** (new, 3 tests) — no test existed for `PostmarkEmailSender` either. Mocks global `fetch` via `vi.stubGlobal` (no prior backend precedent for this; followed the frontend tests' pattern since the class under test calls `fetch` directly):
1. Successful send — asserts URL, `Authorization: Bearer <key>` header, exact JSON body (`from`/`to`/`subject`/`text`).
2. Non-ok response — thrown error includes status + body text, explicitly asserted to *not* include the API key.
3. Failure-response body itself unreadable (`response.text()` rejects) — still throws cleanly via the `.catch(() => "")` fallback, rather than an unhandled rejection.

**Operational note:** `backend/.env` (gitignored, local-only) still had `POSTMARK_API_TOKEN` — updated to `RESEND_API_KEY=change-me-to-your-resend-api-key` so the locally-running dev server's fail-fast `loadEmailConfig()` didn't crash on its next restart. This surfaced a stray duplicate `tsx watch` process left over from an earlier session; both were stopped and one clean instance restarted (`GET /services` → 200, confirmed healthy).

## [REVIEWER OUTPUT]

**Summary:** Faithful like-for-like swap, matching `PostmarkEmailSender`'s shape and error-handling discipline exactly (constructor signature style, the never-log-the-secret comment, the same `.catch(() => "")` defensive read). Confirmed by grep that the three consumer files needed zero changes — the interface boundary held exactly as the task predicted.

**Blockers:** none.
**Nice-to-haves:** none.

## [TESTER OUTPUT]

- Request shape on success (URL, method, headers, JSON body mapping to Resend's field names).
- Non-2xx response → thrown `Error` includes status + body, never the API key.
- Non-2xx response with an unreadable body → still fails cleanly (exercises the defensive `.catch`).
- Regression: full suite 199/199, including `emailWorker.test.ts` (11 tests, unmodified — confirms the interface boundary from the consumer side) and `emailTemplates.test.ts` (9 tests, unmodified — confirms plain-text rendering, now mapped into Resend's `text` field, was untouched).

```bash
cd backend && npm run test:run   # 199/199 passing
```

## [SECURITY OUTPUT]

### 1) CIA Impact
- Confidentiality: Low — `RESEND_API_KEY` has identical handling to the token it replaces (gitignored `.env`, placeholder `.env.example`, never logged/thrown, test-verified).
- Integrity: None — no change to what's sent or the outbox/retry/backoff logic (task 005, untouched), only which HTTP endpoint receives it.
- Availability: None — same fail-fast-on-boot behavior, same single-`fetch`-call shape.

### 2) OWASP-style Checks
No new input surface. Auth via standard `Authorization: Bearer` header over HTTPS, no weaker than Postmark's custom header scheme. API key never appears in thrown errors (test-verified). No new logging path. No new dependency, no new misconfiguration surface.

### 3) Dependency & Supply Chain Review
No new dependencies — plain `fetch`, matching the task's explicit no-SDK constraint. `npm audit --audit-level=high`: unchanged, same 5 pre-existing dev-dependency findings already accepted in `context_template.md`.

### 4) Threat Mini-Model
- Assets: `RESEND_API_KEY`, outbound email content (customer/booking PII).
- Entry points: one outbound `fetch` to `api.resend.com`, same risk profile as the call it replaces.
- Threats: key leakage via logs/errors (mitigated, test-verified); MITM (mitigated — HTTPS to a trusted vendor).
- Mitigations: unchanged from task 005's original review of the outbox/retry/claim logic.

### 5) Risk Summary
- Severity: Low.
- Required mitigations: none.
- Follow-ups: operational only (a real `RESEND_API_KEY` is still needed locally to test actual delivery) — not a security item.

### 6) Secure SDLC Phase
- Phase: Implementation.
- Re-review required: No.

### Merge Decision
- Approved for merge: **Yes**

## [RELEASE OUTPUT]

### DoD checklist

| Gate | Status |
|---|---|
| Acceptance criteria met | Pass — all 9 verified |
| Edge cases considered | Pass — non-ok response, unreadable failure body |
| No breaking changes without migration notes | Pass — see operational note below |
| TS strict / lint | Pass |
| No dead code | Pass — `PostmarkEmailSender` fully removed |
| New behavior has tests | Pass — 3 new tests |
| Negative tests included | Pass |
| Tests pass locally | Pass — 199/199 |
| Secrets not committed | Pass — only `.env.example`'s placeholder changed |
| No new dependency | Pass |
| `npm audit` | Pass — unchanged pre-accepted exception |
| Docs updated | Pass — `.env.example`, `context_template.md` |

### How to verify
```bash
cd backend && npm run lint && npm run typecheck && npm run build
set -a && source .env && set +a && npm run test:run   # 199 passed
```
Manual: with a real `RESEND_API_KEY` in `backend/.env`, trigger any booking email flow and confirm delivery via Resend's dashboard.

### Migration / operational notes
- `.env` key rename required for any existing local setup: `POSTMARK_API_TOKEN` → `RESEND_API_KEY`. `.env.example` documents the new name; this local environment's `.env` was updated as part of this run to keep the running dev server functional.
- No database migration, no API contract change, no frontend impact.

**DoD status: PASS**

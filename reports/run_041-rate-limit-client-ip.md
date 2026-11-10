# Run report: 041-rate-limit-client-ip

- **Title:** Backend: make rate limiting per-client behind Railway's proxy (trust proxy / client IP)
- **Profile:** Node/TypeScript Backend
- **Completed:** 2026-11-10T14:16:11.000Z
- **DoD status:** pass locally; the post-deploy two-network counter check is PENDING.

---

[ARCHITECT OUTPUT]

Approved by Ville. Summary of the approved plan and resolved decisions:

- **Problem:** `backend/src/app.ts` never sets `trust proxy`, and every limiter keyed on `req.ip`. Behind Railway that is a proxy address, so customers share buckets.
- **Why not numeric `trust proxy`:** Railway staff state the hop count is not fixed, and their answers on which `X-Forwarded-For` entry holds the client conflict.
- **Chosen identifier:** `X-Real-IP`, which Railway staff say the public edge overwrites on every request. It is configured through `RATE_LIMIT_CLIENT_IP_HEADER` and only used after production measurements confirm it.
- **IPv6:** once limits are per client, one client could rotate IPv6 addresses for fresh buckets, so addresses are grouped by subnet.
- **CIA:** Confidentiality Low; Integrity Low; Availability Med, positive. **New dependency:** No.

Decisions:

1. Use the verified `X-Real-IP` header via `RATE_LIMIT_CLIENT_IP_HEADER`, with unset meaning today's behaviour. Keep `trust proxy` off and never set it to `true`.
2. Use `ipKeyGenerator` from express-rate-limit. 7.5.1 did not export it, so 8.7.3 was taken in its own commit (`a521d9c`, already pushed). Do not hand-roll IPv6 parsing.
3. A temporary diagnostic route was allowed for measurements only (`081e908`, already pushed), returning only `req.ip`, the socket address, and the caller's own `X-Forwarded-For`, `X-Real-IP` and `X-Railway-Edge`.
4. Accept higher aggregate login-email volume across many IPs; no limit or window changes.

---

## Phase A evidence (production, before any behaviour change)

Recorded as "client A" and "client B"; no real IPs are stored here.

| Check | Result |
|---|---|
| Production logs | `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` twice at 2026-11-04 10:19:07, so `X-Forwarded-For` was present and `trust proxy` was off |
| `req.ip` | A rotating Railway-internal `100.64.0.x` address, not the client, which confirms the bug |
| `X-Real-IP` | Matched the real address of client A and client B, on two different networks |
| IPv4 and IPv6 | Matched over both; a dual-stack client was reported by its IPv4 address both times |
| Forged `X-Real-IP` and `X-Forwarded-For` | Fully ignored or replaced by Railway's edge |
| `X-Forwarded-For` | Carries a second Railway hop, so it must not be used |
| Domains and CDN | One public domain, no CDN in front |

The gate passed, so Phase B went ahead.

---

[IMPLEMENTER OUTPUT]

| File | Change |
|---|---|
| `backend/src/config/rateLimit.ts` (new) | `loadRateLimitClientIpHeader()` reads `RATE_LIMIT_CLIENT_IP_HEADER`, trimmed and lowercased; empty or unset returns `undefined` |
| `backend/src/middleware/rateLimit.ts` | Adds `clientIpFromRequest()` and `rateLimitKey()`, and sets `keyGenerator: rateLimitKey` on all 7 limiters. Limits, windows and messages unchanged |
| `backend/.env.example` | Documents the optional variable and when it must not be set |
| `backend/src/app.ts` | Diagnostic route wiring removed |
| `backend/src/routes/diagnosticClientIp.ts`, `backend/test/integration/diagnosticClientIp.test.ts` | Deleted |
| `backend/test/unit/rateLimitKey.test.ts`, `backend/test/unit/rateLimit.limiters.test.ts`, `backend/test/integration/rateLimit.clientIp.test.ts` (new) | Tests listed under TESTER |

**How the key is chosen:**

1. If the variable names a header and that header is a single valid IP (`net.isIP`), use it.
2. Otherwise use `req.ip`.
3. Pass the result through `ipKeyGenerator`, which turns IPv4-mapped IPv6 into plain IPv4 and groups IPv6 by `/56`.
4. A request with no address at all goes into one `unknown` bucket.

The variable is read on every request rather than cached, so tests can switch it per case. Header values are not trimmed: Railway sets an exact value, and anything else falls back.

**Notes:**

- `trust proxy` is still off, so nothing else in the app starts trusting forwarded headers.
- The `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` log line stops even with the variable unset. express-rate-limit 8 only runs its `trust proxy` checks inside its default key generator, which is no longer used. Bucket behaviour with the variable unset is unchanged.
- express-rate-limit 8 checks custom key generators for IPv6 handling (`ERR_ERL_KEY_GEN_IPV6`). It accepts this one because it calls `ipKeyGenerator`, and no `ERR_ERL` warning appeared in the test run.

---

[REVIEWER OUTPUT]

**Summary:** approved.

- All 7 limiters use the same key function, and a test fails if one is missed or a limit changes.
- The fallback order is fail-safe: a missing or malformed header can only land a client in today's shared bucket, never in a bucket of its choosing.
- The diagnostic route is fully removed: the source, test and `app.ts` wiring are gone, and the grep below is clean.
- The comments state the one dangerous configuration: setting the variable where clients can bypass Railway's edge.

**Required fixes (blockers):** none.

**Suggested improvements (not done):**

- Memory-store buckets are per instance and reset on every deploy. That's unchanged and fine for a single instance, but it would need a shared store if the service ever scales to several replicas.

---

[TESTER OUTPUT]

**Results, real test database:**

| Suite | Total | Pass | Fail |
|---|---:|---:|---:|
| Unit | 134 | 134 | 0 |
| Integration | 145 | 145 | 0 |
| **All** | **279** | **279** | **0** |

The previous total was 254 including the 3 removed diagnostic tests, so 28 tests were added. No existing test was edited.

**New tests:**

| File | Covers |
|---|---|
| `test/unit/rateLimitKey.test.ts` (17) | Valid header used; header name case-insensitive; `X-Forwarded-For` ignored; fallback to `req.ip` for a missing, empty, non-IP, comma-list, whitespace-padded, 10,000-character or array header; mapped IPv4 folded; IPv6 same `/56` grouped and different `/56` separated; unset, empty or blank variable ignores the header; mapped `req.ip` normalised; no address goes to `unknown` |
| `test/unit/rateLimit.limiters.test.ts` (3) | Exactly 7 limiters, each with `keyGenerator === rateLimitKey`; every window and limit unchanged; no `ipv6Subnet` set alongside the custom key generator |
| `test/integration/rateLimit.clientIp.test.ts` (8) | Through the real `GET /services` limiter: separate buckets per client; a forged `X-Forwarded-For` gives no fresh bucket; a forged `X-Forwarded-For` naming another client doesn't use up that client's bucket; a client at the limit stays blocked (429, unchanged message) whatever it forges, while others are unaffected; missing, invalid, list and oversized headers share the `req.ip` bucket; IPv6 `/56` grouping; mapped and plain IPv4 share a bucket; with the variable unset, `X-Real-IP` is ignored |

**Limitation:** the tests act as Railway's edge by setting `X-Real-IP` themselves. That the edge really overwrites client values is established by the Phase A production evidence, not by these tests.

**How to run:**

```
docker start masseur-pg
cd backend && npx vitest --run
```

---

[SECURITY OUTPUT]

### 1) CIA Impact
- **Confidentiality: Low.** Client IPs are held only as in-memory limiter keys for one minute and are not logged. This report records no real IPs.
- **Integrity: Low.** Per-client limits are harder for one client to evade. Many IPs together can now exceed the old global ceiling, which was accepted in decision 4.
- **Availability: Med, positive.** One client can no longer exhaust a limit for all customers or lock the admin out of login requests.

### 2) OWASP-style Checks
- **Input validation:** the header must be a single valid IP. Anything else falls back to `req.ip`, and size is bounded by Node's header limit.
- **AuthN/AuthZ:** unchanged. `adminRateLimit` and `customerBookingActionRateLimit` still protect bearer-token routes, now per client.
- **Sensitive data:** the diagnostic route, which reflected request headers, is removed.
- **Misconfiguration:** `trust proxy` stays off and is never `true`. The only risky setting is the variable on a host without Railway's edge, which is documented in `.env.example` and the config comment.
- **Logging:** the `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` warning no longer appears, so it can't be used to check the setting later. Use the two-network check below instead.

### 3) Dependency & Supply Chain Review
- **New dependencies added? No.** This change uses only `node:net` and the already-upgraded express-rate-limit 8.7.3 from `a521d9c`.

**Audit evidence on the working tree:**

| Command | Result |
|---|---|
| `npm audit --omit=dev` | `found 0 vulnerabilities` |
| `npm audit --audit-level=high` | exit 0 |
| `npm audit` | 10 moderate, 0 high, 0 critical (eslint chain, dev-only) |

**Recommendation: Accept.**

### 4) Threat Mini-Model
- **Assets:** booking flow availability, the admin login-link inbox, bearer-token routes.
- **Entry points:** all rate-limited public and admin routes.
- **Threats:** shared-bucket lockout (fixed); IP forgery through headers (blocked by the edge, per Phase A); IPv6 rotation (grouped by `/56`); the variable set on an exposed non-Railway host (documented).
- **Mitigations:** a verified edge-written header with a validated fallback, `trust proxy` kept off, and subnet grouping.

### 5) Risk Summary
- **Severity: Low** once deployed with the variable set.
- **Required mitigations before merge:** none.
- **Follow-ups:**
    - Railway says this header behaviour is not a contractual guarantee, so repeat the two-network and forged-header checks after any change to Railway networking, domains or CDN.
    - If the service ever moves to private networking or several replicas, revisit the setting and the memory store.

### 6) Secure SDLC Phase
- **Phase affected:** Implementation, with deployment configuration.
- **Re-review required after mitigation?** No. The post-deploy check is verification, not re-review.

### Merge Decision
- **Approved for merge: Yes.**
- **Required for the fix to take effect:** set `RATE_LIMIT_CLIENT_IP_HEADER=x-real-ip` on the Railway service. Without it, production keeps today's shared buckets.

---

[RELEASE OUTPUT]

### DoD checklist

| Item | Status | Evidence |
|---|---|---|
| Acceptance criteria met | Pass, 1 pending | All met except the post-deploy two-network check |
| Production behaviour confirmed before any change | Pass | Phase A evidence above |
| Hop count / client-IP header determined from the deployed service | Pass | Phase A; `X-Forwarded-For` rejected, `X-Real-IP` verified |
| Diagnostic route removed | Pass | Source, test and wiring deleted; grep clean |
| `trust proxy` never `true`, setting env-configurable | Pass | `trust proxy` untouched (off); `RATE_LIMIT_CLIENT_IP_HEADER` |
| Separate buckets and forgery resistance tested | Pass | 28 new tests |
| No limit or window change; no new dependency | Pass | Limiter-config test pins every limit and window |
| Edge cases | Pass | Missing, invalid, list, oversized and array headers; IPv6; mapped IPv4; no address |
| No unnecessary `any` | Pass | None |
| Lint and formatting | Pass (lint) | `npm run lint` clean; no format script is configured |
| No dead code or debug logs | Pass | Diagnostic code removed |
| Tests pass locally | Pass | 279/279 |
| Tests pass in CI | N/A | No CI workflow in the repo |
| Build and `tsc --noEmit` | Pass | |
| Errors don't leak sensitive data | Pass | 429 body unchanged |
| Secrets not committed | Pass | No secrets in the diff; `.env.example` has an empty value |
| `npm audit`: no unresolved HIGH/CRITICAL | Pass | Production 0; full audit 0 high, 0 critical |
| Docs updated | Pass | `.env.example`, this report |
| Frontend untouched | Pass | |
| **Post-deploy two-network counter check** | **PENDING** | Can only be done after deployment |

**Result: pass locally, with the post-deploy check pending.**

### Diagnostic route removal evidence

`grep -rn "__diag\|diagnosticClientIp" backend --exclude-dir=node_modules` returns no matches (exit 1). Before that, the only matches were two stale compiled files in `backend/dist/routes/` (gitignored build output, no longer imported by the rebuilt `app.js`), which were deleted. Railway builds `dist/` fresh.

### Deploy steps

1. Set `RATE_LIMIT_CLIENT_IP_HEADER=x-real-ip` on the Railway service. Order is safe either way: code that reads the variable without it set behaves as today, and setting it before the new code deploys has no effect.
2. Deploy, and wait for it to finish before testing, since counters reset on deploy.
3. **Post-deploy two-network check:** run `curl -s -i "$API/services" | grep -i ratelimit` twice on network A, then twice on network B. Pass means each network starts its own count (for example 29, 28 on A, then 29, 28 on B), rather than continuing one shared count.
4. Optional: one forged request, `curl -s -i -H 'X-Real-IP: 1.2.3.4' "$API/services"`, should continue that network's count rather than starting a fresh one.
5. Confirm `/__diag/client-ip` now returns 404.

### Rollback

Unset `RATE_LIMIT_CLIENT_IP_HEADER` on Railway to restore shared buckets immediately, without a code change, or revert the commit.

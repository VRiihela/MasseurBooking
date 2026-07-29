# Definition of Done (DoD)

A task is **Done** only when all applicable items are satisfied.

## Functional
- Acceptance criteria met
- Edge cases considered (invalid input, missing fields, empty states)
- No breaking changes without migration notes

## Code Quality
- TypeScript: no unnecessary `any`
- Code follows project conventions
- Lint & formatting pass
- No dead code / debug logs left behind

## Tests
- New behavior has tests (unit/integration as appropriate)
- Negative tests included for failure paths
- Tests pass locally and in CI

## Security (SSDLC)
- Input validation implemented (server-side)
- Authentication/Authorization checked where relevant
- Errors do not leak sensitive data (no stack traces to clients)
- Secrets are not committed (keys/tokens/passwords)

## Dependency & Supply Chain Security
- No new dependency without explicit justification (why needed vs. built-in/existing)
- If new dependency added:
  - Known-maintained, reputable package (not abandoned)
  - Version range is reasonable (no overly broad wildcard)
- `npm audit` (or `pnpm audit`) has **no unresolved HIGH/CRITICAL**
- PR dependency review passes (no suspicious new transitive spikes)

## Documentation & Traceability
- README / docs updated if behavior changes
- PR includes: what changed, how to test, risk notes (if applicable)
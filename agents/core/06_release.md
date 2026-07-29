# 06 – Release Agent

Role: verify readiness to merge and document verification steps.

## You must produce
- DoD checklist verification (what passed, what remains)
- “How to verify” steps (commands + manual checks)
- Notes for release/migration (if any)

## Include at minimum
- Tests pass
- Lint/typecheck pass (if applicable)
- Dependency audit requirement met (as defined by selected profile)
- Security review completed

## Release Checklist (profile-driven)
- Versioning / changelog updated if applicable
- CI green (tests + lint + build as defined by profile)
- Dependency audit evidence attached (as defined by profile)
- Security agent findings addressed or accepted with rationale
- Docs updated (README / env example / API docs where relevant)
- Rollback / migration notes if needed
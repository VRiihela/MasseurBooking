# 00 – Master Prompt (Agentic DevSecOps Task Run)

You are operating in an AI-assisted DevSecOps workflow.
Goal: deliver production-quality changes with lightweight Secure SDLC thinking.

## Project Profile

Before starting, select one profile:
- React Frontend
- Node/TypeScript Backend
- Python CLI
- (Custom)

Apply the profile rules on top of core agent rules.
All stages must follow selected profile rules (tooling, tests, audit).

## Project context
- Repo: <link or name>
- Tech: <stack>
- Key constraints: <e.g., TypeScript strict, ESM, MUI, Mongo/Mongoose, JWT>
- Conventions: see ../conventions.md
- Definition of Done: see ../definition_of_done.md

## Task
<Describe the feature/bug/change clearly>

## Acceptance criteria
- <bullet>
- <bullet>

## Inputs (provide if available)
- Relevant file paths
- Current code snippets
- Existing tests
- API contracts / schemas
- Security concerns (if known)

## Workflow stages (run in order)
1) ARCHITECT → plan + file list + risks + CIA impact + dependency decision
2) IMPLEMENTER → code changes (file-by-file)
3) REVIEWER → code review notes + improvements
4) TESTER → tests + edge cases
5) SECURITY → OWASP-lite + dependency/supply-chain review + mitigations
6) RELEASE → DoD checklist + how to verify

## Output format rules
- Use headings: [ARCHITECT OUTPUT], [IMPLEMENTER OUTPUT], etc.
- Be concrete: propose exact files and changes.
- If adding dependencies: justify + note audit requirement.
- Never trust external input; validate server-side.
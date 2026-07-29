# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Repository Is

A **governance framework** for AI-assisted secure software development. It is not an application — it is a collection of structured markdown prompts, templates, and a TypeScript orchestrator designed to be copied into target projects and used to run development tasks through a 6-stage secure SDLC pipeline.

## Repository Structure

```
agents/
  core/           # 6 agent role prompts (00_master.md through 06_release.md)
  profiles/       # Project-type tooling rules (node-ts-backend, react-frontend, python-cli)
  templates/      # GitHub workflows, issue templates, PR template, security docs
  tasks/          # task-template.md + example runs
  orchestrator/   # TypeScript CLI that drives the pipeline via Anthropic SDK
  context_template.md
  conventions.md
  definition_of_done.md
  workflow.md
examples/
  typescript-express-demo/   # Full worked example showing all 6 agent stages
```

## The 6-Stage Pipeline

Every task flows through agents in order. Each agent output must end with `AGENT_PASS` or `AGENT_BLOCK: <reason>` — a BLOCK halts the pipeline.

| Stage | File | Role |
|-------|------|------|
| 0 | `00_master.md` | Task orchestration entry point |
| 1 | `01_architect.md` | Plan, file impacts, CIA triad, dependency decision |
| 2 | `02_implementer.md` | Code changes, no hardcoded secrets, validated inputs |
| 3 | `03_reviewer.md` | Correctness, type safety, error handling, deviations |
| 4 | `04_tester.md` | Unit, integration, negative, edge case tests |
| 5 | `05_security.md` | OWASP-lite, supply chain, CIA impact — CRITICAL/HIGH blocks release |
| 6 | `06_release.md` | DoD checklist, PR-ready summary |

## Orchestrator (TypeScript CLI)

Located at `agents/orchestrator/orchestrator.ts`. Calls the Anthropic SDK to run all 6 agents sequentially, passing each output as context to the next.

**Run with a JSON spec file:**
```bash
npx ts-node agents/orchestrator/orchestrator.ts agents/orchestrator/validate-registration.json
```

**Run interactively (prompts for task details):**
```bash
npx ts-node agents/orchestrator/orchestrator.ts
```

**Outputs:**
- `run_log.json` — machine-readable history of all runs
- `reports/run_<id>.md` — markdown report per run

**Spec file format** (see `validate-registration.json` as reference):
```json
{
  "title": "...",
  "profile": "Node/TypeScript Backend",
  "repo": "...",
  "tech": "Express, Prisma, Zod",
  "keyConstraints": "TypeScript strict, ESM",
  "description": "...",
  "acceptanceCriteria": ["...", "..."],
  "relevantFilePaths": ["src/routes/auth.ts"],
  "securityConsiderations": "..."
}
```

The orchestrator resolves agent `.md` files relative to its own location (`../../agents/`). It falls back to built-in defaults if a file is missing.

## How to Add a New Project Profile

Profiles live in `agents/profiles/`. Each profile defines tooling commands (install, build, lint, test, typecheck, audit). Copy an existing profile and adjust the commands. Reference the profile name in `00_master.md` and in task specs.

## Key Conventions (from `agents/conventions.md`)

- Prefer clarity over cleverness; keep functions small and focused
- TypeScript: strict mode, no `any` without justification, explicit return types on exports
- Express/backend: always validate external input server-side; return consistent error shapes
- Never expose stack traces to clients
- Minimize new dependencies; justify any additions

## Definition of Done Gates

A task is not complete unless all of these pass (enforced by `06_release.md` / `definition_of_done.md`):
- Acceptance criteria met, edge cases covered
- Lint, typecheck, and tests pass
- `npm audit` / `pip-audit` — no unresolved HIGH or CRITICAL
- Security review performed; no unresolved CRITICAL/HIGH findings
- No secrets committed; no debug logs in production paths
- Documentation updated if behaviour changed

## Manual Workflow (Without the Orchestrator)

1. Fill in `agents/context_template.md` with project details
2. Create a task file from `agents/tasks/task-template.md`
3. Open `agents/core/00_master.md`, set the profile and task, then run agents 01–06 in sequence in Claude Code
4. Each agent reads the previous agent's output as context

## Logging Manual Runs

After the RELEASE stage of any task completes, before ending the task:

1. Append one entry to `run_log.json` at the project root (create it as `[]` if it doesn't exist yet — append to the array, never overwrite it):
   - `id`: task id (e.g. "001-booking-creation")
   - `title`
   - `profile`
   - `timestamp`: ISO 8601, run completion time
   - `dodStatus`: "pass" or "blocked" (include the blocking reason if blocked)
   - `filesChanged`: list of file paths touched

2. Write the full run to `reports/run_<task-id>.md` — every stage's labeled output ([ARCHITECT OUTPUT] through [RELEASE OUTPUT]) in full, plus the final DoD checklist.

This mirrors the orchestrator CLI's own log format, so manual and orchestrator runs stay in the same history if you switch to the CLI later.
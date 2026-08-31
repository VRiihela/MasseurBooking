---
name: run-orchestrator
description: Run this project's agentic secure-SDLC pipeline via the TypeScript orchestrator CLI (agents/orchestrator/orchestrator.ts) instead of running the 6 agent stages manually in chat. Use when the user wants to invoke the orchestrator, run a task from a JSON spec file, or asks how to add a new project profile.
---

# Running the orchestrator CLI

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

## Adding a new project profile

Profiles live in `agents/profiles/`. Each profile defines tooling commands (install, build, lint, test, typecheck, audit). Copy an existing profile and adjust the commands. Reference the profile name in `00_master.md` and in task specs.

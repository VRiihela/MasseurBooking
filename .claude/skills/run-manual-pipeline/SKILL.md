---
name: run-manual-pipeline
description: Run this project's 6-stage secure-SDLC pipeline (Architect through Release) manually in Claude Code chat, without the orchestrator CLI, and log the completed run. Use when the user asks to run a task through the pipeline, continue to the next task, or run agents 01-06 in sequence.
---

# Manual workflow (without the orchestrator)

1. Fill in `agents/context_template.md` with project details
2. Create a task file from `agents/tasks/task-template.md`
3. Open `agents/core/00_master.md`, set the profile and task, then run agents 01–06 in sequence in Claude Code
4. Each agent reads the previous agent's output as context

## Logging manual runs

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

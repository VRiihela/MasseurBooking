# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Repository Is

A **governance framework** for AI-assisted secure software development. It is not an application — it is a collection of structured markdown prompts, templates, and a TypeScript orchestrator designed to be copied into target projects and used to run development tasks through a 6-stage secure SDLC pipeline.

## The 6-Stage Pipeline

Every task flows through agents in order. Each agent output must end with `AGENT_PASS` or `AGENT_BLOCK: <reason>` — a BLOCK halts the pipeline.

## Key Conventions

See `agents/conventions.md` for the full list (clarity over cleverness, TS strict mode, server-side input validation, consistent error shapes, minimal new dependencies).

## Definition of Done Gates

See `agents/definition_of_done.md` for the full checklist (enforced by the `06_release.md` stage); a task isn't complete unless all of it passes.

For running a task through the pipeline manually (without the orchestrator CLI) or via `agents/orchestrator/orchestrator.ts`, see the `run-manual-pipeline` and `run-orchestrator` skills.

## Preferred Workflow: Stage-Gated Execution in Claude Code

Ville runs the pipeline himself in Claude Code (not by having an assistant execute it directly in another environment) so that he can review the Architect's plan before any code is written, and review the full run before anything is pushed. When asked to run a task through the pipeline, produce two prompts for Claude Code rather than executing the pipeline directly:

**Prompt 1 — Architect only.** Example:

> Read agents/core/00_master.md, agents/conventions.md, agents/definition_of_done.md, and agents/tasks/031-finnish-translation-admin-frontend.json.
> Run ONLY stage 1 (ARCHITECT) against that task. Stop after producing the [ARCHITECT OUTPUT] — do not proceed to IMPLEMENTER until I explicitly approve the plan.

Ville reviews the Architect's plan (file list, risks, CIA impact, dependency decision, any discretionary calls it raises) and decides how to resolve anything open.

**Prompt 2 — Implementer through Release, once the plan is approved.** Example:

> Proceed to IMPLEMENTER for task 031, following the approved Architect plan exactly, with both discretionary calls resolved: extract frontend/src/lib/statusLabels.ts and migrate ManageBooking.tsx onto it too; leave the two backend-sourced English strings (login-request message, UnauthorizedError) out of scope for this task -- they'll be a small follow-up task.
> Continue through REVIEWER, TESTER, SECURITY, and RELEASE as normal. Stop and report back after RELEASE with the DoD checklist result -- wait for that report before pushing.

Note the pipeline still stops before `git push` even after RELEASE passes — Ville reviews the DoD checklist and gives a separate go-ahead to push. Any discretionary calls the Architect surfaced get resolved explicitly in prompt 2's wording, not left for the Implementer to guess.

This is the default going forward for any task run against this repo's pipeline: draft/scope the task spec, then hand over prompt 1; wait for the Architect output and Ville's approval; then hand over prompt 2; wait for the RELEASE report and Ville's go-ahead before push.
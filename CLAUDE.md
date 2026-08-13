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
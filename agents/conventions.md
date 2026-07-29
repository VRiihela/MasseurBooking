# Project Conventions

These conventions guide AI-generated code.

## General Principles
- Prefer clarity over cleverness.
- Keep functions small and focused.
- Avoid unnecessary abstraction.
- Avoid premature optimization.

## TypeScript
- Use strict mode.
- Avoid `any` unless explicitly justified.
- Prefer explicit return types for exported functions.
- Use descriptive type names.

## Express / Backend
- Always validate external input.
- Never trust client-provided identity.
- Use middleware for cross-cutting concerns.
- Return consistent error shapes.

## Error Handling
- Do not expose stack traces to clients.
- Use structured error responses.
- Log internally if needed, but keep client output minimal.

## Security Defaults
- Validate server-side.
- Sanitize inputs.
- Use safe defaults.
- Minimize new dependencies.

## Tests
- Cover failure paths.
- Include negative cases.
- Prefer deterministic tests.
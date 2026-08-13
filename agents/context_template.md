# Project Context Template

Fill this file when integrating the framework into a project.

## Project Name
Masseur Booking System

## Architecture Overview
- Backend: Node.js + TypeScript (Express or Fastify), REST/JSON API
- Frontend: React + TypeScript — customer booking widget (date picker, slot grid) and masseur admin dashboard
- Database: PostgreSQL, with the `btree_gist` extension enabled (required for the booking exclusion constraint)
- Repo layout (as of task 011): `backend/` and `frontend/` are two independent npm projects at the repo root, each with its own `package.json`/`node_modules`/tooling config -- no npm workspaces. Project-wide artifacts (`agents/`, `documents/`, `CLAUDE.md`, `reports/`, `run_log.json`) live at the repo root, outside either project. Always `cd` into `backend/` or `frontend/` before running dev/build/lint/test/typecheck commands for that project -- there is no root-level `package.json`.
- Auth mechanism: magic-link login for the masseur admin (task 006 — no passwords stored); customers are guest checkout only (name, email, phone) — no accounts, access to their own booking via a signed magic-link token (task 007)

## Security-Sensitive Areas
- Authentication: masseur admin login only, via single-use magic-link tokens and hashed sessions (task 006). Customers never authenticate — they get a signed, unguessable magic-link token per booking instead (task 007).
- Authorization: admin endpoints require a valid session (task 006). Customer endpoints must be scoped strictly to the booking the token was issued for — no way to enumerate or access other customers' bookings.
- External APIs: Resend (outbound transactional email, `backend/src/services/emailSender.ts`'s `ResendEmailSender`) is the one external API this system calls, as of task 015 (swapped from Postmark). Calendar sync (Google Calendar API / Microsoft Graph) is deferred — see `documents/masseur-booking-system-design.md` appendix. Do not add OAuth/calendar integration unless a task explicitly reintroduces it.
- Data processing: Customer PII is name, email, phone only — no payment data is collected or stored anywhere in this system (payment happens in person).

## CI / Tooling
- Test runner: Vitest (suggested — not yet confirmed, swap if you prefer Jest)
- Lint: ESLint
- Typecheck: `tsc --noEmit`
- Dependency audit: `npm audit`
- Backend integration tests run against a dedicated `masseur_booking_test` database, never the dev database (task 016/017 -- `resetAndSeed()` used to inherit whatever `DATABASE_URL` the shell happened to have exported, silently wiping real dev data on every `npm test`). One-time local setup, before running backend tests for the first time:
  1. `createdb masseur_booking_test` (same local Postgres instance as dev, just a different database name)
  2. Apply every file in `backend/src/db/migrations/` against it, in order: `psql -d masseur_booking_test -f backend/src/db/migrations/001_init_core_tables.sql`, then `002_...sql`, etc. (there is no migration-runner tool — an accepted gap)
  3. `cp backend/.env.test.example backend/.env.test` and adjust if your local setup differs
  Then `npm test` in `backend/` reads `backend/.env.test` directly at config-load time — it is never inherited from an ambient/shell-exported `DATABASE_URL`.

## Known Constraints
- Performance limits: single masseur, low request volume — no horizontal scaling or multi-region needed at this stage
- Legacy code: none, greenfield project
- Deployment environment: single-region PaaS (e.g. Render, Fly.io, Railway)
- Accepted `npm audit` exception (backend, as of 2026-08-09): 5 dev-dependency vulnerabilities in the vite/vitest toolchain (1 critical, 1 high, 3 moderate), all in `devDependencies` — never shipped in the running API. The critical finding (`vitest`, CVSS 9.8) requires the `vitest --ui` flag, which this project never uses. The high finding (`vite`, CVSS 7.5) is a Windows-specific path bypass; deployment target is not Windows. Full fix requires `npm audit fix --force`, a semver-major `vitest` 4.1.10 bump needing a full test-suite reverification pass — deferred to a dedicated task rather than applied opportunistically. Re-evaluate if either `vitest --ui` or a Windows dev/deploy target is ever introduced.

## Notes for AI Agents
- Workflow:
  - After the Architect stage, before Implementer runs, pause and wait for explicit
    go-ahead if this task introduces a pattern not yet used elsewhere in the codebase
    (check `documents/concepts-learned.md`) -- this is a deliberate learning checkpoint,
    not just a review gate.
- Critical design decisions:
  - All timestamps are stored in UTC; convert to local time only at display time. Never store naive/local timestamps.
  - Bookings are created with status `pending`, not `confirmed`. The masseur must manually confirm or decline each request — nothing auto-confirms.
  - Double-booking is prevented two ways: a `SELECT ... FOR UPDATE` transaction lock at the application level, and a Postgres exclusion constraint (`btree_gist`) on `(provider_id, tstzrange(start_at, end_at))` as the hard backstop.
  - `start_at` marks the beginning of the whole reserved block (service duration + buffer_before + buffer_after), not necessarily the moment the masseur starts the massage — keep the availability-slot generator and admin calendar view consistent with this.
  - Calendar sync (Google/Outlook) is deferred as of task 007 — no `ExternalBusyBlock`/`CalendarConnection` tables, no OAuth, no calendar push on confirm. Backend ships and frontend starts without it. Full design is preserved in the design doc's appendix if it's picked back up later.
- Things to avoid:
  - Do not add online payment or deposit collection — out of scope, payment is handled in person.
  - Do not auto-confirm bookings under any circumstance.
  - Do not pre-generate a slots table; availability is always computed on read from rules, exceptions, and existing bookings.
  - Do not send SMS notifications or a 24h-before reminder job — email only, sent at request-received and at confirmation.
  - Do not add calendar-sync code (OAuth flows, `ExternalBusyBlock`, `CalendarConnection`, external_event_id columns) unless a task explicitly reintroduces that phase.

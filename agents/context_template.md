# Project Context Template

Fill this file when integrating the framework into a project.

## Project Name
Masseur Booking System

## Architecture Overview
- Backend: Node.js + TypeScript (Express or Fastify), REST/JSON API
- Frontend: React + TypeScript — customer booking widget (date picker, slot grid) and masseur admin dashboard
- Database: PostgreSQL, with the `btree_gist` extension enabled (required for the booking exclusion constraint)
- Auth mechanism: email/password (or magic link) for the masseur admin; customers are guest checkout only (name, email, phone) — no accounts, access to their own booking via a signed magic-link token

## Security-Sensitive Areas
- Authentication: masseur admin login only. Customers never authenticate — they get a signed, unguessable magic-link token per booking instead.
- Authorization: admin endpoints require an authenticated masseur session. Customer endpoints must be scoped strictly to the booking the token was issued for — no way to enumerate or access other customers' bookings.
- External APIs: Google Calendar API and Microsoft Graph (Outlook). OAuth access/refresh tokens stored encrypted at rest. Refresh-token revocation must be handled gracefully, not silently.
- Data processing: Customer PII is name, email, phone only — no payment data is collected or stored anywhere in this system (payment happens in person).

## CI / Tooling
- Test runner: Vitest (suggested — not yet confirmed, swap if you prefer Jest)
- Lint: ESLint
- Typecheck: `tsc --noEmit`
- Dependency audit: `npm audit`

## Known Constraints
- Performance limits: single masseur, low request volume — no horizontal scaling or multi-region needed at this stage
- Legacy code: none, greenfield project
- Deployment environment: single-region PaaS (e.g. Render, Fly.io, Railway)

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
  - `Booking` and `ExternalBusyBlock` are separate tables. Bookings are owned by this app (can be cancelled/rescheduled); external busy blocks are read-only shadows of the masseur's personal calendar synced from Google/Outlook. Do not merge them.
  - Calendar events are pushed to Google/Outlook only after the masseur confirms a booking — never on initial (pending) creation.
  - `start_at` marks the beginning of the whole reserved block (service duration + buffer_before + buffer_after), not necessarily the moment the masseur starts the massage — keep the availability-slot generator and admin calendar view consistent with this.
- Things to avoid:
  - Do not add online payment or deposit collection — out of scope, payment is handled in person.
  - Do not auto-confirm bookings under any circumstance.
  - Do not pre-generate a slots table; availability is always computed on read from rules, exceptions, and existing bookings.
  - Do not send SMS notifications or a 24h-before reminder job — email only, sent at request-received and at confirmation.

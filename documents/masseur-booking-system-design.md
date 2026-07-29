# Appointment Booking System — Architecture Design

**Scope:** single-masseur web app. Customers book a slot online; the booking appears on the masseur's calendar, with two-way sync to Google/Outlook.

---

## 1. A call-out before we design: is two-way sync worth it for MVP?

You asked for both an internal calendar and two-way sync to Google/Outlook. Worth being explicit about what that buys you and what it costs, because it's the single biggest complexity driver in this system.

**One-way push** (app → Google/Outlook, so the masseur sees bookings in their existing calendar) is cheap: one API call per booking, no webhooks, no conflict resolution.

**Two-way sync** (external calendar → app, so a personal appointment the masseur adds manually blocks online booking) means: OAuth token lifecycle management, webhook subscriptions that expire and need renewal (Google push channels expire in ~1 week, Microsoft Graph subscriptions in ~3 days), handling out-of-order or duplicate webhook deliveries, and reconciling edits/deletes that happen on either side. It roughly doubles the calendar-integration work.

Recommendation: build the internal calendar as the single source of truth, ship one-way push in v1, add the inbound pull/webhook sync in v2 once the core booking flow is proven. The design below supports both, but the phasing section at the end marks what's v1 through v3 so you can decide where to draw the line without re-architecting later.

---

## 2. High-level architecture

```
┌─────────────┐      ┌──────────────────────┐      ┌────────────────┐
│  Customer    │─────▶│  Web app (frontend)  │      │ Masseur (admin) │
│  (browser)   │      │  booking UI          │◀────▶│  (browser)      │
└─────────────┘      └──────────┬───────────┘      └────────────────┘
                                 │ REST/JSON
                                 ▼
                       ┌───────────────────┐
                       │   API server       │
                       │  (auth, booking,   │
                       │  availability)     │
                       └──────┬─────┬───────┘
                              │     │
                 ┌────────────┘     └────────────┐
                 ▼                                ▼
        ┌────────────────┐              ┌──────────────────┐
        │   Database       │              │  Calendar sync    │
        │  (Postgres)      │              │  worker            │
        └────────────────┘              └────────┬─────────┘
                                                    │
                                       ┌────────────┴────────────┐
                                       ▼                          ▼
                               Google Calendar API        Microsoft Graph
                                                            (Outlook)
```

Plus a notification worker (email for booking requests, confirmations, cancellations) — same pattern as the calendar sync worker: async, queued, retryable.

---

## 3. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Backend | Node.js + TypeScript (Express or Fastify) | Same language front and back, huge ecosystem for Google/Microsoft calendar SDKs, easy async job handling |
| Frontend | React + TypeScript | Standard, works well with a booking-widget-style UI (date picker, slot grid) |
| Database | PostgreSQL | Strong transactional guarantees — you need real ACID transactions to prevent double-booking, which weaker/NoSQL stores make harder |
| Job queue | Postgres-backed queue (e.g. `pg-boss`) or Redis + BullMQ | For calendar sync, webhook renewal, notification emails — anything that shouldn't block the booking request |
| Auth | Email/password or magic link for masseur; guest checkout (name+email+phone, no account) for customers, with optional account creation | Customers booking a massage generally won't tolerate a signup wall |
| Hosting | Any single-region PaaS (Render, Fly.io, Railway) to start | No need for multi-region complexity at this scale |

This isn't the only reasonable stack — if you already know a language/framework well, use that instead. The stack matters far less here than the data model and the concurrency handling below.

---

## 4. Data model

```
Provider (the masseur — singleton row for v1, but modeled as a table so v2 multi-masseur isn't a rewrite)
  id, name, email, timezone, google_calendar_id, ms_calendar_id, ...

Service
  id, provider_id, name, duration_minutes, price, buffer_before_minutes, buffer_after_minutes, active

AvailabilityRule   (recurring weekly template, e.g. "Mon–Fri 9:00–17:00")
  id, provider_id, weekday, start_time, end_time

AvailabilityException  (one-off overrides: vacation day, extra Saturday shift, etc.)
  id, provider_id, date, type[blocked|open], start_time, end_time

Booking
  id, provider_id, service_id, customer_id, start_at (UTC), end_at (UTC),
  status[pending|confirmed|cancelled|completed|no_show],
  external_event_id_google, external_event_id_outlook,
  created_at, cancelled_at, cancellation_reason

Customer
  id, name, email, phone, notes

ExternalBusyBlock   (v2 — synced from Google/Outlook, represents events NOT created by this app)
  id, provider_id, source[google|outlook], external_event_id, start_at, end_at, last_synced_at

CalendarConnection  (OAuth credentials)
  id, provider_id, source[google|outlook], access_token, refresh_token, expires_at, webhook_channel_id, webhook_expires_at
```

Key design choices worth flagging:

- **All timestamps stored in UTC**, converted to the provider's timezone only at display time. Timezone bugs are the #1 source of "the booking showed up at the wrong time" incidents in scheduling systems — don't store local time anywhere.
- **`Booking` and `ExternalBusyBlock` are separate tables.** Bookings are things the app owns (can be cancelled, rescheduled, refunded). External busy blocks are read-only shadows of the masseur's personal calendar. Merging them into one table tends to cause bugs where the app tries to "cancel" an event it doesn't actually control.
- **Buffers live on `Service`, not `Booking`**, so a 60-minute massage with a 15-minute cleanup buffer blocks 75 minutes of calendar time without that logic leaking into every query.

---

## 5. Core flow: computing availability

This is the function the booking UI calls to show open slots for a given day:

```
available_slots(provider, service, date):
  1. Get AvailabilityRule for that weekday → working hours
  2. Apply AvailabilityException for that date (override/block)
  3. Subtract existing Booking ranges (status in [pending, confirmed]) for that date
  4. Subtract ExternalBusyBlock ranges for that date  (v2)
  5. Slice remaining free time into slots of size = service.duration + buffers,
     at whatever granularity you want to offer (e.g. every 15 or 30 min)
  6. Return slots
```

Compute this on read, not by pre-generating a slots table — a slots table gets stale the moment any input changes and becomes its own sync problem.

---

## 6. Core flow: booking creation (and preventing double-booking)

This is the part that most naive implementations get wrong: two customers hitting "book" for the same slot within milliseconds of each other.

```
BEGIN TRANSACTION
  SELECT existing bookings for provider WHERE time range overlaps requested slot
    FOR UPDATE   -- row lock, blocks concurrent conflicting inserts
  IF overlap exists → ROLLBACK, return "slot no longer available"
  INSERT Booking (status = pending)
COMMIT
```

Additionally, add a Postgres **exclusion constraint** using the `btree_gist` extension on `(provider_id, tstzrange(start_at, end_at))` — this makes double-booking impossible at the database level even if application logic has a bug, race, or a second server instance. Belt and suspenders: the transaction+lock handles the common case cleanly with a good error message; the constraint is the backstop that guarantees correctness.

Note the row is inserted as `pending`, not `confirmed` — bookings are confirmed manually by the masseur (see below), but `pending` still counts against availability (section 5 already excludes `pending` bookings from open slots), so the slot is reserved from the moment of request, not just after confirmation.

After the row commits:
1. Enqueue a "booking request received" email to the customer (not a confirmation — the masseur hasn't approved it yet).
2. Enqueue a notification to the masseur (email or admin dashboard alert) that a new request is waiting.

**Manual confirmation (masseur-facing):**
The masseur reviews pending requests and calls `POST /bookings/:id/confirm` or `POST /bookings/:id/decline`.
- **Confirm** → status → `confirmed`, then enqueue: (a) push the event to Google/Outlook, (b) send the customer a confirmation email.
- **Decline** → status → `cancelled`, then enqueue a "not available" email to the customer, freeing the slot immediately.

One trade-off worth flagging: manual confirmation means the customer doesn't get instant certainty at booking time — they get it whenever the masseur next checks requests. If that gap is more than an hour or two, expect customers to book elsewhere in the meantime, or to be annoyed by a late decline. Worth pairing this with a push/email alert to the masseur the moment a request comes in, so confirmation happens fast in practice even though it isn't automatic.

---

## 7. Calendar sync detail

**Outbound (v1 — booking → external calendar):**
On booking create/cancel/reschedule, the sync worker calls the Google Calendar API (`events.insert`/`update`/`delete`) and/or Microsoft Graph (`/me/events`) using the provider's stored OAuth token, and saves the returned `external_event_id` back on the `Booking` row so future updates target the right event. Runs as a queued job with retry/backoff — if Google's API is briefly down, the booking itself still succeeded and the sync just retries.

**Inbound (v2 — external calendar → app, so manually-added personal events block booking):**
- Google: use a **watch channel** (push notification via webhook) on the calendar; on notification, fetch changes via `events.list` with `syncToken` (incremental sync, not a full re-fetch). Channels expire (~7 days) and must be renewed by a scheduled job.
- Outlook: use **Microsoft Graph subscriptions** (webhook) with delta queries (`/me/events/delta`), same idea. Subscriptions expire in ~3 days for calendar resources — renewal job is not optional, it's load-bearing.
- Fallback: even with webhooks, run a periodic reconciliation poll (e.g. every few hours) in case a webhook delivery was missed — webhooks are "at least once, but not guaranteed" in practice.
- Store results as `ExternalBusyBlock` rows keyed by `external_event_id` so re-syncs are idempotent (upsert, not insert).

**OAuth:** standard authorization-code flow, refresh tokens stored encrypted, access token refreshed transparently by the sync worker before each API call if near expiry. Handle revocation gracefully — if a refresh token is invalidated (masseur revoked access, or changed their Google password), mark the `CalendarConnection` as broken and prompt the masseur to reconnect rather than silently failing bookings.

---

## 8. API surface (REST)

```
Public (customer-facing):
  GET  /services                          list bookable services
  GET  /availability?service_id&date      slots for a day
  POST /bookings                          create booking {service_id, start_at, customer}
  GET  /bookings/:id?token=...            view booking (magic-link token, no login needed)
  POST /bookings/:id/cancel?token=...
  POST /bookings/:id/reschedule?token=...

Admin (masseur-facing, authenticated):
  GET/POST/PATCH  /services
  GET/POST/PATCH  /availability-rules
  GET/POST        /availability-exceptions
  GET             /bookings                       (calendar/list view, incl. pending requests)
  POST            /bookings/:id/confirm            (pending → confirmed; triggers calendar push + customer email)
  POST            /bookings/:id/decline             (pending → cancelled; triggers customer email)
  POST            /bookings/:id/cancel
  POST            /calendar-connections/google/oauth-callback
  POST            /calendar-connections/outlook/oauth-callback
  DELETE          /calendar-connections/:id
```

Customers get a **magic link with a signed token** (emailed at booking time) rather than an account — lower friction, still lets them cancel/reschedule their own booking without exposing everyone else's.

---

## 9. Non-functional considerations

- **Timezones:** always show times in the customer's detected browser timezone on the booking widget, and in the provider's configured timezone in the admin view. Store UTC.
- **No-shows / cancellation policy:** worth a `cancellation_deadline_hours` setting per service for a manual no-show policy — since no payment method is stored, any no-show fee has to be collected/enforced by the masseur in person, not charged automatically.
- **Payments:** out of scope for this system. The masseur collects payment in person at the appointment; no online payment, deposit, or stored card. No `pending_payment` state needed — `pending` in the booking status machine means "awaiting the masseur's manual confirmation," not "awaiting payment."
- **Notifications:** email only (SendGrid/Postmark/SES) — a "request received" email on booking, a confirmation email once the masseur confirms, and a decline/cancellation email if needed. No SMS, no separate reminder job for v1.

---

## 10. Phased plan

**v1 (MVP):**
Internal calendar as source of truth · availability rules + exceptions · booking creation with transaction+exclusion-constraint locking (as `pending`) · manual confirm/decline by the masseur · magic-link cancel/reschedule for the customer · request-received and confirmation emails · one-way push to Google/Outlook on confirm. Payment stays out-of-band (in person).

**v2:**
Inbound webhook sync from Google/Outlook (external events block availability) · admin dashboard polish.

**v3 (only if you outgrow single-masseur):**
Multiple providers, per-provider availability, "any available masseur" booking mode. The data model above already supports this (everything is keyed by `provider_id`) — it wouldn't require a redesign, just new UI and a provider-selection step in the booking flow.

---

## Decisions

- **Payments:** in person, at the appointment. No online collection, no stored card, no `pending_payment` state.
- **Notifications:** email only, at booking (request received) and at confirmation. No SMS, no reminder job in v1.
- **Confirmation:** manual — the masseur reviews and confirms/declines each request; nothing auto-confirms.

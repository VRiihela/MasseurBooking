# Appointment Booking System — Architecture Design

**Scope:** single-masseur web app. Customers book a slot online; the masseur manages bookings through the app's own admin views. Calendar sync (push or two-way) is deferred — see the update in section 1 and the Decisions section at the bottom.

---

## 1. A call-out before we design: is two-way sync worth it for MVP?

You asked for both an internal calendar and two-way sync to Google/Outlook. Worth being explicit about what that buys you and what it costs, because it's the single biggest complexity driver in this system.

**One-way push** (app → Google/Outlook, so the masseur sees bookings in their existing calendar) is cheap: one API call per booking, no webhooks, no conflict resolution.

**Two-way sync** (external calendar → app, so a personal appointment the masseur adds manually blocks online booking) means: OAuth token lifecycle management, webhook subscriptions that expire and need renewal (Google push channels expire in ~1 week, Microsoft Graph subscriptions in ~3 days), handling out-of-order or duplicate webhook deliveries, and reconciling edits/deletes that happen on either side. It roughly doubles the calendar-integration work.

Recommendation: build the internal calendar as the single source of truth, ship one-way push in v1, add the inbound pull/webhook sync in v2 once the core booking flow is proven. The design below supports both, but the phasing section at the end marks what's v1 through v3 so you can decide where to draw the line without re-architecting later.

**Update:** as the backend actually got built (tasks 001-007), the decision went further than "which sync direction first" — calendar sync is deferred entirely for now, in both directions. The backend is the source of truth on its own; the masseur manages bookings through the app's own admin views instead of an external calendar. Frontend is next after backend wraps up. Sections 4, 7, and 8 below still describe the calendar-sync design for when it's picked back up — see the appendix at the end and the Decisions section for the current status.

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
                              ▼     ▼
                       ┌──────────┐   ┌───────────────────┐
                       │ Database │   │  Email worker       │
                       │(Postgres)│   │  (outbox + poller)  │
                       └──────────┘   └──────────┬──────────┘
                                                   │
                                                   ▼
                                        Transactional email API
```

No calendar-sync worker for now (see the update in section 1) — the diagram above matches what's actually built through task 007. Calendar sync, if picked back up later, adds a worker and outbound calls to Google Calendar API / Microsoft Graph the same way the email worker calls its provider today — see the appendix.

---

## 3. Tech stack

| Layer | Choice | Why |
|---|---|---|
| Backend | Node.js + TypeScript (Express or Fastify) | Same language front and back, huge ecosystem for Google/Microsoft calendar SDKs, easy async job handling |
| Frontend | React + TypeScript | Standard, works well with a booking-widget-style UI (date picker, slot grid) |
| Database | PostgreSQL | Strong transactional guarantees — you need real ACID transactions to prevent double-booking, which weaker/NoSQL stores make harder |
| Job queue | Transactional outbox table + polling worker (`SELECT ... FOR UPDATE SKIP LOCKED`), no separate queue library | For notification emails — anything that shouldn't block the booking request. What actually got built in task 005; calendar-sync webhook renewal would need this too if that work resumes |
| Auth | Email/password or magic link for masseur; guest checkout (name+email+phone, no account) for customers, with optional account creation | Customers booking a massage generally won't tolerate a signup wall |
| Hosting | Any single-region PaaS (Render, Fly.io, Railway) to start | No need for multi-region complexity at this scale |

This isn't the only reasonable stack — if you already know a language/framework well, use that instead. The stack matters far less here than the data model and the concurrency handling below.

---

## 4. Data model

```
Provider (the masseur — singleton row for v1, but modeled as a table so a later multi-masseur phase isn't a rewrite)
  id, name, timezone, ...

Service
  id, provider_id, name, duration_minutes, price, buffer_before_minutes, buffer_after_minutes, active

AvailabilityRule   (recurring weekly template, e.g. "Mon–Fri 9:00–17:00")
  id, provider_id, weekday, start_time, end_time

AvailabilityException  (one-off overrides: vacation day, extra Saturday shift, etc.)
  id, provider_id, date, type[blocked|open], start_time, end_time

Booking
  id, provider_id, service_id, customer_id, start_at (UTC), end_at (UTC),
  status[pending|confirmed|cancelled],   -- 'completed'/'no_show' were in an earlier
                                          -- draft of this doc but nothing was ever
                                          -- built to set them; the real CHECK
                                          -- constraint (migration 002) only allows
                                          -- these three. Add a real state here only
                                          -- alongside a task that actually sets it.
  created_at, cancelled_at, cancellation_reason

Customer
  id, name, email, phone, notes
```

`ExternalBusyBlock` and `CalendarConnection` (and the `external_event_id_google`/`external_event_id_outlook` columns on `Booking`) are removed from the near-term model now that calendar sync is deferred — see the appendix for that design if it's picked back up later.

Key design choices worth flagging:

- **All timestamps stored in UTC**, converted to the provider's timezone only at display time. Timezone bugs are the #1 source of "the booking showed up at the wrong time" incidents in scheduling systems — don't store local time anywhere.
- **Buffers live on `Service`, not `Booking`**, so a 60-minute massage with a 15-minute cleanup buffer blocks 75 minutes of calendar time without that logic leaking into every query.

---

## 5. Core flow: computing availability

This is the function the booking UI calls to show open slots for a given day:

```
available_slots(provider, service, date):
  1. Get AvailabilityRule for that weekday → working hours
  2. Apply AvailabilityException for that date (override/block)
  3. Subtract existing Booking ranges (status in [pending, confirmed]) for that date
  4. Slice remaining free time into slots of size = service.duration + buffers,
     at whatever granularity you want to offer (e.g. every 15 or 30 min)
  5. Return slots
```

(A step subtracting `ExternalBusyBlock` ranges was here for when calendar sync existed — removed along with that table. This is what's actually implemented in task 003.)

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
- **Confirm** → status → `confirmed`, then enqueue a confirmation email to the customer. (No calendar push for now — see the update in section 1.)
- **Decline** → status → `cancelled`, then enqueue a "not available" email to the customer, freeing the slot immediately.

One trade-off worth flagging: manual confirmation means the customer doesn't get instant certainty at booking time — they get it whenever the masseur next checks requests. If that gap is more than an hour or two, expect customers to book elsewhere in the meantime, or to be annoyed by a late decline. Worth pairing this with a push/email alert to the masseur the moment a request comes in, so confirmation happens fast in practice even though it isn't automatic.

---

## 7. Calendar sync — deferred

Full design moved to the appendix at the end of this document. Not part of the near-term plan; see section 1's update and the Decisions section.

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

Auth (masseur-facing, task 006):
  POST /auth/login-request                 { email } -- enqueues a magic-link email if it matches ADMIN_EMAIL
  GET  /auth/login?token=...                consumes the login token, returns a session bearer token
  POST /auth/logout                         revokes the current session

Admin (masseur-facing, authenticated via the session from /auth/login):
  GET/POST/PATCH  /admin/services
  GET/POST/PATCH/DELETE  /admin/availability-rules
  GET/POST/DELETE        /admin/availability-exceptions
  GET/PATCH       /admin/provider
  GET             /admin/bookings?status=...       (list/pending-queue view, task 009)
  POST            /bookings/:id/confirm            (pending → confirmed; triggers customer email)
  POST            /bookings/:id/decline             (pending → cancelled; triggers customer email)
  POST            /admin/bookings/:id/cancel        (confirmed → cancelled; masseur-initiated, triggers customer email; task 016)
```

Calendar-connection OAuth endpoints removed for now — see the appendix. This list is now synced against the real routes as of task 016.

The gap noted in earlier drafts of this doc — no way for the masseur to cancel an already-*confirmed* booking on their own initiative — is closed as of task 016. `decline` still covers pending → cancelled; the new `/admin/bookings/:id/cancel` covers confirmed → cancelled, each with its own distinct customer-facing email so the customer can tell which happened.

Customers get a **magic link with a signed token** (emailed at booking time) rather than an account — lower friction, still lets them cancel/reschedule their own booking without exposing everyone else's.

---

## 9. Non-functional considerations

- **Timezones:** always show times in the customer's detected browser timezone on the booking widget, and in the provider's configured timezone in the admin view. Store UTC.
- **No-shows / cancellation policy:** worth a `cancellation_deadline_hours` setting per service for a manual no-show policy — since no payment method is stored, any no-show fee has to be collected/enforced by the masseur in person, not charged automatically.
- **Payments:** out of scope for this system. The masseur collects payment in person at the appointment; no online payment, deposit, or stored card. No `pending_payment` state needed — `pending` in the booking status machine means "awaiting the masseur's manual confirmation," not "awaiting payment."
- **Notifications:** email only (SendGrid/Postmark/SES) — a "request received" email on booking, a confirmation email once the masseur confirms, and a decline/cancellation email if needed. No SMS, no separate reminder job for v1.

---

## 10. Phased plan

**Backend (tasks 001-009, done):**
Internal calendar as source of truth · availability rules + exceptions · booking creation with transaction+exclusion-constraint locking (as `pending`) · manual confirm/decline by the masseur · real masseur login (magic link, task 006) · customer magic-link view/cancel/reschedule (task 007) · admin CRUD for services/availability/provider profile (task 008) · public service listing + admin booking list (task 009) · request-received, confirmation, and cancellation emails via an outbox+poller worker (task 005). Payment stays out-of-band (in person). No calendar sync.

**Frontend (next):**
Customer-facing booking widget (service picker, date/slot picker, confirmation/manage-booking pages using the task 007 magic link) and the masseur admin dashboard (pending-requests queue, calendar/list view, service and availability management, login via task 006).

**Calendar sync (deferred, revisit after frontend):**
One-way push to Google/Outlook first if still wanted, inbound two-way sync only if that gap in practice turns out to matter. Full design preserved in the appendix below — nothing about the current data model or API blocks adding this later, it just isn't being built now.

**Multi-provider (only if you outgrow single-masseur):**
Per-provider availability, "any available masseur" booking mode. The data model already supports this (everything is keyed by `provider_id`) — it wouldn't require a redesign, just new UI and a provider-selection step in the booking flow.

---

## Decisions

- **Payments:** in person, at the appointment. No online collection, no stored card, no `pending_payment` state.
- **Notifications:** email only, at booking (request received) and at confirmation. No SMS, no reminder job in v1.
- **Confirmation:** manual — the masseur reviews and confirms/declines each request; nothing auto-confirms.
- **Calendar sync:** deferred entirely (both push and inbound) as of task 007. Backend ships and frontend starts without it; revisit later based on whether the masseur actually finds double-entry (app + their personal calendar) annoying enough in practice to justify the OAuth/webhook complexity described in the appendix.

---

## Appendix: Calendar sync design (deferred)

Kept for reference — this was designed before the decision to defer calendar sync entirely, and nothing here is built. If picked back up later, it slots in without changing the core data model beyond re-adding what's described below.

**Data model additions:**
```
Provider gains: google_calendar_id, ms_calendar_id
Booking gains: external_event_id_google, external_event_id_outlook

ExternalBusyBlock   (synced from Google/Outlook, represents events NOT created by this app)
  id, provider_id, source[google|outlook], external_event_id, start_at, end_at, last_synced_at

CalendarConnection  (OAuth credentials)
  id, provider_id, source[google|outlook], access_token, refresh_token, expires_at, webhook_channel_id, webhook_expires_at
```

`Booking` and `ExternalBusyBlock` should stay separate tables: bookings are things the app owns (can be cancelled, rescheduled), external busy blocks are read-only shadows of the masseur's personal calendar. Merging them tends to cause bugs where the app tries to "cancel" an event it doesn't actually control.

**Outbound (booking → external calendar):**
On booking create/cancel/reschedule, a sync worker calls the Google Calendar API (`events.insert`/`update`/`delete`) and/or Microsoft Graph (`/me/events`) using the provider's stored OAuth token, and saves the returned `external_event_id` back on the `Booking` row so future updates target the right event. Runs as a queued job with retry/backoff — if Google's API is briefly down, the booking itself still succeeded and the sync just retries.

**Inbound (external calendar → app, so manually-added personal events block booking):**
- Google: use a **watch channel** (push notification via webhook) on the calendar; on notification, fetch changes via `events.list` with `syncToken` (incremental sync, not a full re-fetch). Channels expire (~7 days) and must be renewed by a scheduled job.
- Outlook: use **Microsoft Graph subscriptions** (webhook) with delta queries (`/me/events/delta`), same idea. Subscriptions expire in ~3 days for calendar resources — renewal job is not optional, it's load-bearing.
- Fallback: even with webhooks, run a periodic reconciliation poll (e.g. every few hours) in case a webhook delivery was missed — webhooks are "at least once, but not guaranteed" in practice.
- Store results as `ExternalBusyBlock` rows keyed by `external_event_id` so re-syncs are idempotent (upsert, not insert).

**OAuth:** standard authorization-code flow, refresh tokens stored encrypted, access token refreshed transparently by the sync worker before each API call if near expiry. Handle revocation gracefully — if a refresh token is invalidated (masseur revoked access, or changed their Google password), mark the `CalendarConnection` as broken and prompt the masseur to reconnect rather than silently failing bookings.

**Availability computation gains a step:** subtract `ExternalBusyBlock` ranges for the date, alongside existing `Booking` ranges.

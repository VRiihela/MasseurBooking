import { useEffect, useMemo, useState } from "react";
import { DateTime } from "luxon";
import { Calendar, luxonLocalizer, Views, type View } from "react-big-calendar";
import "react-big-calendar/lib/css/react-big-calendar.css";
import "./AdminCalendar.css";
import { ApiError, getAdminBookings } from "../api/client";
import type { AdminBooking } from "../api/types";

// Positions events using the browser's local timezone (react-big-calendar
// renders plain JS Dates in whatever timezone the runtime is in). This
// project's other displays (start_at_local/end_at_local) instead render in
// provider.timezone explicitly. For a single-masseur tool this is expected to
// coincide in practice -- the masseur's own phone is normally set to their
// own timezone -- but it is a deliberate v1 simplification, not a guarantee,
// and would need revisiting if this ever supported a masseur travelling
// across timezones or multiple providers.
const localizer = luxonLocalizer(DateTime);

const CALENDAR_VIEWS: View[] = [Views.MONTH, Views.WEEK, Views.DAY];

interface Props {
  onSessionEnded: () => void;
}

interface CalendarEvent {
  id: string;
  title: string;
  start: Date;
  end: Date;
  booking: AdminBooking;
}

function toEvent(booking: AdminBooking): CalendarEvent {
  return {
    id: booking.id,
    title: `${booking.service_name} — ${booking.customer_name}`,
    start: new Date(booking.start_at),
    end: new Date(booking.end_at),
    booking,
  };
}

function eventPropGetter(event: CalendarEvent) {
  return {
    className:
      event.booking.status === "pending" ? "admin-calendar-event-pending" : "admin-calendar-event-confirmed",
  };
}

export function AdminCalendar({ onSessionEnded }: Props) {
  const [bookings, setBookings] = useState<AdminBooking[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState<View>(Views.DAY);
  const [date, setDate] = useState(new Date());
  const [selectedBooking, setSelectedBooking] = useState<AdminBooking | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    setBookings(null);

    // No status filter -- the calendar needs pending and confirmed together,
    // and filters out cancelled itself below.
    getAdminBookings()
      .then((result) => {
        if (!cancelled) {
          setBookings(result);
        }
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        if (error instanceof ApiError && error.status === 401) {
          onSessionEnded();
          return;
        }
        setLoadError("Could not load the calendar. Please try again shortly.");
      });

    return () => {
      cancelled = true;
    };
  }, [onSessionEnded]);

  const events = useMemo(
    () => (bookings ?? []).filter((booking) => booking.status !== "cancelled").map(toEvent),
    [bookings],
  );

  return (
    <div className="admin-calendar">
      {loadError && <p role="alert">{loadError}</p>}
      {!loadError && bookings === null && <p>Loading calendar&hellip;</p>}

      {bookings !== null && (
        <div className="admin-calendar-grid" data-testid="admin-calendar-grid">
          <Calendar<CalendarEvent>
            localizer={localizer}
            events={events}
            date={date}
            onNavigate={setDate}
            view={view}
            onView={setView}
            views={CALENDAR_VIEWS}
            startAccessor="start"
            endAccessor="end"
            eventPropGetter={eventPropGetter}
            onSelectEvent={(event) => setSelectedBooking(event.booking)}
            popup
          />
        </div>
      )}

      {selectedBooking && (
        <div className="admin-calendar-detail" role="dialog" aria-label="Booking details">
          <p>{selectedBooking.service_name}</p>
          <p>
            {selectedBooking.start_at_local} to {selectedBooking.end_at_local}
          </p>
          <p>
            {selectedBooking.customer_name} &mdash; {selectedBooking.customer_email} &mdash;{" "}
            {selectedBooking.customer_phone}
          </p>
          <p>Status: {selectedBooking.status}</p>
          <button type="button" onClick={() => setSelectedBooking(null)}>
            Close
          </button>
        </div>
      )}
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { DateTime } from "luxon";
import { Calendar, luxonLocalizer, Views, type SlotInfo, type View } from "react-big-calendar";
import "react-big-calendar/lib/css/react-big-calendar.css";
import "./AdminCalendar.css";
import {
  ApiError,
  cancelBookingAsAdmin,
  confirmBooking,
  createAvailabilityException,
  declineBooking,
  deleteAvailabilityException,
  getAdminBookings,
  getAvailabilityExceptions,
} from "../api/client";
import type { AdminBooking, AvailabilityException } from "../api/types";

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

const FULL_DAY_START = "00:00:00";
const FULL_DAY_END = "23:59:59";

type CalendarMode = "view" | "manage";

interface Props {
  onSessionEnded: () => void;
}

type CalendarEvent =
  | { kind: "booking"; id: string; title: string; start: Date; end: Date; booking: AdminBooking }
  | {
      kind: "exception";
      id: string;
      title: string;
      start: Date;
      end: Date;
      exception: AvailabilityException;
    };

export interface BatchBlockResult {
  newlyBlocked: string[];
  alreadyBlocked: string[];
  failed: { date: string; message: string }[];
}

interface TimeRange {
  start_time: string;
  end_time: string;
}

// Local calendar-date/time extraction, deliberately not .toISOString() --
// that reads UTC components and would shift the date/time whenever the
// browser's local timezone isn't UTC. Same bug class the backend's own
// toIsoDateString() (adminCatalogService.ts) exists to avoid.
export function toLocalDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function toLocalTimeString(date: Date): string {
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

// Pure decision: given what react-big-calendar reports was selected and the
// currently-displayed view, what should be blocked? Kept free of React state
// so it's directly unit-testable without simulating RBC's pixel-based drag
// gestures (getBoundingClientRect-dependent, unreliable in jsdom).
export function planSlotBlock(
  slotInfo: { start: Date; end: Date; slots: Date[] },
  view: View,
): { dates: string[]; timeRange: TimeRange } | { error: string } {
  if (view === Views.MONTH) {
    return {
      dates: slotInfo.slots.map(toLocalDateString),
      timeRange: { start_time: FULL_DAY_START, end_time: FULL_DAY_END },
    };
  }

  const startDate = toLocalDateString(slotInfo.start);
  const endDate = toLocalDateString(slotInfo.end);
  if (startDate !== endDate) {
    return { error: "Can't block a range that crosses midnight -- select a range within a single day." };
  }
  return {
    dates: [startDate],
    timeRange: { start_time: toLocalTimeString(slotInfo.start), end_time: toLocalTimeString(slotInfo.end) },
  };
}

// Pure(ish) batch-create: takes known state as plain arguments and returns a
// plain result rather than closing over component state, so it's directly
// unit-testable by stubbing fetch and calling it -- same technique used for
// planSlotBlock above. Still does the real network calls (sequentially, not
// Promise.all, to keep any burst against adminRateLimit smaller and to make
// partial-failure attribution unambiguous).
export async function runBatchBlock(
  dates: string[],
  timeRange: TimeRange,
  knownExceptions: AvailabilityException[],
): Promise<{ result: BatchBlockResult; created: AvailabilityException[]; unauthorized: boolean }> {
  const isFullDayBlock = timeRange.start_time === FULL_DAY_START && timeRange.end_time === FULL_DAY_END;
  const newlyBlocked: string[] = [];
  const alreadyBlocked: string[] = [];
  const failed: { date: string; message: string }[] = [];
  const created: AvailabilityException[] = [];

  for (const date of dates) {
    if (
      isFullDayBlock &&
      knownExceptions.some(
        (exception) =>
          exception.date === date &&
          exception.start_time === FULL_DAY_START &&
          exception.end_time === FULL_DAY_END,
      )
    ) {
      alreadyBlocked.push(date);
      continue;
    }

    try {
      const exception = await createAvailabilityException({ date, type: "blocked", ...timeRange });
      created.push(exception);
      newlyBlocked.push(date);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        return { result: { newlyBlocked, alreadyBlocked, failed }, created, unauthorized: true };
      }
      failed.push({
        date,
        message: error instanceof ApiError ? error.message : "Could not block this date.",
      });
    }
  }

  return { result: { newlyBlocked, alreadyBlocked, failed }, created, unauthorized: false };
}

function dateAtLocalTime(year: number, month: number, day: number, time: string): Date {
  const [hours, minutes, seconds] = time.split(":").map(Number);
  return new Date(year, month - 1, day, hours, minutes, seconds);
}

function toBookingEvent(booking: AdminBooking): CalendarEvent {
  return {
    kind: "booking",
    id: booking.id,
    title: `${booking.service_name} — ${booking.customer_name}`,
    start: new Date(booking.start_at),
    end: new Date(booking.end_at),
    booking,
  };
}

function toExceptionEvent(exception: AvailabilityException): CalendarEvent {
  const [year, month, day] = exception.date.split("-").map(Number);
  const isFullDay = exception.start_time === FULL_DAY_START && exception.end_time === FULL_DAY_END;
  return {
    kind: "exception",
    id: exception.id,
    title: isFullDay ? "Blocked" : `Blocked ${exception.start_time.slice(0, 5)}–${exception.end_time.slice(0, 5)}`,
    start: dateAtLocalTime(year, month, day, exception.start_time),
    end: dateAtLocalTime(year, month, day, exception.end_time),
    exception,
  };
}

function eventPropGetter(event: CalendarEvent) {
  if (event.kind === "exception") {
    return { className: "admin-calendar-event-blocked" };
  }
  return {
    className:
      event.booking.status === "pending" ? "admin-calendar-event-pending" : "admin-calendar-event-confirmed",
  };
}

export function formatBatchResult(result: BatchBlockResult): string {
  const dayWord = result.newlyBlocked.length === 1 ? "day" : "days";
  let message = `Blocked ${result.newlyBlocked.length} new ${dayWord}`;
  if (result.alreadyBlocked.length > 0) {
    const wasWere = result.alreadyBlocked.length === 1 ? "was" : "were";
    message += ` (${result.alreadyBlocked.length} ${wasWere} already blocked)`;
  }
  if (result.failed.length > 0) {
    message += `. Failed: ${result.failed.map((failure) => `${failure.date} (${failure.message})`).join(", ")}`;
  }
  return message;
}

export function AdminCalendar({ onSessionEnded }: Props) {
  const [bookings, setBookings] = useState<AdminBooking[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState<View>(Views.DAY);
  const [date, setDate] = useState(new Date());
  const [selectedBooking, setSelectedBooking] = useState<AdminBooking | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [decliningId, setDecliningId] = useState<string | null>(null);
  const [declineReason, setDeclineReason] = useState("");
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");

  const [mode, setMode] = useState<CalendarMode>("view");
  const [exceptions, setExceptions] = useState<AvailabilityException[] | null>(null);
  const [exceptionsError, setExceptionsError] = useState<string | null>(null);
  const [slotError, setSlotError] = useState<string | null>(null);
  const [unblockError, setUnblockError] = useState<string | null>(null);
  const [batchResult, setBatchResult] = useState<BatchBlockResult | null>(null);
  const exceptionsRequestedRef = useRef(false);

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

  // Exceptions are fetched only once Manage-availability mode is actually
  // entered, not on mount -- View mode's network behavior (and therefore its
  // existing tests) stays identical to what task 018 shipped.
  useEffect(() => {
    if (mode !== "manage" || exceptionsRequestedRef.current) {
      return;
    }
    exceptionsRequestedRef.current = true;
    let cancelled = false;
    setExceptionsError(null);

    getAvailabilityExceptions()
      .then((result) => {
        if (!cancelled) {
          setExceptions(result.filter((exception) => exception.type === "blocked"));
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
        exceptionsRequestedRef.current = false;
        setExceptionsError("Could not load blocked dates. Please try again shortly.");
      });

    return () => {
      cancelled = true;
    };
  }, [mode, onSessionEnded]);

  const bookingEvents = useMemo(
    () => (bookings ?? []).filter((booking) => booking.status !== "cancelled").map(toBookingEvent),
    [bookings],
  );

  const exceptionEvents = useMemo(() => {
    if (mode !== "manage" || !exceptions) {
      return [];
    }
    return exceptions.map(toExceptionEvent);
  }, [mode, exceptions]);

  const events = useMemo(() => [...bookingEvents, ...exceptionEvents], [bookingEvents, exceptionEvents]);

  function handleModeChange(nextMode: CalendarMode) {
    setMode(nextMode);
    if (nextMode === "view") {
      setBatchResult(null);
      setSlotError(null);
      setUnblockError(null);
    }
  }

  function handleSelectEvent(event: CalendarEvent) {
    if (event.kind === "booking") {
      resetActionState();
      setSelectedBooking(event.booking);
      return;
    }
    void handleUnblock(event.exception);
  }

  // Selecting a different booking event without closing the current popup
  // first is possible -- the popup has no backdrop blocking the grid --
  // so this is called both there and on Close, to prevent a stale error or
  // reveal-form state from one booking leaking into the next.
  function resetActionState() {
    setActionError(null);
    setDecliningId(null);
    setDeclineReason("");
    setCancellingId(null);
    setCancelReason("");
  }

  function closeBookingDetail() {
    setSelectedBooking(null);
    resetActionState();
  }

  // Mirrors AdminDashboard.tsx's applyBookingUpdate, plus keeping
  // selectedBooking in sync -- the list view has no equivalent of a
  // persistently-open "selected" item, so this extra step is unique to the
  // calendar's popup.
  function applyBookingUpdate(id: string, status: AdminBooking["status"]) {
    setBookings((current) =>
      current ? current.map((booking) => (booking.id === id ? { ...booking, status } : booking)) : current,
    );
    setSelectedBooking((current) => (current && current.id === id ? { ...current, status } : current));
  }

  async function handleConfirm(id: string) {
    setActionError(null);
    try {
      const result = await confirmBooking(id);
      applyBookingUpdate(id, result.status);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        onSessionEnded();
        return;
      }
      setActionError(
        error instanceof ApiError ? error.message : "Could not confirm this booking. Please try again.",
      );
    }
  }

  async function handleDecline(id: string) {
    setActionError(null);
    try {
      const result = await declineBooking(id, declineReason);
      applyBookingUpdate(id, result.status);
      if (result.status === "cancelled") {
        closeBookingDetail();
        return;
      }
      setDecliningId(null);
      setDeclineReason("");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        onSessionEnded();
        return;
      }
      setActionError(
        error instanceof ApiError ? error.message : "Could not decline this booking. Please try again.",
      );
    }
  }

  async function handleCancel(id: string) {
    setActionError(null);
    try {
      const result = await cancelBookingAsAdmin(id, cancelReason);
      applyBookingUpdate(id, result.status);
      if (result.status === "cancelled") {
        closeBookingDetail();
        return;
      }
      setCancellingId(null);
      setCancelReason("");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        onSessionEnded();
        return;
      }
      setActionError(
        error instanceof ApiError ? error.message : "Could not cancel this booking. Please try again.",
      );
    }
  }

  async function handleUnblock(exception: AvailabilityException) {
    setUnblockError(null);
    try {
      await deleteAvailabilityException(exception.id);
      setExceptions((current) => current?.filter((item) => item.id !== exception.id) ?? current);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        onSessionEnded();
        return;
      }
      setUnblockError(
        error instanceof ApiError ? error.message : "Could not unblock this date. Please try again.",
      );
    }
  }

  async function handleSelectSlot(slotInfo: SlotInfo) {
    const plan = planSlotBlock(slotInfo, view);
    if ("error" in plan) {
      setSlotError(plan.error);
      return;
    }
    setSlotError(null);

    const outcome = await runBatchBlock(plan.dates, plan.timeRange, exceptions ?? []);
    if (outcome.created.length > 0) {
      setExceptions((current) => (current ? [...current, ...outcome.created] : outcome.created));
    }
    if (outcome.unauthorized) {
      onSessionEnded();
      return;
    }
    setBatchResult(outcome.result);
  }

  return (
    <div className="admin-calendar">
      <section aria-label="Calendar mode">
        <button type="button" aria-pressed={mode === "view"} onClick={() => handleModeChange("view")}>
          View
        </button>
        <button
          type="button"
          aria-pressed={mode === "manage"}
          onClick={() => handleModeChange("manage")}
        >
          Manage availability
        </button>
      </section>

      {loadError && <p role="alert">{loadError}</p>}
      {!loadError && bookings === null && <p>Loading calendar&hellip;</p>}

      {mode === "manage" && (
        <>
          {exceptionsError && <p role="alert">{exceptionsError}</p>}
          {slotError && <p role="alert">{slotError}</p>}
          {unblockError && <p role="alert">{unblockError}</p>}
          {batchResult && <p role="status">{formatBatchResult(batchResult)}</p>}
        </>
      )}

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
            onSelectEvent={handleSelectEvent}
            selectable={mode === "manage"}
            onSelectSlot={mode === "manage" ? (slotInfo) => void handleSelectSlot(slotInfo) : undefined}
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

          {actionError && <p role="alert">{actionError}</p>}

          {selectedBooking.status === "pending" && (
            <>
              <button type="button" onClick={() => void handleConfirm(selectedBooking.id)}>
                Confirm
              </button>
              {decliningId === selectedBooking.id ? (
                <>
                  <label>
                    Reason (optional)
                    <textarea
                      value={declineReason}
                      maxLength={500}
                      onChange={(event) => setDeclineReason(event.target.value)}
                    />
                  </label>
                  <button type="button" onClick={() => void handleDecline(selectedBooking.id)}>
                    Confirm decline
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDecliningId(null);
                      setDeclineReason("");
                    }}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setDecliningId(selectedBooking.id);
                    setDeclineReason("");
                  }}
                >
                  Decline
                </button>
              )}
            </>
          )}

          {selectedBooking.status === "confirmed" &&
            (cancellingId === selectedBooking.id ? (
              <>
                <label>
                  Reason (optional)
                  <textarea
                    value={cancelReason}
                    maxLength={500}
                    onChange={(event) => setCancelReason(event.target.value)}
                  />
                </label>
                <button type="button" onClick={() => void handleCancel(selectedBooking.id)}>
                  Confirm cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCancellingId(null);
                    setCancelReason("");
                  }}
                >
                  Never mind
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setCancellingId(selectedBooking.id);
                  setCancelReason("");
                }}
              >
                Cancel booking
              </button>
            ))}

          <button type="button" onClick={closeBookingDetail}>
            Close
          </button>
        </div>
      )}
    </div>
  );
}

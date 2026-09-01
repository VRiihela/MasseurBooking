import { useEffect, useState } from "react";
import {
  ApiError,
  cancelBooking,
  getAvailability,
  getBookingForCustomer,
  rescheduleBooking,
} from "../api/client";
import type { CustomerBookingView } from "../api/types";

type LoadState =
  | { kind: "loading" }
  | { kind: "not-found" }
  | { kind: "loaded"; view: CustomerBookingView }
  | { kind: "rescheduled"; newStartAt: string };

type ActionMode = "view" | "cancel-confirm" | "reschedule";

function formatSlotLocal(isoUtc: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(isoUtc));
}

function todayLocalDateInput(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

interface Props {
  bookingId: string;
}

export function ManageBooking({ bookingId }: Props) {
  const [token] = useState(() => new URLSearchParams(window.location.search).get("token"));
  const [loadState, setLoadState] = useState<LoadState>({ kind: "loading" });
  const [mode, setMode] = useState<ActionMode>("view");
  const [actionError, setActionError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [date, setDate] = useState(todayLocalDateInput);
  const [slots, setSlots] = useState<string[] | null>(null);
  const [slotsError, setSlotsError] = useState<string | null>(null);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotTakenMessage, setSlotTakenMessage] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);

  function loadBooking() {
    if (!token) {
      setLoadState({ kind: "not-found" });
      return;
    }
    setLoadState({ kind: "loading" });
    getBookingForCustomer(bookingId, token)
      .then((view) => setLoadState({ kind: "loaded", view }))
      .catch(() => setLoadState({ kind: "not-found" }));
  }

  useEffect(loadBooking, [bookingId, token]);

  async function fetchSlots(serviceId: string, forDate: string) {
    if (!token) {
      return;
    }
    setSlotsLoading(true);
    setSlotsError(null);
    try {
      const result = await getAvailability(serviceId, forDate);
      setSlots(result);
    } catch {
      setSlotsError("Could not load available slots. Please try again shortly.");
    } finally {
      setSlotsLoading(false);
    }
  }

  function handleStartReschedule(serviceId: string) {
    setMode("reschedule");
    setActionError(null);
    setSelectedSlot(null);
    setSlots(null);
    setSlotTakenMessage(null);
    void fetchSlots(serviceId, date);
  }

  function handleDateChange(newDate: string, serviceId: string) {
    setDate(newDate);
    setSelectedSlot(null);
    void fetchSlots(serviceId, newDate);
  }

  async function handleCancel() {
    if (!token || submitting || loadState.kind !== "loaded") {
      return;
    }
    const currentView = loadState.view;
    setSubmitting(true);
    setActionError(null);
    try {
      const result = await cancelBooking(bookingId, token);
      setLoadState({ kind: "loaded", view: { ...currentView, status: result.status } });
      setMode("view");
    } catch {
      setActionError("Could not cancel this booking. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleConfirmReschedule(serviceId: string) {
    if (!token || !selectedSlot || submitting) {
      return;
    }
    setSubmitting(true);
    setActionError(null);
    try {
      // rescheduleBookingForCustomer cancels this (old) booking and creates a
      // brand-new one with its own id and a freshly-minted, only-emailed
      // token -- the old bookingId/token pair now permanently refers to a
      // cancelled booking, so a refetch with it would show that instead of
      // success. The response already carries everything needed to confirm
      // the new time without touching that pair again.
      const result = await rescheduleBooking(bookingId, token, selectedSlot);
      setLoadState({ kind: "rescheduled", newStartAt: result.start_at });
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        // A 409 here means either the slot was just taken, or the booking
        // itself became non-modifiable (e.g. declined) since page load.
        // Re-fetch the booking and branch on its actual current status --
        // never on the error message text -- to tell the two apart.
        try {
          const freshView = await getBookingForCustomer(bookingId, token);
          setLoadState({ kind: "loaded", view: freshView });
          if (freshView.status === "cancelled") {
            setMode("view");
          } else {
            setSlotTakenMessage("Sorry, that slot was just taken. Please pick another time.");
            setSelectedSlot(null);
            void fetchSlots(serviceId, date);
          }
        } catch {
          setLoadState({ kind: "not-found" });
        }
      } else {
        setActionError("Could not reschedule this booking. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (loadState.kind === "loading") {
    return (
      <div className="page">
        <h1>Your booking</h1>
        <p className="loading-text">Loading&hellip;</p>
      </div>
    );
  }

  if (loadState.kind === "not-found") {
    return (
      <div className="page">
        <h1>Booking not found</h1>
        <p role="alert">
          We couldn&rsquo;t find this booking. Please use the link from your confirmation email.
        </p>
      </div>
    );
  }

  if (loadState.kind === "rescheduled") {
    return (
      <div className="page">
        <h1>Booking rescheduled</h1>
        <div className="card">
          <p data-testid="reschedule-success">
            Your booking has been moved to {formatSlotLocal(loadState.newStartAt)}. We&rsquo;ve sent
            a new confirmation email with an updated link to manage this booking.
          </p>
        </div>
      </div>
    );
  }

  const { view } = loadState;
  const isModifiable = view.status === "pending" || view.status === "confirmed";

  return (
    <div className="page">
      <h1>Your booking</h1>
      <div className="card">
        <p>
          {view.service_name} &mdash; {view.start_at_local} to {view.end_at_local}
        </p>
        <p>Status: {view.status}</p>

        {actionError && <p role="alert">{actionError}</p>}

        {isModifiable && mode === "view" && (
          <section aria-label="Manage this booking">
            <button type="button" className="btn btn-primary" onClick={() => handleStartReschedule(view.service_id)}>
              Reschedule
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setMode("cancel-confirm")}>
              Cancel booking
            </button>
          </section>
        )}

        {isModifiable && mode === "cancel-confirm" && (
          <section aria-label="Confirm cancellation">
            <p>Are you sure you want to cancel this booking? This cannot be undone.</p>
            <button type="button" className="btn btn-primary" disabled={submitting} onClick={() => void handleCancel()}>
              {submitting ? "Cancelling…" : "Confirm cancellation"}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setMode("view")}>
              Never mind
            </button>
          </section>
        )}

        {isModifiable && mode === "reschedule" && (
          <section aria-label="Reschedule this booking">
            <button
              type="button"
              className="btn btn-back"
              onClick={() => {
                setMode("view");
                setSlotTakenMessage(null);
              }}
            >
              &lsaquo; Back
            </button>
            {slotTakenMessage && <p role="alert">{slotTakenMessage}</p>}
            <div className="field">
              <label>
                Date
                <input
                  type="date"
                  value={date}
                  onChange={(event) => handleDateChange(event.target.value, view.service_id)}
                />
              </label>
            </div>
            {slotsLoading && <p className="loading-text">Loading available times&hellip;</p>}
            {slotsError && <p role="alert">{slotsError}</p>}
            {!slotsLoading && !slotsError && slots?.length === 0 && (
              <p>No available times on this date.</p>
            )}
            <div>
              {slots?.map((slot) => (
                <button
                  key={slot}
                  type="button"
                  className="btn btn-secondary btn-block"
                  data-testid={`slot-option-${slot}`}
                  onClick={() => setSelectedSlot(slot)}
                >
                  {formatSlotLocal(slot)}
                </button>
              ))}
            </div>

            {selectedSlot && (
              <div>
                <p>Move this booking to {formatSlotLocal(selectedSlot)}?</p>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={submitting}
                  onClick={() => void handleConfirmReschedule(view.service_id)}
                >
                  {submitting ? "Rescheduling…" : "Confirm reschedule"}
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => setSelectedSlot(null)}>
                  Choose a different time
                </button>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

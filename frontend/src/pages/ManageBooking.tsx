import { useEffect, useState } from "react";
import {
  ApiError,
  cancelBooking,
  getAvailability,
  getBookingForCustomer,
  rescheduleBooking,
} from "../api/client";
import type { AdminBookingStatus, CustomerBookingView } from "../api/types";
import { formatSlotLocal } from "../lib/formatSlotLocal";

type LoadState =
  | { kind: "loading" }
  | { kind: "not-found" }
  | { kind: "loaded"; view: CustomerBookingView }
  | { kind: "rescheduled"; newStartAt: string };

type ActionMode = "view" | "cancel-confirm" | "reschedule";

const STATUS_LABELS_FI: Record<AdminBookingStatus, string> = {
  pending: "odottaa vahvistusta",
  confirmed: "vahvistettu",
  cancelled: "peruttu",
};

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
      setSlotsError("Vapaita aikoja ei voitu ladata. Yritä hetken kuluttua uudelleen.");
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
      setActionError("Varausta ei voitu perua. Yritä uudelleen.");
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
            setSlotTakenMessage("Valitettavasti tuo aika varattiin juuri. Valitse toinen aika.");
            setSelectedSlot(null);
            void fetchSlots(serviceId, date);
          }
        } catch {
          setLoadState({ kind: "not-found" });
        }
      } else {
        setActionError("Varausta ei voitu siirtää. Yritä uudelleen.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (loadState.kind === "loading") {
    return (
      <div className="page">
        <h1>Varauksesi</h1>
        <p className="loading-text">Ladataan&hellip;</p>
      </div>
    );
  }

  if (loadState.kind === "not-found") {
    return (
      <div className="page">
        <h1>Varausta ei löytynyt</h1>
        <p role="alert">
          Emme löytäneet tätä varausta. Käytä vahvistussähköpostissa ollutta linkkiä.
        </p>
      </div>
    );
  }

  if (loadState.kind === "rescheduled") {
    return (
      <div className="page">
        <h1>Varaus siirretty</h1>
        <div className="card">
          <p data-testid="reschedule-success">
            Varauksesi on siirretty ajankohtaan {formatSlotLocal(loadState.newStartAt)}. Lähetimme
            uuden vahvistusviestin, jossa on päivitetty linkki varauksen hallintaan.
          </p>
        </div>
      </div>
    );
  }

  const { view } = loadState;
  const isModifiable = view.status === "pending" || view.status === "confirmed";

  return (
    <div className="page">
      <h1>Varauksesi</h1>
      <div className="card">
        <p>
          {view.service_name} &mdash; {view.start_at_local} &ndash; {view.end_at_local}
        </p>
        <p>Tila: {STATUS_LABELS_FI[view.status]}</p>

        {actionError && <p role="alert">{actionError}</p>}

        {isModifiable && mode === "view" && (
          <section aria-label="Hallinnoi varausta">
            <button type="button" className="btn btn-primary" onClick={() => handleStartReschedule(view.service_id)}>
              Siirrä aikaa
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setMode("cancel-confirm")}>
              Peru varaus
            </button>
          </section>
        )}

        {isModifiable && mode === "cancel-confirm" && (
          <section aria-label="Vahvista peruutus">
            <p>Haluatko varmasti perua tämän varauksen? Tätä ei voi kumota.</p>
            <button type="button" className="btn btn-primary" disabled={submitting} onClick={() => void handleCancel()}>
              {submitting ? "Perutaan…" : "Vahvista peruutus"}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setMode("view")}>
              Älä peru
            </button>
          </section>
        )}

        {isModifiable && mode === "reschedule" && (
          <section aria-label="Siirrä varausta">
            <button
              type="button"
              className="btn btn-back"
              onClick={() => {
                setMode("view");
                setSlotTakenMessage(null);
              }}
            >
              &lsaquo; Takaisin
            </button>
            {slotTakenMessage && <p role="alert">{slotTakenMessage}</p>}
            <div className="field">
              <label>
                Päivämäärä
                <input
                  type="date"
                  value={date}
                  onChange={(event) => handleDateChange(event.target.value, view.service_id)}
                />
              </label>
            </div>
            {slotsLoading && <p className="loading-text">Ladataan vapaita aikoja&hellip;</p>}
            {slotsError && <p role="alert">{slotsError}</p>}
            {!slotsLoading && !slotsError && slots?.length === 0 && (
              <p>Ei vapaita aikoja tälle päivälle.</p>
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
                <p>Siirretäänkö varaus ajankohtaan {formatSlotLocal(selectedSlot)}?</p>
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={submitting}
                  onClick={() => void handleConfirmReschedule(view.service_id)}
                >
                  {submitting ? "Siirretään…" : "Vahvista uusi aika"}
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => setSelectedSlot(null)}>
                  Valitse toinen aika
                </button>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

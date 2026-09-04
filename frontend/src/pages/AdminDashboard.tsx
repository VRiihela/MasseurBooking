import { useEffect, useState } from "react";
import {
  ApiError,
  cancelBookingAsAdmin,
  clearStoredSessionToken,
  confirmBooking,
  declineBooking,
  getAdminBookings,
  logout,
} from "../api/client";
import type { AdminBooking, AdminBookingStatusFilter } from "../api/types";
import { FILTER_LABELS_FI, STATUS_LABELS_FI } from "../lib/statusLabels";
import { AdminAvailability } from "./AdminAvailability";
import { AdminCalendar } from "./AdminCalendar";
import { AdminServices } from "./AdminServices";

const STATUS_FILTERS: AdminBookingStatusFilter[] = ["pending", "confirmed", "cancelled", "all"];
type ViewMode = "list" | "calendar" | "availability" | "services";

interface Props {
  onSessionEnded: () => void;
}

export function AdminDashboard({ onSessionEnded }: Props) {
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [statusFilter, setStatusFilter] = useState<AdminBookingStatusFilter>("pending");
  const [bookings, setBookings] = useState<AdminBooking[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [decliningId, setDecliningId] = useState<string | null>(null);
  const [declineReason, setDeclineReason] = useState("");
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");

  useEffect(() => {
    let cancelled = false;
    setListError(null);
    setBookings(null);

    getAdminBookings(statusFilter)
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
        setListError("Varauksia ei voitu ladata. Yritä hetken kuluttua uudelleen.");
      });

    return () => {
      cancelled = true;
    };
  }, [statusFilter, onSessionEnded]);

  function applyBookingUpdate(id: string, status: AdminBooking["status"]) {
    setBookings((current) =>
      current ? current.map((booking) => (booking.id === id ? { ...booking, status } : booking)) : current,
    );
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
      setActionError("Varausta ei voitu vahvistaa. Yritä uudelleen.");
    }
  }

  async function handleDecline(id: string) {
    setActionError(null);
    try {
      const result = await declineBooking(id, declineReason);
      applyBookingUpdate(id, result.status);
      setDecliningId(null);
      setDeclineReason("");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        onSessionEnded();
        return;
      }
      setActionError("Varausta ei voitu hylätä. Yritä uudelleen.");
    }
  }

  async function handleCancel(id: string) {
    setActionError(null);
    try {
      const result = await cancelBookingAsAdmin(id, cancelReason);
      applyBookingUpdate(id, result.status);
      setCancellingId(null);
      setCancelReason("");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        onSessionEnded();
        return;
      }
      setActionError("Varausta ei voitu perua. Yritä uudelleen.");
    }
  }

  async function handleLogout() {
    try {
      await logout();
    } catch {
      // Falls through to clearing local state below regardless -- an already
      // invalid/expired session must not strand the masseur on this view.
    } finally {
      clearStoredSessionToken();
      onSessionEnded();
    }
  }

  return (
    <div className="page">
      <h1>Varaukset</h1>
      <button type="button" className="btn btn-back" onClick={() => void handleLogout()}>
        Kirjaudu ulos
      </button>

      <section aria-label="Vaihda näkymää">
        <button
          type="button"
          className={`btn ${viewMode === "list" ? "btn-primary" : "btn-secondary"}`}
          aria-pressed={viewMode === "list"}
          onClick={() => setViewMode("list")}
        >
          Lista
        </button>
        <button
          type="button"
          className={`btn ${viewMode === "calendar" ? "btn-primary" : "btn-secondary"}`}
          aria-pressed={viewMode === "calendar"}
          onClick={() => setViewMode("calendar")}
        >
          Kalenteri
        </button>
        <button
          type="button"
          className={`btn ${viewMode === "availability" ? "btn-primary" : "btn-secondary"}`}
          aria-pressed={viewMode === "availability"}
          onClick={() => setViewMode("availability")}
        >
          Saatavuus
        </button>
        <button
          type="button"
          className={`btn ${viewMode === "services" ? "btn-primary" : "btn-secondary"}`}
          aria-pressed={viewMode === "services"}
          onClick={() => setViewMode("services")}
        >
          Palvelut
        </button>
      </section>

      {viewMode === "calendar" && <AdminCalendar onSessionEnded={onSessionEnded} />}
      {viewMode === "availability" && <AdminAvailability onSessionEnded={onSessionEnded} />}
      {viewMode === "services" && <AdminServices onSessionEnded={onSessionEnded} />}

      {viewMode === "list" && (
        <>
          <section aria-label="Suodata varauksia">
            {STATUS_FILTERS.map((filter) => (
              <button
                key={filter}
                type="button"
                className={`btn ${statusFilter === filter ? "btn-primary" : "btn-secondary"}`}
                aria-pressed={statusFilter === filter}
                onClick={() => setStatusFilter(filter)}
              >
                {FILTER_LABELS_FI[filter]}
              </button>
            ))}
          </section>

          {actionError && <p role="alert">{actionError}</p>}
          {listError && <p role="alert">{listError}</p>}
          {!listError && bookings === null && <p className="loading-text">Ladataan varauksia&hellip;</p>}
          {bookings?.length === 0 && <p>Ei varauksia tässä näkymässä.</p>}

          <ul>
            {bookings?.map((booking) => (
              <li key={booking.id} className="card" data-testid={`booking-${booking.id}`}>
                <p>
                  {booking.service_name} &mdash; {booking.start_at_local} &ndash; {booking.end_at_local}
                </p>
                <p>
                  {booking.customer_name} &mdash; {booking.customer_email} &mdash;{" "}
                  {booking.customer_phone}
                </p>
                <p>Tila: {STATUS_LABELS_FI[booking.status]}</p>

                {booking.status === "pending" && (
                  <>
                    <button type="button" className="btn btn-primary" onClick={() => void handleConfirm(booking.id)}>
                      Vahvista
                    </button>
                    {decliningId === booking.id ? (
                      <>
                        <div className="field">
                          <label>
                            Syy (valinnainen)
                            <textarea
                              value={declineReason}
                              maxLength={500}
                              onChange={(event) => setDeclineReason(event.target.value)}
                            />
                          </label>
                        </div>
                        <button type="button" className="btn btn-primary" onClick={() => void handleDecline(booking.id)}>
                          Vahvista hylkäys
                        </button>
                        <button
                          type="button"
                          className="btn btn-back"
                          onClick={() => {
                            setDecliningId(null);
                            setDeclineReason("");
                          }}
                        >
                          Peruuta
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => {
                          setDecliningId(booking.id);
                          setDeclineReason("");
                        }}
                      >
                        Hylkää
                      </button>
                    )}
                  </>
                )}

                {booking.status === "confirmed" &&
                  (cancellingId === booking.id ? (
                    <>
                      <div className="field">
                        <label>
                          Syy (valinnainen)
                          <textarea
                            value={cancelReason}
                            maxLength={500}
                            onChange={(event) => setCancelReason(event.target.value)}
                          />
                        </label>
                      </div>
                      <button type="button" className="btn btn-primary" onClick={() => void handleCancel(booking.id)}>
                        Vahvista peruutus
                      </button>
                      <button
                        type="button"
                        className="btn btn-back"
                        onClick={() => {
                          setCancellingId(null);
                          setCancelReason("");
                        }}
                      >
                        Älä peru
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => {
                        setCancellingId(booking.id);
                        setCancelReason("");
                      }}
                    >
                      Peru varaus
                    </button>
                  ))}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

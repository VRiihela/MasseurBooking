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

const STATUS_FILTERS: AdminBookingStatusFilter[] = ["pending", "confirmed", "cancelled", "all"];

interface Props {
  onSessionEnded: () => void;
}

export function AdminDashboard({ onSessionEnded }: Props) {
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
        setListError("Could not load bookings. Please try again shortly.");
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
      setActionError("Could not confirm this booking. Please try again.");
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
      setActionError("Could not decline this booking. Please try again.");
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
      setActionError("Could not cancel this booking. Please try again.");
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
    <div>
      <h1>Bookings</h1>
      <button type="button" onClick={() => void handleLogout()}>
        Log out
      </button>

      <section aria-label="Filter bookings">
        {STATUS_FILTERS.map((filter) => (
          <button
            key={filter}
            type="button"
            aria-pressed={statusFilter === filter}
            onClick={() => setStatusFilter(filter)}
          >
            {filter}
          </button>
        ))}
      </section>

      {actionError && <p role="alert">{actionError}</p>}
      {listError && <p role="alert">{listError}</p>}
      {!listError && bookings === null && <p>Loading bookings&hellip;</p>}
      {bookings?.length === 0 && <p>No bookings in this view.</p>}

      <ul>
        {bookings?.map((booking) => (
          <li key={booking.id} data-testid={`booking-${booking.id}`}>
            <p>
              {booking.service_name} &mdash; {booking.start_at_local} to {booking.end_at_local}
            </p>
            <p>
              {booking.customer_name} &mdash; {booking.customer_email} &mdash;{" "}
              {booking.customer_phone}
            </p>
            <p>Status: {booking.status}</p>

            {booking.status === "pending" && (
              <>
                <button type="button" onClick={() => void handleConfirm(booking.id)}>
                  Confirm
                </button>
                {decliningId === booking.id ? (
                  <>
                    <label>
                      Reason (optional)
                      <textarea
                        value={declineReason}
                        maxLength={500}
                        onChange={(event) => setDeclineReason(event.target.value)}
                      />
                    </label>
                    <button type="button" onClick={() => void handleDecline(booking.id)}>
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
                      setDecliningId(booking.id);
                      setDeclineReason("");
                    }}
                  >
                    Decline
                  </button>
                )}
              </>
            )}

            {booking.status === "confirmed" &&
              (cancellingId === booking.id ? (
                <>
                  <label>
                    Reason (optional)
                    <textarea
                      value={cancelReason}
                      maxLength={500}
                      onChange={(event) => setCancelReason(event.target.value)}
                    />
                  </label>
                  <button type="button" onClick={() => void handleCancel(booking.id)}>
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
                    setCancellingId(booking.id);
                    setCancelReason("");
                  }}
                >
                  Cancel booking
                </button>
              ))}
          </li>
        ))}
      </ul>
    </div>
  );
}

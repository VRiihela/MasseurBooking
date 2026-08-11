import { useState } from "react";
import { getStoredSessionToken } from "./api/client";
import { AdminDashboard } from "./pages/AdminDashboard";
import { AdminLoginCallback } from "./pages/AdminLoginCallback";
import { AdminLoginRequest } from "./pages/AdminLoginRequest";
import { BookingWidget } from "./pages/BookingWidget";
import { ManageBooking } from "./pages/ManageBooking";

function AdminRoute() {
  const [hasSession, setHasSession] = useState(() => getStoredSessionToken() !== null);

  if (!hasSession) {
    return <AdminLoginRequest />;
  }

  return <AdminDashboard onSessionEnded={() => setHasSession(false)} />;
}

export function App() {
  const path = window.location.pathname;

  if (path === "/auth/login") {
    return <AdminLoginCallback />;
  }

  if (path.startsWith("/admin")) {
    return <AdminRoute />;
  }

  const manageBookingMatch = path.match(/^\/bookings\/([^/]+)$/);
  if (manageBookingMatch) {
    return <ManageBooking bookingId={manageBookingMatch[1]} />;
  }

  return <BookingWidget />;
}

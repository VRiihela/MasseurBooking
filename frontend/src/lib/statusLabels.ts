import type { AdminBookingStatus, AdminBookingStatusFilter } from "../api/types";

/**
 * Shared by ManageBooking (customer-facing), AdminDashboard, and
 * AdminCalendar -- all three render a booking's raw status enum as text and
 * must never leak the English wire value ("pending"/"confirmed"/"cancelled")
 * directly to either audience.
 */
export const STATUS_LABELS_FI: Record<AdminBookingStatus, string> = {
  pending: "odottaa vahvistusta",
  confirmed: "vahvistettu",
  cancelled: "peruttu",
};

/**
 * Short, tab-appropriate labels for AdminDashboard's status-filter buttons --
 * deliberately terser than STATUS_LABELS_FI's full-sentence phrasing, which
 * reads naturally after "Tila:" but not as a standalone filter-tab name.
 */
export const FILTER_LABELS_FI: Record<AdminBookingStatusFilter, string> = {
  pending: "Odottaa",
  confirmed: "Vahvistettu",
  cancelled: "Peruttu",
  all: "Kaikki",
};

/**
 * Shared by BookingWidget (slot picker) and ManageBooking (reschedule slot
 * picker + preview) -- both format a raw UTC ISO string from GET
 * /availability into a short, human-readable local time, in Finnish
 * convention. The "fi" locale's CLDR data resolves this weekday+day+month+
 * hour+minute skeleton to a numeric "d.M." date rather than a named month,
 * so no month-name lookup table is needed here (unlike the backend's
 * full-prose formatLocalTime).
 */
export function formatSlotLocal(isoUtc: string): string {
  return new Intl.DateTimeFormat("fi", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(isoUtc));
}

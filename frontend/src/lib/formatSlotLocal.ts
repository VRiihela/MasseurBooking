/**
 * Every slot is shown in the provider's timezone rather than the browser's,
 * matching the backend, which interprets GET /availability's date and writes
 * its emails in that zone. Slot tiles show only a time under a separate date
 * header, so a browser-local time could silently belong to a different day
 * than the header says. Keep in sync with providers.timezone, which the
 * frontend doesn't receive from the API.
 */
const PROVIDER_TIME_ZONE = "Europe/Helsinki";

/**
 * Shared by BookingWidget (form summary) and ManageBooking (reschedule preview
 * + success message) -- both format a raw UTC ISO string from GET
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
    timeZone: PROVIDER_TIME_ZONE,
  }).format(new Date(isoUtc));
}

/** Time-only slot tile text, e.g. "12.00" -- the date is in the picker header. */
export function formatSlotTime(isoUtc: string): string {
  return new Intl.DateTimeFormat("fi", {
    hour: "numeric",
    minute: "2-digit",
    hour12: false,
    timeZone: PROVIDER_TIME_ZONE,
  }).format(new Date(isoUtc));
}

/**
 * Formats the picker's "YYYY-MM-DD" date input value as e.g. "ma 2.11.2026".
 * This is a calendar date, not an instant, so it's pinned to UTC on both the
 * parse and the format: the result can't shift with the viewer's timezone.
 * Returns "" for anything unparseable, since a cleared date input yields ""
 * and Intl.DateTimeFormat.format throws on an invalid Date, which would blank
 * the whole page.
 */
export function formatSlotDate(dateInput: string): string {
  const date = new Date(`${dateInput}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Intl.DateTimeFormat("fi", {
    weekday: "short",
    day: "numeric",
    month: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

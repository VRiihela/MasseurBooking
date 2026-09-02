import { DateTime } from "luxon";

/**
 * Finnish month names in the partitive form used after a day number
 * ("12. elokuuta", not the standalone nominative "elokuu"). Intl/CLDR only
 * exposes the standalone form for `fi` via ECMA-402, so this can't come from
 * a Luxon locale token -- it has to be a literal lookup.
 */
const FINNISH_MONTHS_PARTITIVE = [
  "tammikuuta",
  "helmikuuta",
  "maaliskuuta",
  "huhtikuuta",
  "toukokuuta",
  "kesäkuuta",
  "heinäkuuta",
  "elokuuta",
  "syyskuuta",
  "lokakuuta",
  "marraskuuta",
  "joulukuuta",
];

/**
 * Shared by emailQueueService (email bodies) and bookingService (the
 * customer-facing GET /bookings/:id view) -- both need the same UTC-stored
 * instant rendered as a human-readable string in the provider's local
 * timezone, in Finnish convention (24-hour time, day-first order).
 */
export function formatLocalTime(date: Date, timezone: string): string {
  const dt = DateTime.fromJSDate(date, { zone: "utc" }).setZone(timezone).setLocale("fi");
  const weekday = dt.toFormat("cccc");
  const month = FINNISH_MONTHS_PARTITIVE[dt.month - 1];
  const time = dt.toFormat("H.mm");
  return `${weekday} ${dt.day}. ${month} ${dt.year} klo ${time}`;
}

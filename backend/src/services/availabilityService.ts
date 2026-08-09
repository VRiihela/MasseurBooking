import { DateTime } from "luxon";
import { getPool } from "../db/pool.js";
import { ServiceNotFoundError } from "../errors.js";
import {
  type Interval,
  sliceIntoSlots,
  subtractIntervals,
  unionIntervals,
} from "./availabilityIntervals.js";

const SLOT_GRANULARITY_MINUTES = 15;

interface ServiceWithProviderRow {
  provider_id: string;
  duration_minutes: number;
  buffer_before_minutes: number;
  buffer_after_minutes: number;
  timezone: string;
}

interface TimeWindowRow {
  start_time: string;
  end_time: string;
}

interface ExceptionRow extends TimeWindowRow {
  type: "blocked" | "open";
}

interface BookingWindowRow {
  start_at: Date;
  end_at: Date;
}

async function loadServiceWithProvider(serviceId: string): Promise<ServiceWithProviderRow> {
  const result = await getPool().query<ServiceWithProviderRow>(
    `SELECT s.provider_id, s.duration_minutes, s.buffer_before_minutes, s.buffer_after_minutes, p.timezone
     FROM services s
     JOIN providers p ON p.id = s.provider_id
     WHERE s.id = $1 AND s.active = true`,
    [serviceId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new ServiceNotFoundError();
  }
  return row;
}

function toUtcMillis(date: string, timeOfDay: string, zone: string): number {
  return DateTime.fromISO(`${date}T${timeOfDay}`, { zone }).toUTC().toMillis();
}

function windowToInterval(date: string, row: TimeWindowRow, zone: string): Interval {
  return {
    start: toUtcMillis(date, row.start_time, zone),
    end: toUtcMillis(date, row.end_time, zone),
  };
}

async function loadRuleIntervals(
  providerId: string,
  date: string,
  weekday: number,
  zone: string,
): Promise<Interval[]> {
  const result = await getPool().query<TimeWindowRow>(
    `SELECT start_time, end_time FROM availability_rules WHERE provider_id = $1 AND weekday = $2`,
    [providerId, weekday],
  );
  return result.rows.map((row) => windowToInterval(date, row, zone));
}

async function loadExceptions(
  providerId: string,
  date: string,
  zone: string,
): Promise<{ open: Interval[]; blocked: Interval[] }> {
  const result = await getPool().query<ExceptionRow>(
    `SELECT type, start_time, end_time FROM availability_exceptions WHERE provider_id = $1 AND date = $2`,
    [providerId, date],
  );

  const open: Interval[] = [];
  const blocked: Interval[] = [];
  for (const row of result.rows) {
    const interval = windowToInterval(date, row, zone);
    (row.type === "open" ? open : blocked).push(interval);
  }
  return { open, blocked };
}

async function loadBookingIntervals(
  providerId: string,
  dayStartUtcMs: number,
  dayEndUtcMs: number,
): Promise<Interval[]> {
  const result = await getPool().query<BookingWindowRow>(
    `SELECT start_at, end_at FROM bookings
     WHERE provider_id = $1
       AND status IN ('pending', 'confirmed')
       AND tstzrange(start_at, end_at) && tstzrange($2, $3)`,
    [providerId, new Date(dayStartUtcMs).toISOString(), new Date(dayEndUtcMs).toISOString()],
  );
  return result.rows.map((row) => ({ start: row.start_at.getTime(), end: row.end_at.getTime() }));
}

export interface ComputeAvailableSlotsInput {
  serviceId: string;
  date: string; // "YYYY-MM-DD", interpreted in the provider's timezone
}

export async function computeAvailableSlots(input: ComputeAvailableSlotsInput): Promise<string[]> {
  const service = await loadServiceWithProvider(input.serviceId);
  const zone = service.timezone;

  const localDay = DateTime.fromISO(input.date, { zone });
  const weekday = localDay.weekday; // 1 = Monday .. 7 = Sunday
  const dayStartUtcMs = localDay.startOf("day").toUTC().toMillis();
  const dayEndUtcMs = localDay.startOf("day").plus({ days: 1 }).toUTC().toMillis();

  const [ruleIntervals, { open, blocked }, bookingIntervals] = await Promise.all([
    loadRuleIntervals(service.provider_id, input.date, weekday, zone),
    loadExceptions(service.provider_id, input.date, zone),
    loadBookingIntervals(service.provider_id, dayStartUtcMs, dayEndUtcMs),
  ]);

  // 'open' exceptions extend the normal weekly hours; 'blocked' exceptions
  // then win over whatever is open for that window (see Architect notes).
  const withOpens = unionIntervals([...ruleIntervals, ...open]);
  const afterBlocked = subtractIntervals(withOpens, blocked);
  const free = subtractIntervals(afterBlocked, bookingIntervals);

  const totalMinutes =
    service.duration_minutes + service.buffer_before_minutes + service.buffer_after_minutes;
  const slotDurationMs = totalMinutes * 60_000;
  const granularityMs = SLOT_GRANULARITY_MINUTES * 60_000;

  return sliceIntoSlots(free, slotDurationMs, granularityMs).map((ms) =>
    new Date(ms).toISOString(),
  );
}

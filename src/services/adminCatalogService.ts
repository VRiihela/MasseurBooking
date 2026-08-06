import { getPool } from "../db/pool.js";
import type {
  AvailabilityException,
  AvailabilityExceptionType,
  AvailabilityRule,
  Provider,
  Service,
} from "../db/types.js";
import {
  AvailabilityExceptionNotFoundError,
  AvailabilityRuleNotFoundError,
  ServiceNotFoundError,
  ValidationError,
} from "../errors.js";
import type {
  CreateAvailabilityExceptionInput,
  CreateAvailabilityRuleInput,
  UpdateAvailabilityRuleInput,
} from "../validation/adminAvailabilitySchema.js";
import type { UpdateProviderInput } from "../validation/adminProviderSchema.js";
import type { CreateServiceInput, UpdateServiceInput } from "../validation/adminServiceSchema.js";

/**
 * Every existing query resolves provider_id through a service_id or
 * booking_id join -- nothing else needs "the provider" standalone. Exactly
 * one providers row exists in v1 (seeded manually, out of scope for this
 * API -- see task 008's assumptions); a missing row here means the DB was
 * never seeded, a deploy-time problem, not a client-reachable one, so it's
 * left as a plain thrown error rather than a dedicated AppError.
 */
async function loadSingletonProviderId(): Promise<string> {
  const result = await getPool().query<{ id: string }>(`SELECT id FROM providers LIMIT 1`);
  const row = result.rows[0];
  if (!row) {
    throw new Error("No provider row exists -- the provider must be seeded before using admin routes");
  }
  return row.id;
}

/**
 * Builds a `SET col = $n, ...` clause from a fixed, hardcoded column map --
 * iterates the map's own keys, never the input object's keys, so a future
 * loosening of a schema's .strict() can't turn an unexpected input key into
 * an interpolated column name. Column names can't be parameterized like
 * values can; this is the allowlist that stands in for that.
 */
function buildSetClause<Input extends Record<string, unknown>>(
  input: Input,
  columnMap: Record<keyof Input, string>,
  startParamIndex: number,
): { setClause: string; values: unknown[] } {
  const assignments: string[] = [];
  const values: unknown[] = [];
  let paramIndex = startParamIndex;

  for (const key of Object.keys(columnMap) as (keyof Input)[]) {
    const value = input[key];
    if (value === undefined) {
      continue;
    }
    assignments.push(`${columnMap[key]} = $${paramIndex}`);
    values.push(value);
    paramIndex += 1;
  }

  return { setClause: assignments.join(", "), values };
}

// ---- Services ----

interface ServiceRow {
  id: string;
  provider_id: string;
  name: string;
  price: string | null; // NUMERIC comes back from pg as a string
  duration_minutes: number;
  buffer_before_minutes: number;
  buffer_after_minutes: number;
  active: boolean;
}

const SERVICE_COLUMNS = `id, provider_id, name, price, duration_minutes, buffer_before_minutes, buffer_after_minutes, active`;

function toService(row: ServiceRow): Service {
  return {
    id: row.id,
    providerId: row.provider_id,
    name: row.name,
    price: row.price === null ? null : Number(row.price),
    durationMinutes: row.duration_minutes,
    bufferBeforeMinutes: row.buffer_before_minutes,
    bufferAfterMinutes: row.buffer_after_minutes,
    active: row.active,
  };
}

const SERVICE_UPDATE_COLUMNS: Record<keyof UpdateServiceInput, string> = {
  name: "name",
  price: "price",
  duration_minutes: "duration_minutes",
  buffer_before_minutes: "buffer_before_minutes",
  buffer_after_minutes: "buffer_after_minutes",
  active: "active",
};

export async function listServices(): Promise<Service[]> {
  const providerId = await loadSingletonProviderId();
  const result = await getPool().query<ServiceRow>(
    `SELECT ${SERVICE_COLUMNS} FROM services WHERE provider_id = $1 ORDER BY name`,
    [providerId],
  );
  return result.rows.map(toService);
}

export async function createService(input: CreateServiceInput): Promise<Service> {
  const providerId = await loadSingletonProviderId();
  const result = await getPool().query<ServiceRow>(
    `INSERT INTO services (provider_id, name, price, duration_minutes, buffer_before_minutes, buffer_after_minutes, active)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${SERVICE_COLUMNS}`,
    [
      providerId,
      input.name,
      input.price,
      input.duration_minutes,
      input.buffer_before_minutes,
      input.buffer_after_minutes,
      input.active,
    ],
  );
  return toService(result.rows[0]);
}

export async function updateService(id: string, input: UpdateServiceInput): Promise<Service> {
  const providerId = await loadSingletonProviderId();
  const { setClause, values } = buildSetClause(input, SERVICE_UPDATE_COLUMNS, 3);

  const result = await getPool().query<ServiceRow>(
    `UPDATE services SET ${setClause} WHERE id = $1 AND provider_id = $2 RETURNING ${SERVICE_COLUMNS}`,
    [id, providerId, ...values],
  );
  const row = result.rows[0];
  if (!row) {
    throw new ServiceNotFoundError();
  }
  return toService(row);
}

// ---- Availability rules ----

interface AvailabilityRuleRow {
  id: string;
  provider_id: string;
  weekday: number;
  start_time: string;
  end_time: string;
}

const AVAILABILITY_RULE_COLUMNS = `id, provider_id, weekday, start_time, end_time`;

function toAvailabilityRule(row: AvailabilityRuleRow): AvailabilityRule {
  return {
    id: row.id,
    providerId: row.provider_id,
    weekday: row.weekday,
    startTime: row.start_time,
    endTime: row.end_time,
  };
}

const AVAILABILITY_RULE_UPDATE_COLUMNS: Record<keyof UpdateAvailabilityRuleInput, string> = {
  weekday: "weekday",
  start_time: "start_time",
  end_time: "end_time",
};

export async function listAvailabilityRules(): Promise<AvailabilityRule[]> {
  const providerId = await loadSingletonProviderId();
  const result = await getPool().query<AvailabilityRuleRow>(
    `SELECT ${AVAILABILITY_RULE_COLUMNS} FROM availability_rules WHERE provider_id = $1 ORDER BY weekday, start_time`,
    [providerId],
  );
  return result.rows.map(toAvailabilityRule);
}

export async function createAvailabilityRule(
  input: CreateAvailabilityRuleInput,
): Promise<AvailabilityRule> {
  const providerId = await loadSingletonProviderId();
  const result = await getPool().query<AvailabilityRuleRow>(
    `INSERT INTO availability_rules (provider_id, weekday, start_time, end_time)
     VALUES ($1, $2, $3, $4)
     RETURNING ${AVAILABILITY_RULE_COLUMNS}`,
    [providerId, input.weekday, input.start_time, input.end_time],
  );
  return toAvailabilityRule(result.rows[0]);
}

/**
 * availability_rules already has CHECK (end_time > start_time) at the DB
 * level (migration 004) -- that's the correctness backstop, same relationship
 * as the booking exclusion constraint backstopping booking creation. This
 * merge-then-validate check exists only so a partial patch that leaves the
 * pair inconsistent gets a clean 400 here instead of a raw constraint error
 * (the app-level error handler also maps constraint violations to 400 as a
 * second line of defense -- see app.ts).
 */
export async function updateAvailabilityRule(
  id: string,
  input: UpdateAvailabilityRuleInput,
): Promise<AvailabilityRule> {
  const providerId = await loadSingletonProviderId();

  const existingResult = await getPool().query<AvailabilityRuleRow>(
    `SELECT ${AVAILABILITY_RULE_COLUMNS} FROM availability_rules WHERE id = $1 AND provider_id = $2`,
    [id, providerId],
  );
  const existing = existingResult.rows[0];
  if (!existing) {
    throw new AvailabilityRuleNotFoundError();
  }

  const mergedStartTime = input.start_time ?? existing.start_time;
  const mergedEndTime = input.end_time ?? existing.end_time;
  if (mergedEndTime <= mergedStartTime) {
    throw new ValidationError("end_time must be after start_time");
  }

  const { setClause, values } = buildSetClause(input, AVAILABILITY_RULE_UPDATE_COLUMNS, 3);
  const result = await getPool().query<AvailabilityRuleRow>(
    `UPDATE availability_rules SET ${setClause} WHERE id = $1 AND provider_id = $2 RETURNING ${AVAILABILITY_RULE_COLUMNS}`,
    [id, providerId, ...values],
  );
  return toAvailabilityRule(result.rows[0]);
}

export async function deleteAvailabilityRule(id: string): Promise<void> {
  const providerId = await loadSingletonProviderId();
  const result = await getPool().query(
    `DELETE FROM availability_rules WHERE id = $1 AND provider_id = $2`,
    [id, providerId],
  );
  if ((result.rowCount ?? 0) === 0) {
    throw new AvailabilityRuleNotFoundError();
  }
}

// ---- Availability exceptions ----

interface AvailabilityExceptionRow {
  id: string;
  provider_id: string;
  date: Date; // built from local calendar components by pg -- see toIsoDateString below
  type: AvailabilityExceptionType;
  start_time: string;
  end_time: string;
}

const AVAILABILITY_EXCEPTION_COLUMNS = `id, provider_id, date, type, start_time, end_time`;

/**
 * pg's DATE parser (postgres-date) builds the JS Date from local calendar
 * components, not UTC (see its "force YYYY-MM-DD dates to be parsed as local
 * time" comment) -- so it must be read back with local getters too.
 * `.toISOString()` reads UTC components and would shift the date by one
 * whenever the server's local timezone isn't UTC.
 */
export function toIsoDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toAvailabilityException(row: AvailabilityExceptionRow): AvailabilityException {
  return {
    id: row.id,
    providerId: row.provider_id,
    date: toIsoDateString(row.date),
    type: row.type,
    startTime: row.start_time,
    endTime: row.end_time,
  };
}

export async function listAvailabilityExceptions(): Promise<AvailabilityException[]> {
  const providerId = await loadSingletonProviderId();
  const result = await getPool().query<AvailabilityExceptionRow>(
    `SELECT ${AVAILABILITY_EXCEPTION_COLUMNS} FROM availability_exceptions WHERE provider_id = $1 ORDER BY date, start_time`,
    [providerId],
  );
  return result.rows.map(toAvailabilityException);
}

export async function createAvailabilityException(
  input: CreateAvailabilityExceptionInput,
): Promise<AvailabilityException> {
  const providerId = await loadSingletonProviderId();
  const result = await getPool().query<AvailabilityExceptionRow>(
    `INSERT INTO availability_exceptions (provider_id, date, type, start_time, end_time)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING ${AVAILABILITY_EXCEPTION_COLUMNS}`,
    [providerId, input.date, input.type, input.start_time, input.end_time],
  );
  return toAvailabilityException(result.rows[0]);
}

export async function deleteAvailabilityException(id: string): Promise<void> {
  const providerId = await loadSingletonProviderId();
  const result = await getPool().query(
    `DELETE FROM availability_exceptions WHERE id = $1 AND provider_id = $2`,
    [id, providerId],
  );
  if ((result.rowCount ?? 0) === 0) {
    throw new AvailabilityExceptionNotFoundError();
  }
}

// ---- Provider ----

interface ProviderRow {
  id: string;
  name: string;
  timezone: string;
}

function toProvider(row: ProviderRow): Provider {
  return { id: row.id, name: row.name, timezone: row.timezone };
}

const PROVIDER_UPDATE_COLUMNS: Record<keyof UpdateProviderInput, string> = {
  name: "name",
  timezone: "timezone",
};

export async function getProvider(): Promise<Provider> {
  const providerId = await loadSingletonProviderId();
  const result = await getPool().query<ProviderRow>(
    `SELECT id, name, timezone FROM providers WHERE id = $1`,
    [providerId],
  );
  return toProvider(result.rows[0]);
}

export async function updateProvider(input: UpdateProviderInput): Promise<Provider> {
  const providerId = await loadSingletonProviderId();
  const { setClause, values } = buildSetClause(input, PROVIDER_UPDATE_COLUMNS, 2);

  const result = await getPool().query<ProviderRow>(
    `UPDATE providers SET ${setClause} WHERE id = $1 RETURNING id, name, timezone`,
    [providerId, ...values],
  );
  return toProvider(result.rows[0]);
}

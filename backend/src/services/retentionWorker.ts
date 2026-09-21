import { getPool, withTransaction } from "../db/pool.js";
import type { EmailJobType } from "../db/types.js";

const GDPR_PLACEHOLDER = "Poistettu GDPR-syistä";

const ANONYMIZE_AFTER_INTERVAL = "3 months";
const DELETE_AFTER_INTERVAL = "1 month";

/**
 * The only email_jobs.type values whose payload carries customer PII
 * (customerName/customerEmail) -- see BookingEmailPayload in db/types.ts.
 * masseur_booking_change_notice also carries a bookingId (see
 * MasseurBookingChangeEmailPayload) but no customer PII, so it must be
 * excluded here even though it would otherwise match the same
 * payload->>'bookingId' filter as the types below. masseur_login_link has
 * neither a bookingId nor customer PII.
 */
const CUSTOMER_PII_EMAIL_JOB_TYPES: EmailJobType[] = [
  "booking_request_received",
  "booking_confirmed",
  "booking_declined",
  "booking_cancelled_by_customer",
  "booking_cancelled_by_masseur",
];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface AnonymizeCandidate {
  id: string;
  customer_id: string;
}

/**
 * Confirmed bookings whose appointment has fully passed 3+ months ago get
 * their customer's identity scrubbed to a fixed placeholder; the booking
 * row itself (service, timing, status) is kept for business records.
 * Filtering out customers already at the placeholder makes this idempotent
 * -- a re-run only ever reports genuinely new work, not every historically
 * anonymized booking forever.
 */
async function anonymizeOldConfirmedBookings(
  referenceTime: Date,
  dryRun: boolean,
): Promise<string[]> {
  const pool = getPool();
  const candidates = await pool.query<AnonymizeCandidate>(
    `SELECT b.id, b.customer_id
     FROM bookings b
     JOIN customers c ON c.id = b.customer_id
     WHERE b.status = 'confirmed'
       AND b.start_at < $1::timestamptz - INTERVAL '${ANONYMIZE_AFTER_INTERVAL}'
       AND c.email <> $2`,
    [referenceTime.toISOString(), GDPR_PLACEHOLDER],
  );

  if (candidates.rows.length === 0 || dryRun) {
    return candidates.rows.map((row) => row.id);
  }

  const bookingIds = candidates.rows.map((row) => row.id);
  const customerIds = candidates.rows.map((row) => row.customer_id);

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE customers SET name = $1, email = $1, phone = $1 WHERE id = ANY($2::uuid[])`,
      [GDPR_PLACEHOLDER, customerIds],
    );
    await client.query(
      `UPDATE email_jobs
       SET payload = jsonb_set(
         jsonb_set(payload, '{customerName}', to_jsonb($1::text)),
         '{customerEmail}', to_jsonb($1::text)
       )
       WHERE type = ANY($2::text[]) AND payload->>'bookingId' = ANY($3::text[])`,
      [GDPR_PLACEHOLDER, CUSTOMER_PII_EMAIL_JOB_TYPES, bookingIds],
    );
  });

  return bookingIds;
}

interface DeleteCandidate {
  id: string;
  customer_id: string;
}

/**
 * Pending/cancelled bookings whose appointment date is 1+ months in the past
 * never resulted in a real appointment, so they're purged outright rather
 * than anonymized in place. Each booking's full deletion chain runs in its
 * own transaction, in FK-dependency order (customer_booking_tokens ->
 * email_jobs -> bookings -> customers -- see the migration-derived ordering
 * in the task notes), sequentially rather than in parallel: this is a
 * low-volume, once-a-day, irreversible-deletion path, so predictable
 * per-booking error isolation is worth more here than throughput.
 */
async function deleteOldPendingOrCancelledBookings(
  referenceTime: Date,
  dryRun: boolean,
): Promise<string[]> {
  const pool = getPool();
  const candidates = await pool.query<DeleteCandidate>(
    `SELECT id, customer_id
     FROM bookings
     WHERE status IN ('pending', 'cancelled')
       AND start_at < $1::timestamptz - INTERVAL '${DELETE_AFTER_INTERVAL}'`,
    [referenceTime.toISOString()],
  );

  if (dryRun) {
    return candidates.rows.map((row) => row.id);
  }

  const deletedBookingIds: string[] = [];
  for (const candidate of candidates.rows) {
    try {
      await withTransaction(async (client) => {
        await client.query(`DELETE FROM customer_booking_tokens WHERE booking_id = $1`, [
          candidate.id,
        ]);
        await client.query(
          `DELETE FROM email_jobs WHERE type = ANY($1::text[]) AND payload->>'bookingId' = $2`,
          [CUSTOMER_PII_EMAIL_JOB_TYPES, candidate.id],
        );
        await client.query(`DELETE FROM bookings WHERE id = $1`, [candidate.id]);
        await client.query(`DELETE FROM customers WHERE id = $1`, [candidate.customer_id]);
      });
      deletedBookingIds.push(candidate.id);
    } catch (error) {
      console.error(`retention delete failed for booking ${candidate.id}: ${errorMessage(error)}`);
    }
  }

  return deletedBookingIds;
}

export interface ProcessRetentionOnceOptions {
  referenceTime?: Date;
  dryRun?: boolean;
}

export interface RetentionSummary {
  dryRun: boolean;
  anonymizedBookingIds: string[];
  deletedBookingIds: string[];
}

export async function processRetentionOnce(
  options: ProcessRetentionOnceOptions = {},
): Promise<RetentionSummary> {
  const referenceTime = options.referenceTime ?? new Date();
  const dryRun = options.dryRun ?? false;

  const anonymizedBookingIds = await anonymizeOldConfirmedBookings(referenceTime, dryRun);
  const deletedBookingIds = await deleteOldPendingOrCancelledBookings(referenceTime, dryRun);

  const prefix = dryRun ? "[retention] [dry run]" : "[retention]";
  console.log(
    `${prefix} anonymized ${anonymizedBookingIds.length} confirmed booking(s)` +
      `${anonymizedBookingIds.length ? ` [${anonymizedBookingIds.join(", ")}]` : ""}; ` +
      `deleted ${deletedBookingIds.length} pending/cancelled booking(s)` +
      `${deletedBookingIds.length ? ` [${deletedBookingIds.join(", ")}]` : ""}`,
  );

  return { dryRun, anonymizedBookingIds, deletedBookingIds };
}

export interface RetentionWorkerHandle {
  stop(): void;
}

/**
 * Unlike startEmailWorker, this runs an immediate pass at startup before the
 * interval: missing a poll here isn't a delayed email, it's a missed
 * compliance sweep, and a 24h interval is long enough that a Railway
 * redeploy could plausibly restart the process before it ever elapses. The
 * sweep is idempotent and only ever touches already-past-threshold data, so
 * an extra immediate run has no downside.
 */
export function startRetentionWorker(
  options: { intervalMs?: number } = {},
): RetentionWorkerHandle {
  const intervalMs = options.intervalMs ?? 24 * 60 * 60 * 1000;

  const run = () => {
    processRetentionOnce().catch((error) => {
      console.error(`retention worker sweep failed: ${errorMessage(error)}`);
    });
  };

  run();
  const timer = setInterval(run, intervalMs);

  return {
    stop: () => clearInterval(timer),
  };
}

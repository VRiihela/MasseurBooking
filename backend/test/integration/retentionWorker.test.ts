import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { closePool, getPool } from "../../src/db/pool.js";
import { processRetentionOnce } from "../../src/services/retentionWorker.js";
import { resetAndSeed } from "../helpers/fixtures.js";

// Requires DATABASE_URL to point at a disposable Postgres DB with migrations
// 001-008 already applied.
const pool = getPool();

// Fixed, arbitrary reference time -- injected into every processRetentionOnce
// call below so these tests never depend on the real wall clock. Threshold
// math (3 months / 1 month) is done against this anchor, not real now().
const REFERENCE_TIME = new Date("2026-06-01T00:00:00.000Z");
const PLACEHOLDER = "Poistettu GDPR-syistä";

let providerId: string;
let serviceId: string;

beforeEach(async () => {
  ({ providerId, serviceId } = await resetAndSeed(pool));
});

afterAll(async () => {
  await closePool();
});

interface BookingStatusType {
  status: "pending" | "confirmed" | "cancelled";
}

async function createBookingWithCustomer(
  db: Pool,
  startAt: Date,
  endAt: Date,
  status: BookingStatusType["status"],
  customer: { name: string; email: string; phone: string } = {
    name: "Jane Doe",
    email: "jane@example.com",
    phone: "+1234567890",
  },
): Promise<{ bookingId: string; customerId: string }> {
  const customerResult = await db.query<{ id: string }>(
    `INSERT INTO customers (name, email, phone) VALUES ($1, $2, $3) RETURNING id`,
    [customer.name, customer.email, customer.phone],
  );
  const customerId = customerResult.rows[0].id;

  const bookingResult = await db.query<{ id: string }>(
    `INSERT INTO bookings (provider_id, service_id, customer_id, start_at, end_at, status)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [providerId, serviceId, customerId, startAt.toISOString(), endAt.toISOString(), status],
  );

  return { bookingId: bookingResult.rows[0].id, customerId };
}

async function createEmailJob(
  db: Pool,
  type: string,
  payload: Record<string, unknown>,
): Promise<string> {
  const result = await db.query<{ id: string }>(
    `INSERT INTO email_jobs (type, payload) VALUES ($1, $2::jsonb) RETURNING id`,
    [type, JSON.stringify(payload)],
  );
  return result.rows[0].id;
}

async function createBookingToken(db: Pool, bookingId: string): Promise<void> {
  await db.query(
    `INSERT INTO customer_booking_tokens (booking_id, token_hash) VALUES ($1, $2)`,
    [bookingId, `hash-${bookingId}`],
  );
}

function daysBefore(base: Date, days: number): Date {
  return new Date(base.getTime() - days * 24 * 60 * 60 * 1000);
}
function daysAfter(base: Date, days: number): Date {
  return new Date(base.getTime() + days * 24 * 60 * 60 * 1000);
}

// 3-month cutoff relative to REFERENCE_TIME.
const THREE_MONTHS_AGO = new Date("2026-03-01T00:00:00.000Z");
// 1-month cutoff relative to REFERENCE_TIME.
const ONE_MONTH_AGO = new Date("2026-05-01T00:00:00.000Z");

describe("processRetentionOnce", () => {
  describe("anonymize (confirmed, start_at > 3 months old)", () => {
    it("anonymizes a confirmed booking just past the 3-month threshold, keeping the booking row itself", async () => {
      const startAt = daysBefore(THREE_MONTHS_AGO, 1);
      const endAt = new Date(startAt.getTime() + 60 * 60_000);
      const { bookingId, customerId } = await createBookingWithCustomer(
        pool,
        startAt,
        endAt,
        "confirmed",
      );
      const jobId = await createEmailJob(pool, "booking_confirmed", {
        bookingId,
        customerName: "Jane Doe",
        customerEmail: "jane@example.com",
        serviceName: "Deep Tissue Massage",
        startAtLocal: "some local time",
        manageUrl: "https://example.com/manage/abc123",
      });

      const summary = await processRetentionOnce({ referenceTime: REFERENCE_TIME });

      expect(summary.anonymizedBookingIds).toEqual([bookingId]);
      expect(summary.deletedBookingIds).toEqual([]);

      const customerRow = await pool.query(
        `SELECT name, email, phone FROM customers WHERE id = $1`,
        [customerId],
      );
      expect(customerRow.rows[0]).toEqual({
        name: PLACEHOLDER,
        email: PLACEHOLDER,
        phone: PLACEHOLDER,
      });

      const bookingRow = await pool.query(
        `SELECT service_id, start_at, end_at, status FROM bookings WHERE id = $1`,
        [bookingId],
      );
      expect(bookingRow.rows).toHaveLength(1);
      expect(bookingRow.rows[0].service_id).toBe(serviceId);
      expect(bookingRow.rows[0].status).toBe("confirmed");

      const jobRow = await pool.query(`SELECT payload, status FROM email_jobs WHERE id = $1`, [
        jobId,
      ]);
      expect(jobRow.rows[0].payload.customerName).toBe(PLACEHOLDER);
      expect(jobRow.rows[0].payload.customerEmail).toBe(PLACEHOLDER);
      expect(jobRow.rows[0].payload.serviceName).toBe("Deep Tissue Massage");
      expect(jobRow.rows[0].payload.manageUrl).toBe("https://example.com/manage/abc123");
      expect(jobRow.rows[0].status).toBe("queued");
    });

    it("never touches a confirmed booking just under the 3-month threshold", async () => {
      const startAt = daysAfter(THREE_MONTHS_AGO, 1);
      const endAt = new Date(startAt.getTime() + 60 * 60_000);
      const { bookingId, customerId } = await createBookingWithCustomer(
        pool,
        startAt,
        endAt,
        "confirmed",
      );

      const summary = await processRetentionOnce({ referenceTime: REFERENCE_TIME });

      expect(summary.anonymizedBookingIds).toEqual([]);
      const customerRow = await pool.query(`SELECT name FROM customers WHERE id = $1`, [
        customerId,
      ]);
      expect(customerRow.rows[0].name).toBe("Jane Doe");
      const bookingRow = await pool.query(`SELECT id FROM bookings WHERE id = $1`, [bookingId]);
      expect(bookingRow.rows).toHaveLength(1);
    });

    it("leaves a masseur_booking_change_notice job untouched even though it shares the anonymized booking's id", async () => {
      const startAt = daysBefore(THREE_MONTHS_AGO, 1);
      const endAt = new Date(startAt.getTime() + 60 * 60_000);
      const { bookingId } = await createBookingWithCustomer(pool, startAt, endAt, "confirmed");
      const noticeJobId = await createEmailJob(pool, "masseur_booking_change_notice", {
        adminEmail: "admin@example.com",
        bookingId,
        serviceName: "Deep Tissue Massage",
        startAtLocal: "some local time",
        cancellationReason: null,
      });

      await processRetentionOnce({ referenceTime: REFERENCE_TIME });

      const jobRow = await pool.query(`SELECT payload FROM email_jobs WHERE id = $1`, [
        noticeJobId,
      ]);
      expect(jobRow.rows[0].payload).toEqual({
        adminEmail: "admin@example.com",
        bookingId,
        serviceName: "Deep Tissue Massage",
        startAtLocal: "some local time",
        cancellationReason: null,
      });
    });
  });

  describe("delete (pending/cancelled, start_at > 1 month old)", () => {
    it("deletes a pending booking just past the 1-month threshold, along with its tokens, customer, and matching email_jobs", async () => {
      const startAt = daysBefore(ONE_MONTH_AGO, 1);
      const endAt = new Date(startAt.getTime() + 60 * 60_000);
      const { bookingId, customerId } = await createBookingWithCustomer(
        pool,
        startAt,
        endAt,
        "pending",
      );
      await createBookingToken(pool, bookingId);
      const jobId = await createEmailJob(pool, "booking_request_received", {
        bookingId,
        customerName: "Jane Doe",
        customerEmail: "jane@example.com",
        serviceName: "Deep Tissue Massage",
        startAtLocal: "some local time",
        manageUrl: "https://example.com/manage/abc123",
      });

      const summary = await processRetentionOnce({ referenceTime: REFERENCE_TIME });

      expect(summary.deletedBookingIds).toEqual([bookingId]);
      expect(summary.anonymizedBookingIds).toEqual([]);

      const bookingRow = await pool.query(`SELECT id FROM bookings WHERE id = $1`, [bookingId]);
      expect(bookingRow.rows).toHaveLength(0);
      const tokenRow = await pool.query(
        `SELECT id FROM customer_booking_tokens WHERE booking_id = $1`,
        [bookingId],
      );
      expect(tokenRow.rows).toHaveLength(0);
      const customerRow = await pool.query(`SELECT id FROM customers WHERE id = $1`, [
        customerId,
      ]);
      expect(customerRow.rows).toHaveLength(0);
      const jobRow = await pool.query(`SELECT id FROM email_jobs WHERE id = $1`, [jobId]);
      expect(jobRow.rows).toHaveLength(0);
    });

    it("deletes a cancelled booking just past the 1-month threshold", async () => {
      const startAt = daysBefore(ONE_MONTH_AGO, 1);
      const endAt = new Date(startAt.getTime() + 60 * 60_000);
      const { bookingId } = await createBookingWithCustomer(pool, startAt, endAt, "cancelled");

      const summary = await processRetentionOnce({ referenceTime: REFERENCE_TIME });

      expect(summary.deletedBookingIds).toEqual([bookingId]);
      const bookingRow = await pool.query(`SELECT id FROM bookings WHERE id = $1`, [bookingId]);
      expect(bookingRow.rows).toHaveLength(0);
    });

    it("never touches a pending booking just under the 1-month threshold", async () => {
      const startAt = daysAfter(ONE_MONTH_AGO, 1);
      const endAt = new Date(startAt.getTime() + 60 * 60_000);
      const { bookingId } = await createBookingWithCustomer(pool, startAt, endAt, "pending");

      const summary = await processRetentionOnce({ referenceTime: REFERENCE_TIME });

      expect(summary.deletedBookingIds).toEqual([]);
      const bookingRow = await pool.query(`SELECT id FROM bookings WHERE id = $1`, [bookingId]);
      expect(bookingRow.rows).toHaveLength(1);
    });

    it("never touches a cancelled booking just under the 1-month threshold", async () => {
      const startAt = daysAfter(ONE_MONTH_AGO, 2);
      const endAt = new Date(startAt.getTime() + 60 * 60_000);
      const { bookingId } = await createBookingWithCustomer(pool, startAt, endAt, "cancelled");

      const summary = await processRetentionOnce({ referenceTime: REFERENCE_TIME });

      expect(summary.deletedBookingIds).toEqual([]);
      const bookingRow = await pool.query(`SELECT id FROM bookings WHERE id = $1`, [bookingId]);
      expect(bookingRow.rows).toHaveLength(1);
    });

    it("leaves a masseur_booking_change_notice job untouched even though it shares the deleted booking's id", async () => {
      const startAt = daysBefore(ONE_MONTH_AGO, 1);
      const endAt = new Date(startAt.getTime() + 60 * 60_000);
      const { bookingId } = await createBookingWithCustomer(pool, startAt, endAt, "cancelled");
      const noticeJobId = await createEmailJob(pool, "masseur_booking_change_notice", {
        adminEmail: "admin@example.com",
        bookingId,
        serviceName: "Deep Tissue Massage",
        startAtLocal: "some local time",
        cancellationReason: "cancelled by customer",
      });

      await processRetentionOnce({ referenceTime: REFERENCE_TIME });

      const jobRow = await pool.query(`SELECT id, payload FROM email_jobs WHERE id = $1`, [
        noticeJobId,
      ]);
      expect(jobRow.rows).toHaveLength(1);
      expect(jobRow.rows[0].payload.adminEmail).toBe("admin@example.com");
    });
  });

  describe("dry run", () => {
    it("reports what would happen without mutating anything", async () => {
      const anonymizeStartAt = daysBefore(THREE_MONTHS_AGO, 1);
      const anonymizeEndAt = new Date(anonymizeStartAt.getTime() + 60 * 60_000);
      const { bookingId: confirmedId, customerId } = await createBookingWithCustomer(
        pool,
        anonymizeStartAt,
        anonymizeEndAt,
        "confirmed",
      );

      const deleteStartAt = daysBefore(ONE_MONTH_AGO, 1);
      const deleteEndAt = new Date(deleteStartAt.getTime() + 60 * 60_000);
      const { bookingId: pendingId } = await createBookingWithCustomer(
        pool,
        deleteStartAt,
        deleteEndAt,
        "pending",
      );

      const summary = await processRetentionOnce({
        referenceTime: REFERENCE_TIME,
        dryRun: true,
      });

      expect(summary.dryRun).toBe(true);
      expect(summary.anonymizedBookingIds).toEqual([confirmedId]);
      expect(summary.deletedBookingIds).toEqual([pendingId]);

      const customerRow = await pool.query(`SELECT name FROM customers WHERE id = $1`, [
        customerId,
      ]);
      expect(customerRow.rows[0].name).toBe("Jane Doe");
      const bookingRow = await pool.query(`SELECT id FROM bookings WHERE id = $1`, [pendingId]);
      expect(bookingRow.rows).toHaveLength(1);
    });
  });

  describe("idempotency", () => {
    it("produces no further changes when run a second time with the same reference time", async () => {
      const anonymizeStartAt = daysBefore(THREE_MONTHS_AGO, 1);
      const anonymizeEndAt = new Date(anonymizeStartAt.getTime() + 60 * 60_000);
      await createBookingWithCustomer(pool, anonymizeStartAt, anonymizeEndAt, "confirmed");

      const deleteStartAt = daysBefore(ONE_MONTH_AGO, 1);
      const deleteEndAt = new Date(deleteStartAt.getTime() + 60 * 60_000);
      await createBookingWithCustomer(pool, deleteStartAt, deleteEndAt, "pending");

      const first = await processRetentionOnce({ referenceTime: REFERENCE_TIME });
      expect(first.anonymizedBookingIds).toHaveLength(1);
      expect(first.deletedBookingIds).toHaveLength(1);

      const second = await processRetentionOnce({ referenceTime: REFERENCE_TIME });
      expect(second.anonymizedBookingIds).toEqual([]);
      expect(second.deletedBookingIds).toEqual([]);
    });
  });
});

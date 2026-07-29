import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closePool, getPool } from "../../src/db/pool.js";
import { resetAndSeed } from "../helpers/fixtures.js";

// Requires DATABASE_URL to point at a disposable Postgres DB with migrations
// 001 and 002 already applied.
const pool = getPool();

let providerId: string;
let serviceId: string;
let customerId: string;

beforeEach(async () => {
  ({ providerId, serviceId } = await resetAndSeed(pool));
  const customerResult = await pool.query<{ id: string }>(
    `INSERT INTO customers (name, email, phone) VALUES ('Jane Doe', 'jane@example.com', '+1234567890') RETURNING id`,
  );
  customerId = customerResult.rows[0].id;
});

afterAll(async () => {
  await closePool();
});

describe("bookings exclusion constraint (direct SQL, bypassing the application layer)", () => {
  it("rejects a direct overlapping insert", async () => {
    const startAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const endAt = new Date(startAt.getTime() + 60 * 60_000);

    await pool.query(
      `INSERT INTO bookings (provider_id, service_id, customer_id, start_at, end_at, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')`,
      [providerId, serviceId, customerId, startAt.toISOString(), endAt.toISOString()],
    );

    const overlappingStart = new Date(startAt.getTime() + 30 * 60_000);
    const overlappingEnd = new Date(overlappingStart.getTime() + 60 * 60_000);

    await expect(
      pool.query(
        `INSERT INTO bookings (provider_id, service_id, customer_id, start_at, end_at, status)
         VALUES ($1, $2, $3, $4, $5, 'pending')`,
        [
          providerId,
          serviceId,
          customerId,
          overlappingStart.toISOString(),
          overlappingEnd.toISOString(),
        ],
      ),
    ).rejects.toThrow(/exclusion/i);
  });

  it("does not count a cancelled booking toward the exclusion constraint", async () => {
    const startAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const endAt = new Date(startAt.getTime() + 60 * 60_000);

    await pool.query(
      `INSERT INTO bookings (provider_id, service_id, customer_id, start_at, end_at, status)
       VALUES ($1, $2, $3, $4, $5, 'cancelled')`,
      [providerId, serviceId, customerId, startAt.toISOString(), endAt.toISOString()],
    );

    await expect(
      pool.query(
        `INSERT INTO bookings (provider_id, service_id, customer_id, start_at, end_at, status)
         VALUES ($1, $2, $3, $4, $5, 'pending')`,
        [providerId, serviceId, customerId, startAt.toISOString(), endAt.toISOString()],
      ),
    ).resolves.toBeDefined();
  });
});

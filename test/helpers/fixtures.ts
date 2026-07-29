import type { Pool } from "pg";

/**
 * Integration tests get a Provider/Service to book against via fixture rows
 * inserted here in beforeEach — there is no seed migration. Migrations only
 * create schema (tables, constraints, extensions); they never insert rows.
 */
export async function resetAndSeed(pool: Pool): Promise<{ providerId: string; serviceId: string }> {
  await pool.query("DELETE FROM email_jobs");
  await pool.query("DELETE FROM bookings");
  await pool.query("DELETE FROM customers");
  await pool.query("DELETE FROM services");
  await pool.query("DELETE FROM providers");

  const providerResult = await pool.query<{ id: string }>(
    `INSERT INTO providers (name) VALUES ('Test Masseur') RETURNING id`,
  );
  const providerId = providerResult.rows[0].id;

  const serviceResult = await pool.query<{ id: string }>(
    `INSERT INTO services (provider_id, duration_minutes, buffer_before_minutes, buffer_after_minutes, active)
     VALUES ($1, 60, 0, 15, true) RETURNING id`,
    [providerId],
  );
  const serviceId = serviceResult.rows[0].id;

  return { providerId, serviceId };
}

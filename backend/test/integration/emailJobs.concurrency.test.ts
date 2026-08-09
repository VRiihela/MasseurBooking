import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { closePool, getPool } from "../../src/db/pool.js";
import { claimQueuedJobs, processJobsOnce } from "../../src/services/emailWorker.js";

// Requires DATABASE_URL to point at a disposable Postgres DB with migrations
// 001-005 already applied.
const pool = getPool();

async function insertQueuedJob(payload: Record<string, unknown> = {}): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO email_jobs (type, payload) VALUES ('booking_confirmed', $1::jsonb) RETURNING id`,
    [JSON.stringify(payload)],
  );
  return result.rows[0].id;
}

async function insertStaleSendingJob(minutesAgo: number): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO email_jobs (type, payload, status, claimed_at)
     VALUES ('booking_confirmed', '{}'::jsonb, 'sending', now() - ($1 || ' minutes')::interval)
     RETURNING id`,
    [minutesAgo],
  );
  return result.rows[0].id;
}

beforeEach(async () => {
  await pool.query("DELETE FROM email_jobs");
});

afterEach(async () => {
  await pool.query("DELETE FROM email_jobs");
});

afterAll(async () => {
  await closePool();
});

describe("claimQueuedJobs concurrency", () => {
  it("claims every job exactly once across two concurrent racing claims", async () => {
    const ids = await Promise.all(Array.from({ length: 10 }, () => insertQueuedJob()));

    const [batchA, batchB] = await Promise.all([claimQueuedJobs(6), claimQueuedJobs(6)]);

    const claimedIds = [...batchA, ...batchB].map((job) => job.id);
    expect(new Set(claimedIds).size).toBe(claimedIds.length); // no duplicates
    expect(claimedIds.sort()).toEqual([...ids].sort()); // every job claimed, none missed

    const statusResult = await pool.query<{ status: string }>(
      `SELECT status FROM email_jobs WHERE id = ANY($1)`,
      [ids],
    );
    expect(statusResult.rows.every((row) => row.status === "sending")).toBe(true);
  });

  it("reclaims a job stuck in 'sending' past the stale-claim window", async () => {
    const staleId = await insertStaleSendingJob(10); // older than the 5-minute threshold

    const claimed = await claimQueuedJobs(10);

    expect(claimed.map((job) => job.id)).toContain(staleId);
  });

  it("does not reclaim a job still within the stale-claim window", async () => {
    const freshId = await insertStaleSendingJob(1); // within the 5-minute threshold

    const claimed = await claimQueuedJobs(10);

    expect(claimed.map((job) => job.id)).not.toContain(freshId);
  });
});

describe("processJobsOnce", () => {
  it("commits the claim before calling the sender -- no DB connection is held during send", async () => {
    await insertQueuedJob({
      bookingId: "b1",
      customerEmail: "jane@example.com",
      customerName: "Jane",
      serviceName: "Massage",
      startAtLocal: "Monday at 9am",
    });

    let checkedOutDuringSend = -1;
    const sender = {
      send: async () => {
        checkedOutDuringSend = pool.totalCount - pool.idleCount;
      },
    };

    await processJobsOnce(sender, 10);

    expect(checkedOutDuringSend).toBe(0);

    const result = await pool.query<{ status: string; sent_at: Date | null }>(
      `SELECT status, sent_at FROM email_jobs`,
    );
    expect(result.rows[0].status).toBe("sent");
    expect(result.rows[0].sent_at).not.toBeNull();
  });
});

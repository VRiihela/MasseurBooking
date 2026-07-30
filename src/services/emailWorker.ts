import { getPool } from "../db/pool.js";
import type { BookingEmailPayload, EmailJobType } from "../db/types.js";
import type { EmailSender } from "./emailSender.js";
import { renderEmail } from "./emailTemplates.js";

const MAX_ATTEMPTS = 5;
const CLAIM_STALE_MS = 5 * 60_000;
const BACKOFF_BASE_MS = 60_000;
const BACKOFF_CAP_MS = 30 * 60_000;

export interface ClaimedEmailJob {
  id: string;
  type: EmailJobType;
  payload: BookingEmailPayload;
  attempts: number;
}

interface EmailJobRow {
  id: string;
  type: EmailJobType;
  payload: BookingEmailPayload;
  attempts: number;
}

function backoffDelayMs(attempts: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** (attempts - 1), BACKOFF_CAP_MS);
}

/**
 * Claims up to `batchSize` jobs via UPDATE ... WHERE id IN (SELECT ... FOR
 * UPDATE SKIP LOCKED). This is a single statement, so it's atomic and
 * commits on its own (no explicit BEGIN/COMMIT, no checked-out client held
 * afterwards) -- the external send always happens after this has already
 * returned. Matches jobs that are either due for their first/next attempt
 * ('queued' with next_attempt_at <= now()) or stuck mid-flight from a
 * crashed worker ('sending' with a stale claimed_at).
 */
export async function claimQueuedJobs(batchSize: number): Promise<ClaimedEmailJob[]> {
  const result = await getPool().query<EmailJobRow>(
    `UPDATE email_jobs
     SET status = 'sending', claimed_at = now()
     WHERE id IN (
       SELECT id FROM email_jobs
       WHERE (status = 'queued' AND next_attempt_at <= now())
          OR (status = 'sending' AND claimed_at < now() - ($2 || ' milliseconds')::interval)
       ORDER BY created_at
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     RETURNING id, type, payload, attempts`,
    [batchSize, CLAIM_STALE_MS],
  );
  return result.rows;
}

export async function markJobSent(id: string): Promise<void> {
  await getPool().query(
    `UPDATE email_jobs SET status = 'sent', sent_at = now(), claimed_at = NULL WHERE id = $1`,
    [id],
  );
}

export async function markJobFailedAttempt(id: string, currentAttempts: number, error: string): Promise<void> {
  const attempts = currentAttempts + 1;
  if (attempts >= MAX_ATTEMPTS) {
    await getPool().query(
      `UPDATE email_jobs SET status = 'failed', attempts = $2, last_error = $3, claimed_at = NULL WHERE id = $1`,
      [id, attempts, error],
    );
    return;
  }

  await getPool().query(
    `UPDATE email_jobs
     SET status = 'queued', attempts = $2, last_error = $3, claimed_at = NULL,
         next_attempt_at = now() + ($4 || ' milliseconds')::interval
     WHERE id = $1`,
    [id, attempts, error, backoffDelayMs(attempts)],
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function processJobsOnce(sender: EmailSender, batchSize = 10): Promise<void> {
  const jobs = await claimQueuedJobs(batchSize);

  await Promise.all(
    jobs.map(async (job) => {
      try {
        const message = renderEmail(job.type, job.payload);
        await sender.send(message);
        await markJobSent(job.id);
      } catch (error) {
        // Log only the job id and error -- never the full rendered email
        // body, which carries customer PII.
        console.error(`email job ${job.id} failed: ${errorMessage(error)}`);
        await markJobFailedAttempt(job.id, job.attempts, errorMessage(error));
      }
    }),
  );
}

export interface EmailWorkerHandle {
  stop(): void;
}

export function startEmailWorker(
  sender: EmailSender,
  options: { intervalMs?: number; batchSize?: number } = {},
): EmailWorkerHandle {
  const intervalMs = options.intervalMs ?? 5_000;
  const batchSize = options.batchSize ?? 10;

  const timer = setInterval(() => {
    processJobsOnce(sender, batchSize).catch((error) => {
      console.error(`email worker poll failed: ${errorMessage(error)}`);
    });
  }, intervalMs);

  return {
    stop: () => clearInterval(timer),
  };
}

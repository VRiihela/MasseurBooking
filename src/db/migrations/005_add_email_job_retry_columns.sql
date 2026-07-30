-- Service name is needed in email payloads (005) but was never added in 001.
ALTER TABLE services
  ADD COLUMN name TEXT NOT NULL DEFAULT 'Massage Session';

-- Retry/claim tracking for the email worker. 'sending' is a new transient
-- state: a job claimed by a worker but not yet resolved. A job stuck in
-- 'sending' with a stale claimed_at is reclaimed by the next poll (see
-- emailWorker.ts) so a crashed worker never leaves a job stuck forever.
ALTER TABLE email_jobs
  ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN last_error TEXT,
  ADD COLUMN sent_at TIMESTAMPTZ,
  ADD COLUMN next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN claimed_at TIMESTAMPTZ;

ALTER TABLE email_jobs
  DROP CONSTRAINT email_jobs_status_check;

ALTER TABLE email_jobs
  ADD CONSTRAINT email_jobs_status_check
  CHECK (status IN ('queued', 'sending', 'sent', 'failed'));

CREATE INDEX email_jobs_status_next_attempt_idx
  ON email_jobs (status, next_attempt_at);

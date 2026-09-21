import { closePool } from "../db/pool.js";
import { processRetentionOnce } from "../services/retentionWorker.js";

/**
 * One-off manual invocation, not wired into any schedule or route -- lets
 * Ville validate the retention sweep's query logic against real production
 * data (what it WOULD anonymize/delete) before trusting the scheduled
 * version, since the delete path is irreversible. Run via:
 *   npm run retention:dry-run
 */
processRetentionOnce({ dryRun: true })
  .then((summary) => {
    console.log(JSON.stringify(summary, null, 2));
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => closePool());

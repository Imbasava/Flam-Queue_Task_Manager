// src/worker/worker.js
const { init } = require("../db/database");
const { runCommand } = require("../exec/runner");
const { getConfig } = require("../storage/config");

async function runWorker() {
  console.log(`👷 Worker started (pid=${process.pid})...`);

  const db = init();
  let running = true;

  // Graceful shutdown flag
  process.on("SIGINT", () => {
    console.log("\n🛑 Graceful shutdown requested...");
    running = false;
  });
  process.on("SIGTERM", () => {
    console.log("\n🛑 Graceful shutdown requested...");
    running = false;
  });

  // ----------------------------
  // Recovery: reset stale 'processing' jobs
  // ----------------------------
  try {
    // threshold in minutes
    const thresholdMinutes = parseInt(getConfig("stuck-job-threshold") || "10", 10);
    const cutoffTime = new Date(Date.now() - thresholdMinutes * 60 * 1000).toISOString();
    const now = new Date().toISOString();

    const info = db
      .prepare(
        `UPDATE jobs
         SET state='pending',
             run_after=@now,
             updated_at=@now,
             worker_id = NULL
         WHERE state='processing' AND updated_at <= @cutoff`
      )
      .run({ now, cutoff: cutoffTime });

    if (info.changes > 0) {
      console.log(`♻️  Recovery: reset ${info.changes} stuck 'processing' job(s) to 'pending'`);
    }
  } catch (err) {
    console.error("Recovery step failed:", err);
  }

  // ----------------------------
  // Main worker loop
  // ----------------------------
  while (running) {
    const now = new Date().toISOString();

    // Claim one pending job atomically and set worker_id
    const claimStmt = db.prepare(`
      UPDATE jobs
      SET state='processing',
          attempts = attempts + 1,
          worker_id = @pid,
          updated_at = @now
      WHERE id = (
        SELECT id FROM jobs
WHERE state='pending' AND run_after <= @now
ORDER BY priority DESC, created_at ASC
LIMIT 1

      )
      RETURNING *;
    `);

    const job = claimStmt.get({ now, pid: String(process.pid) });

    if (!job) {
      // No job ready → sleep
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }

    console.log(`🚀 Processing job: ${job.id} (${job.command}) [attempt ${job.attempts + 0}]`);

    // Read runtime config values
    const globalMaxRetries = parseInt(getConfig("max-retries") || "3", 10);
    const base = parseInt(getConfig("backoff-base") || "2", 10);
    const jobTimeoutSec = parseInt(getConfig("job-timeout") || "60", 10); // seconds

    // Execute the command with timeout
    let result;
    try {
      result = await runCommand(job, jobTimeoutSec);
    } catch (err) {
      // unexpected runner error
      result = { code: 1, stdout: "", stderr: String(err), timedOut: false };
    }

    const updated_at = new Date().toISOString();

    // Normalize attempts (since we incremented attempts in claim SQL, job.attempts already incremented in returned job only in DB)
    // Note: the returned `job.attempts` may be the value *before* increment depending on SQLite version - but we incremented in SQL, so use DB to fetch updated attempts if necessary.
    // For safety, let's read current attempts from DB:
    const fresh = db.prepare("SELECT attempts, max_retries FROM jobs WHERE id = ?").get(job.id);
    const attempts = fresh ? fresh.attempts : job.attempts;
    const maxRetries = job.max_retries || globalMaxRetries;

    // Successful execution
    if (result.code === 0 && !result.timedOut) {
      db.prepare(
        `UPDATE jobs
         SET state='completed',
             updated_at = @updated_at,
             stdout = @stdout,
             stderr = @stderr
         WHERE id = @id`
      ).run({
        id: job.id,
        updated_at,
        stdout: result.stdout,
        stderr: result.stderr,
      });
      console.log(`✅ Job completed: ${job.id}`);
    } else {
      // Build last_error message
      let lastError = result.stderr || `exit_code=${result.code}`;
      if (result.timedOut) {
        lastError = `timed out after ${jobTimeoutSec}s`;
      }

      if (attempts < maxRetries) {
        const delaySeconds = Math.pow(base, attempts); // attempts already incremented in DB
        const run_after = new Date(Date.now() + delaySeconds * 1000).toISOString();

        db.prepare(
          `UPDATE jobs
           SET state='pending',
               run_after=@run_after,
               updated_at=@updated_at,
               last_error=@last_error,
               stdout=@stdout,
               stderr=@stderr,
               worker_id = NULL
           WHERE id=@id`
        ).run({
          id: job.id,
          run_after,
          updated_at,
          last_error,
          stdout: result.stdout,
          stderr: result.stderr,
        });

        console.log(`⚠️ Job failed (will retry in ${delaySeconds}s): ${job.id}`);
      } else {
        // Move to DLQ (dead)
        db.prepare(
          `UPDATE jobs
           SET state='dead',
               updated_at=@updated_at,
               last_error=@last_error,
               stdout=@stdout,
               stderr=@stderr,
               worker_id = NULL
           WHERE id=@id`
        ).run({
          id: job.id,
          updated_at,
          last_error,
          stdout: result.stdout,
          stderr: result.stderr,
        });

        console.log(`💀 Job moved to DLQ: ${job.id}`);
      }
    }
  } // end while

  db.close();
  console.log("👋 Worker stopped gracefully.");
}

module.exports = { runWorker };

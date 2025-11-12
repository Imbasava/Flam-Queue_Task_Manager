#!/usr/bin/env node
/**
 * queuectl CLI
 * -------------
 * Supports:
 *   - queuectl enqueue '{"command":"echo Hello"}'
 *   - queuectl worker start --count 3
 */

const { Command } = require("commander");
const { insertJob } = require("./storage/jobs");
const { init } = require("./db/database");

// Initialize DB and migrations before CLI runs
init();

const program = new Command();

program
  .name("queuectl")
  .description("CLI background job queue manager")
  .version("0.1.0");

// =============================================================
// ENQUEUE COMMAND
// =============================================================
program
  .command("enqueue <jobJson>")
  .description("Add a new job to the queue (supports delay & priority)")
  .action((jobJson) => {
    try {
      const data = JSON.parse(jobJson);

      if (!data.command) {
        console.error("❌ Missing required field: 'command'");
        process.exit(1);
      }

      // --- Scheduled / Delayed Jobs (in seconds) ---
      if (data.delay) {
        const delayMs = Number(data.delay) * 1000;
        data.run_after = new Date(Date.now() + delayMs).toISOString();
      }

      // --- Job Priority (0 = normal, higher = more urgent) ---
      if (data.priority && typeof data.priority !== "number") {
        console.warn("⚠️  Priority must be a number. Defaulting to 0.");
        data.priority = 0;
      }

      const job = insertJob(data);
      console.log(
        `✅ Job enqueued: ${job.id} | command="${job.command}"${
          data.delay ? ` | delay=${data.delay}s` : ""
        }${data.priority ? ` | priority=${data.priority}` : ""}`
      );
    } catch (err) {
      console.error("❌ Failed to enqueue job:", err.message);
      process.exit(1);
    }
  });
// =============================================================
// WORKER COMMANDS
// =============================================================

// Subcommand group: queuectl worker ...
const workerCommand = program
  .command("worker")
  .description("Worker management commands");

// queuectl worker start --count 3
workerCommand
  .command("start")
  .description("Start one or more worker processes")
  .option("--count <n>", "Number of worker processes", "1")
  .action((opts) => {
    const count = parseInt(opts.count, 10) || 1;
    console.log(`Starting ${count} worker process(es)...`);
    const { startWorkers } = require("./worker/manager");
    startWorkers(count);
  });

// (Optional placeholder for future commands: stop, status, etc.)
// =============================================================

// Parse CLI arguments


// =============================================================
// DLQ COMMANDS
// =============================================================
const {
  listDeadJobs,
  retryDeadJob,
  purgeDeadJobs,
} = require("./storage/jobs");

// queuectl dlq list
program
  .command("dlq:list")
  .description("List all jobs in the Dead Letter Queue (state='dead')")
  .action(() => {
    const jobs = listDeadJobs();
    if (jobs.length === 0) {
      console.log("✅ DLQ is empty — no dead jobs.");
    } else {
      console.log(`🪦 Dead Letter Queue — ${jobs.length} job(s):`);
      for (const job of jobs) {
        console.log(
          `• ${job.id} | command: ${job.command} | attempts: ${job.attempts} | error: ${job.last_error || "none"}`
        );
      }
    }
  });

// queuectl dlq retry <jobId>
program
  .command("dlq:retry <jobId>")
  .description("Retry a dead job (move back to pending)")
  .action((jobId) => {
    const success = retryDeadJob(jobId);
    if (success) {
      console.log(`🔄 Job ${jobId} moved back to pending state.`);
    } else {
      console.log(`❌ Job ${jobId} not found or not dead.`);
    }
  });

// queuectl dlq purge [jobId]
program
  .command("dlq:purge [jobId]")
  .description("Permanently delete a dead job (or all if no ID provided)")
  .action((jobId) => {
    const deleted = purgeDeadJobs(jobId);
    if (deleted > 0) {
      if (jobId) console.log(`🧹 Deleted dead job ${jobId}.`);
      else console.log(`🧹 Purged ${deleted} job(s) from DLQ.`);
    } else {
      console.log("✅ No dead jobs found to delete.");
    }
  });

  // =============================================================
// CONFIG COMMANDS
// =============================================================
const {
  getConfig,
  setConfig,
  listConfig,
  resetConfig,
} = require("./storage/config");

// queuectl config set <key> <value>
program
  .command("config:set <key> <value>")
  .description("Set or update a configuration value (e.g. max-retries, backoff-base)")
  .action((key, value) => {
    setConfig(key, value);
    console.log(`⚙️ Config updated: ${key} = ${value}`);
  });

// queuectl config get [key]
program
  .command("config:get [key]")
  .description("Show configuration value(s)")
  .action((key) => {
    if (key) {
      const val = getConfig(key);
      if (val) console.log(`• ${key} = ${val}`);
      else console.log(`⚠️ No value set for '${key}'`);
    } else {
      const rows = listConfig();
      if (rows.length === 0) console.log("✅ No config values set yet.");
      else {
        console.log("⚙️ Current Configuration:");
        rows.forEach((r) => console.log(`• ${r.key} = ${r.value}`));
      }
    }
  });

// queuectl config reset
program
  .command("config:reset")
  .description("Clear all configuration values")
  .action(() => {
    const deleted = resetConfig();
    console.log(`🧹 Cleared ${deleted} configuration entries.`);
  });


  // =============================================================
// STATUS AND JOB LIST COMMANDS
// =============================================================
const { listJobs } = require("./storage/jobs");
const Database = require("better-sqlite3");
const path = require("path");
const { DB_PATH } = require("./db/database");

// --- STATUS COMMAND ---
program
  .command("status")
  .description("Show summary of job states & active workers")
  .action(() => {
    const db = new Database(DB_PATH);

    // Count jobs by state
    const rows = db
      .prepare("SELECT state, COUNT(*) AS count FROM jobs GROUP BY state")
      .all();

    const summary = {};
    for (const row of rows) summary[row.state] = row.count;

    console.log("\n📊 QueueCTL System Status");
    console.log("─────────────────────────────");
    console.log("Jobs Summary:");
    console.log(`• pending     : ${summary.pending || 0}`);
    console.log(`• processing  : ${summary.processing || 0}`);
    console.log(`• completed   : ${summary.completed || 0}`);
    console.log(`• failed      : ${summary.failed || 0}`);
    console.log(`• dead (DLQ)  : ${summary.dead || 0}`);

    // Optional: Count active workers via pid files in future
    console.log(`\nActive Workers : (dynamic count coming soon)`);

    db.close();
  });

// --- LIST COMMAND ---
program
  .command("list")
  .description("List jobs by state (or all)")
  .option("--state <state>", "Filter jobs by state (pending, completed, etc.)")
  .option("--limit <n>", "Limit number of results", "10")
  .action((opts) => {
    const state = opts.state;
    const limit = parseInt(opts.limit, 10);
    const jobs = listJobs(state);

    if (!jobs.length) {
      console.log(state ? `✅ No jobs found in state '${state}'.` : "✅ No jobs found.");
      return;
    }

    console.log(
      `\n📋 Job List (${state ? state : "all"}) — showing up to ${limit} job(s):`
    );
    console.log("─────────────────────────────");

    for (const job of jobs.slice(0, limit)) {
      console.log(
        `• ID: ${job.id}\n  Command: ${job.command}\n  State: ${job.state}\n  Attempts: ${job.attempts}/${job.max_retries}\n  Created: ${job.created_at}\n  Updated: ${job.updated_at}\n`
      );
    }
  });



program.parse(process.argv);

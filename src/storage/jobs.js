const { v4: uuidv4 } = require("uuid");
const { init } = require("../db/database");

function insertJob(jobData) {
  const db = init();

  // defaults
  const now = new Date().toISOString();
  const job = {
    priority: jobData.priority || 0,
    id: jobData.id || uuidv4(),
    command: jobData.command,
    state: "pending",
    attempts: 0,
    max_retries: jobData.max_retries || 3,
    created_at: now,
    updated_at: now,
    run_after: now,
    last_error: null,
    worker_id: null,
    stdout: null,
    stderr: null,
  };

  const stmt = db.prepare(`
  INSERT INTO jobs (
    id, command, state, attempts, max_retries,
    created_at, updated_at, run_after, last_error,
    worker_id, stdout, stderr, priority
  ) VALUES (
    @id, @command, @state, @attempts, @max_retries,
    @created_at, @updated_at, @run_after, @last_error,
    @worker_id, @stdout, @stderr, @priority
  )
`);

  stmt.run(job);
  db.close();
  return job;
}

function getJob(id) {
  const db = init();
  const job = db.prepare("SELECT * FROM jobs WHERE id = ?").get(id);
  db.close();
  return job;
}

function listJobs(state) {
  const db = init();
  let jobs;

  if (state) {
    const stmt = db.prepare("SELECT * FROM jobs WHERE state = ? ORDER BY created_at DESC");
    jobs = stmt.all(state);
  } else {
    const stmt = db.prepare("SELECT * FROM jobs ORDER BY created_at DESC");
    jobs = stmt.all(); // <-- no parameters here!
  }

  db.close();
  return jobs;
}


function updateJob(id, fields) {
  const db = init();
  const keys = Object.keys(fields);
  const setClause = keys.map(k => `${k} = @${k}`).join(", ");
  const stmt = db.prepare(`UPDATE jobs SET ${setClause} WHERE id = @id`);
  stmt.run({ id, ...fields });
  db.close();


}

// =============================================================
// DLQ (Dead Letter Queue) Helper Functions
// =============================================================

function listDeadJobs() {
  const db = init();
  const stmt = db.prepare("SELECT * FROM jobs WHERE state='dead' ORDER BY updated_at DESC");
  const jobs = stmt.all();
  db.close();
  return jobs;
}

function retryDeadJob(id) {
  const db = init();
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    UPDATE jobs
    SET state='pending',
        attempts=0,
        run_after=@now,
        last_error=NULL,
        updated_at=@now
    WHERE id=@id AND state='dead'
  `);
  const info = stmt.run({ id, now });
  db.close();
  return info.changes > 0;
}

function purgeDeadJobs(jobId = null) {
  const db = init();
  const stmt = jobId
    ? db.prepare("DELETE FROM jobs WHERE id=@id AND state='dead'")
    : db.prepare("DELETE FROM jobs WHERE state='dead'");
  const info = jobId ? stmt.run({ id: jobId }) : stmt.run();
  db.close();
  return info.changes;
}

// Add these to exports
module.exports = {
  insertJob,
  getJob,
  listJobs,
  updateJob,
  listDeadJobs,
  retryDeadJob,
  purgeDeadJobs,
};


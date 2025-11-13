// src/exec/runner.js
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

/**
 * Run the job.command in a shell, stream stdout/stderr to a per-job log,
 * and enforce an optional timeout (seconds). Returns an object:
 * { code: number|null, stdout: string, stderr: string, timedOut: boolean }
 */
async function runCommand(job, timeoutSeconds = null) {
  return new Promise((resolve) => {
    const logDir = path.resolve(__dirname, "../../logs");
    fs.mkdirSync(logDir, { recursive: true });
    const logPath = path.resolve(logDir, `${job.id}.log`);

    const child = spawn(job.command, {
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let timer = null;

    // append initial header to the job log
    try {
      fs.appendFileSync(logPath, `\n=== Run at ${new Date().toISOString()} ===\n`);
    } catch (e) {
      // ignore logging errors
    }

    child.stdout.on("data", (chunk) => {
      const s = chunk.toString();
      stdout += s;
      try { fs.appendFileSync(logPath, s); } catch (e) {}
    });

    child.stderr.on("data", (chunk) => {
      const s = chunk.toString();
      stderr += s;
      try { fs.appendFileSync(logPath, s); } catch (e) {}
    });

    // Setup timeout if requested
    if (timeoutSeconds && Number(timeoutSeconds) > 0) {
      const timeoutMs = Number(timeoutSeconds) * 1000;
      timer = setTimeout(() => {
        timedOut = true;
        try {
          // force kill
          child.kill("SIGKILL");
        } catch (e) {
          // ignore
        }
      }, timeoutMs);
    }

    child.on("close", (code, signal) => {
      if (timer) clearTimeout(timer);
      // append footer
      try {
        fs.appendFileSync(
          logPath,
          `\n=== Exit code: ${code} | signal: ${signal} | timedOut: ${timedOut} ===\n`
        );
      } catch (e) {}
      // If process was killed by timeout it may return null code; we still propagate timedOut flag.
      resolve({ code, stdout, stderr, timedOut });
    });

    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      try {
        fs.appendFileSync(logPath, `\n=== Error: ${err.message} ===\n`);
      } catch (e) {}
      resolve({ code: 1, stdout, stderr: stderr + "\n" + err.message, timedOut: false });
    });
  });
}

module.exports = { runCommand };

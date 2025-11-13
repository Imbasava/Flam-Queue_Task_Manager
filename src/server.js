#!/usr/bin/env node
const express = require("express");
const Database = require("better-sqlite3");
const path = require("path");
const { DB_PATH } = require("./db/database");

const app = express();
const PORT = process.env.PORT || 8080;

// Serve static assets (none yet, but good practice)
app.use(express.static(path.join(__dirname, "public")));

// --- API Endpoint: Summary Stats ---
app.get("/api/stats", (req, res) => {
  const db = new Database(DB_PATH);
  const total = db.prepare("SELECT COUNT(*) as c FROM jobs").get().c;
  const states = db.prepare("SELECT state, COUNT(*) as c FROM jobs GROUP BY state").all();
  const dlq = db
    .prepare(
      "SELECT id, command, attempts, last_error, updated_at FROM jobs WHERE state='dead' ORDER BY updated_at DESC LIMIT 5"
    )
    .all();
  db.close();
  res.json({ total, states, dlq });
});

// --- API Endpoint: List Jobs by State ---
app.get("/api/jobs/:state", (req, res) => {
  const db = new Database(DB_PATH);
  const jobs = db
    .prepare(
      "SELECT id, command, attempts, max_retries, updated_at FROM jobs WHERE state = ? ORDER BY updated_at DESC LIMIT 20"
    )
    .all(req.params.state);
  db.close();
  res.json(jobs);
});

// --- Web UI ---
app.get("/", (req, res) => {
  res.send(`
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="UTF-8" />
    <title>QueueCTL Dashboard</title>
    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">
    <style>
      .collapsible { cursor: pointer; }
      .content { display: none; padding-top: 8px; }
    </style>
  </head>
  <body class="bg-gray-50 text-gray-800">
    <div class="max-w-6xl mx-auto mt-10">
      <h1 class="text-3xl font-bold text-indigo-700 mb-4 text-center">📊 QueueCTL Dashboard (Live)</h1>

      <div class="grid grid-cols-2 gap-6">
        <!-- Chart Section -->
        <div class="bg-white p-6 rounded-xl shadow">
          <h2 class="text-lg font-semibold mb-3">Job Summary</h2>
          <canvas id="stateChart" height="180"></canvas>
          <p class="mt-4 text-gray-500" id="totalJobs"></p>
        </div>

        <!-- DLQ Section -->
        <div class="bg-white p-6 rounded-xl shadow">
          <h2 class="text-lg font-semibold mb-3">Dead Letter Queue (Recent)</h2>
          <table class="table-auto w-full text-sm" id="dlqTable">
            <thead><tr class="border-b"><th>ID</th><th>Command</th><th>Attempts</th><th>Error</th></tr></thead>
            <tbody></tbody>
          </table>
        </div>
      </div>

      <!-- Expandable Lists -->
      <div class="mt-10 bg-white p-6 rounded-xl shadow">
        <h2 class="text-lg font-semibold mb-3">Job Lists by State</h2>
        <div id="jobLists"></div>
      </div>
    </div>

    <script>
      let chart;
      async function fetchStats() {
        const res = await fetch('/api/stats');
        const data = await res.json();
        const labels = data.states.map(s => s.state);
        const values = data.states.map(s => s.c);

        if (!chart) {
          const ctx = document.getElementById('stateChart').getContext('2d');
          chart = new Chart(ctx, {
            type: 'doughnut',
            data: { labels, datasets: [{ data: values, backgroundColor: ['#60a5fa','#34d399','#fbbf24','#f87171','#a78bfa'] }] },
            options: { plugins: { legend: { position: 'bottom' } } }
          });
        } else {
          chart.data.labels = labels;
          chart.data.datasets[0].data = values;
          chart.update();
        }

        document.getElementById('totalJobs').textContent = 'Total Jobs: ' + data.total;

        // Update DLQ table
        const tbody = document.querySelector('#dlqTable tbody');
        tbody.innerHTML = data.dlq.map(d => 
          \`<tr class="border-b"><td>\${d.id.slice(0,6)}...</td><td>\${d.command}</td><td class="text-center">\${d.attempts}</td><td class="text-red-600">\${d.last_error || ''}</td></tr>\`
        ).join('');
      }

      async function fetchJobLists() {
        const states = ['pending','processing','completed','dead'];
        const container = document.getElementById('jobLists');
        container.innerHTML = '';
        for (const state of states) {
          const res = await fetch('/api/jobs/' + state);
          const jobs = await res.json();
          const rows = jobs.map(j => 
            \`<tr class="border-b"><td>\${j.id.slice(0,6)}...</td><td>\${j.command}</td><td class="text-center">\${j.attempts}/\${j.max_retries}</td><td>\${j.updated_at}</td></tr>\`
          ).join('');
          container.innerHTML += \`
            <div class="mb-3">
              <h3 class="collapsible font-semibold text-indigo-700">▶ \${state.toUpperCase()} (\${jobs.length})</h3>
              <div class="content"><table class="table-auto w-full text-sm mt-2"><thead><tr class="border-b"><th>ID</th><th>Command</th><th>Attempts</th><th>Updated</th></tr></thead><tbody>\${rows}</tbody></table></div>
            </div>\`;
        }

        // Attach collapsible behavior
        document.querySelectorAll('.collapsible').forEach(btn => {
          btn.onclick = () => {
            btn.classList.toggle('open');
            const content = btn.nextElementSibling;
            content.style.display = content.style.display === 'block' ? 'none' : 'block';
            btn.textContent = (content.style.display === 'block' ? '▼ ' : '▶ ') + btn.textContent.slice(2);
          };
        });
      }

      async function refresh() {
        await fetchStats();
        await fetchJobLists();
      }

      // Auto-refresh every 5 seconds
      refresh();
      setInterval(refresh, 5000);
    </script>
  </body>
  </html>
  `);
});

app.listen(PORT, () => {
  console.log(`🚀 QueueCTL Dashboard running at http://localhost:${PORT}`);

});
gi
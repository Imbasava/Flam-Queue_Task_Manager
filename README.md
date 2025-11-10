# 🧩 QueueCTL

A CLI-based background job queue system that supports multiple workers, retries with exponential backoff, and a Dead Letter Queue (DLQ). Built using Node.js + SQLite.

---

## 🚀 Features

- ✅ Enqueue background jobs via CLI
- ✅ Persistent job storage (SQLite)
- ✅ Multiple concurrent workers
- ✅ Automatic retries with exponential backoff
- ✅ Dead Letter Queue (DLQ)
- ✅ Configurable retry/backoff settings

---

## ⚙️ Tech Stack

| Component | Tool |
|-----------|------|
| Language | Node.js (LTS) |
| CLI | commander |
| Database | SQLite (better-sqlite3) |
| Process execution | child_process.spawn |
| UUIDs | uuid |

---

## 📦 Installation
```bash
npm install
```

---

## 🛠️ Usage

### Enqueue a job
```bash
node src/cli.js enqueue <command> [args...]
```

### Start worker(s)
```bash
node src/cli.js worker
```

### View queue status
```bash
node src/cli.js status
```

---

## 📂 Project Structure
```
queuectl/
├── src/
│   ├── cli.js          # CLI entry point
│   ├── queue.js        # Queue operations
│   ├── worker.js       # Worker logic
│   └── db.js           # Database connection
├── migrations/
│   └── 001_init.sql    # Database schema
├── .gitignore
├── package.json
└── README.md
```

---

## 🗄️ Database Schema

Jobs are stored in SQLite with the following fields:
- `id` (TEXT PRIMARY KEY)
- `command` (TEXT)
- `args` (TEXT - JSON)
- `status` (TEXT: 'pending', 'running', 'completed', 'failed', 'dlq')
- `attempts` (INTEGER)
- `max_retries` (INTEGER)
- `created_at` (DATETIME)
- `started_at` (DATETIME)
- `completed_at` (DATETIME)
- `error` (TEXT)

---

## 🔄 Retry Logic

- Initial delay: 1 second
- Exponential backoff multiplier: 2x
- Max retries: 3 (configurable)
- Jobs exceeding max retries move to DLQ

---

## 📝 Development Roadmap

- [x] Phase 0: Project skeleton + README
- [ ] Phase 1: Enqueue + persistence
- [ ] Phase 2: Worker + job execution
- [ ] Phase 3: Retry logic + exponential backoff
- [ ] Phase 4: DLQ implementation
- [ ] Phase 5: Testing + edge cases

---

## 📄 License

MIT

---

## 👤 Author

[Your Name]
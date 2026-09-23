CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    app TEXT NOT NULL,
    env TEXT NOT NULL,
    job_key TEXT NOT NULL,
    schedule TEXT,
    first_seen TEXT NOT NULL,
    last_seen TEXT NOT NULL,
    last_status TEXT,
    UNIQUE(app, env, job_key)
);

CREATE TABLE IF NOT EXISTS executions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    app TEXT NOT NULL,
    env TEXT NOT NULL,
    job_key TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    duration_ms INTEGER,
    error_class TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_executions_job
    ON executions(app, env, job_key, started_at);

-- Migration 003: Worker nodes and execution log tables.

CREATE TYPE worker_status AS ENUM (
    'ONLINE', 'BUSY', 'DRAINING', 'OFFLINE', 'LOST'
);

-- ─── Worker Nodes ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS workers (
    id                  UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    hostname            VARCHAR(255) NOT NULL,
    ip_address          INET        NOT NULL,
    pid                 INTEGER     NOT NULL,
    version             VARCHAR(50) NOT NULL,
    status              worker_status NOT NULL DEFAULT 'ONLINE',
    capabilities        JSONB NOT NULL DEFAULT '{}',
    stats               JSONB NOT NULL DEFAULT '{
        "totalJobsProcessed": 0,
        "totalJobsSucceeded": 0,
        "totalJobsFailed": 0,
        "totalJobsTimedOut": 0,
        "averageJobDurationMs": 0,
        "uptimeMs": 0,
        "currentLoad": 0.0
    }',
    current_job_count   SMALLINT    NOT NULL DEFAULT 0,
    max_concurrency     SMALLINT    NOT NULL DEFAULT 10,
    last_heartbeat_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    registered_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_workers_status     ON workers (status);
CREATE INDEX idx_workers_heartbeat  ON workers (last_heartbeat_at);

CREATE TRIGGER trg_workers_updated_at
    BEFORE UPDATE ON workers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── Execution Logs ───────────────────────────────────────────────────────────
-- Immutable audit log: one row per job execution attempt.

CREATE TYPE execution_status AS ENUM (
    'RUNNING', 'COMPLETED', 'FAILED', 'TIMED_OUT', 'CANCELLED'
);

CREATE TABLE IF NOT EXISTS execution_logs (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id          UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    worker_id       UUID NOT NULL,            -- NOT a FK: workers may be deregistered
    attempt_number  SMALLINT    NOT NULL,

    status          execution_status NOT NULL DEFAULT 'RUNNING',
    started_at      TIMESTAMPTZ NOT NULL,
    completed_at    TIMESTAMPTZ,
    duration_ms     INTEGER,

    -- Captured output (capped in application layer to avoid unbounded growth)
    stdout          TEXT,
    stderr          TEXT,
    exit_code       SMALLINT,
    result          JSONB,

    -- Error detail
    error_message   TEXT,
    error_stack     TEXT,
    error_code      VARCHAR(64),

    -- Resource usage snapshots
    peak_memory_mb  REAL,
    cpu_percent     REAL,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Execution logs are append-only; no updated_at trigger needed.

CREATE INDEX idx_exec_logs_job_id    ON execution_logs (job_id);
CREATE INDEX idx_exec_logs_worker_id ON execution_logs (worker_id);
CREATE INDEX idx_exec_logs_status    ON execution_logs (status);
CREATE INDEX idx_exec_logs_started   ON execution_logs (started_at DESC);

-- ─── Knex migrations bookkeeping table is auto-managed by Knex ────────────────
-- (knex_migrations and knex_migrations_lock)

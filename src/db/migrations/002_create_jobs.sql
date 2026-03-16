-- Migration 002: Jobs table
-- Central table for all job definitions and their current state.

CREATE TYPE job_status AS ENUM (
    'PENDING', 'QUEUED', 'RUNNING', 'COMPLETED',
    'FAILED', 'RETRYING', 'CANCELLED', 'TIMED_OUT', 'SKIPPED'
);

CREATE TYPE job_priority AS ENUM (
    'CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'BACKGROUND'
);

CREATE TYPE job_type AS ENUM (
    'HTTP_REQUEST', 'SHELL_COMMAND', 'DATA_PIPELINE',
    'EMAIL_NOTIFICATION', 'REPORT_GENERATION', 'FILE_PROCESSING',
    'DATABASE_CLEANUP', 'WEBHOOK', 'CUSTOM'
);

CREATE TABLE IF NOT EXISTS jobs (
    -- Identity
    id                          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
    name                        VARCHAR(255) NOT NULL,
    description                 TEXT,
    type                        job_type    NOT NULL,
    payload                     JSONB       NOT NULL DEFAULT '{}',

    -- Lifecycle
    status                      job_status  NOT NULL DEFAULT 'PENDING',
    priority                    job_priority NOT NULL DEFAULT 'MEDIUM',

    -- Scheduling
    scheduled_at                TIMESTAMPTZ,
    cron_expression             VARCHAR(100),
    timezone                    VARCHAR(100) NOT NULL DEFAULT 'UTC',
    next_run_at                 TIMESTAMPTZ,
    last_run_at                 TIMESTAMPTZ,

    -- Execution tracking
    worker_id                   UUID,
    started_at                  TIMESTAMPTZ,
    completed_at                TIMESTAMPTZ,
    timeout_ms                  INTEGER NOT NULL DEFAULT 300000,

    -- Retry configuration (embedded JSONB for flexibility)
    retry_config                JSONB NOT NULL DEFAULT '{
        "maxRetries": 3,
        "retryDelay": 5000,
        "retryBackoff": "EXPONENTIAL",
        "retryOn": []
    }',
    retry_count                 SMALLINT NOT NULL DEFAULT 0,
    max_retries                 SMALLINT NOT NULL DEFAULT 3,

    -- Dependencies (array of {jobId, requireStatus[]} objects)
    dependencies                JSONB NOT NULL DEFAULT '[]',
    dependency_count            SMALLINT NOT NULL DEFAULT 0,
    resolved_dependency_count   SMALLINT NOT NULL DEFAULT 0,

    -- Output
    result                      JSONB,
    error_message               TEXT,
    error_stack                 TEXT,
    exit_code                   SMALLINT,

    -- Metadata
    organization_id             UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    created_by                  UUID NOT NULL,
    tags                        TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    metadata                    JSONB NOT NULL DEFAULT '{}',
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Indexes ──────────────────────────────────────────────────────────────────

-- Primary query patterns
CREATE INDEX idx_jobs_status          ON jobs (status);
CREATE INDEX idx_jobs_priority_status ON jobs (priority DESC, status, scheduled_at ASC NULLS LAST);
CREATE INDEX idx_jobs_org             ON jobs (organization_id);
CREATE INDEX idx_jobs_scheduled_at    ON jobs (scheduled_at) WHERE scheduled_at IS NOT NULL;
CREATE INDEX idx_jobs_next_run_at     ON jobs (next_run_at)  WHERE next_run_at IS NOT NULL;
CREATE INDEX idx_jobs_created_by      ON jobs (created_by);
CREATE INDEX idx_jobs_worker          ON jobs (worker_id)    WHERE worker_id IS NOT NULL;
CREATE INDEX idx_jobs_tags            ON jobs USING GIN (tags);
CREATE INDEX idx_jobs_metadata        ON jobs USING GIN (metadata);

-- Scheduler-critical index: grab all runnable jobs efficiently
CREATE INDEX idx_jobs_runnable ON jobs (priority DESC, scheduled_at ASC)
    WHERE status IN ('PENDING', 'QUEUED') AND scheduled_at IS NOT NULL;

-- Full-text search
CREATE INDEX idx_jobs_name_trgm ON jobs USING GIN (name gin_trgm_ops);

-- ─── Trigger ──────────────────────────────────────────────────────────────────
CREATE TRIGGER trg_jobs_updated_at
    BEFORE UPDATE ON jobs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─── Schedules table ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS schedules (
    id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name                    VARCHAR(255) NOT NULL,
    description             TEXT,
    cron_expression         VARCHAR(100) NOT NULL,
    timezone                VARCHAR(100) NOT NULL DEFAULT 'UTC',
    job_template            JSONB NOT NULL,
    is_active               BOOLEAN NOT NULL DEFAULT TRUE,
    last_triggered_at       TIMESTAMPTZ,
    next_trigger_at         TIMESTAMPTZ,
    total_triggered_count   INTEGER NOT NULL DEFAULT 0,
    organization_id         UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    created_by              UUID NOT NULL,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_schedules_org          ON schedules (organization_id);
CREATE INDEX idx_schedules_active_next  ON schedules (next_trigger_at) WHERE is_active = TRUE;

CREATE TRIGGER trg_schedules_updated_at
    BEFORE UPDATE ON schedules
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

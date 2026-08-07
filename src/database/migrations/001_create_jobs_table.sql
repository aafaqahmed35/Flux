-- Migration: 001_create_jobs_table.sql
-- Description: Create canonical jobs entity table, constraints, and indexes for background task processing.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    queue_name VARCHAR(255) NOT NULL,
    idempotency_key VARCHAR(255) NULL,
    worker_id VARCHAR(255) NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(50) NOT NULL DEFAULT 'PENDING',
    priority VARCHAR(50) NOT NULL DEFAULT 'NORMAL',
    retry_count INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 3,
    retry_delay INTEGER NOT NULL DEFAULT 1000,
    next_retry_at TIMESTAMPTZ NULL,
    scheduled_for TIMESTAMPTZ NULL,
    delay_until TIMESTAMPTZ NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    locked_at TIMESTAMPTZ NULL,
    started_at TIMESTAMPTZ NULL,
    completed_at TIMESTAMPTZ NULL,
    failed_at TIMESTAMPTZ NULL,
    execution_time_ms INTEGER NULL,
    error_message TEXT NULL,
    error_stack TEXT NULL,
    failure_reason TEXT NULL,
    CONSTRAINT chk_jobs_status CHECK (status IN ('PENDING', 'QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'RETRYING', 'CANCELLED', 'DELAYED')),
    CONSTRAINT chk_jobs_priority CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'CRITICAL')),
    CONSTRAINT chk_jobs_retry_count CHECK (retry_count >= 0),
    CONSTRAINT chk_jobs_max_retries CHECK (max_retries >= 0),
    CONSTRAINT chk_jobs_retry_delay CHECK (retry_delay >= 0),
    CONSTRAINT chk_jobs_attempts CHECK (attempts >= 0),
    CONSTRAINT chk_jobs_version CHECK (version >= 1)
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_queue_name ON jobs(queue_name);
CREATE INDEX IF NOT EXISTS idx_jobs_scheduled_for ON jobs(scheduled_for) WHERE scheduled_for IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_created_at ON jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_priority ON jobs(priority);
CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_queue_idempotency ON jobs(queue_name, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_queue_status ON jobs(queue_name, status);
CREATE INDEX IF NOT EXISTS idx_jobs_status_priority_created ON jobs(status, priority, created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_worker_id ON jobs(worker_id) WHERE worker_id IS NOT NULL;

-- Migration: 004_retry_metadata.sql
-- Description: Add retry metadata, dead letter fields, chk_jobs_status DEAD_LETTER update, and job_retry_history table.

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS retry_strategy VARCHAR(50) NOT NULL DEFAULT 'EXPONENTIAL_WITH_JITTER';
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS last_retry_at TIMESTAMPTZ NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS last_failure_type TEXT NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS last_failure_code TEXT NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS dead_lettered_at TIMESTAMPTZ NULL;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS dead_letter_reason TEXT NULL;

ALTER TABLE jobs DROP CONSTRAINT IF EXISTS chk_jobs_status;

ALTER TABLE jobs ADD CONSTRAINT chk_jobs_status
    CHECK (status IN ('PENDING', 'QUEUED', 'CLAIMED', 'RUNNING', 'COMPLETED', 'FAILED', 'RETRYING', 'CANCELLED', 'DELAYED', 'DEAD_LETTER'));

CREATE TABLE IF NOT EXISTS job_retry_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    attempt INTEGER NOT NULL,
    strategy VARCHAR(50) NOT NULL,
    delay_ms INTEGER NOT NULL,
    scheduled_at TIMESTAMPTZ NULL,
    started_at TIMESTAMPTZ NULL,
    failed_at TIMESTAMPTZ NULL,
    completed_at TIMESTAMPTZ NULL,
    failure_reason TEXT NULL,
    failure_code TEXT NULL,
    worker_id VARCHAR(255) NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_jobs_next_retry_at ON jobs(next_retry_at) WHERE next_retry_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_dead_lettered_at ON jobs(dead_lettered_at) WHERE dead_lettered_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_job_retry_history_job_id ON job_retry_history(job_id);
CREATE INDEX IF NOT EXISTS idx_job_retry_history_created_at ON job_retry_history(created_at DESC);

-- Migration: 006_schedule_execution_history
-- Purpose: Relational history tracking table for recurring schedule execution attempts

CREATE TABLE IF NOT EXISTS schedule_execution_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    schedule_id UUID NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
    job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finished_at TIMESTAMPTZ,
    status VARCHAR(50) NOT NULL,
    execution_time_ms INTEGER,
    worker_id VARCHAR(255),
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_schedule_execution_history_schedule_id ON schedule_execution_history(schedule_id);
CREATE INDEX IF NOT EXISTS idx_schedule_execution_history_job_id ON schedule_execution_history(job_id);
CREATE INDEX IF NOT EXISTS idx_schedule_execution_history_created_at ON schedule_execution_history(created_at DESC);

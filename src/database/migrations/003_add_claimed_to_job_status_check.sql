-- Migration: 003_add_claimed_to_job_status_check.sql
-- Description: Add 'CLAIMED' to chk_jobs_status check constraint in jobs table.

ALTER TABLE jobs DROP CONSTRAINT IF EXISTS chk_jobs_status;

ALTER TABLE jobs ADD CONSTRAINT chk_jobs_status
    CHECK (status IN ('PENDING', 'QUEUED', 'CLAIMED', 'RUNNING', 'COMPLETED', 'FAILED', 'RETRYING', 'CANCELLED', 'DELAYED'));

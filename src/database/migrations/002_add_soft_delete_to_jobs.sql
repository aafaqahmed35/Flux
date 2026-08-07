-- Migration: 002_add_soft_delete_to_jobs.sql
-- Description: Add soft delete support (is_deleted, deleted_at) to jobs table for auditability and replay support.

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_jobs_is_deleted ON jobs(is_deleted) WHERE is_deleted = TRUE;

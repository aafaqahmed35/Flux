import { JobPriority, JobStatus } from '../constants/job.constants.js';

export interface RetryConfiguration {
  maxRetries: number;
  retryDelay: number;
}

export interface Job {
  id: string;
  name: string;
  queueName: string;
  idempotencyKey: string | null;
  workerId: string | null;
  payload: Record<string, unknown>;
  metadata: Record<string, unknown>;
  status: JobStatus;
  priority: JobPriority;
  retryCount: number;
  maxRetries: number;
  retryDelay: number;
  nextRetryAt: Date | null;
  scheduledFor: Date | null;
  delayUntil: Date | null;
  attempts: number;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  lockedAt: Date | null;
  startedAt: Date | null;
  completedAt: Date | null;
  failedAt: Date | null;
  executionTimeMs: number | null;
  errorMessage: string | null;
  errorStack: string | null;
  failureReason: string | null;
  isDeleted: boolean;
  deletedAt: Date | null;
}

export interface CreateJobRequest {
  name: string;
  queueName: string;
  payload?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  priority?: JobPriority;
  maxRetries?: number;
  retryDelay?: number;
  scheduledFor?: Date | string | null;
  delayUntil?: Date | string | null;
  idempotencyKey?: string | null;
}

export interface UpdateJobRequest {
  status?: JobStatus;
  workerId?: string | null;
  retryCount?: number;
  maxRetries?: number;
  retryDelay?: number;
  nextRetryAt?: Date | null;
  scheduledFor?: Date | null;
  delayUntil?: Date | null;
  attempts?: number;
  version?: number;
  lockedAt?: Date | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
  failedAt?: Date | null;
  executionTimeMs?: number | null;
  errorMessage?: string | null;
  errorStack?: string | null;
  failureReason?: string | null;
  metadata?: Record<string, unknown>;
  isDeleted?: boolean;
  deletedAt?: Date | null;
}

export interface UpdateRetryInput {
  retryCount: number;
  nextRetryAt?: Date | null;
  status?: JobStatus;
  errorMessage?: string | null;
  errorStack?: string | null;
  failureReason?: string | null;
}

export interface UpdateExecutionMetadataInput {
  attempts?: number;
  workerId?: string | null;
  lockedAt?: Date | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
  failedAt?: Date | null;
  executionTimeMs?: number | null;
  errorMessage?: string | null;
  errorStack?: string | null;
  failureReason?: string | null;
  metadata?: Record<string, unknown>;
}

export interface ListJobsOptions {
  queueName?: string;
  status?: JobStatus;
  priority?: JobPriority;
  workerId?: string;
  createdAfter?: Date;
  createdBefore?: Date;
  scheduledAfter?: Date;
  scheduledBefore?: Date;
  includeDeleted?: boolean;
  limit?: number;
  offset?: number;
  orderBy?: 'createdAt' | 'priority' | 'status' | 'scheduledFor';
  orderDirection?: 'ASC' | 'DESC';
}

export interface CountJobsOptions {
  queueName?: string;
  status?: JobStatus;
  priority?: JobPriority;
  workerId?: string;
  createdAfter?: Date;
  createdBefore?: Date;
  scheduledAfter?: Date;
  scheduledBefore?: Date;
  includeDeleted?: boolean;
}

export interface PaginatedJobsResult {
  jobs: Job[];
  total: number;
  limit: number;
  offset: number;
}

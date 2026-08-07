import { JobPriority, JobStatus } from '../constants/job.constants.js';
import { RetryStrategy } from '../retry/retry.constants.js';

export interface RetryConfiguration {
  maxRetries: number;
  retryDelay: number;
  retryStrategy?: RetryStrategy;
}

export interface RetryHistoryRecord {
  id: string;
  jobId: string;
  attempt: number;
  strategy: string;
  delayMs: number;
  scheduledAt: Date | null;
  startedAt: Date | null;
  failedAt: Date | null;
  completedAt: Date | null;
  failureReason: string | null;
  failureCode: string | null;
  workerId: string | null;
  createdAt: Date;
}

export interface CreateRetryHistoryRecordInput {
  jobId: string;
  attempt: number;
  strategy: string;
  delayMs: number;
  scheduledAt?: Date | null;
  startedAt?: Date | null;
  failedAt?: Date | null;
  completedAt?: Date | null;
  failureReason?: string | null;
  failureCode?: string | null;
  workerId?: string | null;
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
  retryStrategy: RetryStrategy;
  nextRetryAt: Date | null;
  lastRetryAt: Date | null;
  lastFailureType: string | null;
  lastFailureCode: string | null;
  deadLetteredAt: Date | null;
  deadLetterReason: string | null;
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
  retryStrategy?: RetryStrategy;
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
  retryStrategy?: RetryStrategy;
  nextRetryAt?: Date | null;
  lastRetryAt?: Date | null;
  lastFailureType?: string | null;
  lastFailureCode?: string | null;
  deadLetteredAt?: Date | null;
  deadLetterReason?: string | null;
  scheduledFor?: Date | null;
  delayUntil?: Date | null;
  attempts?: number;
  version?: number;
  expectedVersion?: number;
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
  lastRetryAt?: Date | null;
  status?: JobStatus;
  errorMessage?: string | null;
  errorStack?: string | null;
  failureReason?: string | null;
  lastFailureType?: string | null;
  lastFailureCode?: string | null;
  deadLetteredAt?: Date | null;
  deadLetterReason?: string | null;
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

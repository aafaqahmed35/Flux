import { JobPriority, JobStatus } from '../constants/job.constants.js';
import { Job } from '../types/job.types.js';

export interface CreateJobRequestDTO {
  name: string;
  queueName: string;
  payload?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  priority?: JobPriority;
  maxRetries?: number;
  retryDelay?: number;
  scheduledFor?: string | Date | null;
  delayUntil?: string | Date | null;
  idempotencyKey?: string | null;
}

export interface JobResponseDTO {
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
  nextRetryAt: string | null;
  scheduledFor: string | null;
  delayUntil: string | null;
  attempts: number;
  version: number;
  createdAt: string;
  updatedAt: string;
  lockedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  failedAt: string | null;
  executionTimeMs: number | null;
  errorMessage: string | null;
  errorStack: string | null;
  failureReason: string | null;
  isDeleted: boolean;
  deletedAt: string | null;
}

export interface CreateJobResponseDTO {
  job: JobResponseDTO;
  isDuplicate: boolean;
}

export interface PaginationMetaDTO {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

export interface ListJobsResponseDTO {
  items: JobResponseDTO[];
  pagination: PaginationMetaDTO;
}

export interface CancelJobResponseDTO {
  job: JobResponseDTO;
  cancelledAt: string;
}

export interface DeleteJobResponseDTO {
  id: string;
  deleted: true;
  deletedAt: string;
}

export const mapJobToDTO = (job: Job): JobResponseDTO => {
  return {
    id: job.id,
    name: job.name,
    queueName: job.queueName,
    idempotencyKey: job.idempotencyKey,
    workerId: job.workerId,
    payload: job.payload,
    metadata: job.metadata,
    status: job.status,
    priority: job.priority,
    retryCount: job.retryCount,
    maxRetries: job.maxRetries,
    retryDelay: job.retryDelay,
    nextRetryAt: job.nextRetryAt ? job.nextRetryAt.toISOString() : null,
    scheduledFor: job.scheduledFor ? job.scheduledFor.toISOString() : null,
    delayUntil: job.delayUntil ? job.delayUntil.toISOString() : null,
    attempts: job.attempts,
    version: job.version,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    lockedAt: job.lockedAt ? job.lockedAt.toISOString() : null,
    startedAt: job.startedAt ? job.startedAt.toISOString() : null,
    completedAt: job.completedAt ? job.completedAt.toISOString() : null,
    failedAt: job.failedAt ? job.failedAt.toISOString() : null,
    executionTimeMs: job.executionTimeMs,
    errorMessage: job.errorMessage,
    errorStack: job.errorStack,
    failureReason: job.failureReason,
    isDeleted: job.isDeleted,
    deletedAt: job.deletedAt ? job.deletedAt.toISOString() : null,
  };
};

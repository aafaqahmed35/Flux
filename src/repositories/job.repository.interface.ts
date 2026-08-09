import { JobStatus } from '../constants/job.constants.js';
import {
  CountJobsOptions,
  CreateJobRequest,
  CreateRetryHistoryRecordInput,
  Job,
  ListJobsOptions,
  PaginatedJobsResult,
  RetryHistoryRecord,
  UpdateExecutionMetadataInput,
  UpdateJobRequest,
  UpdateRetryInput,
} from '../types/job.types.js';

export interface IJobRepository {
  createJob(request: CreateJobRequest): Promise<Job>;
  findById(id: string): Promise<Job | null>;
  findByIdempotencyKey(queueName: string, idempotencyKey: string): Promise<Job | null>;
  findByStatus(status: JobStatus, options?: Partial<ListJobsOptions>): Promise<Job[]>;
  findByQueue(queueName: string, options?: Partial<ListJobsOptions>): Promise<Job[]>;
  findReadyJobs(queueName?: string, limit?: number): Promise<Job[]>;
  findScheduledJobs(beforeDate?: Date, limit?: number): Promise<Job[]>;
  findDueRetries(limit?: number): Promise<Job[]>;
  updateStatus(
    id: string,
    newStatus: JobStatus,
    additionalData?: Partial<UpdateJobRequest>,
  ): Promise<Job>;
  updateRetry(id: string, retryData: UpdateRetryInput): Promise<Job>;
  updateExecutionMetadata(id: string, metadata: UpdateExecutionMetadataInput): Promise<Job>;
  addRetryHistoryRecord(input: CreateRetryHistoryRecordInput): Promise<RetryHistoryRecord>;
  getJobRetryHistory(jobId: string): Promise<RetryHistoryRecord[]>;
  cancelJob(id: string, reason?: string): Promise<Job>;
  deleteJob(id: string): Promise<boolean>;
  exists(id: string): Promise<boolean>;
  count(options?: CountJobsOptions): Promise<number>;
  countByStatus(queueName?: string): Promise<Record<JobStatus, number>>;
  listJobs(options?: ListJobsOptions): Promise<PaginatedJobsResult>;

  // Recovery operations
  findStaleRunningJobs(leaseTimeoutMs: number, limit?: number): Promise<Job[]>;
  findClaimedJobs(leaseTimeoutMs: number, limit?: number): Promise<Job[]>;
  findRecoverablePendingJobs(staleThresholdMs: number, limit?: number): Promise<Job[]>;
  findRetryingJobs(limit?: number): Promise<Job[]>;
  recoverStaleJob(
    jobId: string,
    fromStatus: JobStatus,
    targetStatus: JobStatus,
    reason: string,
  ): Promise<boolean>;
  recoverPendingJob(jobId: string): Promise<boolean>;
  updateJobLease(jobId: string, workerId: string): Promise<boolean>;
}
